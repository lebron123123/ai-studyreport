/* Existing-report imports are independent browser drafts, never project writes. */
(function(root){
 'use strict';
 const DATABASE='ai-studyreport-imports-v1';
 const error=(code,message,cause)=>Object.assign(new Error(message),{code,...(cause?{cause}:{} )});
 const clone=value=>structuredClone(value);
 const key=(owner,id)=>[owner,id];
 // SHA-256 also works on HTTP LAN deployments where crypto.subtle is absent.
 function sha256(bytes){
  const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],length=bytes.length,padded=new Uint8Array(Math.ceil((length+9)/64)*64),view=new DataView(padded.buffer),words=new Uint32Array(64);
  padded.set(bytes);padded[length]=0x80;view.setUint32(padded.length-8,Math.floor(length/0x20000000));view.setUint32(padded.length-4,(length*8)>>>0);
  const rotate=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let offset=0;offset<padded.length;offset+=64){
   for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
   for(let i=16;i<64;i++){const a=words[i-15],b=words[i-2];words[i]=(words[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+words[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;}
   let [a,b,c,d,e,f,g,j]=h;
   for(let i=0;i<64;i++){const t1=(j+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^((~e)&g))+k[i]+words[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
   [a,b,c,d,e,f,g,j].forEach((v,i)=>{h[i]=(h[i]+v)>>>0;});
  }
  return h.map(v=>v.toString(16).padStart(8,'0')).join('');
 }
 async function digest(value){
  const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
  if(root.crypto?.subtle){const result=await root.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(result),v=>v.toString(16).padStart(2,'0')).join('');}
  return sha256(bytes);
 }
 function identifier(){
  if(!root.crypto?.getRandomValues)throw error('STORAGE','当前浏览器无法安全创建工作稿编号，请升级浏览器后重试');
  return 'import_'+Array.from(root.crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
 }
 function reviewIdentifier(){
  if(root.crypto?.randomUUID)return root.crypto.randomUUID();
  if(!root.crypto?.getRandomValues)throw error('STORAGE','当前浏览器无法安全创建候选编号');
  const bytes=root.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
 }
 function storageError(cause){
  if(cause?.code&&typeof cause.code==='string')return cause;
  return error('STORAGE',cause?.name==='QuotaExceededError'?'本浏览器存储空间不足，已有原件和工作稿未删除；请保留文件后重试':'本浏览器保存未完成，已有原件和工作稿保留，请重试',cause);
 }
 function create({getOwner,indexedDB=root.indexedDB,timeoutMs=12000}={}){
  if(typeof getOwner!=='function')throw error('OWNER_REQUIRED','缺少当前账号');
  const timeout=Number.isFinite(timeoutMs)&&timeoutMs>0?timeoutMs:12000;
  function owner(){const value=getOwner();if(typeof value!=='string'||!value.trim())throw error('OWNER_REQUIRED','请先登录后再保存或打开工作稿');return value;}
  function check(expected){let current;try{current=owner();}catch(_){}if(current!==expected)throw error('AUTH_CHANGED','登录账号已变化，旧任务结果未采用，请重新打开工作稿');}
  function open(expected){return new Promise((resolve,reject)=>{
   if(!indexedDB)return reject(error('STORAGE','当前浏览器不支持本机工作稿保存，请更换浏览器'));
   let settled=false,request;
   const finish=(failure,db)=>{if(settled){db?.close();return;}settled=true;clearTimeout(timer);failure?reject(failure):resolve(db);};
   const timer=setTimeout(()=>finish(error('TIMEOUT','打开本机工作稿库超时，请保留原件并重试')),timeout);
   try{check(expected);request=indexedDB.open(DATABASE,1);}catch(e){finish(storageError(e));return;}
   request.onupgradeneeded=()=>{const db=request.result;for(const name of ['originals','parsed','drafts','revisions'])if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name,{keyPath:name==='revisions'?['owner','id','revision']:['owner','id']});store.createIndex('owner','owner');}};
   request.onblocked=()=>finish(error('STORAGE','工作稿库被其他页面占用，请关闭旧版页面后重试；已有工作稿保留'));
   request.onerror=()=>finish(storageError(request.error));
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();try{check(expected);finish(null,db);}catch(e){db.close();finish(e);}};
  });}
  async function transaction(expected,names,mode,work){
   const db=await open(expected);try{check(expected);}catch(e){db.close();throw e;}
   return new Promise((resolve,reject)=>{
    let tx,result,failure,settled=false;
    const finish=e=>{if(settled)return;settled=true;clearTimeout(timer);db.close();e?reject(storageError(e)):resolve(result);};
    const abort=e=>{failure=e;try{tx?.abort();}catch(_){}if(!tx)finish(e);};
    const timer=setTimeout(()=>abort(error('TIMEOUT','本机保存超时，未确认保存成功；已有原件保留，请重试')),timeout);
    const guard=callback=>(...args)=>{try{check(expected);callback(...args);}catch(e){abort(e);}};
    try{
     tx=db.transaction(names,mode);
     tx.oncomplete=()=>{try{check(expected);finish();}catch(e){finish(e);}};
     tx.onabort=()=>finish(failure||tx.error||error('STORAGE','本机保存已中止，已有版本保留，请重试'));
     tx.onerror=()=>{failure=failure||tx.error;};
     work(tx,guard,value=>{result=value;},abort);
    }catch(e){abort(e);}
   });
  }
  function editable(input){
   const title=String(input.title||'未命名报告').trim();if(!title||title.length>200)throw error('INVALID','工作稿名称应为 1 至 200 字');
   if(!Array.isArray(input.outline||[])||!Array.isArray(input.protectedBlockIds||[]))throw error('INVALID','目录或原文保护设置格式错误');
   return {title,outline:clone(input.outline||[]),confirmed:input.confirmed===true,protectedBlockIds:[...new Set((input.protectedBlockIds||[]).map(String))]};
  }
  function validateFiles(files){
   const roles=new Set(['main','special','reference','calculation']);
   if(files.some(file=>!roles.has(file.role))||files.filter(file=>file.role==='main').length!==1)throw error('INVALID','请选择一份主报告，并为补充资料选择有效角色');
   for(const file of files){
    if(file.role!=='main'&&file.parsed===null)continue;
    const parsed=file.parsed,ids=new Set();
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!Array.isArray(parsed.blocks)||!parsed.blocks.length)throw error('INVALID','Word 文件尚未正确解析，未保存不完整工作稿');
    for(const block of parsed.blocks){
     if(!block||typeof block!=='object'||typeof block.id!=='string'||!block.id.trim()||ids.has(block.id)||!['paragraph','table','unsupported'].includes(block.type)||typeof block.text!=='string'||typeof block.html!=='string')throw error('INVALID','原文段落结构无效，未保存不完整工作稿');
     ids.add(block.id);
    }
   }
  }
  async function readDraft(expected,id,historicalRevision){
   const historical=historicalRevision!=null;
   const loaded=await transaction(expected,[historical?'revisions':'drafts','parsed','originals'],'readonly',(tx,guard,done,abort)=>{
    const request=tx.objectStore(historical?'revisions':'drafts').get(historical?[expected,id,historicalRevision]:key(expected,id));request.onsuccess=guard(()=>{
     if(!request.result){abort(error('NOT_FOUND','工作稿不存在或不属于当前账号'));return;}
     const draft=request.result,files=[];done({...draft,files});
     for(const ref of draft.files){
      const item={...ref};files.push(item);
      const parsed=tx.objectStore('parsed').get(key(expected,ref.id));parsed.onsuccess=guard(()=>{if(!parsed.result){abort(error('INTEGRITY','工作稿解析内容缺失，原件保留，请重新导入独立工作稿'));return;}item.parsed=parsed.result.value;item.parsedHash=parsed.result.hash;});
      const original=tx.objectStore('originals').getKey(key(expected,ref.id));original.onsuccess=guard(()=>{if(!original.result)abort(error('INTEGRITY','工作稿原件缺失，未将工作稿标记为完整'));});
     }
    });
   });
   for(const file of loaded.files){if(await digest(new TextEncoder().encode(JSON.stringify(file.parsed)))!==file.parsedHash)throw error('INTEGRITY','解析内容校验不一致，原件保留，请重新导入独立工作稿');delete file.parsedHash;check(expected);}
   return loaded;
  }
  async function original(expected,id){
   const row=await transaction(expected,['originals'],'readonly',(tx,guard,done,abort)=>{const request=tx.objectStore('originals').get(key(expected,id));request.onsuccess=guard(()=>request.result?done(request.result):abort(error('NOT_FOUND','原件不存在或不属于当前账号')));});
   if(!(row.blob instanceof Blob)||row.size!==row.blob.size||await digest(await row.blob.arrayBuffer())!==row.hash)throw error('INTEGRITY','原件校验不一致，已阻止读取，请保留磁盘上的原始文件');
   check(expected);return row;
  }
  return Object.freeze({
   async list(){const expected=owner();return transaction(expected,['drafts'],'readonly',(tx,guard,done)=>{const request=tx.objectStore('drafts').index('owner').getAll(expected);request.onsuccess=guard(()=>done(request.result.map(d=>({id:d.id,title:d.title,revision:d.revision,createdAt:d.createdAt,updatedAt:d.updatedAt,confirmed:d.confirmed,fileCount:d.files.length})).sort((a,b)=>b.updatedAt-a.updatedAt)));});},
   async createDraft(input){
    const expected=owner(),fields=editable(input||{});
    if(!Array.isArray(input?.files)||!input.files.length)throw error('INVALID','请先选择需要导入的原件');
    const files=input.files.map(file=>({...file,parsed:clone(file.parsed)}));
    validateFiles(files);
    const rows=[];
    for(const file of files){
     check(expected);if(!(file.blob instanceof Blob)||!file.blob.size)throw error('INVALID','原件为空或无法读取');
     if(file.blob.size>50*1024*1024)throw error('INVALID','单个原件不能超过 50 MiB');
     const bytes=await file.blob.arrayBuffer(),hash=await digest(bytes),parsed=clone(file.parsed),parsedHash=await digest(new TextEncoder().encode(JSON.stringify(parsed)));
     check(expected);rows.push({id:identifier(),name:String(file.name||'原件.docx'),role:file.role,size:file.blob.size,type:file.blob.type||'application/octet-stream',hash,blob:file.blob,parsed,parsedHash});
    }
    const now=Date.now(),draft={owner:expected,id:identifier(),schemaVersion:1,revision:1,createdAt:now,updatedAt:now,...fields,files:rows.map(({blob,parsed,parsedHash,...ref})=>ref)};
    await transaction(expected,['originals','parsed','drafts','revisions'],'readwrite',(tx,guard,done)=>{
     for(const row of rows){const {parsed,parsedHash,...source}=row;tx.objectStore('originals').add({owner:expected,...source});tx.objectStore('parsed').add({owner:expected,id:row.id,value:parsed,hash:parsedHash});}
     tx.objectStore('drafts').add(draft);tx.objectStore('revisions').add(draft);done(true);
    });
    for(const row of rows)await original(expected,row.id);
    return readDraft(expected,draft.id);
   },
   async load(id){return readDraft(owner(),id);},
   async save(input,expectedRevision){
    const expected=owner(),fields=editable(input||{});
    if(input?.owner!==expected)throw error('AUTH_CHANGED','工作稿不属于当前账号，未写入');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw error('CONFLICT','缺少工作稿版本，请重新打开后保存');
    const saved=await transaction(expected,['drafts','revisions','parsed'],'readwrite',(tx,guard,done,abort)=>{
     const request=tx.objectStore('drafts').get(key(expected,input.id));request.onsuccess=guard(()=>{
      const old=request.result;if(!old){abort(error('NOT_FOUND','工作稿不存在或不属于当前账号'));return;}
      if(old.revision!==expectedRevision){abort(error('CONFLICT','其他页面已经保存了新版本，未覆盖；请保留当前修改并重新打开工作稿'));return;}
      const next={...old,...fields,revision:old.revision+1,updatedAt:Date.now()};tx.objectStore('drafts').put(next);tx.objectStore('revisions').add(next);
      const files=next.files.map(ref=>({...ref}));done({...next,files});
      for(const file of files){const parsed=tx.objectStore('parsed').get(key(expected,file.id));parsed.onsuccess=guard(()=>{if(!parsed.result){abort(error('INTEGRITY','工作稿解析内容缺失，未保存新版本'));return;}file.parsed=parsed.result.value;file.parsedHash=parsed.result.hash;});}
     });
    });
    // Return the accepted revision, even if another tab saves a later revision.
    for(const file of saved.files){if(await digest(new TextEncoder().encode(JSON.stringify(file.parsed)))!==file.parsedHash)throw error('INTEGRITY','解析内容校验不一致，原件和历史版本保留');delete file.parsedHash;check(expected);}
    return saved;
   },
   async review(id,expectedRevision,action){
    const expected=owner(),operation=clone(action),engine=root.ReportImportReview||(typeof require==='function'?require('./report-import-review.js'):null);
    if(!engine?.apply)throw error('REVIEW_UNAVAILABLE','候选审阅模块尚未加载，请刷新页面后重试');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw error('CONFLICT','缺少工作稿版本，请重新打开后保存');
    const requestId=operation?.type==='begin'?reviewIdentifier():null;
    return transaction(expected,['drafts','revisions','parsed'],'readwrite',(tx,guard,done,abort)=>{
     const request=tx.objectStore('drafts').get(key(expected,id));request.onsuccess=guard(()=>{
      const old=request.result;if(!old){abort(error('NOT_FOUND','工作稿不存在或不属于当前账号'));return;}
      if(old.revision!==expectedRevision){abort(error('CONFLICT','其他页面已经保存了新版本，候选操作未覆盖；请保留当前内容并重新打开工作稿'));return;}
      const files=old.files.map(ref=>({...ref}));let remaining=files.length;
      for(const file of files){const parsed=tx.objectStore('parsed').get(key(expected,file.id));parsed.onsuccess=guard(()=>{
       if(!parsed.result||sha256(new TextEncoder().encode(JSON.stringify(parsed.result.value)))!==parsed.result.hash){abort(error('INTEGRITY','解析内容缺失或校验不一致，候选操作未保存，原件保留'));return;}
       file.parsed=parsed.result.value;if(--remaining)return;
       const reviewState=engine.apply({...old,files},operation,{requestId,now:Date.now()}),next={...old,reviewState,revision:old.revision+1,updatedAt:Date.now()};
       tx.objectStore('drafts').put(next);tx.objectStore('revisions').add(next);done({...next,files});
      });}
     });
    });
   },
   async getOriginal(id){return original(owner(),id);},
   async exportSnapshot(id,expectedRevision,{historical=false}={}){
    if(historical&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<1))throw error('CONFLICT','请选择有效的历史工作稿版本，未另存副本');
    const expected=owner(),draft=await readDraft(expected,id,historical?expectedRevision:undefined);
    if(expectedRevision!=null&&draft.revision!==expectedRevision)throw error('CONFLICT','工作稿版本已变化，请先保存或重新打开后备份');
    const originals=[];for(const file of draft.files){const row=await original(expected,file.id);check(expected);originals.push({id:row.id,name:row.name,role:row.role,type:row.type,size:row.size,hash:row.hash,blob:row.blob});}
    const revisions=await transaction(expected,['drafts','revisions'],'readonly',(tx,guard,done,abort)=>{
     if(!historical){const current=tx.objectStore('drafts').get(key(expected,id));current.onsuccess=guard(()=>{if(current.result?.revision!==draft.revision)abort(error('CONFLICT','备份期间工作稿版本已变化，未导出混合版本，请重新备份'));});}
     const request=tx.objectStore('revisions').getAll(root.IDBKeyRange.bound([expected,id,1],[expected,id,draft.revision]));request.onsuccess=guard(()=>done(request.result));
    });check(expected);return {schemaVersion:1,owner:expected,draft,originals,revisions};
   },
   async importSnapshot(input){
    const expected=owner(),backup=root.ReportImportBackup||(typeof require==='function'?require('./report-import-backup.js'):null);
    if(!backup?.validate)throw error('DEPENDENCY_MISSING','完整备份模块尚未加载，请刷新后重试');
    const snapshot=clone(input);await backup.validate(snapshot,{owner:expected});check(expected);
    const old=snapshot.draft,newId=identifier(),fileIds=new Map(old.files.map(file=>[file.id,identifier()])),now=Date.now();
    const remap=(value,name)=>{if(name==='qualityDecisions'||name==='receiptContext')return clone(value);if(typeof value==='string'){if(['fileId','mainFileId','id'].includes(name)&&fileIds.has(value))return fileIds.get(value);if(name==='draftId'&&value===old.id)return newId;return value;}if(Array.isArray(value))return value.map(item=>name==='referenceFileIds'&&typeof item==='string'?(fileIds.get(item)||item):remap(item,''));if(value&&typeof value==='object'){const result={};for(const [field,item]of Object.entries(value))result[field]=remap(item,field);return result;}return value;};
    const remapRevision=revision=>{const value=remap(revision,'');value.id=newId;value.owner=expected;value.restoredFrom={draftId:old.id,revision:old.revision,restoredAt:now};
     if(value.reviewState?.requests)for(let i=0;i<value.reviewState.requests.length;i++){const source=revision.reviewState.requests[i],request=value.reviewState.requests[i];if(['running','outcome_unknown'].includes(source.status)){request.status='outcome_unknown';request.durable=source.durable===true;if(request.durable)request.receiptContext=clone(source.receiptContext||source.context);request.message='此请求的结果尚未确认；请只回查原请求。取得结果后仍须审阅采用，恢复副本不会重新发送生成请求。';request.restoredFromDraftId=old.id;}}
     return value;};
    const draft=remapRevision(old),rows=[];
    for(const file of draft.files){const oldId=old.files.find(source=>fileIds.get(source.id)===file.id).id,source=snapshot.originals.find(original=>original.id===oldId),parsed=clone(file.parsed);rows.push({owner:expected,id:file.id,name:file.name,role:file.role,size:file.size,type:file.type,hash:file.hash,blob:source.blob,parsed,parsedHash:await digest(new TextEncoder().encode(JSON.stringify(parsed)))});check(expected);}
    const stripParsed=value=>({...value,files:value.files.map(({parsed,...ref})=>ref)}),saved=stripParsed(draft),revisions=snapshot.revisions.map(remapRevision);
    await transaction(expected,['originals','parsed','drafts','revisions'],'readwrite',(tx,guard,done)=>{for(const row of rows){const {parsed,parsedHash,...source}=row;tx.objectStore('originals').add(source);tx.objectStore('parsed').add({owner:expected,id:row.id,value:parsed,hash:parsedHash});}tx.objectStore('drafts').add(saved);for(const revision of revisions)tx.objectStore('revisions').add(revision);done(true);});
    // Only add() is used: quota/collision aborts all new records and never touches an existing draft.
    return readDraft(expected,newId);
   }
  });
 }
 const api=Object.freeze({create,sha256});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ReportImportStore=api;
})(typeof window!=='undefined'?window:globalThis);
