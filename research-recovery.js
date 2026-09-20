/* Explicit conflict recovery. Backups never replace drafts implicitly. */
(function(root){
 'use strict';
 function differences(a,b,path='',out=[],limit=Infinity){
  if(Object.is(a,b)||out.length>=limit)return out;
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
   for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
    differences(a[key],b[key],path?path+'.'+key:key,out,limit);
    if(out.length>=limit)break;
   }
  }else out.push({path,local:a,server:b});
  return out;
 }
 async function open({session,snapshot,request,onApplied}){
  const identity=session.identity(),key=session.localKey();
  if(!identity)throw new Error('尚未打开研究');
  document.getElementById('researchRecovery')?.remove();
  const d=document.createElement('dialog');d.id='researchRecovery';d.style.cssText='width:min(1000px,92vw);max-height:85vh;padding:24px;border:1px solid #b8cfe4;border-radius:12px';
  const title=document.createElement('h2');title.textContent='核对保存冲突';d.append(title);
  const note=document.createElement('p');note.textContent='正在读取本机与服务器副本，请稍候；当前页面仍可安全关闭此窗口。';d.append(note);
  const close=document.createElement('button');close.className='btn ghost';close.style.margin='8px';close.textContent='关闭';close.onclick=()=>d.close();d.append(close);
  document.body.append(d);d.showModal();
  // Paint the recovery shell immediately. A large remote state or a damaged
  // IndexedDB draft must not keep the toolbar button disabled or hide Close.
  void (async()=>{try{
  const remote=await request({method:'GET',researchId:identity.run.researchId,runId:identity.run.runId});
  if(!remote.ok)throw new Error(remote.error||'无法读取服务器副本');
  if(remote.userId!==identity.userId||remote.run.epoch!==identity.run.epoch||remote.run.runId!==identity.run.runId||remote.run.researchId!==identity.run.researchId)throw new Error('研究身份或轮次已变化，未处理冲突');
  const options=[{name:'当前页面内容',state:snapshot()}];
  const recoveryWarnings=[];
  if(typeof indexedDB!=='undefined'){
   try{
    const store=await import('./research-local-state.mjs');
    for(const row of (await store.listDrafts(identity)).filter(r=>!r.acknowledged)){
     try{const item=await store.loadLocal(identity,row.id);if(item)options.push({name:'本机分块副本（服务器版本 '+item.baseVersion+'）',state:item.state});}
     catch(_){recoveryWarnings.push('有一份本机分块副本读取失败，原副本未删除');}
    }
   }catch(_){recoveryWarnings.push('本机分块草稿库暂不可读，原副本未删除');}
  }
  // The application reads only its own scoped draft backups, never auth data.
  for(let i=0;i<localStorage.length;i++){
   const k=localStorage.key(i);if(k!==key&&!k.startsWith(key+'_conflict_'))continue;
   try{const item=JSON.parse(localStorage.getItem(k));if(item.userId===identity.userId&&item.researchId===identity.run.researchId&&item.runId===identity.run.runId&&item.epoch===identity.run.epoch)options.push({name:'本机保留副本（服务器版本 '+item.baseVersion+'）',state:item.state});}catch(_){}
  }
  note.textContent='先比较两份内容。处理前会完整保留本机和服务器快照；不会删除原件。服务器再次更新时会停止处理，不强行覆盖。'+(recoveryWarnings.length?' '+[...new Set(recoveryWarnings)].join('；')+'。':'');
  const select=document.createElement('select');options.forEach((o,i)=>{const el=document.createElement('option');el.value=i;el.textContent=o.name;select.append(el);});d.append(select);
  const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;max-height:48vh;overflow:auto;font-size:13px';d.append(pre);
  const short=v=>v===undefined?'（不存在）':JSON.stringify(v).slice(0,300);
  function render(){pre.textContent='正在比较，请稍候…';setTimeout(()=>{const rows=differences(options[+select.value].state,remote.run.state,'',[],101),more=rows.length>100;pre.textContent='差异 '+(more?'至少 100':rows.length)+' 处；服务器版本 '+remote.run.version+'\n'+rows.slice(0,100).map(x=>x.path+'\n本机：'+short(x.local)+'\n服务器：'+short(x.server)).join('\n\n');},0);}
  select.onchange=render;render();
  async function backup(){const bundle={createdAt:new Date().toISOString(),identity,local:options[+select.value].state,server:remote.run.state,serverVersion:remote.run.version};const raw=JSON.stringify(bundle),backupKey=key+'_recovery_'+crypto.randomUUID();await new Promise((resolve,reject)=>{const req=indexedDB.open('research-conflict-backups',1);req.onupgradeneeded=()=>req.result.createObjectStore('snapshots');req.onerror=()=>reject(new Error('备份存储不可用，未覆盖内容'));req.onsuccess=()=>{const db=req.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(raw,backupKey);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=tx.onerror=()=>{db.close();reject(new Error('备份失败，未覆盖内容；请检查磁盘空间'));};};});return raw;}
  function button(label,fn){const b=document.createElement('button');b.className='btn ghost';b.style.margin='8px';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){note.textContent=e.message;}finally{b.disabled=false;}};d.append(b);}
  button('下载两份备份',async()=>{const raw=await backup(),url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='研究冲突双份备份-'+identity.run.researchId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);note.textContent='两份完整快照已保留在本机，并已发起下载。';});
  async function apply(useLocal){if(!confirm(useLocal?'使用选中的本机副本继续编辑？服务器当前副本将独立备份。':'使用服务器副本继续编辑？本机当前副本将独立备份。'))return;await backup();await session.recover(remote, useLocal?options[+select.value].state:remote.run.state);onApplied(session.current().run.state);d.close();}
  button('使用选中本机副本',()=>apply(true));button('使用服务器副本',()=>apply(false));
  }catch(e){note.textContent=(e&&e.message?e.message:'冲突副本读取失败')+'；原副本未删除，可关闭窗口后继续使用当前页面。';}})();
  return d;
 }
 const api={differences,open};if(typeof module==='object'&&module.exports)module.exports=api;else root.ResearchRecovery=api;
})(typeof globalThis!=='undefined'?globalThis:this);
