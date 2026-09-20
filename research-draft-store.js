/* Durable local drafts. No deletion of legacy storage; no server authority here. */
(function(root){
 'use strict';
 const scopeKey=s=>{
  if(!s||['userId','researchId','runId','epoch'].some(k=>s[k]===undefined||s[k]===null||s[k]===''))throw new Error('草稿身份不完整');
  return JSON.stringify([s.userId,s.researchId,s.runId,s.epoch]);
 };
 function indexedAdapter(indexedDB){
  let opening;
  function db(){return opening||(opening=new Promise((resolve,reject)=>{
   const request=indexedDB.open('research-drafts-v1',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'}).createIndex('scope','scope');
   request.onerror=()=>{opening=null;reject(new Error('本机草稿库无法打开，请保持页面并重试保存'));};
   request.onblocked=()=>{opening=null;reject(new Error('请关闭其他旧版页面后重试；未删除草稿'));};
   request.onsuccess=()=>{const value=request.result;value.onversionchange=()=>{value.close();opening=null;};resolve(value);};
  }));}
  async function transaction(mode,work){
   const database=await db();
   return new Promise((resolve,reject)=>{
    const tx=database.transaction('drafts',mode);let result;
    tx.oncomplete=()=>resolve(result);
    tx.onabort=tx.onerror=()=>reject(new Error('本机草稿保存未完成，请保持页面并重试'));
    work(tx.objectStore('drafts'),value=>{result=value;});
   });
  }
  return {
   put:row=>transaction('readwrite',(store,done)=>{const r=store.add(row);r.onsuccess=()=>done(row.id);}),
   list:scope=>transaction('readonly',(store,done)=>{const r=store.index('scope').getAll(scope);r.onsuccess=()=>done(r.result);}),
   acknowledge:(id,scope,receipt)=>transaction('readwrite',(store,done)=>{const r=store.get(id);r.onsuccess=()=>{const row=r.result;if(!row||row.scope!==scope)return done(false);store.put({...row,receipt});done(true);};}),
   prune:(scope,before)=>transaction('readwrite',(store,done)=>{let count=0;const r=store.index('scope').openCursor(scope);r.onsuccess=()=>{const cursor=r.result;if(!cursor)return done(count);const row=cursor.value;if(row.scope===scope&&row.receipt&&row.receipt.confirmedAt<before&&!row.conflict){cursor.delete();count++;}cursor.continue();};})
  };
 }
 function create({adapter,now=Date.now,id=()=>crypto.randomUUID()}={}){
  adapter=adapter||indexedAdapter(root.indexedDB);
  return Object.freeze({
   async save(scope,state,{baseVersion,conflict=false}={}){
    const row={id:id(),scope:scopeKey(scope),state:JSON.parse(JSON.stringify(state)),baseVersion,conflict:!!conflict,createdAt:now(),receipt:null};
    await adapter.put(row);return row.id;
   },
   async list(scope){return (await adapter.list(scopeKey(scope))).filter(r=>r.scope===scopeKey(scope)).sort((a,b)=>b.createdAt-a.createdAt);},
   async acknowledge(scope,draftId,{serverVersion,state}={}){
    if(!Number.isInteger(serverVersion)||serverVersion<0)throw new Error('缺少服务器保存确认');
    const key=scopeKey(scope),row=(await adapter.list(key)).find(r=>r.id===draftId&&r.scope===key);
    if(!row||JSON.stringify(row.state)!==JSON.stringify(state))throw new Error('服务器确认与草稿内容不一致，保留副本');
    return adapter.acknowledge(draftId,key,{serverVersion,confirmedAt:now()});
   },
   async cleanup(scope,{retentionMs=7*24*60*60*1000}={}){
    if(!Number.isFinite(retentionMs)||retentionMs<24*60*60*1000)throw new Error('已同步草稿至少保留一天');
    return adapter.prune(scopeKey(scope),now()-retentionMs);
   }
  });
 }
 const api=Object.freeze({create,indexedAdapter,scopeKey});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ResearchDraftStore=api;
})(typeof window!=='undefined'?window:globalThis);
