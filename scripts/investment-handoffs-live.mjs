// Real HTTP checks on the final local process; only an isolated synthetic project is mutated.
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const database=new URL(process.env.DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(database.hostname));
const DB=createD1Shim(database.toString()),projectId=crypto.randomUUID(),username='[系统测试]handoff-'+crypto.randomUUID();let userId;
try{
 await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(username,'disabled','test-only',Date.now()).run();
 userId=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id);
 await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,userId,'[系统测试]责任交接真实接口','{}',Date.now()).run();
 const token=await signToken({...process.env,DB},userId,username),headers={authorization:'Bearer '+token,'content-type':'application/json'};
 async function api(body,status=200){const r=await fetch('http://localhost:8080/api/investmentops?view=handoffs&projectId='+projectId,{method:body?'POST':'GET',headers,body:body?JSON.stringify({...body,projectId}):undefined,signal:AbortSignal.timeout(15000)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
 assert.equal((await api()).handoffs.items.length,0);
 const meeting=await api({action:'extractMeeting',title:'[系统测试]总办会',content:'确认安排专人准备董事会材料，期限待核对。'});
 const b={action:'saveHandoff',eventId:meeting.id,type:'board_materials',round:1,expectedVersion:0,newRoundConfirmed:true,title:'[系统测试]准备董事会材料',basis:'核对后续工作，不视作正式批准',result:'follow_up',dueDate:'',dueBasis:'',reason:'首次确认',assigneeId:userId};
 const created=await api(b);await api(b,409);
 await api({action:'acceptHandoff',id:created.id,expectedVersion:1});
 const updated=await api({...b,expectedVersion:2,basis:'只更正依据，不新建事项',reason:'更正'});assert.equal(updated.id,created.id);
 const loaded=(await api()).handoffs;assert.equal(loaded.items.length,1);assert.equal(loaded.items[0].version,3);assert.equal(loaded.items[0].status,'pending');
 assert.equal(Number((await DB.prepare('SELECT COUNT(*) n FROM project_events WHERE project_id=?').bind(projectId).first()).n),4);
 console.log('PASS real localhost HTTP: empty, meeting registration, create, duplicate409, accept, correction, fresh read, audit.');
}finally{
 if(userId){for(const table of ['project_obligations','project_events','project_meetings','project_memberships','project_profiles','project_work_stages'])await DB.prepare('DELETE FROM '+table+' WHERE project_id=?').bind(projectId).run();await DB.prepare('DELETE FROM projects WHERE id=? AND user_id=?').bind(projectId,userId).run();await DB.prepare('DELETE FROM users WHERE id=? AND username=?').bind(userId,username).run();}
 await DB._close();console.log('Temporary synthetic project and account removed; user projects untouched.');
}
