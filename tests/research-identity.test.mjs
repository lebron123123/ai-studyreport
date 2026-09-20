import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {createResearch,readResearch,saveResearchRun,selectResearchRun,restartPrivateResearch,restartResearch,researchInheritance,importLegacyResearch,updateResearchMember,listResearch,listResearchRuns,changeResearchStatus,authorizeResearchTask} from '../functions/api/_research-store.js';
import {researchAuthorizer} from '../functions/api/_research-authorization.js';
import {onRequestGet,onRequestPost} from '../functions/api/research.js';
import {signToken,hashPassword} from '../functions/api/_auth.js';
const require=createRequire(import.meta.url),context=require('../research-context.js');
const migration=fs.readFileSync(new URL('../migrations/0034_research_identity.sql',import.meta.url),'utf8');
const authMigration=fs.readFileSync(new URL('../migrations/0035_research_reauthentication.sql',import.meta.url),'utf8');
const uid=987001,peer=987002;
const request=()=>crypto.randomUUID();
const exec=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
function sqlite(){
 const connection=new DatabaseSync(':memory:');connection.exec('PRAGMA foreign_keys=ON');connection.exec(migration);connection.exec(migration);
 connection.exec(authMigration);connection.exec(authMigration);
 let queue=Promise.resolve();
 const db={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return connection.prepare(sql).get(...args)||null;},async all(){return {results:connection.prepare(sql).all(...args)};},async run(){const result=connection.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}};},_close(){connection.close();}};
 const scoped={...db,_transaction:work=>work(scoped)};
 db._transaction=work=>{const pending=queue.catch(()=>{}).then(async()=>{connection.exec('BEGIN');try{const result=await work(scoped);connection.exec('COMMIT');return result;}catch(e){connection.exec('ROLLBACK');throw e;}});queue=pending;return pending;};
 return db;
}
async function cases(t,db){
 await t.test('长篇可研超过旧2MB限制仍完整保存，超过20MB拒绝且保留原稿',async()=>{
  const x=await createResearch(db,uid,{title:'[系统测试]长报告保存',requestId:request()});
  const state={report:'正文'.repeat(400000)};
  await saveResearchRun(db,uid,{...x,requestId:request(),expectedVersion:1,epoch:1,state});
  assert.deepEqual((await readResearch(db,uid,x.researchId,x.runId)).run.state,state);
  await assert.rejects(saveResearchRun(db,uid,{...x,requestId:request(),expectedVersion:2,epoch:1,state:{report:'a'.repeat(20*1024*1024)}}),e=>e.status===413);
  assert.deepEqual((await readResearch(db,uid,x.researchId,x.runId)).run.state,state);
 });
 await t.test('服务端任务使用认证用户与冻结轮次；输入更新、重启后拒绝旧任务',async()=>{
  const x=await createResearch(db,uid,{title:'[系统测试]任务围栏',requestId:request()});
  const token={...x,epoch:1,expectedVersion:1};
  await db._transaction(d=>authorizeResearchTask(d,uid,token));
  await assert.rejects(db._transaction(d=>authorizeResearchTask(d,peer,{...token,userId:uid})),e=>e.status===409);
  await assert.rejects(db._transaction(d=>authorizeResearchTask(d,peer,token)),e=>e.status===404);
  await saveResearchRun(db,uid,{...token,requestId:request(),state:{chat:['新输入']}});
  await assert.rejects(db._transaction(d=>authorizeResearchTask(d,uid,token)),e=>e.status===409);
  await restartPrivateResearch(db,uid,{...token,expectedVersion:2,mode:'blank',requestId:request()});
  await assert.rejects(db._transaction(d=>authorizeResearchTask(d,uid,{...token,expectedVersion:2})),e=>e.status===409);
 });
 const a=await createResearch(db,uid,{title:'[系统测试]甲',requestId:request(),formalProjectId:'project_shared_01'});
 const b=await createResearch(db,peer,{title:'[系统测试]乙',requestId:request(),formalProjectId:'project_shared_01'});
 const payload=(x,extra={})=>({...x,requestId:request(),expectedVersion:1,epoch:1,state:{chat:['甲']},...extra});
 await t.test('同一项目两人各有研究，管理员参数不能取得他人私有研究',async()=>{
  assert.notEqual(a.researchId,b.researchId);
  await assert.rejects(readResearch(db,peer,a.researchId,a.runId),e=>e.status===404);
  await assert.rejects(saveResearchRun(db,peer,payload(a)),e=>e.status===404);
  assert.deepEqual((await readResearch(db,peer,b.researchId,b.runId)).run.state,{});
 });
 await t.test('重复新增只生成一份，同请求不同内容拒绝',async()=>{
  const input={title:'[系统测试]幂等',requestId:request()};
  const values=await Promise.all(Array.from({length:4},()=>createResearch(db,uid,input)));
  assert.equal(new Set(values.map(x=>x.researchId)).size,1);
  await assert.rejects(createResearch(db,uid,{...input,title:'不同'}),e=>e.status===409);
 });
 await t.test('并发CAS只有一笔成功；同请求重试不加版本，不同内容冲突',async()=>{
  const input=payload(a),other=payload(a,{state:{chat:['竞争写入']}});
  const result=await Promise.allSettled([saveResearchRun(db,uid,input),saveResearchRun(db,uid,other)]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(result.find(x=>x.status==='rejected').reason.status,409);
  const winner=result[0].status==='fulfilled'?input:other;
  assert.equal((await saveResearchRun(db,uid,winner)).replayed,true);
  await assert.rejects(saveResearchRun(db,uid,{...winner,state:{changed:true}}),e=>e.status===409);
  assert.equal((await readResearch(db,uid,a.researchId,a.runId)).run.version,2);
 });
 await t.test('拒绝跨研究轮次，失败不改变版本',async()=>{
  await assert.rejects(saveResearchRun(db,uid,payload(a,{runId:b.runId})),e=>e.status===404);
  await assert.rejects(exec(db,'INSERT INTO research_selections(research_id,user_id,run_id) VALUES(?,?,?)',a.researchId,peer,b.runId));
  assert.equal((await readResearch(db,uid,a.researchId,a.runId)).run.version,2);
 });
 await t.test('空白重启保留旧轮次；迟到保存被拒绝且重复重启幂等',async()=>{
  const input=payload(a,{mode:'blank',expectedVersion:2});
  const next=await restartPrivateResearch(db,uid,input);
  assert.deepEqual(await restartPrivateResearch(db,uid,input),next);
  const old=await readResearch(db,uid,a.researchId,a.runId);
  assert.equal(old.run.status,'history');assert.equal(old.run.epoch,2);assert.ok(old.run.state.chat);
  assert.deepEqual((await readResearch(db,uid,next.researchId,next.runId)).run.state,{});
  await assert.rejects(saveResearchRun(db,uid,payload(a,{expectedVersion:2})),e=>e.status===409);
  assert.deepEqual((await readResearch(db,peer,b.researchId,b.runId)).run.state,{});
 });
 await t.test('共享研究的个人选择不更改共享活动轮次，撤权即时生效',async()=>{
  await exec(db,"UPDATE research_studies SET visibility='shared' WHERE id=?",a.researchId);
  await exec(db,"INSERT INTO research_members(research_id,user_id,role) VALUES(?,?,'editor')",a.researchId,peer);
  const newest=(await readResearch(db,uid,a.researchId)).run;
  await exec(db,'INSERT INTO research_shared_active(research_id,run_id) VALUES(?,?)',a.researchId,newest.runId);
  await selectResearchRun(db,peer,{researchId:a.researchId,runId:a.runId});
  assert.equal((await readResearch(db,peer,a.researchId)).run.runId,a.runId);
  const owner=await readResearch(db,uid,a.researchId);assert.equal(owner.run.runId,newest.runId);assert.equal(owner.sharedActive.run_id,newest.runId);
  await updateResearchMember(db,uid,{researchId:a.researchId,userId:peer,role:'editor',status:'revoked',expectedVersion:2});
  await assert.rejects(saveResearchRun(db,peer,payload({researchId:a.researchId,runId:newest.runId})),e=>e.status===404);
  await assert.rejects(readResearch(db,peer,a.researchId),e=>e.status===404);
 });
 await t.test('只读成员拒绝保存；共享重启没有无密码旁路',async()=>{
  await updateResearchMember(db,uid,{researchId:a.researchId,userId:peer,role:'viewer',status:'active',expectedVersion:3});
  const current=(await readResearch(db,uid,a.researchId)).run;
  await assert.rejects(saveResearchRun(db,peer,payload(current)),e=>e.status===403);
  await assert.rejects(restartPrivateResearch(db,uid,{...payload(current),mode:'blank'}),e=>e.status===403);
 });
 await t.test('幂等记录写入失败时，状态与版本一并回滚',async()=>{
  const c=await createResearch(db,uid,{title:'[系统测试]回滚',requestId:request()});
  const broken={_transaction:work=>db._transaction(d=>work({...d,prepare(sql){if(sql.startsWith('INSERT INTO research_requests'))throw new Error('injected rollback');return d.prepare(sql);}}))};
  await assert.rejects(saveResearchRun(broken,uid,payload(c)),/injected rollback/);
  const loaded=await readResearch(db,uid,c.researchId,c.runId);assert.equal(loaded.run.version,1);assert.deepEqual(loaded.run.state,{});
 });
 await t.test('废弃及恢复代次变化都拒绝旧任务',async()=>{
  await exec(db,"UPDATE research_studies SET status='abandoned' WHERE id=?",b.researchId);
  await assert.rejects(saveResearchRun(db,peer,payload(b)),e=>e.status===409);
  await exec(db,"UPDATE research_studies SET status='active' WHERE id=?",b.researchId);
  await exec(db,'UPDATE research_runs SET epoch=epoch+1 WHERE id=?',b.runId);
  await assert.rejects(saveResearchRun(db,peer,payload(b)),e=>e.status===409);
 });
 await t.test('实际废弃恢复：验证失败无变化、重复幂等、恢复后旧任务仍拒绝、原内容保留',async()=>{
  const c=await createResearch(db,uid,{title:'[系统测试]生命周期',requestId:request()});
  await saveResearchRun(db,uid,payload(c));
  const input={...c,action:'abandon',requestId:request(),expectedVersion:1};
  await assert.rejects(changeResearchStatus(db,uid,input),e=>e.status===403);
  await assert.rejects(changeResearchStatus(db,uid,input,async()=>{throw new Error('denied');}),/denied/);
  assert.equal((await readResearch(db,uid,c.researchId)).study.status,'active');
  const authorize=async()=>{};
  const abandoned=await changeResearchStatus(db,uid,input,authorize);
  assert.deepEqual(await changeResearchStatus(db,uid,input,authorize),abandoned);
  assert.ok((await listResearch(db,uid,{status:'abandoned'})).items.some(x=>x.id===c.researchId));
  assert.ok(!(await listResearch(db,peer,{status:'abandoned'})).items.some(x=>x.id===c.researchId));
  await assert.rejects(saveResearchRun(db,uid,payload(c,{expectedVersion:2})),e=>e.status===409);
  await changeResearchStatus(db,uid,{...input,action:'restore',requestId:request(),expectedVersion:2},authorize);
  const loaded=await readResearch(db,uid,c.researchId);
  assert.equal(loaded.run.epoch,3);assert.deepEqual(loaded.run.state,{chat:['甲']});
  await assert.rejects(saveResearchRun(db,uid,payload(c,{expectedVersion:2})),e=>e.status===409);
  assert.equal((await listResearchRuns(db,uid,c.researchId)).items.length,1);
  await assert.rejects(listResearchRuns(db,peer,c.researchId),e=>e.status===404);
 });
 await t.test('共享重启必须授权，保留他人个人选择但使旧任务失效',async()=>{
  const c=await createResearch(db,uid,{title:'[系统测试]共享轮次',requestId:request()});
  await exec(db,"UPDATE research_studies SET visibility='shared' WHERE id=?",c.researchId);
  await exec(db,"INSERT INTO research_members(research_id,user_id,role) VALUES(?,?,'editor')",c.researchId,peer);
  await selectResearchRun(db,peer,c);
  const input={...c,mode:'blank',expectedVersion:1,epoch:1,requestId:request()};
  await assert.rejects(restartResearch(db,uid,input),e=>e.status===403);
  await assert.rejects(restartResearch(db,peer,input,undefined,async()=>{}),e=>e.status===403);
  const next=await restartResearch(db,uid,input,undefined,async()=>{});
  const peerView=await readResearch(db,peer,c.researchId);
  assert.equal(peerView.run.runId,c.runId);assert.equal(peerView.run.status,'history');
  assert.equal(peerView.sharedActive.run_id,next.runId);
  await assert.rejects(saveResearchRun(db,peer,payload(c)),e=>e.status===409);
 });
 await t.test('旧会话只按本人显式导入，重复导入不覆盖新状态或原会话',async()=>{
  await exec(db,'CREATE TABLE IF NOT EXISTS aireport_project_sessions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,project_id TEXT NOT NULL,data TEXT NOT NULL,updated_at BIGINT NOT NULL,UNIQUE(user_id,project_id))');
  const projectId='legacy_'+request(),source=JSON.stringify({chat:['旧稿'],value:12});
  await exec(db,'INSERT INTO aireport_project_sessions(id,user_id,project_id,data,updated_at) VALUES(?,?,?,?,?)',request(),uid,projectId,source,1);
  const first=await importLegacyResearch(db,uid,{legacyProjectId:projectId});
  const second=await importLegacyResearch(db,uid,{legacyProjectId:projectId});assert.equal(first.researchId,second.researchId);
  const imported=await readResearch(db,uid,first.researchId,first.runId);assert.equal(imported.study.formalProjectId,null);assert.equal(imported.run.state.requiresReview,true);
  assert.deepEqual(imported.run.state.legacySnapshot,JSON.parse(source));
  assert.equal((await db.prepare('SELECT data FROM aireport_project_sessions WHERE user_id=? AND project_id=?').bind(uid,projectId).first()).data,source);
  await assert.rejects(importLegacyResearch(db,peer,{legacyProjectId:projectId}),e=>e.status===404);
 });
}
test('研究身份：SQLite行为、外键及重复建表',async t=>{const db=sqlite();try{await cases(t,db);}finally{db._close();}});
const target=testDatabaseUrl();
test('研究身份：真实PostgreSQL事务与并发',{skip:!target},async t=>{const db=createD1Shim(target);try{await cases(t,db);}finally{await db._close();}});
test('继承只采用服务端重新核验的引用，不复制推测、结果或任意新字段',async()=>{
 const source={materialRefs:[{id:'m1'},{id:'no'}],confirmedFacts:[{id:'f1'}],chat:['旧'],params:{guess:1},report:'旧稿',futureSecret:'不可继承'};
 assert.deepEqual(await researchInheritance(source,'blank'),{});
 await assert.rejects(researchInheritance(source,'verified'),e=>e.status===503);
 assert.deepEqual(await researchInheritance(source,'verified',async(kind,x)=>x.id==='no'?null:{id:x.id,verified:true}),{materialRefs:[{id:'m1',verified:true}],confirmedFacts:[{id:'f1',verified:true}]});
});
test('七条异步链使用冻结身份、用户隔离键和选择代次，返回旧轮次也拒绝旧回调',()=>{
 const c=context.create(),base={userId:uid,researchId:request(),runId:request(),version:1,epoch:1};c.select(base);
 const tokens=['chat','parameters','calculation','file','report','autosave','export'].map(x=>c.capture(x));
 const oldKey=c.localKey();assert.equal(new Set(tokens.map(x=>x.requestId)).size,7);
 c.select({...base,runId:request()});for(const token of tokens)assert.equal(c.accepts(token),false);
 c.select(base);for(const token of tokens)assert.equal(c.accepts(token),false);
 const fresh=c.capture('autosave');assert.equal(c.acceptVersion(fresh,{researchId:base.researchId,runId:base.runId,epoch:1,acceptedVersion:2}),true);
 assert.equal(c.capture('chat').expectedVersion,2);c.select({...base,userId:peer});assert.notEqual(c.localKey(),oldKey);c.clear();assert.equal(c.accepts(fresh),false);
});
test('API默认关闭，无事务不降级；未登录、错误JSON和未知操作返回明确错误',async()=>{
 const db=sqlite(),env={DB:db,SESSION_SECRET:'test-only-research'};
 try{
  const token=await signToken(env,uid,'[系统测试]');
  const call=(body,extra={},auth=true)=>onRequestPost({env:{...env,...extra},request:new Request('http://test/api/research',{method:'POST',headers:auth?{authorization:'Bearer '+token}:{},body})});
  assert.equal((await call('{}',{},false)).status,401);
  assert.equal((await call('{}')).status,503);
  assert.equal((await call('{',{RESEARCH_IDENTITY_ENABLED:'1'})).status,400);
  assert.equal((await call('{"action":"unknown"}',{RESEARCH_IDENTITY_ENABLED:'1'})).status,400);
  const created=await (await call(JSON.stringify({action:'create',title:'[系统测试]',requestId:request()}),{RESEARCH_IDENTITY_ENABLED:'1'})).json();assert.equal(created.ok,true);
  const loaded=await onRequestGet({env:{...env,RESEARCH_IDENTITY_ENABLED:'1'},request:new Request('http://test/api/research?researchId='+created.researchId,{headers:{authorization:'Bearer '+token}})});assert.equal(loaded.status,200);
 }finally{db._close();}
});

test('二次验证：本人密码、管理员范围、持久限流及凭据变更',async()=>{
 const db=sqlite(),salt='0123456789abcdef',password='test-only-password';
 try{
  await exec(db,'CREATE TABLE users(id INTEGER PRIMARY KEY,pass_hash TEXT,salt TEXT)');
  await exec(db,'INSERT INTO users(id,pass_hash,salt) VALUES(?,?,?)',uid,await hashPassword(password,salt),salt);
  const env={DB:db,ADMIN_USERS:''},user={userId:uid,username:'[系统测试]'};
  await assert.rejects(researchAuthorizer(env,user,'wrong'),e=>e.status===403);
  const proof=await researchAuthorizer(env,user,password);
  await proof({study:{visibility:'private',owner_user_id:uid},db});
  await assert.rejects(proof({study:{visibility:'shared',owner_user_id:uid},db}),e=>e.status===403);
  const adminProof=await researchAuthorizer({...env,ADMIN_USERS:String(uid)},user,password);
  await adminProof({study:{visibility:'shared',owner_user_id:uid},db});
  await exec(db,"UPDATE users SET pass_hash='changed' WHERE id=?",uid);
  await assert.rejects(adminProof({study:{visibility:'shared',owner_user_id:uid},db}),e=>e.status===403);
  for(let i=0;i<2;i++)await assert.rejects(researchAuthorizer(env,user,'wrong'),e=>e.status===403);
  await assert.rejects(researchAuthorizer(env,user,'wrong'),e=>e.status===429);
 }finally{db._close();}
});
