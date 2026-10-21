/* Immutable server backup transport. Network failures never trigger writes again. */
(function(root){'use strict';
 const CHUNK=512*1024,MAX=128*1024*1024;
 const fail=(code,message)=>Object.assign(new Error(message),{code});
 const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 function create({getOwner=()=>String(root.getUser?.()||''),headersFor=()=>root.authHeaders?.()||{},fetchImpl=(...a)=>root.fetch(...a),timeoutMs=60000}={}){
  const hash=b=>root.ReportImportStore.sha256(b);
  async function call(owner,path,body){
   if(!owner||getOwner()!==owner)throw fail('AUTH_CHANGED','登录账号已变化，本次云备份操作已停止');
   const controller=new AbortController();let timer;
   const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('CLOUD_NETWORK','云备份等待超时；本机稿仍保留，未自动重传。请先刷新云备份列表核对。'));},timeoutMs);});
   try{const response=await Promise.race([fetchImpl('/api/reportimportarchive'+path,{method:body?'POST':'GET',headers:{...headersFor(),...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal}),expired]);
    if(getOwner()!==owner)throw fail('AUTH_CHANGED','登录账号已变化，未采用云端返回');
    const raw=await Promise.race([response.text(),expired]);if(getOwner()!==owner)throw fail('AUTH_CHANGED','登录账号已变化，未采用云端返回');if(raw.length>900000)throw fail('CLOUD_PROTOCOL','云备份响应超出范围');let data;try{data=JSON.parse(raw);}catch{throw fail('CLOUD_PROTOCOL','云备份服务未返回有效结果');}
    if(!data||typeof data!=='object')throw fail('CLOUD_PROTOCOL','云备份服务未返回有效结果');
    if(!response.ok||!data.ok)throw fail('CLOUD_HTTP',data.error||'云备份尚未完成');return data;
   }catch(e){if(e.code)throw e;throw fail('CLOUD_NETWORK','云备份连接或等待失败；本机稿仍保留，未自动重传。请先刷新云备份列表核对。');}finally{clearTimeout(timer);}
  }
  async function downloadFor(owner,id){if(!validHash(id))throw fail('CLOUD_INTEGRITY','云备份编号无效');const manifest=await call(owner,'?id='+encodeURIComponent(id));if(manifest.id!==id||!Number.isSafeInteger(manifest.size)||manifest.size<1||manifest.size>MAX||!Array.isArray(manifest.chunks)||!manifest.chunks.length||manifest.chunks.length>256||!manifest.chunks.every(validHash)||manifest.chunks.length!==Math.ceil(manifest.size/CHUNK))throw fail('CLOUD_INTEGRITY','云备份清单校验失败');const bytes=new Uint8Array(manifest.size);let offset=0;
   for(let i=0;i<manifest.chunks.length;i++){const part=await call(owner,'?id='+encodeURIComponent(id)+'&chunk='+i);if(typeof part.data!=='string'||!part.data.length||part.data.length>Math.ceil(CHUNK/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(part.data))throw fail('CLOUD_INTEGRITY','云备份资料块无效');let block;try{block=Uint8Array.from(atob(part.data),c=>c.charCodeAt(0));}catch{throw fail('CLOUD_INTEGRITY','云备份资料块无效');}if(!block.length||block.length>CHUNK||i<manifest.chunks.length-1&&block.length!==CHUNK||block.length!==part.size||offset+block.length>bytes.length||hash(block)!==manifest.chunks[i]||part.hash!==manifest.chunks[i])throw fail('CLOUD_INTEGRITY','云备份资料块校验失败');bytes.set(block,offset);offset+=block.length;}
   if(getOwner()!==owner)throw fail('AUTH_CHANGED','登录账号已变化，未采用云端返回');if(offset!==bytes.length||hash(bytes)!==id)throw fail('CLOUD_INTEGRITY','完整云备份校验失败，未恢复');return {blob:new Blob([bytes],{type:'application/octet-stream'}),manifest};
  }
  async function download(id){return downloadFor(getOwner(),id);}
  async function save(blob,meta){if(!(blob instanceof Blob)||!blob.size||blob.size>MAX)throw fail('CLOUD_LIMIT','云备份包最大128MiB；请先保留完整本地备份');if(!meta||typeof meta.title!=='string'||!meta.title.trim()||meta.title.length>200||typeof meta.draftId!=='string'||!/^import_[a-f0-9]{32}$/.test(meta.draftId)||!Number.isSafeInteger(meta.revision)||meta.revision<1)throw fail('CLOUD_INVALID','缺少有效工作稿或版本说明，未上传云备份');const owner=getOwner(),bytes=new Uint8Array(await blob.arrayBuffer()),id=hash(bytes),chunks=[];
   for(let start=0;start<bytes.length;start+=CHUNK){const block=bytes.subarray(start,start+CHUNK),digest=hash(block);chunks.push(digest);let binary='';for(let p=0;p<block.length;p+=8192)binary+=String.fromCharCode(...block.subarray(p,p+8192));const result=await call(owner,'',{action:'chunk',hash:digest,data:btoa(binary)});if(result.hash!==digest||result.size!==block.length)throw fail('CLOUD_INTEGRITY','云备份写入回执不一致');}
   const saved=await call(owner,'',{action:'publish',id,title:meta.title,draftId:meta.draftId,revision:meta.revision,size:bytes.length,chunks});
   // Confirm the exact published bytes, not just HTTP 200.
   if(saved.id!==id||saved.revision!==meta.revision||saved.size!==bytes.length)throw fail('CLOUD_INTEGRITY','云备份发布回执不一致');await downloadFor(owner,id);if(getOwner()!==owner)throw fail('AUTH_CHANGED','登录账号已变化');return saved;
  }
  return Object.freeze({save,list:async()=>{const owner=getOwner(),result=await call(owner,'');if(!Array.isArray(result.items))throw fail('CLOUD_PROTOCOL','云备份列表响应无效');return result.items;},download});
 }
 const api=Object.freeze({create});if(typeof module==='object'&&module.exports)module.exports=api;else root.ReportImportCloud=api;
})(typeof window==='undefined'?globalThis:window);
