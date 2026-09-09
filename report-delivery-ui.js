(function(root){
  'use strict';
  const style=document.createElement('style');style.textContent=`
  #reportDeliveryDialog{box-sizing:border-box;font:14px/1.65 system-ui,"Microsoft YaHei",sans-serif;color:#263b50;background:#f5f8fc;box-shadow:0 24px 80px #173b6333}
  #reportDeliveryDialog::backdrop{background:#142e4b66}
  #reportDeliveryDialog h2{font-size:23px;color:#194b77;margin:0 0 8px}
  #reportDeliveryDialog p{margin:12px 0;color:#526b82}
  #reportDeliveryDialog fieldset,#reportDeliveryDialog>details{min-width:0;border:1px solid #dce6f0;border-radius:12px;background:white;padding:18px;margin:18px 0}
  #reportDeliveryDialog legend{font-size:16px;font-weight:650;color:#225c87;padding:0 8px}
  #reportDeliveryDialog label{display:block;font-size:13px;color:#526b82;margin:0 0 7px}
  #reportDeliveryDialog [role=status]{padding:10px 14px;border-radius:8px;background:#e9f2fb;color:#225c87}
  #reportDeliveryDialog summary{cursor:pointer;font-weight:600;color:#225c87;padding:6px 0}
  #reportDeliveryDialog input:not([type=checkbox]),#reportDeliveryDialog textarea,#reportDeliveryDialog select{box-sizing:border-box;width:100%;font:inherit;border:1px solid #cbd9e6;border-radius:8px;padding:10px 12px;margin:5px 0 10px;background:white;color:#263b50}
  #reportDeliveryDialog textarea{resize:vertical;min-height:110px}
  #reportDeliveryDialog input[type=checkbox]{accent-color:#2e6fa5;width:17px;height:17px;vertical-align:middle}
  #reportDeliveryDialog button,.air-modal-card button:not(.air-modal-close){font:inherit;border:1px solid #b9cfe2;border-radius:8px;padding:8px 14px;background:#f7fbff;color:#245c89;cursor:pointer;margin:4px 6px 4px 0}
  #reportDeliveryDialog button:hover,.air-modal-card button:not(.air-modal-close):hover{background:#e8f2fc;border-color:#6c9dc4}
  #reportDeliveryDialog button:disabled,.air-modal-card button:disabled{opacity:.5;cursor:not-allowed}
  #reportDeliveryDialog button.delivery-primary,.air-modal-card button.btn:not(.ghost){background:#2d6da3;color:white;border-color:#2d6da3}
  #reportDeliveryDialog :focus-visible,.air-modal-card :focus-visible{outline:3px solid #80b8e6;outline-offset:2px}
  #reportDeliveryDialog pre{font-size:12px;background:#f4f7fb;border-radius:8px;padding:12px}
  .air-modal-card{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#263b50}
  .air-modal-card [data-sources]>details{border:1px solid #dce6f0;border-radius:9px;padding:12px;margin:10px 0;background:#f8fbff}
  .air-modal-card [data-sources] summary{cursor:pointer;color:#245c89;font-weight:600}
  @media(max-width:600px){#reportDeliveryDialog{padding:16px!important;width:96vw!important}#reportDeliveryDialog fieldset{padding:12px}}
  `;document.head.appendChild(style);
  root.ReportDeliveryUI={open};
  let activeRequestScope=null;
  function element(tag,text,parent){const el=document.createElement(tag);if(text)el.textContent=text;if(parent)parent.append(el);return el;}
  async function open(){
    if(typeof currentProjectId==='undefined'||!currentProjectId)return alert('请先保存并打开一个项目');
    const pid=currentProjectId,actor=typeof getUser==='function'?getUser():null;activeRequestScope?.abort();const requestScope=new AbortController();activeRequestScope=requestScope;document.getElementById('reportDeliveryDialog')?.remove();
    const dialog=element('dialog');dialog.id='reportDeliveryDialog';dialog.style.cssText='width:min(900px,90vw);max-height:85vh;overflow:auto;border:1px solid #aac7dd;border-radius:12px;padding:24px;overscroll-behavior:contain';
    document.body.append(dialog);element('h2','项目验收与运行保障',dialog);element('p','使用后台已保存的正文冻结版本，不覆盖工作稿。自动检查通过不等于正式签发；请由另一位项目成员复核。',dialog);
    const close=element('button','关闭',dialog);close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{requestScope.abort();dialog.remove();});
    const isCurrent=()=>!requestScope.signal.aborted&&dialog.isConnected&&currentProjectId===pid&&(typeof getUser!=='function'||getUser()===actor);
    let busy=false,currentHash=null,currentUpdatedAt=null,needsProjectReload=false,versionRead=0,fileRead=0,currentRole=null,reviewControls=[];
    const reload=element('button','重新读取后台版本',dialog);reload.onclick=()=>action(reload,refresh);
    const status=element('p','正在读取…',dialog);status.setAttribute('role','status');
    const content=element('div','',dialog),controls=element('fieldset','',dialog);element('legend','冻结验收版本',controls);
    element('label','独立只读成员账号ID（不是自己，且未担任过本项目编辑）',controls);const reviewer=element('input','',controls);reviewer.type='number';reviewer.min='1';reviewer.setAttribute('aria-label','复核成员账号ID');
    element('p','检查合同：填写需核验的标题、数值、表格。示例可自行替换；不会自动把示例作为正式标准。',controls);
    const contract=element('textarea','',controls);contract.rows=5;contract.style.width='100%';contract.value='{"headings":[],"numbers":[],"tables":[],"noPending":true}';contract.setAttribute('aria-label','验收检查合同');
    const freeze=element('button','冻结后台已保存版本',controls);freeze.className='delivery-primary';controls.disabled=true;
    const files=element('fieldset','',dialog);element('legend','原件归档（服务器磁盘，单文件最多256MiB）',files);const upload=element('input','',files);upload.type='file';upload.setAttribute('aria-label','选择归档原件');const uploadButton=element('button','上传并校验原件',files);
    const admin=element('details','',dialog);element('summary','管理员：费用对账、账号撤销、运行状态',admin);const password=element('input','',admin);password.type='password';password.placeholder='管理员验证口令（仅本次使用）';password.setAttribute('aria-label','管理员验证口令');
    const metrics=element('button','查看运行状态',admin),notify=element('button','发送告警测试',admin),billing=element('button','查看待对账调用',admin),adminOutput=element('pre','',admin);adminOutput.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';
    const fileList=element('div','',files);uploadButton.disabled=true;
    const reloadFiles=element('button','重新读取归档原件',files);reloadFiles.onclick=()=>action(reloadFiles,refreshFiles);
    async function refreshFiles(){const ticket=++fileRead,result=await api('/api/projectartifacts?projectId='+encodeURIComponent(pid));if(ticket!==fileRead)return;fileList.replaceChildren();if(!result.items.length)element('p','尚无归档原件。',fileList);for(const file of result.items){const p=element('p',file.file_name+' · '+file.size_bytes+' 字节 · SHA-256 '+file.content_hash,fileList);p.style.overflowWrap='anywhere';const download=element('button','下载 '+file.file_name,p);download.onclick=()=>action(download,async()=>{const response=await fetch('/api/projectartifacts?projectId='+encodeURIComponent(pid)+'&id='+encodeURIComponent(file.id),{headers:authHeaders(),signal:AbortSignal.any([requestScope.signal,AbortSignal.timeout(180000)])});if(!response.ok)throw new Error('下载失败，请检查权限或服务器存储');const blob=await response.blob();if(!isCurrent())return;const url=URL.createObjectURL(blob),a=element('a','',dialog);a.href=url;a.download=file.file_name;a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);});}}
    const billingInput=element('textarea','',admin);billingInput.rows=4;billingInput.placeholder='{"id":"调用ID","prompt_tokens":0,"completion_tokens":0,"costMicros":0,"evidence":"供应商账单与请求ID依据"}';billingInput.setAttribute('aria-label','账单确认数据');const reconcile=element('button','按账单确认结算（不重新生成）',admin);
    const account=element('input','',admin);account.type='number';account.placeholder='账号ID';account.setAttribute('aria-label','管理账号ID');const note=element('input','',admin);note.placeholder='操作原因';note.setAttribute('aria-label','账号操作原因');
    const revoke=element('button','撤销该账号全部登录',admin);
    async function api(url,body,raw=false){if(!isCurrent())throw new DOMException('页面已关闭或项目已切换','AbortError');const headers={...(typeof authHeaders==='function'?authHeaders():{}),...(password.value?{'x-admin-pass':password.value}:{})};if(!raw)headers['content-type']='application/json';let r,data;try{r=await fetch(url,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:raw?body:JSON.stringify(body),signal:AbortSignal.any([requestScope.signal,AbortSignal.timeout(raw?180000:30000)])});data=await r.json();}catch(e){if(!isCurrent())throw e;throw new Error(body===undefined?'无法读取后台记录，请检查连接后重新读取。':'提交未获后台确认，请先重新读取后台记录核对结果，不要重复提交。');}if(!isCurrent())throw new DOMException('页面已关闭或项目已切换','AbortError');if(!r.ok||!data.ok)throw new Error(data.error||'操作未完成，请核对后重试');return data;}
    function syncPermissions(){controls.disabled=currentRole!=='OWNER'||needsProjectReload;uploadButton.disabled=!['OWNER','EDITOR'].includes(currentRole);reviewControls.forEach(ready=>ready());}
    async function action(button,fn){if(busy||button.matches(':disabled')||!isCurrent())return;busy=true;const disabled=[...dialog.querySelectorAll('button')].filter(b=>b!==close).map(b=>[b,b.disabled]);disabled.forEach(([b])=>b.disabled=true);status.textContent='正在等待后台确认…';try{const message=await fn();if(isCurrent())status.textContent=typeof message==='string'?message:message===false?'已取消，未修改后台记录':'操作已由后台确认';}catch(e){if(isCurrent())status.textContent=e.message||'请求失败，请重新读取后台记录';}finally{busy=false;if(isCurrent()){disabled.forEach(([b,value])=>{if(b.isConnected)b.disabled=value;});syncPermissions();}}}
    function hasUnconfirmedEdits(){return typeof reportHasUnsavedChanges==='function'&&reportHasUnsavedChanges()||typeof reportDocumentRevision==='number'&&reportDocumentRevision>0&&typeof reportCloudPersistedRevision==='number'&&reportCloudPersistedRevision<reportDocumentRevision;}
    async function refresh(){const ticket=++versionRead,{result}=await api('/api/reportdelivery?projectId='+encodeURIComponent(pid));if(ticket!==versionRead)return;currentHash=result.currentHash;currentUpdatedAt=result.updatedAt;currentRole=result.role;reviewControls=[];content.replaceChildren();syncPermissions();
      if(!result.versions.length)element('p','尚无冻结验收版本。',content);
      result.versions.forEach(v=>{const box=element('fieldset','',content);element('legend',new Date(v.created_at).toLocaleString()+' · '+v.status+(v.current?' · 当前正文':' · 历史正文'),box);element('p','版本 '+v.content_hash.slice(0,12)+'；已声明检查 '+(v.result.passed?'通过':'未通过')+'；数值覆盖 '+(v.result.coverageComplete?'完整':'不完整')+'。仅核对检查合同覆盖的项目，不代表已完成事实、来源效力或版式的人工复核。'+(v.result.error||''),box);
        const view=element('button','查看冻结正文与检查依据',box);view.onclick=()=>action(view,async()=>{const r=await api('/api/reportdelivery?projectId='+encodeURIComponent(pid)+'&id='+encodeURIComponent(v.id));let pre=box.querySelector('pre');if(!pre){pre=element('pre','',box);pre.style.cssText='white-space:pre-wrap;max-height:300px;overflow:auto';}const snap=r.result.snapshot;pre.textContent=snap.chapters.map(c=>c.name+'\n'+c.sections.map(s=>s.title+'\n'+s.content+(snap.schemaVersion>=2?'\n段落定位：'+(s.paragraphs||[]).map(p=>p.id).join('、')+'\n来源与逻辑（保存记录，不代表已核实）：'+JSON.stringify({prov:s.prov,logicSnapshot:s.logicSnapshot,lineage:s.lineage}):'')).join('\n')).join('\n\n')+'\n\n检查依据：'+JSON.stringify(r.result.contract)+'\n\n'+(snap.schemaVersion>=2?'全篇引用与版本：'+JSON.stringify(snap.references):'旧冻结格式：未记录历史引用与逻辑快照，来源状态为 unknown。');});
        const download=element('button',v.status==='approved'?'下载批准快照 Word':'下载冻结稿 Word（供复核）',box);download.onclick=()=>action(download,()=>root.exportFrozenDeliveryWord(pid,v.id));
        if(result.role==='OWNER'){
          const restore=element('button','恢复为未签发工作稿',box),ready=()=>{restore.disabled=busy||needsProjectReload||!Number.isSafeInteger(currentUpdatedAt);};reviewControls.push(ready);ready();
          restore.onclick=()=>action(restore,async()=>{
            if(hasUnconfirmedEdits())throw new Error('当前页面存在未获后台保存确认的编辑，请先保存完成再恢复；未覆盖本地编辑。');
            if(!confirm('把此冻结版本的正文及引用恢复为未签发工作稿？当前后台工作稿会完整备份，历史签发结论不变；项目事实及测算不回滚，恢复后需重新核对。请确认没有未保存的编辑。'))return false;
            if(hasUnconfirmedEdits())throw new Error('页面编辑状态已变化，请先保存后再恢复。');
            await api('/api/reportdelivery',{action:'restoreWorkingDraft',projectId:pid,id:v.id,confirmRestore:true,expectedContentHash:currentHash,expectedUpdatedAt:currentUpdatedAt});needsProjectReload=true;
            let readWarning='';try{await refresh();}catch(e){readWarning=' 后续版本列表读取失败，请重新读取；不要重复恢复。';}
            return '后台已恢复为待复核、未签发工作稿；原工作稿和签发历史均已保留。项目事实及当前测算未回滚，版本一致性需重新核对。当前页面未被覆盖，请关闭本窗口后从项目库重新打开项目，勿继续使用旧页面改稿。'+readWarning;
          });
        }
        v.result.checks?.filter(c=>!c.passed).forEach(c=>element('p','未通过：'+c.kind+' / '+c.value,box));
        if(v.status==='approved'&&v.current&&result.role==='OWNER'){
          const golden=element('details','',box);element('summary','管理员：登记为受控评测样本',golden);
          element('p','只登记这一已审签版本；不会自动审批。Training用于完善规则，Holdout必须来自独立项目及材料。请在下方管理员区域填写验证口令。',golden);
          const scenario=element('input','',golden);scenario.placeholder='场景代码，例如 housing_conversion';scenario.setAttribute('aria-label','评测场景');
          const role=element('select','',golden);role.setAttribute('aria-label','评测数据集');for(const value of ['training','holdout']){const option=element('option',value,role);option.value=value;}
          const material=element('textarea','',golden);material.placeholder='该版本实际使用的输入材料（不超过25000字）';material.maxLength=25000;material.setAttribute('aria-label','评测输入材料');
          const approval=element('input','',golden);approval.placeholder='样本登记依据';approval.setAttribute('aria-label','样本登记依据');
          const register=element('button','登记此审签版本',golden);register.onclick=()=>action(register,async()=>{const r=await api('/api/reportorchestration',{action:'trustedCaseRegister',sample:{projectId:pid,deliveryId:v.id,scenario:scenario.value,datasetRole:role.value,input:material.value,approvalNote:approval.value}});element('p','已登记：'+r.sample.id,golden);});
        }
        if(v.status==='pending'&&Number(v.reviewer_id)===Number(result.userId)&&result.role==='VIEWER'){const facts=element('input','',box);facts.type='checkbox';facts.setAttribute('aria-label','已逐项核实事实数值');element('span','已逐项核实事实数值 ',box);const word=element('input','',box);word.type='checkbox';word.setAttribute('aria-label','已检查实际Word版式');element('span','已检查实际Word版式 ',box);const reason=element('input','',box);reason.placeholder='复核依据';reason.setAttribute('aria-label','复核依据');const approve=element('button','确认独立复核通过',box),reject=element('button','退回',box);const ready=()=>{approve.disabled=busy||!v.current||v.schemaVersion<3||!v.result.passed||!facts.checked||!word.checked||!reason.value.trim();reject.disabled=busy||!reason.value.trim();};facts.onchange=word.onchange=reason.oninput=ready;reviewControls.push(ready);ready();
          for(const [button,name] of [[approve,'approve'],[reject,'reject']])button.onclick=()=>action(button,async()=>{await api('/api/reportdelivery',{action:name,projectId:pid,id:v.id,note:reason.value,factsReviewed:facts.checked,wordLayoutReviewed:word.checked});await refresh();});}
      });
    }
    freeze.onclick=()=>action(freeze,async()=>{if(!currentHash)throw new Error('请先读取后台保存版本');if(!Number.isSafeInteger(Number(reviewer.value))||Number(reviewer.value)<=0)throw new Error('请填写有效的独立复核成员账号ID');let checks;try{checks=JSON.parse(contract.value);}catch(_){throw new Error('检查合同不是有效JSON，请修正后提交');}await api('/api/reportdelivery',{action:'freeze',projectId:pid,reviewerId:Number(reviewer.value),contract:checks,expectedContentHash:currentHash});await refresh();});
    uploadButton.onclick=()=>action(uploadButton,async()=>{const file=upload.files[0];if(!file)throw new Error('请选择文件');if(file.size>256*1024*1024)throw new Error('文件超过256MiB');await api('/api/projectartifacts?projectId='+encodeURIComponent(pid)+'&name='+encodeURIComponent(file.name),file,true);await refreshFiles();});
    metrics.onclick=()=>action(metrics,async()=>{adminOutput.textContent=JSON.stringify((await api('/api/operations')).result,null,2);});
    notify.onclick=()=>action(notify,async()=>{adminOutput.textContent=JSON.stringify((await api('/api/operations',{})).result,null,2);});
    billing.onclick=()=>action(billing,async()=>{adminOutput.textContent=JSON.stringify((await api('/api/agentbilling')).items,null,2);});
    reconcile.onclick=()=>action(reconcile,async()=>{await api('/api/agentbilling',JSON.parse(billingInput.value));adminOutput.textContent='对账已记录；未重发模型请求';});
    revoke.onclick=()=>action(revoke,async()=>{if(!confirm('撤销该账号全部登录并取消在途任务？'))return;await api('/api/accountsecurity',{action:'revoke',userId:Number(account.value),note:note.value});});
    dialog.showModal();const results=await Promise.allSettled([refresh(),refreshFiles()]);if(isCurrent()){const failed=results.filter(x=>x.status==='rejected');status.textContent=failed.length?failed.map(x=>x.reason.message).join('；')+' 可分别重新读取版本或原件。':'已读取后台保存版本；未保存的本地编辑不包含在冻结版本中。';}
  }
})(globalThis);
