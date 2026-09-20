import {packState,referencedObjects} from './research-state-codec.mjs';
// Only a successful remote save of the exact payload can authorize eviction.
// Old rows, unique recovery copies and unknown-owner AI caches stay protected.
export async function acknowledgeReportCache(key,state,{budgetBytes=64*1024*1024}={}){
 if(typeof key!=='string'||!key.includes('/')||!Number.isFinite(budgetBytes)||budgetBytes<0)throw Error('缓存范围无效');
 const packed=await packState(state),normalize=manifest=>JSON.stringify(manifest?.[0]==='o'?['o',manifest[1].filter(([k])=>k!=='ts')]:manifest);
 return new Promise((resolve,reject)=>{
  const open=indexedDB.open('ai-studyreport-drafts',2);let db,tx,expired=false;
  const timer=setTimeout(()=>{expired=true;try{tx?.abort();db?.close();}catch{}reject(Error('缓存维护超时，原草稿保留'));},8000);
  open.onerror=()=>{clearTimeout(timer);reject(open.error);};open.onblocked=()=>{clearTimeout(timer);expired=true;reject(Error('缓存被旧页面占用'));};
  open.onsuccess=()=>{
   db=open.result;if(expired){db.close();return;}if(!db.objectStoreNames.contains('objects')){clearTimeout(timer);db.close();resolve(false);return;}
   tx=db.transaction(['drafts','objects'],'readwrite');const drafts=tx.objectStore('drafts'),objects=tx.objectStore('objects'),get=drafts.get(key);let matched=false;
   get.onsuccess=()=>{
    const row=get.result;if(row?.storageFormat!=='draft-parts-v1'||normalize(row.manifest)!==normalize(packed.manifest))return;
    matched=true;row.confirmedAt=Date.now();row.confirmedBytes=JSON.stringify(row.manifest).length*2+[...packed.objects.values()].reduce((n,v)=>n+v.length*2,0);drafts.put(row,key);
    const ownerPrefix=key.slice(0,key.lastIndexOf('/')+1),cursor=drafts.openCursor(),rows=[];
    cursor.onsuccess=()=>{
     const c=cursor.result;
     if(c){if(typeof c.key==='string'&&c.key.startsWith(ownerPrefix)&&!c.key.slice(ownerPrefix.length).includes('/')&&c.value.confirmedAt)rows.push({key:c.key,...c.value});c.continue();return;}
     rows.sort((a,b)=>b.confirmedAt-a.confirmedAt);let bytes=0;
     for(const entry of rows){bytes+=entry.confirmedBytes||budgetBytes;if(bytes<=budgetBytes)continue;drafts.delete(entry.key);for(const id of referencedObjects(entry.manifest))objects.delete(entry.key+'/'+id);}
    };
   };
   tx.oncomplete=()=>{clearTimeout(timer);db.close();resolve(matched);};tx.onerror=tx.onabort=()=>{clearTimeout(timer);db.close();reject(tx.error||Error('缓存维护未完成'));};
  };
 });
}
