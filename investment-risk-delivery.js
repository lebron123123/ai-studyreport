(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function mount(host,{projectId,reportId,headers}){
  let busy=false;
  host.innerHTML='<h4>独立复核与签发</h4><p>所有者指定未参与编制的只读成员。复核人先下载待复核Word，核对版式、事实与覆盖缺口后批准；批准不关闭风险。</p><div data-rd-body></div><p role="status" data-rd-status></p>';
  const msg=t=>host.querySelector('[data-rd-status]').textContent=t;
  async function api(body){const q=new URLSearchParams({projectId,riskReportId:reportId}),r=await fetch('/api/reportdelivery?'+q,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers()},body:body?JSON.stringify({...body,projectId}):undefined,signal:AbortSignal.timeout(30000)}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'复核服务暂不可用，请刷新重试');return d.result;}
  async function task(fn){if(busy)return;busy=true;try{await fn();}catch(e){msg(e.message+'；未覆盖原报告。');}finally{busy=false;}}
  async function load(){const d=await api();if(!host.isConnected)return;const body=host.querySelector('[data-rd-body]');body.innerHTML=(d.role==='OWNER'?'<label>独立复核人成员ID <input data-rd-reviewer type="number" min="1"></label><button data-rd-submit>提交独立复核</button>':'')+'<button data-rd-refresh>刷新复核状态</button>'+d.versions.map(v=>'<section><p>'+esc(v.id)+' · '+esc(({pending:'待独立复核',approved:'已批准',rejected:'已退回'})[v.status]||v.status)+(v.current?'':' · 当前依据已变化')+'</p><button data-rd-export="'+esc(v.id)+'">'+(v.status==='approved'?'下载批准快照Word':'下载待复核Word')+'</button>'+((Number(v.reviewer_id)===Number(d.userId)&&d.role==='VIEWER'&&v.status==='pending')?'<div data-rd-review="'+esc(v.id)+'"><label>复核依据 <textarea data-rd-note></textarea></label><label><input type="checkbox" data-rd-facts>已核对事实、数值、来源及覆盖缺口</label><label><input type="checkbox" data-rd-layout>已下载核对Word版式</label><button data-rd-approve>批准签发</button><button data-rd-reject>退回</button></div>':'')+'</section>').join('');
   body.querySelector('[data-rd-refresh]').onclick=()=>task(load);
   body.querySelector('[data-rd-submit]')?.addEventListener('click',()=>task(async()=>{await api({action:'freeze',riskReportId:reportId,reviewerId:Number(body.querySelector('[data-rd-reviewer]').value)});await load();msg('已提交独立复核；尚未签发。');}));
   body.querySelectorAll('[data-rd-export]').forEach(b=>b.onclick=()=>task(async()=>{if(!root.exportFrozenDeliveryWord)throw Error('导出模块尚未加载，请刷新页面');await root.exportFrozenDeliveryWord(projectId,b.dataset.rdExport);}));
   body.querySelectorAll('[data-rd-review]').forEach(s=>{for(const action of ['approve','reject'])s.querySelector('[data-rd-'+action+']').onclick=()=>task(async()=>{await api({action,id:s.dataset.rdReview,note:s.querySelector('[data-rd-note]').value,factsReviewed:s.querySelector('[data-rd-facts]').checked,wordLayoutReviewed:s.querySelector('[data-rd-layout]').checked});await load();msg(action==='approve'?'已批准该冻结版本；风险状态未改变。':'已退回；原复核记录保留。');});});
  }
  task(load);
 }
 root.InvestmentRiskDelivery={mount};
})(window);
