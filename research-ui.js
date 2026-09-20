/* Research owns its draft. Every round opens in a new document realm. */
(function(root){
 'use strict';
 const query=new URLSearchParams(location.search),enabled=query.has('research'),clone=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));
 let session=null,loaded=false,busy=false,lastError='',saveTimer=null,recoveredState=null,conflictCache=null,legacyRecord=null;
 let saveInFlight=null,saveRequested=false,editSequence=0,firstPendingAt=0;
 async function durableCache(state,identity){
  if(typeof indexedDB==='undefined'){cache(state);return null;}
  try{const store=await import('./research-local-state.mjs');return await store.saveLocal(identity,state);}
  catch(e){error(new Error('本机备份暂不可用，仍会尝试服务器保存；成功前请勿关闭页面'));return null;}
 }
 async function readRecoveryCache(){
  const legacy=cached();if(typeof indexedDB==='undefined')return legacy;
  try{
   const store=await import('./research-local-state.mjs'),identity=session.identity();
   const rows=await store.listDrafts(identity),latest=rows.find(r=>!r.acknowledged);
   if(!latest)return legacy;
   const row=await store.loadLocal(identity,latest.id);
   return row?{userId:identity.userId,researchId:identity.run.researchId,runId:identity.run.runId,epoch:identity.run.epoch,baseVersion:row.baseVersion,state:row.state,durableId:row.id}:legacy;
  }catch(e){error(new Error('本机草稿读取失败，保留原副本；当前显示服务器内容'));return legacy;}
 }
 root.addEventListener?.('beforeunload',event=>{if(enabled&&(saveRequested||saveInFlight)){event.preventDefault();event.returnValue='';}});
 root.addEventListener?.('storage',event=>{if(enabled&&['fs_token','fs_user',null].includes(event.key)){loaded=false;session?.invalidate();clearTimeout(saveTimer);currentProjectRole='UNAVAILABLE';error(new Error('登录身份已变化，请刷新后重新打开研究；未将旧内容写入新账号。'));renderSheet();}});
 async function request(input){const body={...input};delete body.method;const method=input.method||'GET',url='/api/research'+(method==='GET'?'?'+new URLSearchParams(Object.entries(body).filter(([,v])=>v!=null)):'');const r=await fetch(url,{method,headers:{'Content-Type':'application/json',...authHeaders()},signal:AbortSignal.timeout(30000),...(method==='POST'?{body:JSON.stringify(body)}:{})});return r.json();}
 const current=()=>session?.current();
 const editable=()=>{if(!loaded||busy)return false;const c=session?.identity();return c?.study.status==='active'&&c?.run.status==='active'&&c?.study.role!=='viewer';};
 function error(e){lastError=/AbortError|TimeoutError/.test(e.name||'')||/aborted a request/i.test(e.message||'')?'研究保存或读取超时，请重试保存；成功前不要刷新，当前正文仍保留在页面。':e.message||String(e);setSaveState('offline');const el=document.getElementById('researchStatus');if(el)el.textContent=lastError;}
 function capture(chain){if(!loaded||busy)throw new Error('研究尚未就绪');return session.capture(chain);}
 function accepts(token){return loaded&&!busy&&session?.accepts(token)&&(token.chain==='export'||editable());}
 async function guard(token){try{if(!accepts(token))throw new Error('研究轮次已变化，旧任务结果未采用');await session.refreshAuthority(token);return true;}catch(e){e.researchStale=true;throw e;}}
 function snapshot(){const old=recoveredState||session?.stateMetadata()||{},refs=[...(old.materialRefs||[]),...kbEntries.map(x=>x.materialRef).filter(Boolean)];return clone({...old,materialRefs:[...new Map(refs.map(x=>[[x.researchId,x.runId,x.actorId,x.fileId||x.storageKey].join(':'),x])).values()],draft:buildDraftData(),aiReport:airSerializableState()});}
 function cache(state){const c=session?.identity();if(!c)return;preserveConflict();if(conflictCache)return;try{localStorage.setItem(session.localKey(),JSON.stringify({userId:c.userId,researchId:c.run.researchId,runId:c.run.runId,epoch:c.run.epoch,baseVersion:c.run.version,state}));}catch(e){error(new Error('本机备份不可用，正在尝试服务器保存；成功前请勿刷新'));}}
 function cached(){try{return JSON.parse(localStorage.getItem(session.localKey())||'null');}catch(_){return null;}}
 function sameState(a,b){const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
 function preserveConflict(){if(!conflictCache)return;const raw=JSON.stringify(conflictCache),prefix=session.localKey()+'_conflict_',key=prefix+String(conflictCache.epoch)+'_'+String(conflictCache.baseVersion);try{let target=key;const existing=localStorage.getItem(target);if(existing&&existing!==raw)target=prefix+crypto.randomUUID();localStorage.setItem(target,raw);if(localStorage.getItem(target)!==raw)throw new Error('备份回读不一致');if(localStorage.getItem(session.localKey())===raw)localStorage.removeItem(session.localKey());conflictCache=null;}catch(e){if(localStorage.getItem(session.localKey())===raw)return;throw new Error('冲突草稿无法确认完整保留，未覆盖内容；请核对保存冲突。');}}
 function clearCache(state){try{const stored=cached();if(stored&&JSON.stringify(stored.state)===JSON.stringify(state))localStorage.removeItem(session.localKey());}catch(_){}}
 function save(){
  if(!editable())return Promise.resolve(false);
  clearTimeout(saveTimer);firstPendingAt=0;saveRequested=true;
  if(saveInFlight)return saveInFlight;
  saveInFlight=Promise.resolve().then(async()=>{
   while(saveRequested&&editable()){
    saveRequested=false;
    const sequence=editSequence,state=snapshot(),savedRevision=reportDocumentRevision,identity=session.identity();
    try{
     const localId=await durableCache(state,identity);setSaveState('saving');await session.save(state);
     const now=session.identity();
     if(!loaded||!now||now.userId!==identity.userId||now.run.runId!==identity.run.runId||now.run.epoch!==identity.run.epoch)return false;
     if(localId)try{const store=await import('./research-local-state.mjs');await store.acknowledgeLocal(identity,localId,now.run.version);}catch(_){/* Keep the unacknowledged recovery copy; remote save already succeeded. */}
     recoveredState=null;clearCache(state);reportCloudPersistedRevision=savedRevision;
     if(sequence===editSequence&&!saveRequested){setSaveState('ok');lastError='';}
     else{saveRequested=true;setSaveState('saving');}
    }catch(e){saveRequested=true;error(e);return false;}
   }
   return !saveRequested;
  }).finally(()=>{saveInFlight=null;});
  return saveInFlight;
 }
 async function flush(){clearTimeout(saveTimer);if(!enabled){if(typeof reportHasUnsavedChanges==='function'&&reportHasUnsavedChanges()){const result=await persistReportDraft();if(!result.ok)throw new Error('原工作稿保存失败，未离开页面');}return true;}if(editable()&&!await save())throw new Error(lastError||'研究保存失败，未离开当前页面');await session?.flush();return true;}
 function schedule(){if(!editable())return;editSequence++;saveRequested=true;setSaveState('saving');if(saveInFlight)return;const now=Date.now();if(!firstPendingAt)firstPendingAt=now;clearTimeout(saveTimer);saveTimer=setTimeout(save,Math.max(0,Math.min(1000,5000-(now-firstPendingAt))));}
 function url(researchId,runId){const u=new URL(location.href);u.search='';u.searchParams.set('research',researchId);if(runId)u.searchParams.set('run',runId);u.hash='aireport';return u.href;}
 async function navigate(researchId,runId){await flush();busy=true;loaded=false;session?.invalidate();const destination=url(researchId,runId);if(destination===location.href)location.reload();else location.assign(destination);}
 function modal(title){document.getElementById('researchDialog')?.remove();const d=document.createElement('dialog');d.id='researchDialog';d.className='research-dialog';d.style.cssText='width:min(840px,90vw);max-height:85vh;border:1px solid #b8cfe4;border-radius:12px;padding:24px';const h=document.createElement('h2');h.textContent=title;d.append(h);const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>d.close();d.append(close);document.body.append(d);d.showModal();return d;}
 function button(parent,text,fn){const b=document.createElement('button');b.className=text==='新建可研'?'btn':'btn ghost'+(/废止/.test(text)?' research-danger':'');b.style.margin='8px';b.textContent=text;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){error(e);alert(e.message);}finally{b.disabled=false;}};parent.append(b);return b;}
 async function list(){return openProjectsPanel();}
 async function listRecords(status='active',offset=0){const result=await request({action:'list',status,offset});if(!result.ok)throw new Error(result.error||'可研列表读取失败，请重试');return result;}
 async function create(){const d=modal('新增可研'),input=document.createElement('input');let envelope=null;input.placeholder='可研名称';input.maxLength=200;d.append(input);button(d,'创建并编辑',async()=>{const title=input.value.trim();if(!title)throw new Error('请填写可研名称');await flush();envelope=envelope||{method:'POST',action:'create',title,requestId:crypto.randomUUID()};input.disabled=true;const r=await request(envelope);if(!r.ok){input.disabled=false;envelope=null;throw new Error(r.error);}busy=true;loaded=false;session?.invalidate();location.assign(url(r.researchId,r.runId));});}
 async function rounds(){const d=modal('历史轮次（只读）'),r=await request({action:'rounds',researchId:current().study.researchId});if(!r.ok)throw new Error(r.error);for(const row of r.runs||r.items||[]){button(d,'第 '+row.ordinal+' 轮 · '+row.status,()=>navigate(current().study.researchId,row.runId||row.id));}}
 async function transition(action){const selected=current();if(!selected)throw new Error('尚未打开研究');const d=modal(action==='restart'?'重新开始：原轮次完整保留':action==='abandon'?'废止研究（保留全部历史）':'恢复研究');const mode=document.createElement('select');if(action==='restart'){for(const [value,text]of [['verified','保留有效资料引用，重新研究'],['blank','空白开始（不删除原件）']]){const o=document.createElement('option');o.value=value;o.textContent=text;mode.append(o);}d.append(mode);}let password=null;if(action!=='restart'||selected.study.visibility==='shared'){password=document.createElement('input');password.type='password';password.autocomplete='current-password';password.placeholder=selected.study.visibility==='shared'?'管理员密码':'本人密码';d.append(password);}button(d,'确认'+(action==='restart'?'重新开始':action==='abandon'?'废止':'恢复'),async()=>{await flush();busy=true;try{const r=await session.transition(action,{...(action==='restart'?{mode:mode.value}:{}),...(password?{password:password.value}:{})});if(password)password.value='';loaded=false;const destination=url(r.researchId||selected.study.researchId,r.runId||undefined);if(destination===location.href)location.reload();else location.assign(destination);}finally{busy=false;}});}
 async function materials(){const d=modal('本轮资料引用'),refs=current()?.run.state.materialRefs||[];const p=document.createElement('p');p.textContent=refs.length?'原件保持不变。重新解析会生成本轮待确认信息，不沿用旧推测、正文或测算结果。':'本轮暂无原件引用，可在AI可研中上传资料。';d.append(p);for(const ref of refs){const row=document.createElement('div');row.textContent=ref.name||ref.fileName||ref.fileId;button(row,'下载原件',()=>ResearchMaterials.download(ref));if(editable())button(row,'重新解析此资料',async()=>{const file=await ResearchMaterials.load(ref);d.close();await airPrepareInitialProjectFiles([file]);});d.append(row);}}
 function toolbar(){
  const sheet=document.getElementById('sheet'),anchor=document.getElementById('airRestartBtn')?.parentElement||sheet;
  if(!anchor)return;
  document.getElementById('researchToolbar')?.remove();
  const bar=document.createElement('div');bar.id='researchToolbar';bar.className='research-actions';button(bar,'新建可研',create);
  // A toolbar needs identity, not a deep copy of every report and attachment.
  const c=session?.identity();
  if(enabled&&c){
   const label=document.createElement('span');label.className='research-current';label.textContent=c.study.title+' · 第 '+c.run.ordinal+' 轮 · '+(editable()?'编辑中':'只读');bar.append(label);
   if(editable())button(bar,'保存',save);
   if(typeof recoverConflict==='function'&&editable())button(bar,'核对保存冲突',recoverConflict);
   button(bar,'历史轮次',rounds);button(bar,'资料引用',materials);
   if(c.study.role!=='viewer'){if(c.study.status==='abandoned')button(bar,'恢复可研',()=>transition('restore'));else button(bar,'废止可研',()=>transition('abandon'));}
  }else if(!enabled&&typeof currentProjectId!=='undefined'&&currentProjectId&&legacyRecord&&legacyRecord.id===currentProjectId&&legacyRecord.role==='OWNER'){
   button(bar,legacyAbandoned()?'恢复可研':'废止可研',()=>legacyTransition(legacyAbandoned()?'restore':'abandon'));
  }
  const status=document.createElement('span');status.id='researchStatus';status.className='research-status';status.textContent=lastError;bar.append(status);
  if(anchor===sheet)anchor.prepend(bar);else anchor.append(bar);
 }
 function recoverConflict(){
  const options={session,snapshot,request,onApplied:state=>{recoveredState=null;clearCache(state);lastError='冲突已处理，两份备份保留';if(state.draft)restoreDraft(state.draft,{deferRender:true});reportCloudPersistedRevision=reportDocumentRevision;setSaveState('ok');renderTOC();renderSheet();toolbar();}};
  const failed=e=>{
   error(e);let d=document.getElementById('researchRecovery');
   if(!d){d=modal('核对保存冲突');d.id='researchRecovery';}
   let note=d.querySelector?.('[data-recovery-error]');
   if(!note){note=document.createElement('p');note.dataset.recoveryError='1';d.append(note);}
   note.textContent=(e?.message||'冲突副本读取失败')+'；原副本未删除，可关闭窗口后继续使用当前页面。';
  };
  try{Promise.resolve(ResearchRecovery.open(options)).catch(failed);}catch(e){failed(e);}
 }
 function setLegacyRecord(record){legacyRecord=record?clone(record):null;}
 function legacyAbandoned(){return !enabled&&!!legacyRecord&&legacyRecord.id===currentProjectId&&!!legacyRecord.data?.workflow?.management?.legacyResearchAbandoned;}
 async function legacyTransition(action){if(!['abandon','restore'].includes(action))throw new Error('不支持的可研操作');const id=currentProjectId;if(!id||!legacyRecord||legacyRecord.id!==id)throw new Error('请先打开目标可研');const d=modal(action==='abandon'?'废止本份可研':'恢复本份可研'),p=document.createElement('p');p.textContent='仅改变这份历史可研的状态；正式项目继续管理，正文、资料与历史版本完整保留。';d.append(p);const password=document.createElement('input');password.type='password';password.autocomplete='current-password';password.placeholder='本人登录密码';d.append(password);button(d,action==='abandon'?'确认废止可研':'确认恢复可研',async()=>{if(currentProjectId!==id)throw new Error('当前项目已切换，请重新选择');if(action==='abandon'){await flush();if(typeof airSaveState==='function'&&!await airSaveState())throw new Error('可研保存失败，尚未废止');}const r=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},signal:AbortSignal.timeout(30000),body:JSON.stringify({action:'setResearchAbandoned',id,abandoned:action==='abandon',password:password.value,expectedUpdatedAt:currentProjectUpdatedAt})}),data=await r.json();password.value='';if(!r.ok||!data.ok)throw new Error(data.error||'可研状态更新失败，请重试');location.reload();});}
 async function actionForRecord(id,action,kind='research'){if(!['restart','abandon','restore'].includes(action))throw new Error('不支持的可研操作');if(kind==='legacy'){if(enabled){await flush();rememberActiveProjectId(id);const u=new URL(location.href);u.search='';u.searchParams.set('legacyResearchAction',action);u.hash='aireport';location.assign(u.href);return;}if(!await openAiReportProject(id))return false;return action==='restart'?importLegacy():legacyTransition(action);}await flush();const u=new URL(url(id));u.searchParams.set('researchAction',action);busy=true;loaded=false;session?.invalidate();location.assign(u.href);}
 function resumeAction(){const key=enabled?'researchAction':'legacyResearchAction',action=query.get(key);if(!['restart','abandon','restore'].includes(action))return;query.delete(key);const u=new URL(location.href);u.searchParams.delete(key);history.replaceState(null,'',u.href);Promise.resolve(enabled?transition(action):action==='restart'?importLegacy():legacyTransition(action)).catch(e=>{error(e);alert(e.message);});}
 function renderLegacyReadOnly(sheet){sheet.replaceChildren();const h=document.createElement('h2');h.textContent=(legacyRecord?.name||'本项目')+' · 可研已废止';const p=document.createElement('p');p.textContent='这份可研已停止编辑，正式项目仍继续管理。恢复后可以继续研究，历史正文和原件没有删除。';sheet.append(h,p);for(const chapter of legacyRecord?.data?.chapters||[]){const heading=document.createElement('h3');heading.textContent=chapter.name;sheet.append(heading);for(const section of chapter.sections||[]){const title=document.createElement('h4'),body=document.createElement('div');title.textContent=section.t;body.style.whiteSpace='pre-wrap';body.textContent=section.editedHtml?new DOMParser().parseFromString(section.editedHtml,'text/html').body.textContent:section.content||'尚无正文';sheet.append(title,body);}}toolbar();resumeAction();}
 async function bootstrap(){
  session=ResearchSession.create({request,onError:error});if(!enabled)return false;
  currentProjectId=null;currentProjectRole='PENDING';mountUserBar();
  try{
   await Promise.all([fetchOutlines(),fetchCalcConfig()]);const c=await session.open(query.get('research'),query.get('run')||undefined);loaded=true;
   const local=await readRecoveryCache();let state=c.run.state||{},recoveryNotice='';
   async function confirmed(){
    clearCache(local.state);
    if(local.durableId){const store=await import('./research-local-state.mjs');const identity=session.identity();await store.acknowledgeLocal({...identity,run:{...identity.run,version:local.baseVersion}},local.durableId,identity.run.version);}
   }
   if(local&&local.userId===c.userId&&local.researchId===c.run.researchId&&local.runId===c.run.runId&&sameState(local.state,state)){
    try{await confirmed();}catch(_){/* An unacknowledged copy remains recoverable. */}
   }else if(local){
    const matches=local.userId===c.userId&&local.researchId===c.run.researchId&&local.runId===c.run.runId&&local.epoch===c.run.epoch&&local.baseVersion===c.run.version;
    if(matches&&editable()){
     try{await session.save(local.state);state=current().run.state;try{await confirmed();}catch(_){}recoveryNotice='已恢复刷新前未完成同步的本机研究草稿。';}
     catch(e){state=local.state;recoveredState=local.state;recoveryNotice='已恢复本机草稿，但服务器保存仍失败；请点击保存重试，勿离开。';}
    }else{
     if(!local.durableId){conflictCache=local;try{preserveConflict();}catch(e){recoveryNotice=e.message;}}
     recoveryNotice=recoveryNotice||'发现冲突版本的本机副本，已独立保留；请点击“核对保存冲突”选择，不会自动覆盖服务器。';
    }
   }
   if(state.draft)restoreDraft(state.draft,{deferRender:true});else Object.assign(project,{name:current().study.title});
   currentProjectRole=editable()?'OWNER':'VIEWER';currentProjectReadOnlyData=state.draft||{};appMode='aireport';renderTOC();renderSheet();toolbar();
   if(recoveryNotice&&document.getElementById('researchStatus'))document.getElementById('researchStatus').textContent=recoveryNotice;
   return true;
  }catch(e){loaded=false;currentProjectRole='UNAVAILABLE';renderTOC();renderSheet();toolbar();error(e);return true;}
 }
 function historyText(state){const ai=state.aiReport||state.legacySnapshot||{},labels={projectName:'项目名称',location:'项目位置',owner:'实施主体',desc:'项目说明',calcType:'测算类型',landArea:'用地面积',startYear:'建设起始年'};const chat=(ai.chat||[]).filter(x=>x.kind!=='loading'&&!(ai.extracted&&x.kind!=='text'&&/正在.*(理解|提取|处理)/.test(x.content||''))).map(x=>x.content||'').filter(Boolean);for(const [title,data]of [['已提取项目信息（历史快照，仍需核验）',ai.extracted],['已保存参数建议（历史快照）',ai.suggested?.params||ai.suggested],['已保存测算参数',ai.calcParams],['已保存测算结果',ai.calcSummary]])if(data&&typeof data==='object')chat.push(title+'\n'+Object.entries(data).map(([key,value])=>(labels[key]||key)+'：'+(typeof value==='object'?JSON.stringify(value):String(value))).join('\n'));return chat.join('\n\n')||'这一轮尚未生成报告。';}
 function renderReadOnly(sheet){sheet.replaceChildren();const h=document.createElement('h2');h.textContent=current()?current().study.title+' · 第 '+current().run.ordinal+' 轮（只读）':'研究暂不可用';sheet.append(h);const p=document.createElement('p');p.textContent=current()?'历史轮次、查看者及已废弃研究不会覆盖任何活动内容。':'无法读取研究，请检查登录和网络后刷新；原资料不受影响。';sheet.append(p);button(sheet,'研究列表',()=>list());if(current()){button(sheet,'全部轮次',rounds);if(current().study.status==='active')button(sheet,'下载历史工作稿 Word',()=>exportWord());const draft=current().run.state?.draft;for(const c of draft?.chapters||[]){const ch=document.createElement('h3');ch.textContent=c.name;sheet.append(ch);for(const s of c.sections||[]){const sh=document.createElement('h4'),body=document.createElement('div');sh.textContent=s.t;body.style.whiteSpace='pre-wrap';body.textContent=s.editedHtml?new DOMParser().parseFromString(s.editedHtml,'text/html').body.textContent:s.content||'尚无正文';sheet.append(sh,body);}}if(!draft?.chapters?.length){const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=historyText(current().run.state);sheet.append(pre);}}toolbar();resumeAction();}
 async function leaveForProject(id,options={}){await flush();busy=true;loaded=false;session?.invalidate();rememberActiveProjectId(id);const u=new URL(location.href);u.search='';u.hash=options.hash==='#aireport'?'#aireport':'';location.assign(u.href);return false;}
 async function importLegacy(){if(!currentProjectId)throw new Error('请先保存当前研究，再导入历史副本；未清除任何内容。');if(!confirm('将当前报告复制为私人研究，保留原项目和全部正文；进入后可点击“重新开始”建立新轮次。是否继续？'))return;await flush();if(!await airSaveState())throw new Error('旧会话保存失败，未导入或离开当前页，请重试。');const r=await request({method:'POST',action:'importLegacy',legacyProjectId:currentProjectId,title:project.name||'旧研究副本',draft:clone(buildDraftData())});if(!r.ok)throw new Error(r.error||'导入失败，原内容保持不变');busy=true;loaded=false;session?.invalidate();location.assign(url(r.researchId,r.runId));}
 root.ResearchUI=Object.freeze({active:()=>enabled,current,editable,capture,accepts,guard,refreshAuthority:guard,save,flush,schedule,bootstrap,list,listRecords,openResearch:navigate,mountActions:toolbar,create,importLegacy,rounds,transition,renderReadOnly,leaveForProject,actionForRecord,setLegacyRecord,legacyAbandoned,legacyTransition,resumeAction,renderLegacyReadOnly,localKey:()=>session?.localKey(),state:()=>recoveredState||current()?.run.state||{},requestScope:capture});
})(window);
