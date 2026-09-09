/* Persistent checks are server owned; this component never advances the scan watermark. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=v=>v?new Date(Number(v)).toLocaleString():'尚无记录';
 const states={open:'待处置',review:'待独立复核',exception:'限期例外（风险仍保留）',closed:'已复核关闭',mitigated:'历史缓释',candidate:'历史待确认'};
 function mount(host,{projectId,headers}){
  let data,busy=false,period='week';
  const message=t=>{const e=host.querySelector('[data-watch-message]');if(e)e.textContent=t;};
  async function request(body){const r=await fetch('/api/investmentops?view=watch&projectId='+encodeURIComponent(projectId)+'&period='+period,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers()},body:body?JSON.stringify({...body,projectId}):undefined,signal:AbortSignal.timeout(30000)});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'持续检查读取失败');return d;}
  function render(){
   const s=data.schedule,v=data.view,t=v.totals,levels={high:'红 · 高风险',medium:'黄 · 预警',unknown:'灰 · 待核实',normal:'一般风险'};
   host.innerHTML=`<section class="iw-panel"><header><h3>持续检查与周/月风险</h3><div><select data-watch-period aria-label="风险期间"><option value="week" ${period==='week'?'selected':''}>本周风险事项</option><option value="month" ${period==='month'?'selected':''}>本月风险事项</option></select> <button type="button" data-watch-refresh>刷新</button></div></header>
    <p role="status" data-watch-message></p><p>${s.enabled?'已启用，后台约每15分钟检查一次，无需保持页面打开。':'未启用持续检查。仅负责人可以启用。'} 服务停机无法检查，恢复后补查当前状态，不补造历史快照。</p>
    ${data.canManage?`<button type="button" data-watch-toggle>${s.enabled?'停用持续检查':'启用持续检查'}</button>`:''}
    <p data-watch-coverage class="iw-coverage ${s.fresh?'iw-complete':'iw-unknown'}">${s.fresh?'当前检查覆盖完整（不等于没有风险）':'覆盖未知 / 不完整，不能判断为健康'} · 已核验 ${s.last.checked??0} / ${s.last.expected??'未知'} · 待核实 ${s.last.unknown??'未知'}</p>
    <p>最近检查：${esc(time(s.watermark))}；最近完整检查：${esc(time(s.completeAt))}；下次计划：${s.enabled?esc(time(s.nextAt)):'未启用'}</p><p>${esc(s.last.notice||'尚无后台检查记录。')}</p>
    <div class="iw-summary"><span>去重事项 <strong>${t.unique}</strong></span><span>未结 <strong>${t.unresolved}</strong></span><span>往期结转 <strong>${t.carryover}</strong></span><span>本期新增 <strong>${t.added}</strong></span><span>本期升级 <strong>${t.escalated}</strong></span><span>本期到期 <strong>${t.due}</strong></span></div>
    <p>${esc(v.startDate)} 至 ${esc(v.asOf)}（北京时间）。${esc(v.notice)}</p>
    <div class="iw-list">${v.items.map(r=>`<article data-watch-risk="${esc(r.id)}" class="iw-risk iw-${r.unresolved?esc(['high','medium','unknown'].includes(r.level)?r.level:'unknown'):'closed'}"><h4>${esc(r.title)} <small>${r.unresolved?esc(levels[r.level]||'待核实'):'绿 · 已复核关闭'}</small></h4><p>${esc(states[r.status]||r.status)} ${r.closureInvalid?' · 关闭依据已失效，计入未结，待后台重开':''} ${r.carryover?' · 往期结转':''} ${r.round?' · 第'+r.round+'轮':''} ${r.assignee?' · 责任人 #'+Number(r.assignee):''}</p><p>${esc(r.latest?.reason||'请核对规则和原件')}</p><p>${r.dueDate?'有效截止：'+esc(r.dueDate):''} ${r.until?'例外截止：'+esc(r.until):''}</p>
     <details><summary>依据与处置记录</summary><pre>${esc(JSON.stringify(r.latest||{},null,2))}</pre><p>提交人：${Number(r.submitter)||'—'}；复核人：${Number(r.reviewer)||'—'}；最近说明：${esc(r.lastReason||'—')}</p>${(r.proofs||[]).map(p=>'<p>证据：'+esc(p.id)+'</p>').join('')}</details>
     ${data.canEdit&&!r.legacy?`<form data-watch-form="${esc(r.id)}"><label>处置说明<textarea name="reason" required maxlength="2000" placeholder="说明认领、整改或复核依据"></textarea></label><label>有效证据（可多选；提交整改/例外必选）<select name="evidence" multiple size="3">${data.evidence.map(e=>`<option value="${esc(e.id)}">${esc(e.label)} · ${esc(e.id)}</option>`).join('')}</select></label><label>例外截止日期<input name="until" type="date"></label><div class="iw-actions">${r.status!=='closed'?'<button type="submit" value="claim">认领（不关闭）</button><button type="submit" value="submit">提交整改复核</button><button type="submit" value="exception">申请限期例外</button>':''}${r.status==='review'&&data.canReview&&Number(r.submitter)!==data.actorId?'<button type="submit" value="approve">独立复核通过</button><button type="submit" value="return">退回整改</button>':''}${['closed','exception'].includes(r.status)?'<button type="submit" value="reopen">重新打开</button>':''}</div></form>`:r.legacy?'<p>历史台账事项，请在原风险台账核对；历史关闭标记不自动算独立复核通过。</p>':''}</article>`).join('')||'<p data-watch-empty>本期暂无已记录风险；请同时核对检查覆盖状态。</p>'}</div>
    <details><summary>站内提醒（最近100条，仅本人）</summary>${data.notices.map(n=>`<p>${esc(time(n.created_at))} · ${esc(v.items.find(r=>r.id===n.risk_id)?.title||n.risk_id)}</p>`).join('')||'<p>暂无提醒</p>'}<p>同一事项、轮次、等级和业务日期去重；查看提醒不会关闭风险。</p></details>
    <details><summary>处置审计（最近200条）</summary>${data.history.map(h=>`<p>${esc(time(h.created_at))} · ${esc(h.actor)} · ${esc(h.event_type)} · ${esc(h.payload.reason||h.payload.id||'')}</p>`).join('')||'<p>暂无审计记录</p>'}</details></section>`;
   const reports=document.createElement('div');host.append(reports);root.InvestmentRiskReport?.mount(reports,{projectId,headers,risks:v.items,canEdit:data.canEdit});
   host.querySelector('[data-watch-refresh]').onclick=()=>{if(!busy)load();};
   host.querySelector('[data-watch-period]').onchange=e=>{if(!busy){period=e.target.value;load();}};
   host.querySelector('[data-watch-toggle]')?.addEventListener('click',()=>{if(!busy&&confirm(s.enabled?'停用后检查覆盖将标为未知，保留历史风险。确认停用？':'确认启用本项目后台持续检查？系统将记录风险与站内提醒，不会代替企业审批。'))perform({action:'watchConfigure',enabled:!s.enabled,confirmed:true,expectedVersion:s.version});});
   host.querySelectorAll('[data-watch-form]').forEach(f=>f.onsubmit=e=>{e.preventDefault();if(busy)return;const r=v.items.find(x=>x.id===f.dataset.watchForm),operation=e.submitter.value;perform({action:'watchRiskAction',operation,id:r.id,expectedVersion:r.version,reason:f.elements.reason.value,until:f.elements.until.value,evidenceIds:[...f.elements.evidence.selectedOptions].map(x=>x.value)});});
  }
  async function load(){try{const d=await request();if(!host.isConnected)return false;data=d;render();return true;}catch(e){if(!host.isConnected)return false;if(data)message('读取失败：'+e.message+'；保留上次结果，不能据此判断最新状态。');else{host.innerHTML='<p role="alert">'+esc(e.message)+'</p><button type="button">重试</button>';host.querySelector('button').onclick=load;}return false;}}
  async function perform(body){if(busy)return;busy=true;host.querySelectorAll('button,select').forEach(x=>x.disabled=true);message('正在保存…');try{await request(body);const ok=await load();message(ok?'已保存到服务器。':'已保存，但读取失败，请刷新核对。');}catch(e){message((e.name==='TimeoutError'?'请求超时，请刷新核对是否已保存':e.message)+'；输入已保留。');}finally{busy=false;host.querySelectorAll('button,select').forEach(x=>x.disabled=false);}}
  host.innerHTML='<p role="status">正在读取持续检查…</p>';load();
  const freshness=setInterval(()=>{if(!host.isConnected){clearInterval(freshness);return;}if(data?.schedule.fresh&&Date.now()-data.schedule.watermark>30*60000){data.schedule.fresh=false;const c=host.querySelector('[data-watch-coverage]');if(c){c.className='iw-coverage iw-unknown';c.textContent='检查已过期，覆盖未知；请刷新核对，不能继续判断为健康。';}}},30000);
 }
 root.InvestmentWatch={mount};
})(typeof window!=='undefined'?window:globalThis);
