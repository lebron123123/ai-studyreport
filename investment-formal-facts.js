/* External facts only. Corporate approval and warning policy remain separate. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const kinds={scheduled:'会议排期',held:'实际召开',decision:'决议结果',condition:'条件落实',original:'原批准基线',adjustment:'调整批准',extension:'批准延期',pause:'批准暂停',started:'实际开工',rule:'制度检查规则'};
 const results={passed:'通过',conditional:'附条件通过',deferred:'暂缓',rejected:'未通过'};
 const drafts=new Map();
 root.addEventListener?.('beforeunload',e=>{if(drafts.size){e.preventDefault();e.returnValue='';}});
 function mount(host,{projectId,headers}){
  let data,busy=false,checkRequestId;
  const key=()=>data.actorId+':'+projectId;
  const message=t=>{const el=host.querySelector('[data-ff-message]');if(el)el.textContent=t;};
  async function request(body){const r=await fetch('/api/investmentops?view=formalFacts&projectId='+encodeURIComponent(projectId),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers()},body:body?JSON.stringify({...body,projectId}):undefined,signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'事实台账请求失败');return d.formalFacts||d;}
  const options=(list,value)=>'<option value="">请选择</option>'+list.map(([k,v])=>`<option value="${esc(k)}" ${String(k)===String(value)?'selected':''}>${esc(v)}</option>`).join('');
  function form(item){
   const p=item?.payload||{},slot=host.querySelector('[data-ff-form]');
   const input=(n,label,type='text',value=p[n]||'',required=true)=>`<label>${label}<input name="${n}" type="${type}" value="${esc(value)}" ${required?'required':''} ${type==='text'?'maxlength="1000"':''}></label>`;
   slot.innerHTML=`<form class="ff-form"><h4>${item?'更正原记录（保存后重新核验）':'登记外部事实'}</h4>
    <label>事实类别<select name="kind" ${item?'disabled':''}>${Object.entries(kinds).map(([k,v])=>`<option value="${k}" ${item?.kind===k?'selected':''}>${v}</option>`).join('')}</select></label>
    <label>所属会议事件<select name="eventId" required ${item?'disabled':''}>${options(data.meetings.map(m=>[m.id,m.title]),item?.event_id)}</select></label>
    ${input('round','业务轮次 / 条件序号','number',item?.round||1)}
    ${input('title','事实标题','text',p.title||'')}${input('date','事实 / 批准日期','date')}
    <label>已归档原件<select name="sourceId" required>${options(data.sources.map(s=>[s.id,s.file_name]),item?.source_id)}</select></label>
    ${input('locator','原件定位（页码 / 条款）')}
    <label data-for="decision">决议结果<select name="result">${Object.entries(results).map(([k,v])=>`<option value="${k}" ${p.result===k?'selected':''}>${v}</option>`).join('')}</select></label>
    <label class="ff-wide" data-for="decision">附带条件（每行一条；仅附条件通过时填写）<textarea name="conditions" maxlength="15000">${esc((p.conditions||[]).join('\n'))}</textarea></label>
    <label data-for="condition original adjustment extension pause">关联决议<select name="decisionId">${options(data.items.filter(x=>x.kind==='decision').map(x=>[x.id,x.payload.title+' · '+(x.currentValid?'已核验':'待核验/失效')]),p.decisionId)}</select></label>
    <label data-for="condition">落实的原条件（与决议原文一致）<input name="condition" maxlength="500" value="${esc(p.condition||'')}"></label>
    <label data-for="original adjustment">批准金额（元）<input name="amount" inputmode="decimal" value="${esc(p.amount||'')}"></label>
    <label data-for="original adjustment rule" data-rule="investment">币种<input name="currency" maxlength="3" value="${esc(p.currency||'CNY')}"></label>
    <label data-for="original adjustment rule" data-rule="investment">金额口径<input name="amountBasis" maxlength="1000" value="${esc(p.amountBasis||'')}" placeholder="例如：含税总投资"></label>
    <label data-for="original adjustment rule">适用范围（基线与规则须一致）<input name="scope" maxlength="500" value="${esc(p.scope||'')}" placeholder="按批准文件明确范围，不自动猜测"></label>
    <label data-for="original adjustment">批准的计划开工日期（可留空）<input name="plannedStart" type="date" value="${esc(p.plannedStart||'')}"></label>
    <label data-for="adjustment started">关联原批准<select name="originalId">${options(data.items.filter(x=>x.kind==='original').map(x=>[x.id,x.payload.title]),p.originalId)}</select></label>
    <label data-for="extension pause">原交接事项<select name="obligationId">${options((data.obligations||[]).map(x=>[x.id,x.title]),p.obligationId)}</select></label>
    <label data-for="extension">延期后的截止日期<input type="date" name="newDue" value="${esc(p.newDue||'')}"></label>
    <label data-for="pause">暂停开始日期（含）<input type="date" name="start" value="${esc(p.start||'')}"></label>
    <label data-for="pause">恢复日期（不含；未恢复留空）<input type="date" name="end" value="${esc(p.end||'')}"></label>
    <label data-for="rule">检查类别<select name="ruleType">${options([['deadline','交接期限'],['investment','预计投资偏差'],['construction','开工延期']],p.ruleType)}</select></label>
    <label data-for="rule">规则生效日<input type="date" name="validFrom" value="${esc(p.validFrom||'')}"></label>
    <label data-for="rule">规则失效日（可空）<input type="date" name="validUntil" value="${esc(p.validUntil||'')}"></label>
    <label data-for="rule">阈值比较<select name="operator">${options([['gt','严格超过'],['gte','达到或超过']],p.operator)}</select></label>
    <label data-for="rule" data-rule="deadline">暂停计时起点<input type="date" name="clockStart" value="${esc(p.clockStart||'')}"></label>
    <label data-for="rule" data-rule="deadline">延期与暂停口径<select name="stacking">${options([['no-mix','不叠加（同时存在则待核实）'],['extension-plus-pauses','延期截止日加批准暂停天数']],p.stacking)}</select></label>
    <label data-for="rule" data-rule="investment">阈值基点（20%填2000，不是默认制度）<input type="number" name="thresholdBps" min="0" max="100000" step="1" value="${esc(p.thresholdBps??'')}"></label>
    <label data-for="rule" data-rule="investment">核对的采纳情景<select name="scenarioId">${options((data.scenarios||[]).map(s=>[s.id,s.name]),p.scenarioId)}</select></label>
    <label data-for="rule" data-rule="investment">复算总投资指标单位<select name="metricUnit">${options([['元','元'],['万元','万元']],p.metricUnit)}</select></label>
    <label data-for="rule" data-rule="construction">日历年阈值（闰日周年取2月28日）<input name="years" type="number" min="1" max="100" step="1" value="${esc(p.years||'')}"></label>
    <p class="ff-wide" data-for="rule">规则须关联制度原件并由不同人员独立核验后生效；业务日期统一按北京时间。系统不预设20%或两年为已发布制度。请按制度会议事件登记，不代表系统代行企业审批。</p>
    ${input('reason','本次登记 / 更正原因','text','')}
    <label class="ff-wide">备注<textarea name="note" maxlength="4000">${esc(p.note||'')}</textarea></label>
    ${item?'':'<label class="ff-wide"><span><input type="checkbox" name="confirmed" required> 确认新事项 / 新轮次；更正已有记录请使用“更正”。多个条件分别登记，使用不同条件序号。</span></label>'}
    <div class="ff-wide"><button class="ub-btn" type="submit">保存待核验记录</button> <button class="ub-btn ghost" type="button" data-ff-cancel>取消</button></div></form>`;
   const f=slot.querySelector('form');f.elements.round.min='1';f.elements.round.step='1';f.elements.round.disabled=!!item;
   function fields(){const k=item?.kind||f.elements.kind.value;f.querySelectorAll('[data-for]').forEach(el=>{el.hidden=!el.dataset.for.split(' ').includes(k)||(k==='rule'&&el.dataset.rule&&el.dataset.rule!==f.elements.ruleType.value);el.querySelectorAll('input,select,textarea').forEach(c=>c.disabled=el.hidden);});}
   fields();f.oninput=f.onchange=()=>{fields();drafts.set(key(),{item,values:Object.fromEntries(new FormData(f))});};
   slot.querySelector('[data-ff-cancel]').onclick=()=>{if(!busy){drafts.delete(key());slot.innerHTML='';}};
   f.onsubmit=e=>{e.preventDefault();const b=Object.fromEntries(new FormData(f));perform({ ...b,action:'saveFormalFact',kind:item?.kind||b.kind,eventId:item?.event_id||b.eventId,round:item?.round||Number(b.round),conditions:(b.conditions||'').split('\n').map(x=>x.trim()).filter(Boolean),expectedVersion:Number(item?.version||0),newRoundConfirmed:b.confirmed==='on'});};
  }
  function render(){
   const amount=r=>r?`${esc(r.payload.amount)} ${esc(r.payload.currency)}（${esc(r.payload.amountBasis)}）`:'未建立 / 待核验';
   host.innerHTML=`<section class="ff-panel"><header><div><h3>正式事实与批准基线</h3><p>${esc(data.warning)}</p></div><button class="ub-btn ghost" data-ff-refresh>刷新</button></header>
    <div role="status" data-ff-message></div><div class="ff-summary"><div>原批准<strong>${amount(data.approvedBaseline)}</strong></div><div>调整批准<strong>${amount(data.approvedAdjustment)}</strong></div><div>预测<strong>独立保存在财务与版本页面</strong></div></div>
    ${data.canEdit?'<div class="ff-tools"><button class="ub-btn" data-ff-new>＋ 登记事实</button><label>归档原件（最多256 MiB）<input type="file" data-ff-file></label><button class="ub-btn ghost" data-ff-upload>上传原件</button></div>':''}
    ${data.canManage?`<details><summary>核验动作授权（不等于企业审批授权）</summary><form data-ff-grant><label>当前编辑成员<select name="userId" required>${options(data.members.map(id=>[id,'用户 #'+id]),'')}</select></label><label>操作<select name="active"><option value="true">授权</option><option value="false">撤销</option></select></label><label>授权 / 撤销依据<input name="basis" required maxlength="1000"></label><button class="ub-btn ghost">保存授权</button></form><p>${data.grants.map(g=>'用户 #'+g.user_id+'：'+(Number(g.active)?'已授权':'已撤销')).join('；')||'尚未授权；编辑权限不自动包含核验权限。'}</p></details>`:''}
    <div data-ff-checks></div><div data-ff-form></div><div class="ff-list">${data.items.map(x=>`<article><header><strong>${esc(kinds[x.kind])} · ${esc(x.payload.title)}</strong><span>${x.currentValid?'已核验':x.status==='verified'?'依据变化，需重新登记核验':'待独立核验'} · v${Number(x.version)}</span></header><p>${esc(x.payload.date)} · 第${x.round}轮 / 条件序号 · 登记人 #${x.created_by}${x.verified_by?' · 核验人 #'+x.verified_by:''}</p><p>${x.payload.amount?amount(x):esc(results[x.payload.result]||x.payload.condition||'')}</p><details><summary>原件与依据</summary><p>${esc(x.payload.locator)}</p><p class="ff-pre">${esc((x.payload.conditions||[]).join('\n')||x.payload.note||'')}</p><pre class="ff-pre">${esc(JSON.stringify(x.payload,null,2))}</pre><p>最近原因：${esc(x.payload.reason)}；核验意见：${esc(x.payload.verificationNote||'尚未核验')}</p><button class="ub-btn ghost" data-ff-source="${esc(x.source_id)}">下载原件核对</button></details><div class="ff-tools">${data.canEdit?`<button class="ub-btn ghost" data-ff-edit="${esc(x.id)}">更正</button>`:''}${data.canVerify&&Number(x.created_by)!==data.actorId&&x.status==='pending'?`<input data-ff-note="${esc(x.id)}" aria-label="核验意见" placeholder="核验意见"><label><input type="checkbox" data-ff-confirm="${esc(x.id)}">已核对原件</label><button class="ub-btn" data-ff-verify="${esc(x.id)}">独立核验</button>`:''}</div></article>`).join('')||'<p>暂无正式事实。先登记会议并归档原件，再登记事实；不会将历史草稿自动转成批准。</p>'}</div></section>`;
   const checks=host.querySelector('[data-ff-checks]'),states={unknown:'待核实',overdue:'已逾期',triggered:'触发阈值',clear:'未触发'};
   const watch=document.createElement('div');checks.before(watch);root.InvestmentWatch?.mount(watch,{projectId,headers});
   checks.innerHTML=`<h4>规则检查记录</h4><p>手动检查并保存结果；不会关闭风险。尚未启用无人值守定时检查。结果只代表检查当时，不代表当前健康度。</p>${data.checks?.canRun?'<button class="ub-btn" data-ff-run>执行检查并保存</button>':''}${(data.checks?.runs||[]).map((r,i)=>`<details ${i===0?'open':''}><summary>${esc(new Date(r.checkedAt).toLocaleString())} · ${r.status==='complete'?'检查覆盖完成':r.status==='failed'?'检查失败':'部分待核实'} · 已核验 ${r.checked} / ${r.expected??'未知'}</summary><p>${esc(r.notice)}</p>${r.results.map(x=>`<p data-check-state="${esc(x.status)}"><strong>${esc(states[x.status]||'待核实')} · ${esc(x.title)}</strong>：${esc(x.reason||'请核对原计划与阈值')} ${x.effectiveDue?'有效截止 '+esc(x.effectiveDue)+'（原截止 '+esc(x.originalDue)+'）':''}${x.thresholdDate?'阈值日期 '+esc(x.thresholdDate):''}${x.ruleId?' · 规则 '+esc(x.ruleId)+' v'+Number(x.ruleVersion):''}</p>`).join('')}</details>`).join('')||'<p>尚无检查记录，不能判断健康度。</p>'}`;
   checks.querySelector('[data-ff-run]')?.addEventListener('click',()=>{checkRequestId||=crypto.randomUUID();perform({action:'runInvestmentCheck',requestId:checkRequestId});});
   checks.querySelector('p').textContent='手动检查并保存结果，不会关闭风险。持续检查由负责人在上方面板启用；历史记录只代表检查当时，不代表当前健康度。';
   const discard=()=>!drafts.has(key())||confirm('放弃尚未保存的事实输入？');
   host.querySelector('[data-ff-refresh]').onclick=()=>{if(!busy&&discard()){drafts.delete(key());load();}};
   host.querySelector('[data-ff-new]')?.addEventListener('click',()=>{if(!busy&&discard()){drafts.delete(key());form();}});
   host.querySelectorAll('[data-ff-edit]').forEach(b=>b.onclick=()=>{if(!busy&&discard()){drafts.delete(key());form(data.items.find(x=>x.id===b.dataset.ffEdit));}});
   host.querySelectorAll('[data-ff-verify]').forEach(b=>b.onclick=()=>{const x=data.items.find(x=>x.id===b.dataset.ffVerify);perform({action:'verifyFormalFact',id:x.id,expectedVersion:Number(x.version),confirmed:host.querySelector(`[data-ff-confirm="${x.id}"]`).checked,reason:host.querySelector(`[data-ff-note="${x.id}"]`).value});});
   const grant=host.querySelector('[data-ff-grant]');if(grant)grant.onsubmit=e=>{e.preventDefault();const b=Object.fromEntries(new FormData(grant));perform({action:'grantFactVerifier',userId:Number(b.userId),basis:b.basis,active:b.active==='true',expectedVersion:Number(data.grants.find(g=>Number(g.user_id)===Number(b.userId))?.version||0)});};
   host.querySelector('[data-ff-upload]')?.addEventListener('click',()=>transfer());
   host.querySelectorAll('[data-ff-source]').forEach(b=>b.onclick=()=>transfer(b.dataset.ffSource));
   const draft=drafts.get(key());if(draft&&data.canEdit){form(draft.item);const f=host.querySelector('.ff-form');if(!draft.item&&draft.values.kind)f.elements.kind.value=draft.values.kind;if(draft.values.ruleType)f.elements.ruleType.value=draft.values.ruleType;f.onchange();for(const [n,v]of Object.entries(draft.values)){const c=f.elements.namedItem(n);if(c&&!c.disabled){if(c.type==='checkbox')c.checked=v==='on';else c.value=v;}}f.onchange();}
  }
  async function transfer(id){
   if(busy)return;const file=host.querySelector('[data-ff-file]')?.files[0];if(!id&&(!file||file.size===0||file.size>256*1024*1024)){message('请选择非空且不超过256 MiB的原件');return;}
   busy=true;message(id?'正在读取原件…':'正在归档原件…');
   try{const r=await fetch('/api/projectartifacts?projectId='+encodeURIComponent(projectId)+(id?'&id='+encodeURIComponent(id):'&name='+encodeURIComponent(file.name)),{method:id?'GET':'POST',headers:{...headers(),...(!id?{'Content-Type':file.type||'application/octet-stream'}:{})},body:id?undefined:file,signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error((await r.json()).error||'原件处理失败');if(id){const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=data.sources.find(s=>s.id===id)?.file_name||'原件';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);message('已下载原件，请核对页码、内容和批准口径。');}else {await load();message('原件已归档，可以选择关联。');}}catch(e){message(e.message+'；请刷新核对后重试。');}finally{busy=false;}
  }
  async function perform(body){if(busy)return;busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);try{await request(body);if(body.action==='runInvestmentCheck')checkRequestId=null;if(body.action==='saveFormalFact')drafts.delete(key());if(host.isConnected){const loaded=await load();message(loaded?'已保存到服务器。':'已保存，但重新读取失败，请刷新核对。');}}catch(e){message((e.name==='TimeoutError'?'请求超时，请刷新核对是否已保存':e.message)+'；输入已保留。');}finally{busy=false;host.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  async function load(){try{const next=await request();if(!host.isConnected)return false;data=next;render();return true;}catch(e){if(!host.isConnected)return false;if(data)message('读取失败：'+e.message);else{host.innerHTML='<p role="alert">'+esc(e.message)+'</p><button class="ub-btn ghost">重试</button>';host.querySelector('button').onclick=load;}return false;}}
  host.innerHTML='<p role="status">正在读取正式事实…</p>';load();
 }
 root.InvestmentFormalFacts={mount};
})(typeof window!=='undefined'?window:globalThis);
