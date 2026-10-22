require('../scripts/windows-browser-lockout-guard.cjs');
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const {sha256}=require('../report-import-store.js');
const source=fs.readFileSync(path.join(__dirname,'../report-import-store.js'),'utf8');
const reviewSource=fs.readFileSync(path.join(__dirname,'../report-import-review.js'),'utf8');
const contextSource=['report-completion-contract.js','report-writing-standard.js','report-import-context.js','report-import-quality.js'].map(file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8')).join('\n');
let browser,context,page;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{
 context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated report import storage test</title>'}));
 await context.addInitScript({content:contextSource+'\n'+reviewSource+'\n'+source});
 page=await context.newPage();await page.goto('http://report-import.test/');
 await page.evaluate(()=>{
  window.testOwner='alice';window.testStore=ReportImportStore.create({getOwner:()=>testOwner});
  window.makeImport=()=>({title:'[系统测试] 原稿',files:[{name:'主报告.docx',role:'main',blob:new Blob(['原文与数字 42.44\n\u0000'],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),parsed:{blocks:[{id:'p1',type:'paragraph',text:'原文与数字 42.44',html:'<p>原文与数字 42.44</p>'},{id:'t1',type:'table',text:'收入 金额 租金 42.44',html:'<table><tr><td>租金</td><td>42.44</td></tr></table>',rows:[['收入','金额'],['租金','42.44']]}]}},{name:'补充.docx',role:'reference',blob:new Blob(['补充原件']),parsed:{blocks:[{id:'s1',type:'paragraph',text:'参考说明',html:'<p>参考说明</p>'}]}}],outline:[{blockId:'p1',title:'项目概况',level:1}],protectedBlockIds:['t1']});
 });
});
afterEach(async()=>{await context?.close();});

test('SHA-256 fallback matches known vectors and binary boundaries',()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from('abc'),Buffer.from('中文原稿'),Buffer.alloc(55,0xfe),Buffer.alloc(56,1),Buffer.alloc(64,0),Buffer.alloc(100000,0xa3)])assert.equal(sha256(bytes),crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('real IndexedDB preserves both original bytes and parsed blocks after reload',async()=>{
 const first=await page.evaluate(async()=>{const draft=await testStore.createDraft(makeImport());return {draft,original:await(await testStore.getOriginal(draft.files[0].id)).blob.text(),fallback:!crypto.subtle};});
 assert.equal(first.fallback,true,'test exercises insecure HTTP LAN fallback');
 assert.equal(first.original,'原文与数字 42.44\n\u0000');
 assert.equal(first.draft.files[0].hash,crypto.createHash('sha256').update(first.original).digest('hex'));
 await page.reload();
 const result=await page.evaluate(async id=>{const store=ReportImportStore.create({getOwner:()=> 'alice'}),draft=await store.load(id);return {draft,list:await store.list(),original:await(await store.getOriginal(draft.files[1].id)).blob.text()};},first.draft.id);
 assert.deepEqual(result.draft,first.draft);assert.equal(result.original,'补充原件');assert.equal(result.list.length,1);assert.equal(result.list[0].fileCount,2);
});

test('unparsed supplemental originals survive reload, save and independent copy',async()=>{
 const first=await page.evaluate(async()=>{
  const input=makeImport();input.files.push({name:'测算.xlsx',role:'calculation',blob:new Blob(['工作簿原件\u0000\u0001'],{type:'application/octet-stream'}),parsed:null});
  const draft=await testStore.createDraft(input);return {id:draft.id,file:draft.files[2]};
 });
 assert.equal(first.file.parsed,null);assert.equal(first.file.hash,crypto.createHash('sha256').update('工作簿原件\u0000\u0001').digest('hex'));
 await page.reload();
 const result=await page.evaluate(async id=>{
  const store=ReportImportStore.create({getOwner:()=> 'alice'}),draft=await store.load(id),saved=await store.save({...draft,confirmed:true},draft.revision),files=[];
  for(const file of saved.files)files.push({...file,blob:(await store.getOriginal(file.id)).blob});
  const copied=await store.createDraft({...saved,title:'[系统测试] 副本',files});
  return {saved,copied,original:await(await store.getOriginal(copied.files[2].id)).blob.text()};
 },first.id);
 assert.equal(result.saved.files[2].parsed,null);assert.equal(result.copied.files[2].parsed,null);assert.equal(result.original,'工作簿原件\u0000\u0001');assert.equal(result.saved.files[2].hash,result.copied.files[2].hash);assert.notEqual(result.saved.id,result.copied.id);assert.notEqual(result.saved.files[2].id,result.copied.files[2].id);
});

test('invalid roles, missing or duplicate main reports and invalid blocks never create a draft',async()=>{
 const result=await page.evaluate(async()=>{
  const cases=[input=>{input.files[0].role='reference';},input=>{input.files[1].role='main';},input=>{input.files[1].role='supplement';},input=>{input.files[0].parsed=null;},input=>{input.files[0].parsed={};},input=>{input.files[0].parsed.blocks=[];},input=>{input.files[0].parsed.blocks[1].id='p1';},input=>{input.files[0].parsed.blocks[0].text=42;},input=>{input.files[1].parsed={blocks:[{id:'bad'}]};}],failures=[];
  for(const mutate of cases){const input=makeImport();mutate(input);failures.push(await testStore.createDraft(input).catch(e=>e.code));}
  return {failures,list:await testStore.list()};
 });
 assert.deepEqual(result.failures,Array(9).fill('INVALID'));assert.deepEqual(result.list,[]);
});

test('account partitions reject direct draft and original access',async()=>{
 const result=await page.evaluate(async()=>{
  const draft=await testStore.createDraft(makeImport());testOwner='bob';
  const list=await testStore.list(),load=await testStore.load(draft.id).catch(e=>e.code),original=await testStore.getOriginal(draft.files[0].id).catch(e=>e.code),save=await testStore.save(draft,1).catch(e=>e.code);
  const other=await testStore.createDraft(makeImport());testOwner='alice';return {list,load,original,save,alice:await testStore.list(),bobId:other.id};
 });
 assert.equal(result.list.length,0);assert.equal(result.load,'NOT_FOUND');assert.equal(result.original,'NOT_FOUND');assert.equal(result.save,'AUTH_CHANGED');assert.equal(result.alice.length,1);assert.notEqual(result.alice[0].id,result.bobId);
});

test('two connections compare revisions atomically and retain every accepted revision',async()=>{
 const result=await page.evaluate(async()=>{
  const draft=await testStore.createDraft(makeImport()),other=ReportImportStore.create({getOwner:()=>testOwner});
  const results=await Promise.allSettled([testStore.save({...draft,title:'标签页 A'},1),other.save({...draft,title:'标签页 B'},1)]),current=await testStore.load(draft.id);
  const versions=await new Promise((resolve,reject)=>{const request=indexedDB.open('ai-studyreport-imports-v1',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('revisions'),read=tx.objectStore('revisions').getAll();read.onsuccess=()=>resolve(read.result.filter(d=>d.id===draft.id));tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);});
  return {results:results.map(x=>({status:x.status,code:x.reason?.code})),current,versions};
 });
 assert.equal(result.results.filter(x=>x.status==='fulfilled').length,1);assert.equal(result.results.find(x=>x.status==='rejected').code,'CONFLICT');assert.equal(result.current.revision,2);assert.deepEqual(result.versions.map(x=>x.revision),[1,2]);assert.equal(result.versions[0].title,'[系统测试] 原稿');
});

test('save changes only draft settings and never accepts replacement original or parsed data',async()=>{
 const result=await page.evaluate(async()=>{
  const draft=await testStore.createDraft(makeImport()),originalHash=draft.files[0].hash;
  draft.files[0].parsed.blocks[0].text='不应写入的替换正文';draft.files[0].hash='forged';draft.files[0].name='替换原件.docx';
  draft.title='确认后的工作稿';draft.confirmed=true;draft.outline=[{blockId:'p1',title:'人工目录',level:2}];draft.protectedBlockIds=['p1','t1'];
  const saved=await testStore.save(draft,1),loaded=await testStore.load(draft.id);return {saved,loaded,originalHash};
 });
 assert.deepEqual(result.saved,result.loaded);assert.equal(result.saved.title,'确认后的工作稿');assert.equal(result.saved.confirmed,true);assert.equal(result.saved.files[0].parsed.blocks[0].text,'原文与数字 42.44');assert.equal(result.saved.files[0].hash,result.originalHash);assert.equal(result.saved.files[0].name,'主报告.docx');
});

test('quota failure rolls back entire transaction and preserves previous draft and originals',async()=>{
 const result=await page.evaluate(async()=>{
  const draft=await testStore.createDraft(makeImport()),add=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(...args){if(this.name==='revisions')throw new DOMException('simulated quota failure','QuotaExceededError');return add.apply(this,args);};
  let failure;try{await testStore.save({...draft,title:'不应提交'},1);}catch(e){failure={code:e.code,message:e.message};}finally{IDBObjectStore.prototype.add=add;}
  return {failure,current:await testStore.load(draft.id),original:await(await testStore.getOriginal(draft.files[0].id)).blob.text()};
 });
 assert.equal(result.failure.code,'STORAGE');assert.match(result.failure.message,/空间不足/);assert.equal(result.current.revision,1);assert.equal(result.current.title,'[系统测试] 原稿');assert.equal(result.original,'原文与数字 42.44\n\u0000');
});

test('quota failure during initial import leaves no partial draft or original rows',async()=>{
 const result=await page.evaluate(async()=>{
  const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){if(this.name==='parsed')throw new DOMException('simulated quota failure','QuotaExceededError');return add.apply(this,args);};
  let failure;try{await testStore.createDraft(makeImport());}catch(e){failure=e.code;}finally{IDBObjectStore.prototype.add=add;}
  const counts=await new Promise(resolve=>{const r=indexedDB.open('ai-studyreport-imports-v1',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['originals','parsed','drafts','revisions']),result={};for(const name of tx.objectStoreNames){const c=tx.objectStore(name).count();c.onsuccess=()=>{result[name]=c.result;};}tx.oncomplete=()=>{db.close();resolve(result);};};});
  return {failure,counts};
 });
 assert.equal(result.failure,'STORAGE');assert.deepEqual(result.counts,{drafts:0,originals:0,parsed:0,revisions:0});
});

test('account change while reading an original rejects late import without cross-account writes',async()=>{
 const result=await page.evaluate(async()=>{
  const input=makeImport(),bytes=await input.files[0].blob.arrayBuffer();
  class DelayedBlob extends Blob{arrayBuffer(){return new Promise(resolve=>{window.finishRead=()=>resolve(bytes);});}}
  input.files[0].blob=new DelayedBlob([bytes]);const pending=testStore.createDraft(input).catch(e=>e.code);testOwner='bob';finishRead();const failure=await pending,bob=await testStore.list();testOwner='alice';return {failure,bob,alice:await testStore.list()};
 });
 assert.equal(result.failure,'AUTH_CHANGED');assert.equal(result.alice.length,0);assert.equal(result.bob.length,0);
});

test('transaction timeout aborts queued writes and leaves original revision intact',async()=>{
 const result=await page.evaluate(async()=>{
  const draft=await testStore.createDraft(makeImport()),native=IDBDatabase.prototype.transaction;let aborted=false;
  IDBDatabase.prototype.transaction=function(names,mode,...args){
   const tx=native.call(this,names,mode,...args);
   if(mode==='readwrite'){tx.addEventListener('abort',()=>{aborted=true;});const keepAlive=()=>{try{const r=tx.objectStore('drafts').get(['alice',draft.id]);r.onsuccess=keepAlive;}catch(_){}};keepAlive();}
   return tx;
  };
  let failure;try{const slow=ReportImportStore.create({getOwner:()=>testOwner,timeoutMs:80});await slow.save({...draft,title:'超时的新版本'},1);}catch(e){failure=e.code;}finally{IDBDatabase.prototype.transaction=native;}
  return {failure,aborted,current:await testStore.load(draft.id)};
 });
 assert.equal(result.failure,'TIMEOUT');assert.equal(result.aborted,true);assert.equal(result.current.revision,1);assert.equal(result.current.title,'[系统测试] 原稿');
});

test('corrupted parsing is reported instead of silently displaying incomplete original text',async()=>{
 const result=await page.evaluate(async()=>{
  const draft=await testStore.createDraft(makeImport());
  await new Promise(resolve=>{const r=indexedDB.open('ai-studyreport-imports-v1',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('parsed','readwrite'),store=tx.objectStore('parsed'),read=store.get(['alice',draft.files[0].id]);read.onsuccess=()=>store.put({...read.result,value:{blocks:[]}});tx.oncomplete=()=>{db.close();resolve();};};});
  return {failure:await testStore.load(draft.id).catch(e=>e.code),original:await(await testStore.getOriginal(draft.files[0].id)).blob.text()};
 });
 assert.equal(result.failure,'INTEGRITY');assert.equal(result.original,'原文与数字 42.44\n\u0000');
});

test('review append, ordinary settings save, reload, accept and undo preserve immutable originals and legacy draft shape',async()=>{
 const first=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];input.protectedBlockIds=['p1','t1'];
  const original=await testStore.createDraft(input);let d=await testStore.review(original.id,1,{type:'begin',mode:'append',scope:'paragraph',blockId:'p1',instruction:'补充实施安排'}),id=d.reviewState.requests[0].id;
  d=await testStore.review(d.id,d.revision,{type:'complete',requestId:id,changes:[{blockId:'p1',text:'金额 42.44 保留，补充实施安排。',beforeText:'不可信调用方内容'}]});
  const ready=structuredClone(d);d=await testStore.save({...d,title:'[系统测试] 候选工作稿',reviewState:{schemaVersion:999,requests:[]}},d.revision);
  return {original,ready,saved:d,id};
 });
 assert.equal(first.original.reviewState,undefined);assert.match(first.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.deepEqual(first.ready.reviewState,first.saved.reviewState);assert.equal(first.ready.reviewState.requests[0].changes[0].beforeText,'');
 await page.reload();
 const result=await page.evaluate(async({draftId,candidateId})=>{
  const store=ReportImportStore.create({getOwner:()=> 'alice'});let d=await store.load(draftId);const reloaded=structuredClone(d);d=await store.review(d.id,d.revision,{type:'accept',candidateId});const accepted=ReportImportReview.project(d),parsed=d.files[0].parsed;
  const repeat=await store.review(d.id,d.revision,{type:'accept',candidateId}).catch(e=>e.code);d=await store.review(d.id,d.revision,{type:'undo'});
  return {reloaded,accepted,parsed,repeat,undone:ReportImportReview.project(d),final:d,original:await(await store.getOriginal(d.files[0].id)).blob.text()};
 },{draftId:first.saved.id,candidateId:first.id});
 assert.deepEqual(result.reloaded,first.saved);assert.deepEqual(result.parsed,first.original.files[0].parsed);assert.equal(result.accepted[0].appendTexts[0].text,'金额 42.44 保留，补充实施安排。');assert.equal(result.accepted[0].text,'原文与数字 42.44');assert.equal(result.repeat,'REVIEW_STATE');assert.equal(result.undone[0].appendTexts.length,0);assert.equal(result.final.reviewState.requests[0].status,'undone');assert.equal(result.original,'原文与数字 42.44\n\u0000');
});

test('invalid review candidate rolls back without changing pending request, revision or accepted text',async()=>{
 const result=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];let d=await testStore.createDraft(input);d=await testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排'});const before=structuredClone(d),requestId=d.reviewState.requests[0].id;
  const invalid=await testStore.review(d.id,d.revision,{type:'complete',requestId,changes:[{blockId:'p1',text:'新增 999元。'}]}).catch(e=>e.code),after=await testStore.load(d.id);
  return {before,invalid,after};
 });
 assert.equal(result.invalid,'REVIEW_NUMBERS');assert.deepEqual(result.after,result.before);
});

test('concurrent review and settings saves use the same atomic revision gate',async()=>{
 const result=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];const d=await testStore.createDraft(input),other=ReportImportStore.create({getOwner:()=>testOwner});
  const results=await Promise.allSettled([testStore.review(d.id,1,{type:'begin',blockId:'p1',instruction:'说明安排'}),other.save({...d,title:'并发设置'},1)]);
  return {results:results.map(r=>({status:r.status,code:r.reason?.code})),current:await testStore.load(d.id)};
 });
 assert.equal(result.results.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.results.find(r=>r.status==='rejected').code,'CONFLICT');assert.equal(result.current.revision,2);
});

test('protection or directory changes preserve candidates but prevent accepting stale suggestions',async()=>{
 const result=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];let d=await testStore.createDraft(input);d=await testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排'});const requestId=d.reviewState.requests[0].id;
  d=await testStore.review(d.id,d.revision,{type:'complete',requestId,changes:[{blockId:'p1',text:'补充实施安排。'}]});d=await testStore.save({...d,protectedBlockIds:['p1','t1']},d.revision);const before=structuredClone(d);
  const failure=await testStore.review(d.id,d.revision,{type:'accept',candidateId:requestId}).catch(e=>e.code);return {before,failure,after:await testStore.load(d.id)};
 });
 assert.equal(result.failure,'REVIEW_STALE');assert.deepEqual(result.after,result.before);assert.equal(result.after.reviewState.requests[0].status,'ready');
});

test('review storage quota failure rolls back the new overlay and preserves prior history',async()=>{
 const result=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];const d=await testStore.createDraft(input),add=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(...args){if(this.name==='revisions')throw new DOMException('simulated','QuotaExceededError');return add.apply(this,args);};
  let failure;try{await testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排'});}catch(e){failure=e.code;}finally{IDBObjectStore.prototype.add=add;}
  return {before:d,failure,after:await testStore.load(d.id)};
 });
 assert.equal(result.failure,'STORAGE');assert.deepEqual(result.after,result.before);
});

test('review pending survives reload without resending and can be explicitly cancelled',async()=>{
 const saved=await page.evaluate(async()=>{const input=makeImport();input.confirmed=true;input.outline=[];const d=await testStore.createDraft(input);return testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排'});});
 await page.reload();const result=await page.evaluate(async id=>{const store=ReportImportStore.create({getOwner:()=> 'alice'}),d=await store.load(id),requestId=d.reviewState.requests[0].id,cancelled=await store.review(d.id,d.revision,{type:'cancel',requestId});return {restored:d,cancelled,late:await store.review(cancelled.id,cancelled.revision,{type:'complete',requestId,changes:[{blockId:'p1',text:'迟到正文'}]}).catch(e=>e.code)};},saved.id);
 assert.deepEqual(result.restored,saved);assert.equal(result.cancelled.reviewState.requests[0].status,'cancelled');assert.equal(result.late,'REVIEW_STATE');
});

test('account change before review transaction prevents cross-account writes',async()=>{
 const result=await page.evaluate(async()=>{const input=makeImport();input.confirmed=true;input.outline=[];const d=await testStore.createDraft(input),pending=testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排'});testOwner='bob';const failure=await pending.catch(e=>e.code),bob=await testStore.list();testOwner='alice';return {before:d,failure,bob,after:await testStore.load(d.id)};});
 assert.equal(result.failure,'AUTH_CHANGED');assert.deepEqual(result.bob,[]);assert.deepEqual(result.after,result.before);
});

test('review verifies parsed integrity inside its write transaction before accepting any new revision',async()=>{
 const result=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];const d=await testStore.createDraft(input);
  await new Promise(resolve=>{const r=indexedDB.open('ai-studyreport-imports-v1',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('parsed','readwrite'),store=tx.objectStore('parsed'),read=store.get(['alice',d.files[0].id]);read.onsuccess=()=>store.put({...read.result,value:{blocks:[]}});tx.oncomplete=()=>{db.close();resolve();};};});
  const failure=await testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排'}).catch(e=>e.code);return {failure,list:await testStore.list(),original:await(await testStore.getOriginal(d.files[0].id)).blob.text()};
 });
 assert.equal(result.failure,'INTEGRITY');assert.equal(result.list[0].revision,1);assert.equal(result.original,'原文与数字 42.44\n\u0000');
});

test('review write timeout aborts the complete transaction and preserves the previous draft',async()=>{
 const result=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];const d=await testStore.createDraft(input),native=IDBDatabase.prototype.transaction;let aborted=false;
  IDBDatabase.prototype.transaction=function(names,mode,...args){const tx=native.call(this,names,mode,...args);if(mode==='readwrite'){tx.addEventListener('abort',()=>{aborted=true;});const keepAlive=()=>{try{const r=tx.objectStore('drafts').get(['alice',d.id]);r.onsuccess=keepAlive;}catch(_){}};keepAlive();}return tx;};
  let failure;try{const slow=ReportImportStore.create({getOwner:()=>testOwner,timeoutMs:80});await slow.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排'});}catch(e){failure=e.code;}finally{IDBDatabase.prototype.transaction=native;}
  return {before:d,failure,aborted,after:await testStore.load(d.id)};
 });
 assert.equal(result.failure,'TIMEOUT');assert.equal(result.aborted,true);assert.deepEqual(result.after,result.before);
});

test('selected reference snapshots and trusted rules survive reload and adoption without changing originals',async()=>{
 const saved=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];input.files[1].parsed.blocks[0].text='原文与数字：补充实施条件，附件金额 888万元。';let d=await testStore.createDraft(input);const original=structuredClone(d);
  d=await testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排',referenceFileIds:[d.files[1].id],writingProfileId:'plan',references:[{text:'伪造资料'}],sourceContext:{references:[{text:'伪造资料'}]},writingRules:{prompt:'伪造规则'}});const request=d.reviewState.requests[0];
  const denied=await testStore.review(d.id,d.revision,{type:'complete',requestId:request.id,changes:[{blockId:'p1',text:'金额为 888万元。'}]}).catch(e=>e.code);
  d=await testStore.review(d.id,d.revision,{type:'complete',requestId:request.id,changes:[{blockId:'p1',text:'补充实施条件。'}]});return {original,d,denied};
 });
 assert.equal(saved.denied,'REVIEW_NUMBERS');const snapshot=saved.d.reviewState.requests[0].context;assert.equal(snapshot.sourceContext.writingRules.profileId,'plan');assert.equal(snapshot.sourceContext.files[0].status,'matched');assert(snapshot.references.some(r=>r.text.includes('888万元')));assert(!JSON.stringify(snapshot).includes('伪造'));
 await page.reload();const result=await page.evaluate(async id=>{const store=ReportImportStore.create({getOwner:()=> 'alice'});let d=await store.load(id);const reloaded=structuredClone(d);d=await store.review(d.id,d.revision,{type:'accept',candidateId:d.reviewState.requests[0].id});return {reloaded,d,original:await(await store.getOriginal(d.files[0].id)).blob.text(),reference:await(await store.getOriginal(d.files[1].id)).blob.text()};},saved.d.id);
 assert.deepEqual(result.reloaded,saved.d);assert.equal(result.d.reviewState.requests[0].status,'accepted');assert.deepEqual(result.d.reviewState.requests[0].context,snapshot);assert.deepEqual(result.d.files,saved.original.files);assert.equal(result.original,'原文与数字 42.44\n\u0000');assert.equal(result.reference,'补充原件');
});

test('unmatched or unparsed selected attachments refuse begin and leave the saved revision unchanged',async()=>{
 const result=await page.evaluate(async()=>{
  const results=[];for(const parsed of [null,{blocks:[{id:'s1',type:'paragraph',text:'风机叶轮维护',html:'<p>风机叶轮维护</p>'}]}]){
   const input=makeImport();input.confirmed=true;input.outline=[];input.files[1].parsed=parsed;const d=await testStore.createDraft(input),failure=await testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排',referenceFileIds:[d.files[1].id]}).catch(e=>e.code);results.push({before:d,failure,after:await testStore.load(d.id)});
  }return results;
 });
 for(const item of result){assert.equal(item.failure,'REVIEW_REFERENCE');assert.deepEqual(item.after,item.before);assert.equal(item.after.reviewState,undefined);}
});

test('changed selected parsed content with a valid storage hash still invalidates the pending context',async()=>{
 const result=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];input.files[1].parsed.blocks[0].text='原文与数字的补充实施条件。';let d=await testStore.createDraft(input);d=await testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排',referenceFileIds:[d.files[1].id]});const before=structuredClone(d);
  await new Promise((resolve,reject)=>{const r=indexedDB.open('ai-studyreport-imports-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('parsed','readwrite'),store=tx.objectStore('parsed'),read=store.get(['alice',d.files[1].id]);read.onsuccess=()=>{const row=read.result;row.value.blocks[0].text+='材料已更新。';row.hash=ReportImportStore.sha256(new TextEncoder().encode(JSON.stringify(row.value)));store.put(row);};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
  const failure=await testStore.review(d.id,d.revision,{type:'complete',requestId:d.reviewState.requests[0].id,changes:[{blockId:'p1',text:'补充实施安排。'}]}).catch(e=>e.code);return {before,failure,after:await testStore.load(d.id),original:await(await testStore.getOriginal(d.files[1].id)).blob.text()};
 });
 assert.equal(result.failure,'REVIEW_STALE');assert.equal(result.after.revision,result.before.revision);assert.deepEqual(result.after.reviewState,result.before.reviewState);assert.equal(result.original,'补充原件');
});

test('legacy ready candidate can be adopted without the new context module loaded',async()=>{
 const result=await page.evaluate(async()=>{
  const input=makeImport();input.confirmed=true;input.outline=[];let d=await testStore.createDraft(input);d=await testStore.review(d.id,d.revision,{type:'begin',blockId:'p1',instruction:'说明安排'});d=await testStore.review(d.id,d.revision,{type:'complete',requestId:d.reviewState.requests[0].id,changes:[{blockId:'p1',text:'旧候选补充。'}]});
  await new Promise((resolve,reject)=>{const r=indexedDB.open('ai-studyreport-imports-v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),read=store.get(['alice',d.id]);read.onsuccess=()=>{const row=read.result,c=row.reviewState.requests[0].context;for(const key of ['reviewContextVersion','referenceFileIds','writingProfileId','sourceContext','references'])delete c[key];delete c.baseline.request;delete c.baseline.sourceContext;store.put(row);};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
  const newContext=window.ReportImportContext;window.ReportImportContext=undefined;try{d=await testStore.review(d.id,d.revision,{type:'accept',candidateId:d.reviewState.requests[0].id});return {d,projection:ReportImportReview.project(d)};}finally{window.ReportImportContext=newContext;}
 });
 assert.equal(result.d.reviewState.requests[0].status,'accepted');assert.equal(result.d.reviewState.requests[0].context.sourceContext,undefined);assert.equal(result.projection[0].appendTexts[0].text,'旧候选补充。');
});
