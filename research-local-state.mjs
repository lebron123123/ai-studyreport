import {packState,unpackState,referencedObjects} from './research-state-codec.mjs';
const hashes=new Map();
let opening;
function database(){
 if(!globalThis.indexedDB)return Promise.reject(Error('本机草稿库不可用'));
 return opening||(opening=new Promise((resolve,reject)=>{
  const r=indexedDB.open('research-state-parts-v1',1);
  let expired=false;const timer=setTimeout(()=>{expired=true;opening=null;reject(Error('本机草稿库打开超时，仍可保存到项目库'));},5000);
  r.onupgradeneeded=()=>{r.result.createObjectStore('objects');r.result.createObjectStore('drafts',{keyPath:'id'}).createIndex('scope','scope');};
  r.onerror=()=>{clearTimeout(timer);opening=null;reject(Error('本机草稿库打开失败'));};
  r.onblocked=()=>{clearTimeout(timer);expired=true;opening=null;reject(Error('请关闭旧版页面后重试保存，草稿未删除'));};
  r.onsuccess=()=>{clearTimeout(timer);const db=r.result;if(expired){db.close();return;}db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
 }));
}
async function transaction(stores,mode,work){
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction(stores,mode);let result;
  const timer=setTimeout(()=>{try{tx.abort();}catch{}reject(Error('本机草稿操作超时，原副本保留'));},8000);
  tx.oncomplete=()=>{clearTimeout(timer);resolve(result);};tx.onabort=tx.onerror=()=>{clearTimeout(timer);reject(Error('本机草稿保存未完成，请勿关闭页面'));};
  try{work(tx,value=>result=value);}catch(e){tx.abort();reject(e);}
 });
}
export function scopeOf(identity){
 const values=[identity.userId,identity.run.researchId,identity.run.runId,identity.run.epoch];
 if(values.some(x=>x==null||x===''))throw Error('本机草稿身份不完整');
 return JSON.stringify(values);
}
export async function listDrafts(identity){
 const scope=scopeOf(identity);
 return transaction(['drafts'],'readonly',(tx,done)=>{const r=tx.objectStore('drafts').index('scope').getAll(scope);r.onsuccess=()=>done(r.result.sort((a,b)=>b.createdAt-a.createdAt));});
}
export async function saveLocal(identity,state){
  const scope=scopeOf(identity),packed=await packState(state,hashes);
 const estimatedBytes=JSON.stringify(packed.manifest).length*2+[...packed.objects.values()].reduce((n,text)=>n+text.length*2,0);
 const row={id:crypto.randomUUID(),scope,createdAt:Date.now(),baseVersion:identity.run.version,manifest:packed.manifest,estimatedBytes,acknowledged:false};
 await transaction(['objects','drafts'],'readwrite',(tx,done)=>{
  for(const [digest,content] of packed.objects){const key=scope+'/'+digest,store=tx.objectStore('objects'),r=store.getKey(key);r.onsuccess=()=>{if(r.result===undefined)store.add(content,key);};}
  tx.objectStore('drafts').add(row);done(row.id);
 });
 return row.id;
}
export async function loadLocal(identity,id){
 const scope=scopeOf(identity);
 return transaction(['objects','drafts'],'readonly',(tx,done)=>{
  const r=tx.objectStore('drafts').get(id);
  r.onsuccess=()=>{
   const row=r.result;if(!row||row.scope!==scope)return done(null);
   const objects=new Map(),ids=[...referencedObjects(row.manifest)];let remaining=ids.length;
   const finish=()=>{try{done({...row,state:unpackState(row.manifest,objects)});}catch{tx.abort();}};
   if(!remaining)return finish();
   for(const digest of ids){const request=tx.objectStore('objects').get(scope+'/'+digest);request.onsuccess=()=>{if(typeof request.result==='string')objects.set(digest,request.result);if(--remaining===0)finish();};}
  };
 });
}
export async function acknowledgeLocal(identity,id,version){
 if(!Number.isSafeInteger(version)||version<identity.run.version)throw Error('服务器回执版本无效');
 const scope=scopeOf(identity);
 const acknowledged=await transaction(['drafts'],'readwrite',(tx,done)=>{const store=tx.objectStore('drafts'),r=store.get(id);r.onsuccess=()=>{const row=r.result;if(!row||row.scope!==scope)return done(false);store.put({...row,acknowledged:true,serverVersion:version});done(true);};});
 if(acknowledged){await compactAcknowledged(identity);await compactAccountAcknowledged(identity);}
 return acknowledged;
}
// Account-wide budget, not one allowance per research. Pending/conflict copies
// remain protected even when they exceed the budget; never evict another user.
export async function compactAccountAcknowledged(identity,{budgetBytes=128*1024*1024}={}){
 if(!Number.isFinite(budgetBytes)||budgetBytes<0)throw Error('缓存预算无效');
 const owner=JSON.parse(scopeOf(identity))[0];
 return transaction(['drafts','objects'],'readwrite',(tx,done)=>{
  const drafts=tx.objectStore('drafts'),request=drafts.getAll();
  request.onsuccess=()=>{
   const rows=request.result.filter(row=>{try{return JSON.parse(row.scope)[0]===owner;}catch{return false;}}).sort((a,b)=>b.createdAt-a.createdAt);
   const keep=new Set(),scopes=new Set(rows.map(row=>row.scope));let bytes=0,removed=0;
   for(const row of rows){
    if(row.acknowledged){const size=Number(row.estimatedBytes)||budgetBytes;if(bytes+size>budgetBytes){drafts.delete(row.id);removed++;continue;}bytes+=size;}
    for(const digest of referencedObjects(row.manifest))keep.add(row.scope+'/'+digest);
   }
   let pending=scopes.size;if(!pending)return done({removed,confirmedEstimatedBytes:bytes});
   for(const scope of scopes){
    const prefix=scope+'/',cursor=tx.objectStore('objects').openKeyCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
    cursor.onsuccess=()=>{const item=cursor.result;if(!item){if(--pending===0)done({removed,confirmedEstimatedBytes:bytes});return;}if(!keep.has(item.key))tx.objectStore('objects').delete(item.key);item.continue();};
   }
  };
 });
}
export async function compactAcknowledged(identity,{budgetBytes=64*1024*1024,maxConfirmed=20}={}){
 if(!Number.isFinite(budgetBytes)||budgetBytes<0||!Number.isSafeInteger(maxConfirmed)||maxConfirmed<0)throw Error('缓存预算无效');
 const scope=scopeOf(identity);
 return transaction(['drafts','objects'],'readwrite',(tx,done)=>{
  const store=tx.objectStore('drafts'),r=store.index('scope').getAll(scope);
  r.onsuccess=()=>{
   const rows=r.result.sort((a,b)=>b.createdAt-a.createdAt),retained=new Set();let confirmations=0,bytes=0;
   for(const row of rows){
    // Unsynced/conflict drafts are never automatically removed. Keep the latest
    // twenty confirmed manifests; all removed content remains in the backend.
    if(row.acknowledged){
     const size=Number(row.estimatedBytes)||budgetBytes;
     if(++confirmations>maxConfirmed||bytes+size>budgetBytes){store.delete(row.id);continue;}
     bytes+=size;
    }
    for(const digest of referencedObjects(row.manifest))retained.add(scope+'/'+digest);
   }
   const prefix=scope+'/',cursor=tx.objectStore('objects').openKeyCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
   cursor.onsuccess=()=>{const item=cursor.result;if(!item)return done(true);if(!retained.has(item.key))tx.objectStore('objects').delete(item.key);item.continue();};
  };
 });
}
