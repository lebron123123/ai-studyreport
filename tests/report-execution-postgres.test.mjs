import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {startReportSection,readReportSection} from '../functions/api/reportexecution.js';
import {registerReportCase,startReportEvaluation,trustedReportEvaluations,scoreReportCase,reportCandidateBinding,reportEvidenceHash} from '../functions/api/_report-trusted-evaluation.js';
import {executeLlmTask,settleAgentJob} from '../functions/api/_agent-enterprise.js';
import {signToken} from '../functions/api/_auth.js';
import * as projects from '../functions/api/projects.js';
import * as orchestration from '../functions/api/reportorchestration.js';
test('受控检查不把空输出或关键词检查冒充语义准确率',()=>{
  assert.equal(scoreReportCase({required:['依据'],forbidden:['主项目']},'依据已核对').passed,true);
  assert.equal(scoreReportCase({required:['依据'],forbidden:['主项目']},'主项目依据').passed,false);
  assert.equal(scoreReportCase({required:[],forbidden:[]},'').passed,false);
  assert.equal(scoreReportCase({required:['依据'],forbidden:[]},'依据').semanticAccuracyVerified,false);
});
const target=process.env.AGENT_TEST_DATABASE_URL;
test('真实数据库：报告任务、受控评测、发布消费与回滚',{skip:!target},async t=>{
  const url=new URL(target);assert.match(url.pathname,/^\/studyreport_restore_\d+$/);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const DB=createD1Shim(target),env={DB,SESSION_SECRET:crypto.randomUUID(),ADMIN_USERS:'test-admin',DEEPSEEK_API_KEY:'test-only',DEEPSEEK_API_URL:'http://test.invalid/chat/completions'},pid=crypto.randomUUID();
  let user,token;
  async function request(api,body){const r=await api.onRequestPost({env,request:new Request('http://test/api/test',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};}
  async function finish(runId,text){
    await DB.prepare("UPDATE agent_jobs SET status='running',lease_owner='isolated-test',lease_expires_at=?,attempts=attempts+1 WHERE run_id=?").bind(Date.now()+60000,runId).run();
    const job=await DB.prepare('SELECT * FROM agent_jobs WHERE run_id=?').bind(runId).first(),oldFetch=globalThis.fetch;
    let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:text}}],usage:{prompt_tokens:5,completion_tokens:10}}),{headers:{'content-type':'application/json'}});};
    try{await executeLlmTask(env,job,JSON.parse(job.payload_json));await settleAgentJob(env,job,true);return calls;}finally{globalThis.fetch=oldFetch;}
  }
  try{
    user=Number((await DB.prepare('SELECT id FROM users ORDER BY id LIMIT 1').first()).id);token=await signToken(env,user,'test-admin');
    assert.equal((await request(projects,{id:pid,name:'[系统测试]报告任务闭环',data:{project:{businessScenario:'housing_conversion'},chapters:[]}})).status,200);
    const input={projectId:pid,sectionKey:'第一章 / 编制依据',system:'正式行文',user:'依据资料。'+('资料'.repeat(18000))};let first;
    await t.test('并发重复入队只有一份，长输入完整，重连恢复不再调用模型',async()=>{
      const tasks=await Promise.all([startReportSection(env,user,input),startReportSection(env,user,input)]);assert.equal(tasks[0].id,tasks[1].id);first=tasks[0];
      const payload=JSON.parse((await DB.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(first.runId).first()).payload_json);assert.equal(payload.query,input.user);
      assert.equal(await finish(first.runId,'依据已经核对'),1);
      const DB2=createD1Shim(target);try{const read=await readReportSection({...env,DB:DB2},user,first.id);assert.equal(read.text,'依据已经核对');assert.equal(read.graph[3].status,'ready');assert.equal((await startReportSection({...env,DB:DB2},user,input)).reused,true);}finally{await DB2._close();}
    });
    let candidate;
    await t.test('评测只消费绑定版本的后台结果，未完成不能通过，留出不能用来源项目',async()=>{
      const created=await request(orchestration,{action:'feedbackCreate',feedback:{projectId:pid,scenario:'housing_conversion',before:'旧',after:'新',candidateRule:'必须写出依据已核对',target:'编制依据'}});assert.equal(created.status,200);
      candidate=await DB.prepare('SELECT * FROM report_feedback_candidates WHERE id=?').bind(created.data.candidate.candidateId).first();
      const sampleInput='[系统测试]'+pid+'材料：依据已经核对。';
      const sample=await registerReportCase(env,user,{projectId:pid,scenario:'housing_conversion',datasetRole:'training',input:sampleInput,required:['依据'],forbidden:['主项目'],approvalNote:'隔离库合成回归，不是正式Golden'});
      const evalTask=await startReportEvaluation(env,user,candidate,sample.id);assert.equal((await trustedReportEvaluations(env,candidate))[0].passed,false);
      const again=await Promise.all([startReportEvaluation(env,user,candidate,sample.id),startReportEvaluation(env,user,candidate,sample.id)]);assert.ok(again.every(x=>x.jobId===evalTask.jobId&&x.reused));
      assert.equal((await request(orchestration,{action:'feedbackPublish',candidateId:candidate.id})).status,409);
      const run=(await DB.prepare('SELECT run_id FROM report_trusted_runs WHERE id=?').bind(evalTask.id).first()).run_id;await finish(run,'依据已核对');
      const verified=await trustedReportEvaluations(env,candidate);assert.equal(verified[0].passed,true);assert.equal(verified[0].candidateHash,await reportEvidenceHash(reportCandidateBinding(candidate)));
      const changed={...candidate,version:2};assert.equal((await trustedReportEvaluations(env,changed)).length,0);
      const holdout=await registerReportCase(env,user,{projectId:pid,scenario:'housing_conversion',datasetRole:'holdout',input:'测试',required:['依据'],approvalNote:'测试非法留出'});await assert.rejects(()=>startReportEvaluation(env,user,candidate,holdout.id),/来源项目/);
      const duplicate=await registerReportCase(env,user,{projectId:'other-'+pid,scenario:'housing_conversion',datasetRole:'holdout',input:sampleInput,required:['依据'],approvalNote:'测试跨项目重复材料'});await assert.rejects(()=>startReportEvaluation(env,user,candidate,duplicate.id),/材料重复/);
    });
    await t.test('发布后真实任务消费规则，旧候选失效；回滚后不再消费且正文不覆盖',async()=>{
      assert.equal((await request(orchestration,{action:'feedbackPublish',candidateId:candidate.id})).status,200);
      assert.equal((await readReportSection(env,user,first.id)).status,'invalidated');
      const next=await startReportSection(env,user,input);assert.notEqual(next.id,first.id);
      const payload=JSON.parse((await DB.prepare('SELECT payload_json FROM agent_jobs WHERE run_id=?').bind(next.runId).first()).payload_json);assert.match(payload.system,/必须写出依据已核对/);
      assert.equal((await request(orchestration,{action:'feedbackRollback',candidateId:candidate.id,reason:'[系统测试]回滚验证'})).status,200);
      assert.equal((await readReportSection(env,user,next.id)).status,'invalidated');
      assert.equal((await readReportSection(env,user,first.id)).text,'依据已经核对');
      const saved=JSON.parse((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(pid).first()).data);assert.deepEqual(saved.chapters,[]);
      await DB.prepare("UPDATE agent_jobs SET status='cancelled' WHERE run_id=? AND status='queued'").bind(next.runId).run();
    });
  }finally{await DB._close();}
});
