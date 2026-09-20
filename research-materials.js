(function(root){
 'use strict';
 async function store(file){
  const ui=root.ResearchUI;if(!ui?.active()||!ui.editable())throw new Error('当前研究轮次不可上传原件');
  const token=ui.capture('file');
  if(!file||file.size>50*1024*1024)throw new Error('单个原件不能超过50MB');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('原件读取失败'));reader.readAsDataURL(file);});
  await ui.guard(token);
  const response=await fetch('/api/researchmaterials',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({...token,name:file.name,mimeType:file.type,dataBase64:data}),signal:AbortSignal.timeout(120000)});
  const result=await response.json();await ui.guard(token);
  if(!response.ok||!result.ok||!result.stored)throw new Error(result.error||'原件未保存，请重试');
  return result;
 }
 async function load(ref){
  const ui=root.ResearchUI;if(!ui?.active()||!ui.editable())throw new Error('请选择可编辑研究轮次后解析原件');
  const token=ui.capture('file');
  if(ref?.researchId!==token.researchId)throw new Error('资料不属于当前研究');
  const query=new URLSearchParams({researchId:ref.researchId,runId:ref.runId,fileId:ref.fileId,actorId:String(ref.actorId)});
  const response=await fetch('/api/researchmaterials?'+query,{headers:authHeaders(),signal:AbortSignal.timeout(120000)});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'原件读取失败');}
  const blob=await response.blob();await ui.guard(token);
  return new File([blob],ref.name||'原件.bin',{type:blob.type});
 }
 async function download(ref){
  const ui=root.ResearchUI;if(!ui?.active())throw new Error('请先打开研究');
  const token=ui.capture('export');
  if(ref?.researchId!==token.researchId)throw new Error('资料不属于当前研究');
  const query=new URLSearchParams({researchId:ref.researchId,runId:ref.runId,fileId:ref.fileId,actorId:String(ref.actorId)});
  // Reading an archived original is not an edit. The API checks current access
  // and its immutable receipt; abandoned studies remain readable to their owner.
  const response=await fetch('/api/researchmaterials?'+query,{headers:authHeaders(),signal:AbortSignal.timeout(120000)});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'原件下载失败');}
  const blob=await response.blob();if(!ui.accepts(token))throw new Error('研究轮次已变化，未下载旧任务文件');
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  try{a.href=url;a.download=ref.name||'原件.bin';document.body.appendChild(a);a.click();}finally{a.remove();URL.revokeObjectURL(url);}
 }
 root.ResearchMaterials=Object.freeze({store,load,download});
})(globalThis);
