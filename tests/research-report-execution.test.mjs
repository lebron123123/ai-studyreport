import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {createResearch,saveResearchRun,restartPrivateResearch} from '../functions/api/_research-store.js';
import {startReportSection,readReportSection} from '../functions/api/reportexecution.js';
import {reauthorizeAgentJob,executeLlmTask,settleAgentJob} from '../functions/api/_agent-enterprise.js';
const target=testDatabaseUrl();
test('研究报告任务：真实事务、冻结输入、自动保存兼容与旧轮次失效',{skip:!target},async t=>{
 const DB=createD1Shim(target),env={DB,RESEARCH_IDENTITY_ENABLED:'1',DEEPSEEK_API_KEY:'test-only',DEEPSEEK_API_URL:'http://test.invalid/chat/completions'};
 const requestId=()=>crypto.randomUUID();
 try{
  const user=Number((await DB.prepare('SELECT id FROM users ORDER BY id LIMIT 1').first()).id);
  const identity=await createResearch(DB,user,{title:'[系统测试]研究报告',requestId:requestId()});
  let token={...identity,epoch:1,expectedVersion:1};
  const draft={project:{name:'测试'},calcParams:{area:100},kb:[],chapters:[]};
  await saveResearchRun(DB,user,{...token,requestId:requestId(),state:{draft}});token.expectedVersion=2;
  const input={research:token,sectionKey:'第一章 / 编制依据',system:'正式行文',user:'据实编制'};
  const task=await startReportSection(env,user,input),job=await DB.prepare('SELECT * FROM agent_jobs WHERE run_id=?').bind(task.runId).first();
  await t.test('不伪造正式项目，冻结研究身份且拒绝跨用户读取',async()=>{
   assert.equal(JSON.parse(job.payload_json).projectId,'');
   assert.equal(JSON.parse(job.payload_json).research.runId,identity.runId);
   await assert.rejects(readReportSection(env,user+999,task.id));
   assert.equal((await startReportSection(env,user,input)).reused,true);
  });
  await t.test('普通聊天、正文保存不误伤运行中的任务；模型完成能够读取',async()=>{
   await saveResearchRun(DB,user,{...token,requestId:requestId(),state:{draft:{...draft,chapters:[{text:'另一节正文'}]},aiReport:{chat:['新增聊天']}}});token.expectedVersion=3;
   assert.equal((await reauthorizeAgentJob(env,job)).ok,true);
   await DB.prepare("UPDATE agent_jobs SET status='running',lease_owner='research-test',lease_expires_at=?,attempts=1 WHERE id=?").bind(Date.now()+60000,job.id).run();
   const leased=await DB.prepare('SELECT * FROM agent_jobs WHERE id=?').bind(job.id).first(),original=globalThis.fetch;
   globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'研究报告候选正文'}}],usage:{prompt_tokens:3,completion_tokens:5}}),{headers:{'content-type':'application/json'}});
   try{await executeLlmTask(env,leased,JSON.parse(leased.payload_json));await settleAgentJob(env,leased,true);}finally{globalThis.fetch=original;}
   assert.equal((await readReportSection(env,user,task.id)).text,'研究报告候选正文');
  });
  await t.test('源参数更新后拒绝旧任务结果和过时提交',async()=>{
   await saveResearchRun(DB,user,{...token,requestId:requestId(),state:{draft:{...draft,calcParams:{area:200}}}});token.expectedVersion=4;
   assert.equal((await reauthorizeAgentJob(env,job)).ok,false);
   await assert.rejects(readReportSection(env,user,task.id),/源数据/);
   await assert.rejects(startReportSection(env,user,{...input,research:{...token,expectedVersion:2}}),/已有更新/);
  });
  await t.test('重新开始后旧epoch无法读回或执行；新轮次产生独立任务',async()=>{
   const next=await restartPrivateResearch(DB,user,{...token,requestId:requestId(),mode:'blank'});
   assert.equal((await reauthorizeAgentJob(env,job)).ok,false);
   await assert.rejects(readReportSection(env,user,task.id));
   const fresh=await startReportSection(env,user,{...input,research:{researchId:identity.researchId,runId:next.runId,epoch:1,expectedVersion:1}});
   assert.notEqual(fresh.id,task.id);
   await DB.prepare("UPDATE agent_jobs SET status='running',lease_owner='research-late',lease_expires_at=?,attempts=1 WHERE run_id=?").bind(Date.now()+60000,fresh.runId).run();
   const late=await DB.prepare('SELECT * FROM agent_jobs WHERE run_id=?').bind(fresh.runId).first(),original=globalThis.fetch;
   globalThis.fetch=async()=>{
    await restartPrivateResearch(DB,user,{researchId:identity.researchId,runId:next.runId,epoch:1,expectedVersion:1,requestId:requestId(),mode:'blank'});
    return new Response(JSON.stringify({choices:[{message:{content:'迟到结果不得写入'}}],usage:{prompt_tokens:3,completion_tokens:5}}),{headers:{'content-type':'application/json'}});
   };
   try{await assert.rejects(executeLlmTask(env,late,JSON.parse(late.payload_json)),/失效/);}finally{globalThis.fetch=original;}
   const completed=await DB.prepare("SELECT COUNT(*) AS n FROM agent_checkpoints WHERE run_id=? AND state_json LIKE '%迟到结果%'").bind(fresh.runId).first();
   assert.equal(Number(completed.n),0);
  });
 }finally{await DB._close();}
});
