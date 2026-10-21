import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {signToken} from '../functions/api/_auth.js';
import {onRequestPost,onRequestGet} from '../functions/api/reportimportarchive.js';
const target=testDatabaseUrl(),CHUNK=512*1024,OWNER_MAX=512*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('独立 PostgreSQL：私有云备份、完整性、并发硬额度与丢回执幂等',{skip:!target},async t=>{
 const url=new URL(target);assert.match(url.pathname,/^\/studyreport_restore_\d+$/);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const DB=createD1Shim(target),env={DB,SESSION_SECRET:crypto.randomUUID()};
 try {
  async function user(){const name='[系统测试]云备份'+crypto.randomUUID(),row=await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?) RETURNING id').bind(name,'disabled-no-login','disabled',Date.now()).first();return {id:Number(row.id),headers:{Authorization:'Bearer '+await signToken(env,Number(row.id),name),'Content-Type':'application/json'}};}
  const owner=await user(),other=await user();
  const post=(body,account=owner,db=DB)=>onRequestPost({env:{...env,DB:db},request:new Request('http://test/api/reportimportarchive',{method:'POST',headers:account.headers,body:JSON.stringify(body)})});
  const get=(query='',account=owner)=>onRequestGet({env,request:new Request('http://test/api/reportimportarchive'+query,{headers:account.headers})});
  const chunk=bytes=>({action:'chunk',hash:hash(bytes),data:Buffer.from(bytes).toString('base64')});
  const publication=(bytes,parts=[bytes])=>({action:'publish',id:hash(bytes),title:'[系统测试]原件保留',draftId:'import_'+'a'.repeat(32),revision:1,size:bytes.length,chunks:parts.map(hash)});
  await t.test('鉴权、无事务部署和错误资料不发生写入',async()=>{
   assert.equal((await onRequestGet({env,request:new Request('http://test')})).status,401);
   assert.equal((await post(null)).status,400);
   assert.equal((await post({...chunk(Buffer.from('test')),hash:'x'})).status,400);
   assert.equal((await post({...chunk(Buffer.from('test')),data:'%%%'})).status,400);
   const readonly={_schemaParent:DB,prepare:sql=>DB.prepare(sql)};assert.equal((await post(chunk(Buffer.from('test')),owner,readonly)).status,503);
   assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_import_archive_chunks').first()).n),0);
  });
  await t.test('真实分块发布与响应丢失后重放只保留一个版本、不重复扣额度',async()=>{
   const first=Buffer.alloc(CHUNK,17),last=Buffer.from('[系统测试]末块'),bytes=Buffer.concat([first,last]),body=publication(bytes,[first,last]);
   const result=await Promise.all(Array.from({length:10},()=>post(chunk(first))));assert.ok(result.every(r=>r.status===200));assert.equal((await post(chunk(last))).status,200);
   await post(body);const replay=await post(body);assert.equal(replay.status,200);assert.equal((await replay.json()).id,body.id);
   const list=await (await get()).json();assert.equal(list.items.length,1);const manifest=await (await get('?id='+body.id)).json();assert.deepEqual(manifest.chunks,body.chunks);
   const read=[];for(let i=0;i<2;i++){const r=await (await get('?id='+body.id+'&chunk='+i)).json();read.push(Buffer.from(r.data,'base64'));}assert.deepEqual(Buffer.concat(read),bytes);
   assert.equal(Number((await DB.prepare('SELECT used_bytes FROM report_import_archive_budgets WHERE owner_id=?').bind(owner.id).first()).used_bytes),bytes.length);
   assert.equal((await post({...body,revision:2})).status,409);assert.equal((await get('?id='+body.id,other)).status,404);assert.equal((await get('?id='+body.id+'&chunk=0',other)).status,404);assert.equal((await (await get('',other)).json()).items.length,0);
   assert.equal((await post(body,other)).status,409);
  });
  await t.test('缺块、错序、损坏数据、损坏长度均不发布或返回不完整副本',async()=>{
   const bytes=Buffer.from('corruption test'),body=publication(bytes);assert.equal((await post(body)).status,409);assert.equal((await post(chunk(bytes))).status,200);assert.equal((await post({...body,id:'f'.repeat(64)})).status,409);assert.equal((await post(body)).status,200);
   await DB.prepare('UPDATE report_import_archive_chunks SET size_bytes=size_bytes+1 WHERE owner_id=? AND hash=?').bind(owner.id,body.id).run();assert.equal((await get('?id='+body.id+'&chunk=0')).status,409);assert.equal((await post(body)).status,409);
   await DB.prepare('UPDATE report_import_archive_chunks SET size_bytes=?,data=? WHERE owner_id=? AND hash=?').bind(bytes.length,Buffer.from('different bytes').toString('base64'),owner.id,body.id).run();assert.equal((await get('?id='+body.id+'&chunk=0')).status,409);assert.equal((await post(chunk(bytes))).status,409);
   assert.equal((await get('?id='+body.id+'&chunk=-1')).status,400);
  });
  await t.test('账号额度串行预留：接近上限的两个并发新块仅容纳一个，重复块仍可复用',async()=>{
   const limited=await user(),a=Buffer.from('new-one'),b=Buffer.from('new-two');
   // Synthetic old accounting boundary, not a physical 512MiB capacity benchmark.
   await DB.prepare('INSERT INTO report_import_archive_chunks(owner_id,hash,data,size_bytes,created_at) VALUES(?,?,?,?,?)').bind(limited.id,'e'.repeat(64),'isolated-boundary-accounting',OWNER_MAX-a.length,Date.now()).run();
   const responses=await Promise.all([post(chunk(a),limited),post(chunk(b),limited)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,413]);
   const winner=responses[0].status===200?a:b;assert.equal((await post(chunk(winner),limited)).status,200);
   assert.equal(Number((await DB.prepare('SELECT SUM(size_bytes) AS n FROM report_import_archive_chunks WHERE owner_id=?').bind(limited.id).first()).n),OWNER_MAX);
   assert.equal(Number((await DB.prepare('SELECT used_bytes FROM report_import_archive_budgets WHERE owner_id=?').bind(limited.id).first()).used_bytes),OWNER_MAX);
   assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_import_archive_chunks WHERE owner_id=?').bind(limited.id).first()).n),2);
  });
  await t.test('事务中断回滚资料块及额度，没有半份占用；重复读取不改正式项目',async()=>{
   const isolated=await user(),bytes=Buffer.from('rollback-boundary');
   const wrapped={_schemaParent:DB,prepare:sql=>DB.prepare(sql),_transaction:work=>DB._transaction(tx=>work({prepare(sql){if(sql.startsWith('UPDATE report_import_archive_budgets'))return {bind(){return {run(){throw new Error('isolated write failure');}};}};return tx.prepare(sql);}}))};
   assert.equal((await post(chunk(bytes),isolated,wrapped)).status,503);
   assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM report_import_archive_chunks WHERE owner_id=?').bind(isolated.id).first()).n),0);
   assert.equal(await DB.prepare('SELECT used_bytes FROM report_import_archive_budgets WHERE owner_id=?').bind(isolated.id).first(),null);
   assert.equal((await post(chunk(bytes),isolated)).status,200);await get();await get();assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id=?').bind(owner.id).first()).n),0);
  });
 }finally{await DB._close();}
});
