/* Complete, bounded portable snapshots. A checksum detects damage, not authorship. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ReportImportBackup=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const FORMAT='studyreport-import-backup',VERSION=1,LIMITS=Object.freeze({packageBytes:128*1024*1024,originalBytes:100*1024*1024,fileBytes:50*1024*1024,files:21,revisions:10000,requests:10000,depth:80});
 const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
 const copy=value=>structuredClone(value),encoder=new TextEncoder();
 const store=()=>root.ReportImportStore||(typeof require==='function'?require('./report-import-store.js'):null);
 const hash=bytes=>store().sha256(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes));
 const jsonHash=value=>hash(encoder.encode(JSON.stringify(value)));
 function boundedObject(value){const stack=[[value,0]];while(stack.length){const [item,depth]=stack.pop();if(depth>LIMITS.depth)fail('BACKUP_LIMIT','备份层级过深，未恢复');if(item&&typeof item==='object')for(const name of Object.keys(item)){if(['__proto__','prototype','constructor'].includes(name))fail('BACKUP_INVALID','备份含无效属性，未恢复');stack.push([item[name],depth+1]);}}}
 function base64(bytes){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return root.btoa?root.btoa(value):Buffer.from(bytes).toString('base64');}
 function decode(value,size){if(typeof value!=='string'||value.length!==4*Math.ceil(size/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('BACKUP_INTEGRITY','备份原件编码损坏，未恢复');const bytes=root.atob?Uint8Array.from(root.atob(value),c=>c.charCodeAt(0)):new Uint8Array(Buffer.from(value,'base64'));if(bytes.length!==size)fail('BACKUP_INTEGRITY','备份原件长度不一致');return bytes;}
 function receiptMetadata(request,owner){
  if(!Object.hasOwn(request,'receiptContext'))return;
  const receipt=request.receiptContext,context=request.context;
  if(receipt?.owner!==owner||receipt?.baseline?.owner!==owner||context?.owner!==owner)fail('BACKUP_OWNER','备份回查记录不属于当前账号，未恢复');
  if(request.durable!==true||typeof receipt.draftId!=='string'||!receipt.draftId||typeof receipt.fileId!=='string'||!receipt.fileId||receipt.baseline.draftId!==receipt.draftId||receipt.baseline.fileId!==receipt.fileId||receipt.baseline.sourceHash!==receipt.sourceHash||receipt.sourceHash!==context.sourceHash)fail('BACKUP_INTEGRITY','备份原请求回查身份不完整，未恢复');
  for(const field of ['mode','scope','blockId','blockIds','scopeBlockIds','instruction','blocks','skippedBlocks','allowedNumbers','baseDraftRevision','reviewContextVersion'])if(JSON.stringify(receipt[field])!==JSON.stringify(context[field]))fail('BACKUP_INTEGRITY','备份原请求范围与审阅上下文不一致，未恢复');
 }
 function metadata(snapshot,owner){
  if(!snapshot||snapshot.schemaVersion!==VERSION)fail('BACKUP_SCHEMA','备份版本不受支持，未恢复');
  if(typeof snapshot.owner!=='string'||!snapshot.owner||snapshot.owner!==owner)fail('BACKUP_OWNER','此备份不属于当前登录账号，未恢复');
  const draft=snapshot.draft;if(!draft||draft.schemaVersion!==1||draft.owner!==owner||!draft.id||!Number.isSafeInteger(draft.revision)||draft.revision<1||!Array.isArray(draft.files)||!draft.files.length||draft.files.length>LIMITS.files||draft.files.filter(f=>f.role==='main').length!==1)fail('BACKUP_SCHEMA','备份工作稿格式不受支持');
  if(!Array.isArray(snapshot.originals)||snapshot.originals.length!==draft.files.length||!Array.isArray(snapshot.revisions)||!snapshot.revisions.length||snapshot.revisions.length>LIMITS.revisions)fail('BACKUP_SCHEMA','备份原件或历史不完整');
  const ids=new Set();for(const file of draft.files){if(typeof file.id!=='string'||!file.id||ids.has(file.id)||!['main','special','reference','calculation'].includes(file.role)||typeof file.name!=='string'||!file.name||!Number.isSafeInteger(file.size)||file.size<1||file.size>LIMITS.fileBytes||!/^[a-f0-9]{64}$/.test(file.hash))fail('BACKUP_SCHEMA','备份原件索引无效');ids.add(file.id);}
  if(draft.files.reduce((n,f)=>n+f.size,0)>LIMITS.originalBytes)fail('BACKUP_LIMIT','备份原件总量超过 100 MiB');
  const revisionIds=new Set();for(const revision of snapshot.revisions){if(revision.owner!==owner||revision.id!==draft.id||revision.schemaVersion!==1||!Number.isSafeInteger(revision.revision)||revision.revision<1||revision.revision>draft.revision||revisionIds.has(revision.revision)||!Array.isArray(revision.files)||revision.files.length!==draft.files.length)fail('BACKUP_SCHEMA','备份历史版本无效');revisionIds.add(revision.revision);if(revision.reviewState&&(revision.reviewState.schemaVersion!==1||!Array.isArray(revision.reviewState.requests)||revision.reviewState.requests.length>LIMITS.requests))fail('BACKUP_SCHEMA','备份候选历史不受支持');for(const request of revision.reviewState?.requests||[])receiptMetadata(request,owner);}
  if(revisionIds.size!==draft.revision||!revisionIds.has(draft.revision))fail('BACKUP_INTEGRITY','备份缺少保存历史，未恢复半份工作稿');
  const withoutParsed=value=>{const result=copy(value);result.files=result.files.map(({parsed,...ref})=>ref);return result;};
  const fileIndex=JSON.stringify(withoutParsed(draft).files);for(const revision of snapshot.revisions)if(JSON.stringify(revision.files)!==fileIndex)fail('BACKUP_INTEGRITY','备份历史中的原件索引不一致，未恢复');
  if(JSON.stringify(withoutParsed(draft))!==JSON.stringify(snapshot.revisions.find(r=>r.revision===draft.revision)))fail('BACKUP_INTEGRITY','备份最新工作稿与历史版本不一致');
  boundedObject(draft);boundedObject(snapshot.revisions);
 }
 async function validate(snapshot,{owner,verifyParsed=true}={}){
  metadata(snapshot,owner);const seen=new Set();
  for(const file of snapshot.draft.files){const original=snapshot.originals.find(o=>o.id===file.id);if(!original||seen.has(original.id)||!(original.blob instanceof Blob)||original.blob.size!==file.size||original.hash!==file.hash)fail('BACKUP_INTEGRITY','备份原件缺失或长度不一致');seen.add(original.id);if(hash(new Uint8Array(await original.blob.arrayBuffer()))!==file.hash)fail('BACKUP_INTEGRITY','备份原件校验失败，未恢复');
   if(verifyParsed){if(/\.docx$/i.test(file.name)){const core=root.ReportImportCore||(typeof require==='function'?require('./report-import-core.js'):null);if(!core?.parseDocx)fail('DEPENDENCY_MISSING','Word 读取组件尚未加载');const parsed=await core.parseDocx(original.blob,{fileName:file.name});if(JSON.stringify(parsed)!==JSON.stringify(file.parsed))fail('BACKUP_INTEGRITY','备份解析结果与原件不一致，未导入不可信预览');}else if(file.parsed!==null)fail('BACKUP_INTEGRITY','非 Word 原件不应含解析预览');}
  }
  const engine=root.ReportImportReview||(typeof require==='function'?require('./report-import-review.js'):null);if(!engine?.project)fail('DEPENDENCY_MISSING','候选审阅模块尚未加载');engine.project(snapshot.draft);return snapshot;
 }
 async function create(snapshot){
  await validate(snapshot,{owner:snapshot?.owner});const {originals,...data}=snapshot;const payload={...copy(data),originals:[]};
  for(const original of originals){const file=snapshot.draft.files.find(f=>f.id===original.id);payload.originals.push({id:file.id,size:file.size,hash:file.hash,type:file.type||'',data:base64(new Uint8Array(await original.blob.arrayBuffer()))});}
  const manifest={format:FORMAT,schemaVersion:VERSION,payloadHash:jsonHash(payload),fileCount:payload.originals.length,draftRevision:payload.draft.revision};const blob=new Blob([JSON.stringify({...manifest,payload})],{type:'application/vnd.studyreport.backup+json'});if(blob.size>LIMITS.packageBytes)fail('BACKUP_LIMIT','完整备份超过 128 MiB，未截断或删除任何资料');
  return {blob,fileName:snapshot.draft.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,120)+'-完整备份.rbackup',manifest};
 }
 async function read(blob,{owner}={}){
  if(!(blob instanceof Blob)||!blob.size||blob.size>LIMITS.packageBytes)fail('BACKUP_LIMIT','请选择不超过 128 MiB 的完整 .rbackup 文件');let envelope;try{envelope=JSON.parse(await blob.text());}catch(_){fail('BACKUP_INVALID','备份不是有效的 JSON 文件，未恢复');}
  boundedObject(envelope);if(envelope.format!==FORMAT||envelope.schemaVersion!==VERSION)fail('BACKUP_SCHEMA','备份版本不受支持，未恢复');if(!envelope.payload||jsonHash(envelope.payload)!==envelope.payloadHash)fail('BACKUP_INTEGRITY','完整备份校验失败，未恢复');
  const snapshot=envelope.payload;metadata(snapshot,owner);snapshot.originals=snapshot.originals.map(original=>({...original,blob:new Blob([decode(original.data,original.size)],{type:original.type||'application/octet-stream'})}));snapshot.originals.forEach(o=>delete o.data);return validate(snapshot,{owner});
 }
 return Object.freeze({FORMAT,VERSION,LIMITS,create,read,validate});
});
