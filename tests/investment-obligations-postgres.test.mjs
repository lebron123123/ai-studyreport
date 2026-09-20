import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {ensureObligations,mutateObligation,readObligations} from '../functions/api/_investment-obligations.js';
import {ensureInvestmentTables} from '../functions/api/investmentops.js';
import {ensureLifecycleIntegrity,withProjectMutation} from '../functions/api/_lifecycle-integrity.js';
import {resolveProjectAccess,ensureProjectMemberships} from '../functions/api/_project-access.js';
const target=testDatabaseUrl();
test('交接真实数据库：身份、并发、更正、角色、退回、撤权、原子回滚',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB},projectId=crypto.randomUUID(),eventId=crypto.randomUUID();
 try{
  await ensureInvestmentTables(env);await ensureLifecycleIntegrity(env);await ensureObligations(env);await ensureObligations(env);await ensureProjectMemberships(env);
  const users=[];for(let i=0;i<3;i++){const name='[系统测试]handoff-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();users.push(Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id));}
  const [owner,editor,viewer]=users;
  await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,owner,'[系统测试]会议交接','{}',Date.now()).run();
  for(const [user,role]of[[editor,'EDITOR'],[viewer,'VIEWER']])await DB.prepare('INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,\'active\',?,?)').bind(projectId,user,role,Date.now(),Date.now()).run();
  await DB.prepare('INSERT INTO project_meetings(id,project_id,user_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(eventId,projectId,editor,'[系统测试]总办会','核对后的会议原文',Date.now(),Date.now()).run();
  const call=(b,user=owner,override=env)=>withProjectMutation(override,{userId:user},projectId,'edit',(tx,a)=>mutateObligation(tx,{userId:user},a,b));
  const base={action:'saveHandoff',eventId,type:'board_materials',round:1,expectedVersion:0,newRoundConfirmed:true,title:'准备董事会材料',basis:'依据纪要安排准备材料，不代表已获董事会批准',result:'follow_up',dueDate:'',dueBasis:'',reason:'首次确认',assigneeId:editor};
  await assert.rejects(call(base,viewer),{status:403});await assert.rejects(call(base,editor),{status:403});
  await assert.rejects(call({...base,result:'deferred'}),{status:409});await assert.rejects(call({...base,dueDate:'2026-02-30',dueBasis:'测试'}),{status:400});await assert.rejects(call({...base,dueDate:'2026-10-01'}),{status:400});
  const results=await Promise.allSettled([call(base),call(base)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const first=results.find(r=>r.status==='fulfilled').value,id=first.id;
  assert.equal(Number((await DB.prepare('SELECT COUNT(*) n FROM project_obligations WHERE project_id=?').bind(projectId).first()).n),1);
  await call({action:'acceptHandoff',id,expectedVersion:1},editor);
  const corrected=await call({...base,expectedVersion:2,basis:'仅更正日期',dueDate:'2026-10-02',dueBasis:'负责人确认的计划期限',reason:'纪要日期更正'});assert.equal(corrected.id,id);assert.equal(corrected.version,3);assert.equal(corrected.status,'pending');
  await assert.rejects(call({...base,expectedVersion:1}),{status:409});
  await assert.rejects(call({action:'returnHandoff',id,expectedVersion:3},editor),{status:400});
  await call({action:'returnHandoff',id,expectedVersion:3,reason:'职责不匹配'},editor);
  await call({action:'assignHandoff',id,expectedVersion:4,assigneeId:null,reason:'重新确认责任岗位'});
  await call({action:'assignHandoff',id,expectedVersion:5,assigneeId:editor,reason:'重新分派'});
  await DB.prepare("UPDATE project_memberships SET status='removed' WHERE project_id=? AND user_id=?").bind(projectId,editor).run();
  const list=await readObligations(env,{userId:owner},await resolveProjectAccess(env,owner,projectId));assert.equal(list.items[0].status,'unassigned');assert.equal(list.items[0].assignmentInvalid,true);
  await assert.rejects(call({action:'acceptHandoff',id,expectedVersion:6},editor),{status:404});
  await assert.rejects(call({...base,round:2,assigneeId:null,newRoundConfirmed:false}),{status:400});
  const next=await call({...base,round:2,assigneeId:null});assert.notEqual(next.id,id);
  const broken={...env,DB:{...DB,_transaction:fn=>DB._transaction(tx=>fn({...tx,prepare(sql){if(sql.startsWith('INSERT INTO project_events'))return {bind(){return this;},run(){throw Error('audit-failure');}};return tx.prepare(sql);}}))}};
  await assert.rejects(call({...base,round:3,assigneeId:null},owner,broken));
  assert.equal(Number((await DB.prepare('SELECT COUNT(*) n FROM project_obligations WHERE project_id=?').bind(projectId).first()).n),2);
  const events=(await DB.prepare('SELECT payload_json FROM project_events WHERE project_id=? ORDER BY created_at').bind(projectId).all()).results.map(r=>JSON.parse(r.payload_json));assert.ok(events.some(e=>e.before?.basis===base.basis&&e.after?.basis==='仅更正日期'));
 }finally{await DB._close();}
});
