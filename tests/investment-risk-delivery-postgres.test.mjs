import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {ensureRiskReports,createRiskReport} from '../functions/api/_investment-risk-report.js';
import {withProjectMutation} from '../functions/api/_lifecycle-integrity.js';
import {changeProjectMember} from '../functions/api/_project-members.js';
import {deliveryAction,listDeliveries} from '../functions/api/_delivery.js';
import {authorizeAgentAction} from '../functions/api/_agent-policy.js';
const target=testDatabaseUrl();
test('风险签发绑定独立快照：隔离、自审、并发、变更、恢复与历史导出',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB},pid=crypto.randomUUID();
 try{
  await ensureRiskReports(env);const users=[];
  for(let i=0;i<3;i++){const name='[系统测试]risk-sign-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();users.push(Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id));}
  const [owner,reviewer,outsider]=users;const original=JSON.stringify({chapters:[{name:'不可覆盖的可研',sections:[{t:'总论',content:'保留原稿'}]}]});
  await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(pid,owner,'[系统测试]签发',original,Date.now()).run();await changeProjectMember(env,owner,pid,reviewer,'VIEWER');
  const draft=()=>withProjectMutation(env,{userId:owner},pid,'edit',(tx,a)=>createRiskReport(tx,{userId:owner},a,{scope:'project',requestId:crypto.randomUUID()}));
  await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify({workflow:{evidenceSnapshot:{reportId:'spoof'}}}),pid).run();
  await assert.rejects(deliveryAction(env,owner,{action:'freeze',projectId:pid,reviewerId:reviewer}),/服务端风险草稿/);
  await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(original,pid).run();
  assert.equal((await authorizeAgentAction(env,{userId:reviewer,clearance:1},{toolName:'get_investment_risks',action:'read',projectId:pid})).ok,true);
  assert.equal((await authorizeAgentAction(env,{userId:outsider,clearance:1},{toolName:'get_investment_risks',action:'read',projectId:pid})).ok,false);
  const report=await draft(),freeze={action:'freeze',projectId:pid,riskReportId:report.report.id,reviewerId:reviewer};
  await assert.rejects(deliveryAction(env,owner,{...freeze,reviewerId:owner}),/不能自审/);
  const frozen=await deliveryAction(env,owner,freeze);assert.equal(frozen.result.passed,true);assert.equal(frozen.result.score,null);
  assert.equal((await deliveryAction(env,owner,freeze)).id,frozen.id);
  assert.equal((await listDeliveries(env,owner,pid)).versions.length,0);
  assert.equal((await listDeliveries(env,reviewer,pid,'',report.report.id)).versions.length,1);
  await assert.rejects(listDeliveries(env,outsider,pid,frozen.id),/无项目权限/);
  assert.equal((await listDeliveries(env,owner,pid,frozen.id)).formalExportAllowed,false);
  const approve={action:'approve',projectId:pid,id:frozen.id,note:'核对原件及覆盖缺口，版式符合要求',factsReviewed:true,wordLayoutReviewed:true};
  await assert.rejects(deliveryAction(env,owner,approve),/独立/);
  await assert.rejects(deliveryAction(env,reviewer,{...approve,factsReviewed:false}),/确认Word/);
  await assert.rejects(deliveryAction(env,owner,{action:'restoreWorkingDraft',projectId:pid,id:frozen.id}),/不能覆盖可研/);
  // Changing unrelated feasibility prose must not invalidate a risk report.
  await DB.prepare("UPDATE projects SET data='{}' WHERE id=?").bind(pid).run();
  const outcomes=await Promise.allSettled([deliveryAction(env,reviewer,approve),deliveryAction(env,reviewer,approve)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const signed=await listDeliveries(env,owner,pid,frozen.id);assert.equal(signed.formalExportAllowed,true);assert.doesNotMatch(signed.snapshot.chapters[0].name,/未签发/);
  const another=await draft(),pending=await deliveryAction(env,owner,{...freeze,riskReportId:another.report.id});
  await DB.prepare("INSERT INTO project_risks(id,project_id,user_id,title,risk_level,owner,source_ref,status,created_at,updated_at) VALUES(?,?,?,?,'high','','manual','open',?,?)").bind(crypto.randomUUID(),pid,owner,'后续新增风险',Date.now(),Date.now()).run();
  await assert.rejects(deliveryAction(env,reviewer,{...approve,id:pending.id}),/变化/);
  const historical=await listDeliveries(env,owner,pid,frozen.id);assert.equal(historical.formalExportAllowed,true);assert.equal(historical.current,false);assert.deepEqual(historical.snapshot,signed.snapshot);
  assert.equal((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(pid).first()).data,'{}');
  assert.equal((await DB.prepare('SELECT status FROM project_risks WHERE project_id=?').bind(pid).first()).status,'open');
 }finally{await DB._close();}
});
test('投资助手服务器策略拒绝投资写操作与未知工具',async()=>{
 for(const toolName of ['close_investment_risk','sign_investment_report','get_investment_risks'])assert.equal((await authorizeAgentAction({}, {}, {toolName,action:'write'})).ok,false);
});
