import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {startReportSection} from '../functions/api/reportexecution.js';
import {reauthorizeAgentJob} from '../functions/api/_agent-enterprise.js';
const target=testDatabaseUrl();
test('旧可研废止与恢复使旧生成任务失效，普通项目任务仍可执行',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB},id=crypto.randomUUID();
 try{
  const user=Number((await DB.prepare('SELECT id FROM users ORDER BY id LIMIT 1').first()).id);
  const state={project:{name:'[系统测试]可研任务生命周期'},workflow:{management:{}}};
  await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(id,user,state.project.name,JSON.stringify(state),Date.now()).run();
  const input={projectId:id,sectionKey:'第一章 / 测试',system:'据实编写',user:'测试上下文'};
  const task=await startReportSection(env,user,input),job=await DB.prepare('SELECT * FROM agent_jobs WHERE run_id=?').bind(task.runId).first();
  assert.equal((await reauthorizeAgentJob(env,job)).ok,true);
  state.workflow.management={legacyResearchAbandoned:true,legacyResearchEpoch:1};
  const save=()=>DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(state),id).run();await save();
  await assert.rejects(startReportSection(env,user,input),/废止/);
  assert.equal((await reauthorizeAgentJob(env,job)).ok,false);
  assert.equal((await reauthorizeAgentJob(env,{...job,payload_json:JSON.stringify({projectId:id})})).ok,true);
  state.workflow.management={legacyResearchAbandoned:false,legacyResearchEpoch:2};await save();
  assert.equal((await reauthorizeAgentJob(env,job)).ok,false);
  await assert.rejects(startReportSection(env,user,input),/状态已变化/);
  const fresh=await startReportSection(env,user,{...input,legacyResearchEpoch:2});assert.notEqual(fresh.id,task.id);
 }finally{await DB._close();}
});
