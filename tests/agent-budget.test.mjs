import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {ensureAgentRuntime,createAgentRun} from '../functions/api/_agent-runtime.js';
import {ensureAgentEnterprise,upsertRunGovernance} from '../functions/api/_agent-enterprise.js';
import {agentPrice,agentUsage,reserveAgentCall,settleAgentCall,markAgentCallUnknown} from '../functions/api/_agent-budget.js';
test('预算价格和用量：未知不能冒充零，负数和小数拒绝',()=>{
  assert.equal(agentPrice({},'p','m'),null);
  assert.equal(agentUsage({}),null);
  assert.equal(agentUsage({prompt_tokens:null,completion_tokens:2}),null);
  assert.equal(agentUsage({prompt_tokens:'',completion_tokens:2}),null);
  assert.equal(agentUsage({prompt_tokens:-1,completion_tokens:2}),null);
  assert.equal(agentUsage({prompt_tokens:1.5,completion_tokens:2}),null);
  assert.deepEqual(agentUsage({prompt_tokens:0,completion_tokens:0}),{input:0,output:0});
});
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
const target=testDatabaseUrl();
test('PostgreSQL原子预算：并发预留、重复结算、未知调用与子任务汇总',{skip:!target},async t=>{
  const url=new URL(target);assert.match(url.pathname,/^\/studyreport_restore_\d+$/);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const DB=createD1Shim(target),env={DB,LLM_COSTS_JSON:JSON.stringify({p:{inputPerMillion:1,outputPerMillion:2}})};
  try{
    await ensureAgentRuntime(env);await ensureAgentEnterprise(env);
    const user=await DB.prepare('SELECT id FROM users ORDER BY id LIMIT 1').first();
    async function run(governance={}){const {run}=await createAgentRun(env,user.id,{query:'[系统测试]预算',idempotencyKey:crypto.randomUUID()});await upsertRunGovernance(env,user.id,run.id,governance);return run.id;}
    function call(runId,id=crypto.randomUUID()){return {id,runId,userId:user.id,provider:'p',model:'m',messages:[{role:'user',content:'test'}],maxTokens:200};}
    await t.test('并发不超卖，幂等结算和响应重用',async()=>{
      const root=await run({budgetOutputTokens:300}),a=call(root),b=call(root);
      const outcomes=await Promise.allSettled([reserveAgentCall(env,a),reserveAgentCall(env,b)]);
      assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
      const winner=outcomes[0].status==='fulfilled'?a:b;
      const result={text:'已完成',provider:'p',model:'m'};
      await Promise.all([settleAgentCall(env,winner.id,result,{prompt_tokens:10,completion_tokens:20}),settleAgentCall(env,winner.id,result,{prompt_tokens:10,completion_tokens:20})]);
      const g=await DB.prepare('SELECT input_tokens,output_tokens,cost_micros FROM agent_run_governance WHERE run_id=?').bind(root).first();
      assert.equal(Number(g.input_tokens),10);assert.equal(Number(g.output_tokens),20);assert.equal(Number(g.cost_micros),50);
      assert.deepEqual(await reserveAgentCall(env,winner),{reused:true,result});
    });
    await t.test('结果未知不重发，缺usage仍保留预留且可恢复正文',async()=>{
      const root=await run(),a=call(root);await reserveAgentCall(env,a);await markAgentCallUnknown(env,a.id);
      await assert.rejects(()=>reserveAgentCall(env,a),/外部执行结果不确定/);
      const b=call(root);await reserveAgentCall(env,b);await settleAgentCall(env,b.id,{text:'正文'},{});
      assert.equal((await reserveAgentCall(env,b)).result.text,'正文');
      const row=await DB.prepare('SELECT status,actual_cost FROM agent_call_ledger WHERE id=?').bind(b.id).first();assert.equal(row.status,'usage_unknown');assert.equal(row.actual_cost,null);
    });
    await t.test('子任务预留共享根预算，结算根与子各记一次',async()=>{
      const root=await run({budgetOutputTokens:300}),child=await run({rootRunId:root,parentRunId:root}),a=call(child);
      await reserveAgentCall(env,a);await assert.rejects(()=>reserveAgentCall(env,call(root)),/预算不足/);
      await settleAgentCall(env,a.id,{text:'子任务'}, {prompt_tokens:2,completion_tokens:3});
      for(const id of [root,child])assert.equal(Number((await DB.prepare('SELECT output_tokens FROM agent_run_governance WHERE run_id=?').bind(id).first()).output_tokens),3);
    });
    await t.test('费用预算没有价格则拒绝，事务缺失则拒绝',async()=>{
      const root=await run({budgetCostMicros:10000});await assert.rejects(()=>reserveAgentCall({...env,LLM_COSTS_JSON:'{}'},call(root)),/价格未配置/);
      const noTx={prepare:DB.prepare.bind(DB)};await assert.rejects(()=>reserveAgentCall({...env,DB:noTx},call(root)),/支持事务/);
    });
  }finally{await DB._close();}
});
