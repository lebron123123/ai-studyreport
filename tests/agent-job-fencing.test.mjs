import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createAgentRun,ensureAgentRuntime} from '../functions/api/_agent-runtime.js';
import {ensureAgentEnterprise,enqueueAgentJob,claimAgentJob,settleAgentJob,heartbeatAgentJob,executeLlmTask,upsertRunGovernance} from '../functions/api/_agent-enterprise.js';
import {withAgentJobLease,AgentLeaseLostError} from '../functions/api/_agent-job-fence.js';
import {onRequestPost} from '../functions/api/agentjobs.js';
import {signToken} from '../functions/api/_auth.js';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const target=process.env.AGENT_TEST_DATABASE_URL;
test('真实PostgreSQL：接管、取消、事务回滚、迟到结果、重复入队', {skip:!target},async t=>{
  const u=new URL(target);assert.match(u.pathname,/^\/studyreport_restore_\d+$/,'只允许独立恢复测试库');
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(u.hostname));
  const DB=createD1Shim(target),env={DB,SESSION_SECRET:'isolated-'+crypto.randomUUID()},prefix='[系统测试]'+crypto.randomUUID();
  try{
    await ensureAgentRuntime(env);await ensureAgentEnterprise(env);
    const user=await DB.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();assert.ok(user);
    async function job(){const {run}=await createAgentRun(env,user.id,{query:prefix,idempotencyKey:prefix+crypto.randomUUID()});return enqueueAgentJob(env,user.id,run.id,{payload:{query:prefix}});}
    async function claim(j,owner){await DB.prepare("UPDATE agent_jobs SET priority=10,created_at=0 WHERE id=?").bind(j.id).run();const c=await claimAgentJob(env,owner,60000);assert.equal(c?.id,j.id);return c;}
    await t.test('并发幂等创建返回同一运行和任务',async()=>{
      const key=prefix+'idem',runs=await Promise.all(Array.from({length:5},()=>createAgentRun(env,user.id,{idempotencyKey:key,query:prefix})));
      assert.equal(new Set(runs.map(x=>x.run.id)).size,1);
      const jobs=await Promise.all(runs.map(x=>enqueueAgentJob(env,user.id,x.run.id,{})));assert.equal(new Set(jobs.map(x=>x.id)).size,1);
      await DB.prepare("UPDATE agent_jobs SET status='cancelled' WHERE id=?").bind(jobs[0].id).run();
    });
    await t.test('同一owner的旧代次也不能续租或结算',async()=>{
      const j=await job(),a=await claim(j,'same-owner');await DB.prepare('UPDATE agent_jobs SET lease_expires_at=0 WHERE id=?').bind(j.id).run();
      const b=await claim(j,'same-owner');assert.equal(b.attempts,a.attempts+1);
      assert.equal(await heartbeatAgentJob(env,j.id,a.lease_owner,60000,a.attempts),false);
      assert.equal(await settleAgentJob(env,a,true),'lease_lost');
      await assert.rejects(()=>withAgentJobLease(env,a,async()=>{}),AgentLeaseLostError);
      assert.equal(await settleAgentJob(env,b,true),'completed');
    });
    await t.test('幂等重试不重设预算和作用域',async()=>{
      const a=await job();
      await upsertRunGovernance(env,user.id,a.run_id,{budgetOutputTokens:500,securityLevel:2});
      await upsertRunGovernance(env,user.id,a.run_id,{budgetOutputTokens:0,securityLevel:1});
      const g=await DB.prepare('SELECT budget_output_tokens,security_level FROM agent_run_governance WHERE run_id=?').bind(a.run_id).first();
      assert.equal(g.budget_output_tokens,500);assert.equal(g.security_level,2);
      await DB.prepare("UPDATE agent_jobs SET status='cancelled' WHERE id=?").bind(a.id).run();
    });
    await t.test('外部结果不确定停止自动重试',async()=>{
      const a=await claim(await job(),'uncertain');
      assert.equal(await settleAgentJob(env,a,false,'外部执行结果不确定：需人工对账'),'dead');
    });
    await t.test('事务失败不遗留部分run写入',async()=>{
      const a=await claim(await job(),'rollback');
      await assert.rejects(()=>withAgentJobLease(env,a,async scoped=>{await scoped.DB.prepare("UPDATE agent_runs SET output_json='changed' WHERE id=?").bind(a.run_id).run();throw new Error('test rollback');}),/test rollback/);
      assert.equal((await DB.prepare('SELECT output_json FROM agent_runs WHERE id=?').bind(a.run_id).first()).output_json,'{}');await settleAgentJob(env,a,true);
    });
    await t.test('取消后模型迟到保留费用记录但不写成果',async()=>{
      const a=await claim(await job(),'late'),oldFetch=globalThis.fetch;let release,started;
      const entered=new Promise(r=>{started=r;});
      globalThis.fetch=async()=>{started();return new Promise(r=>{release=()=>r(new Response(JSON.stringify({choices:[{message:{content:'迟到正文不得写回'}}],usage:{prompt_tokens:2,completion_tokens:3}}),{headers:{'content-type':'application/json'}}));});};
      try{
        const execution=executeLlmTask({...env,DEEPSEEK_API_KEY:'test-only',DEEPSEEK_API_URL:'http://test.invalid/chat/completions'},a,{query:prefix});
        const rejected=assert.rejects(execution,AgentLeaseLostError);await entered;
        const token=await signToken(env,user.id,user.username);
        const response=await onRequestPost({env,request:new Request('http://test/api/agentjobs',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'cancel',id:a.id})})});assert.equal(response.status,200);
        release();await rejected;
        assert.equal((await DB.prepare('SELECT status FROM agent_runs WHERE id=?').bind(a.run_id).first()).status,'cancelled');
        assert.equal((await DB.prepare('SELECT count(*) AS n FROM agent_checkpoints WHERE run_id=?').bind(a.run_id).first()).n,0);
        assert.equal((await DB.prepare('SELECT count(*) AS n FROM agent_run_usage WHERE run_id=?').bind(a.run_id).first()).n,1);
        assert.equal(await settleAgentJob(env,a,false,'late'),'lease_lost');
      }finally{globalThis.fetch=oldFetch;}
    });
    await t.test('完成后取消返回冲突且不把run改成取消',async()=>{
      const a=await claim(await job(),'done');await settleAgentJob(env,a,true);
      const token=await signToken(env,user.id,user.username),response=await onRequestPost({env,request:new Request('http://test/api/agentjobs',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'cancel',id:a.id})})});
      assert.equal(response.status,409);assert.notEqual((await DB.prepare('SELECT status FROM agent_runs WHERE id=?').bind(a.run_id).first()).status,'cancelled');
    });
    await t.test('真实子进程崩溃后接管：未确定的付费请求不再次发送',async()=>{
      const a=await claim(await job(),'crash-A');
      const code=`import {createD1Shim} from './local-server/d1-shim.js';import {executeLlmTask} from './functions/api/_agent-enterprise.js';
        const DB=createD1Shim(process.env.AGENT_TEST_DATABASE_URL),job=JSON.parse(process.env.TEST_JOB_JSON);
        globalThis.fetch=async()=>{process.send('request-started');return new Promise(()=>setInterval(()=>{},1000));};
        await executeLlmTask({DB,DEEPSEEK_API_KEY:'test-only',DEEPSEEK_API_URL:'http://test.invalid/chat/completions'},job,{query:'[系统测试]崩溃'});`;
      const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TEST_JOB_JSON:JSON.stringify(a)},stdio:['ignore','ignore','ignore','ipc']});
      let timer;try{
        const message=await Promise.race([once(child,'message'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('子进程未进入请求')),10000);})]);assert.equal(message[0],'request-started');
        const exited=once(child,'exit');child.kill('SIGKILL');await exited;
      }finally{clearTimeout(timer);if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');}
      await DB.prepare('UPDATE agent_jobs SET lease_expires_at=0 WHERE id=?').bind(a.id).run();const b=await claim(a,'crash-B');
      const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('不得重复调用');};
      try{await assert.rejects(()=>executeLlmTask({...env,DEEPSEEK_API_KEY:'test-only',DEEPSEEK_API_URL:'http://test.invalid/chat/completions'},b,{query:prefix}),/未对账调用/);assert.equal(calls,0);assert.equal(await settleAgentJob(env,b,false,'外部执行结果不确定：需对账'),'dead');}
      finally{globalThis.fetch=previous;}
      assert.equal((await DB.prepare('SELECT count(*) AS n FROM agent_call_ledger WHERE run_id=?').bind(a.run_id).first()).n,1);
    });
  }finally{await DB._close();}
});
