import test from 'node:test';
import assert from 'node:assert/strict';
import {reportRouteProject} from '../functions/api/_report-route-access.js';
test('旧路由权限根据持久化记录而不是伪造projectId定位',async()=>{
  const env={DB:{prepare(sql){assert.match(sql,/SELECT project_id FROM report_workflows WHERE id=\?/);return {bind(id){assert.equal(id,'real');return {first:async()=>({project_id:'protected'})};}};}}};
  assert.equal(await reportRouteProject(env,{action:'workflowPause',contextId:'fake',workflowId:'real',projectId:'forged'}),'protected');
});
import {createD1Shim} from '../local-server/d1-shim.js';
import {changeProjectMember} from '../functions/api/_project-members.js';
import {ensureReportOrchestration} from '../functions/api/_report-orchestration.js';
import {guardReportRoute} from '../functions/api/_report-route-access.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
const target=testDatabaseUrl();
test('旧上下文创建人撤权后，读写入口都禁止',{skip:!target},async()=>{
 const u=new URL(target);assert.match(u.pathname,/^\/studyreport_restore_\d+$/);assert.ok(['localhost','127.0.0.1','[::1]'].includes(u.hostname));
 const DB=createD1Shim(target),env={DB};try{
  const ids=[];for(let i=0;i<2;i++){const n='test'+crypto.randomUUID().replaceAll('-','');await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(n,'invalid','test',Date.now()).run();ids.push(Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(n).first()).id));}
  const pid=crypto.randomUUID();await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(pid,ids[0],'[系统测试]旧入口权限','{}',Date.now()).run();await ensureReportOrchestration(env);
  await changeProjectMember(env,ids[0],pid,ids[1],'EDITOR');
  assert.equal(await guardReportRoute(env,ids[1],{action:'contextCreate',context:{identity:{projectId:pid}}}),true);
  await changeProjectMember(env,ids[0],pid,ids[1],'VIEWER');
  assert.equal(await guardReportRoute(env,ids[1],{action:'contextCreate',context:{identity:{projectId:pid}}}),false);
  assert.equal(await guardReportRoute(env,ids[1],{projectId:pid},true),true);
  await changeProjectMember(env,ids[0],pid,ids[1],'VIEWER',true);
  assert.equal(await guardReportRoute(env,ids[1],{projectId:pid},true),false);
 }finally{await DB._close();}
});
