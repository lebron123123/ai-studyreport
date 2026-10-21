require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
global.ReportImportStore=require('../report-import-store.js');
const {create}=require('../report-import-cloud.js'),hash=global.ReportImportStore.sha256;
const CHUNK=512*1024,meta={title:'[系统测试]云端备份',draftId:'import_'+'a'.repeat(32),revision:2};
function fixture(options={}){
 let owner='test-owner';const calls=[],chunks=new Map(),manifests=new Map();
 const fetchImpl=async(url,init)=>{calls.push({url,init});if(options.fetch)return options.fetch(url,init);
  const p=new URL(url,'http://test').searchParams;
  if(init.method==='POST'){const body=JSON.parse(init.body);if(body.action==='chunk'){chunks.set(body.hash,body.data);return Response.json({ok:true,hash:body.hash,size:Buffer.from(body.data,'base64').length});}manifests.set(body.id,body);if(options.losePublish)throw new Error('response lost');return Response.json({ok:true,id:body.id,revision:body.revision,size:body.size});}
  if(!p.has('id'))return Response.json({ok:true,items:[...manifests.values()]});
  const manifest=manifests.get(p.get('id'));if(!manifest)return Response.json({ok:false,error:'missing'},{status:404});
  if(p.has('chunk')){const id=manifest.chunks[Number(p.get('chunk'))],data=chunks.get(id);return Response.json({ok:true,hash:id,data,size:Buffer.from(data,'base64').length});}
  return Response.json({ok:true,...manifest});
 };
 return {api:create({getOwner:()=>owner,fetchImpl,timeoutMs:options.timeoutMs||1000}),calls,chunks,manifests,setOwner:v=>{owner=v;}};
}
test('云备份分块上传、发布后完整读回，恢复字节一致，无额外POST',async()=>{
 const f=fixture(),bytes=Uint8Array.from({length:CHUNK+41},(_,i)=>i%251),blob=new Blob([bytes]),saved=await f.api.save(blob,meta);
 assert.equal(saved.id,hash(bytes));assert.equal(f.calls.filter(c=>c.init.method==='POST').length,3);assert.equal(f.chunks.size,2);
 assert.equal((await f.api.list()).length,1);const downloaded=await f.api.download(saved.id);assert.equal(downloaded.blob.type,'application/octet-stream');assert.deepEqual(new Uint8Array(await downloaded.blob.arrayBuffer()),bytes);
 assert.equal(f.calls.filter(c=>c.init.method==='POST').length,3);
});
test('发布响应丢失不自动重传，主动刷新列表能看到已落盘备份',async()=>{
 const f=fixture({losePublish:true});await assert.rejects(f.api.save(new Blob(['backup']),meta),e=>e.code==='CLOUD_NETWORK');assert.equal(f.calls.filter(c=>c.init.method==='POST').length,2);
 const items=await f.api.list();assert.equal(items.length,1);assert.equal(await (await f.api.download(items[0].id)).blob.text(),'backup');assert.equal(f.calls.filter(c=>c.init.method==='POST').length,2);
});
test('无响应及正文读取卡住均按时退出，单个上传绝不重传',async t=>{
 for(const bodyStuck of [false,true])await t.test(String(bodyStuck),async()=>{
  const f=fixture({timeoutMs:15,fetch:()=>bodyStuck?{ok:true,text:()=>new Promise(()=>{})}:new Promise(()=>{})});await assert.rejects(f.api.save(new Blob(['backup']),meta),e=>e.code==='CLOUD_NETWORK');assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.signal.aborted,true);
 });
});
test('账号在响应正文解析期间切换拒绝旧账号列表；不继续上传',async()=>{
 let release,started;const began=new Promise(r=>{started=r;});const f=fixture({fetch:()=>({ok:true,text:()=>new Promise(r=>{release=r;started();})})});const pending=f.api.list();await began;f.setOwner('other-owner');release(JSON.stringify({ok:true,items:[{id:'private'}]}));await assert.rejects(pending,e=>e.code==='AUTH_CHANGED');assert.equal(f.calls.length,1);
});
test('清单/分块/完整包损坏全部拒绝，不返回半份备份',async t=>{
 for(const kind of ['manifest-empty','manifest-hash','chunk-data','chunk-size','whole-hash'])await t.test(kind,async()=>{
  const f=fixture(),bytes=new TextEncoder().encode('backup'),id=hash(bytes);await f.api.save(new Blob([bytes]),meta);const manifest=f.manifests.get(id);
  if(kind==='manifest-empty')manifest.chunks=[];
  if(kind==='manifest-hash')manifest.chunks=['invalid'];
  if(kind==='chunk-data')f.chunks.set(id,Buffer.from('broken').toString('base64'));
  if(kind==='chunk-size')manifest.size++;
  if(kind==='whole-hash'){const fake='f'.repeat(64);f.manifests.set(fake,{...manifest,id:fake});await assert.rejects(f.api.download(fake),e=>e.code==='CLOUD_INTEGRITY');return;}
  await assert.rejects(f.api.download(id),e=>e.code==='CLOUD_INTEGRITY');assert.equal(f.calls.filter(c=>c.init.method==='POST').length,2);
 });
});
test('无效草稿说明和空包先拦截，不上传孤立资料块',async()=>{
 const f=fixture();await assert.rejects(f.api.save(new Blob(['x']),{...meta,revision:0}),e=>e.code==='CLOUD_INVALID');await assert.rejects(f.api.save(new Blob([]),meta),e=>e.code==='CLOUD_LIMIT');assert.equal(f.calls.length,0);
});
