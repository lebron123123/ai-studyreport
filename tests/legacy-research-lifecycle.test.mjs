import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyResearchLifecycle,guardLegacyResearchSave} from '../functions/api/_legacy-research-lifecycle.js';
import {onRequestPost,summarizeProjectRow} from '../functions/api/projects.js';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {hashPassword,signToken} from '../functions/api/_auth.js';
import {onRequestPost as aiPost} from '../functions/api/aireport.js';
test('旧可研状态保护：元数据可改，正文与迟到任务不可改，恢复携带epoch才能写',()=>{
 const old={project:{name:'正式项目'},chapters:[{content:'保留'}],workflow:{management:{legacyResearchAbandoned:true,legacyResearchEpoch:1}}};
 const metadata=structuredClone(old);metadata.project.name='项目更名';delete metadata.workflow.management.legacyResearchAbandoned;
 assert.equal(guardLegacyResearchSave(old,metadata,0).ok,true);assert.equal(metadata.workflow.management.legacyResearchAbandoned,true);
 const changed=structuredClone(old);changed.chapters=[];assert.equal(guardLegacyResearchSave(old,changed,1).ok,false);
 old.workflow.management.legacyResearchAbandoned=false;old.workflow.management.legacyResearchEpoch=2;
 assert.equal(guardLegacyResearchSave(old,changed,1).ok,false);assert.equal(guardLegacyResearchSave(old,changed,2).ok,true);
 assert.equal(legacyResearchLifecycle({}).legacyResearchEpoch,0);
 assert.equal(summarizeProjectRow({id:'x',data:metadata}).legacyResearchAbandoned,true);
});
const target=testDatabaseUrl();
test('旧可研HTTP废止独立于正式项目，恢复、权限、密码、迟到写入与新建防覆盖',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB,SESSION_SECRET:crypto.randomUUID()},password='test-legacy-password',salt='legacy-test-salt',id=crypto.randomUUID();
 try{
  const username='legacy-'+id;await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(username,await hashPassword(password,salt),salt,Date.now()).run();
  const uid=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id),token=await signToken(env,uid,username);
  const call=async body=>{const r=await onRequestPost({env,request:new Request('http://test/api/projects',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({id,...body})})});return {http:r.status,...await r.json()};};
  const session=async body=>{const r=await aiPost({env,request:new Request('http://test/api/aireport',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({action:'saveState',projectId:id,state:{stateRevision:1,chat:['original']},...body})})});return {http:r.status,...await r.json()};};
  const read=async()=>{const row=await DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();return {...row,data:JSON.parse(row.data)};};
  assert.equal((await call({action:'createProject',name:'[系统测试]独立生命周期'})).ok,true);
  assert.equal((await call({action:'createProject',name:'不能覆盖'})).http,409);
  assert.equal((await session({})).ok,true);assert.equal((await session({projectId:crypto.randomUUID()})).http,403);
  let row=await read();row.data.chapters=[{sections:[{content:'原文'}]}];assert.equal((await call({data:row.data,name:row.name})).ok,true);
  const before=await read();assert.equal((await call({action:'setResearchAbandoned',abandoned:true,password:'wrong'})).http,403);
  const stopped=await call({action:'setResearchAbandoned',abandoned:true,password});assert.equal(stopped.legacyResearchEpoch,1);
  assert.equal((await session({legacyResearchEpoch:1})).http,409);
  row=await read();assert.equal(row.data.project.name,'[系统测试]独立生命周期');assert.equal(row.data.workflow.management.archived,undefined);assert.deepEqual(row.data.chapters,before.data.chapters);
  const altered=structuredClone(before.data);altered.chapters=[];assert.equal((await call({data:altered})).http,409);
  row.data.project.location='正式项目继续管理';assert.equal((await call({data:row.data})).ok,true);
  const restored=await call({action:'setResearchAbandoned',abandoned:false,password});assert.equal(restored.legacyResearchEpoch,2);
  assert.equal((await session({legacyResearchEpoch:0})).http,409);assert.equal((await session({legacyResearchEpoch:2})).ok,true);
  assert.equal((await session({projectId:''})).ok,true);
  assert.equal((await call({data:altered,legacyResearchEpoch:0})).http,409);
  assert.equal((await call({data:altered,legacyResearchEpoch:2})).ok,true);
 }finally{await DB._close();}
});
