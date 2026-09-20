/* 分类建议只辅助管理员，不自动批准、发布或修改原投稿。 */
(function(global){
 'use strict';
 const labels={policy:'政策原文 → 资料台账',interpretation:'政策解读 → 资料台账',standard:'标准规范 → 资料台账',data:'统计数据 → 资料台账',material:'其他资料 → 资料台账',experience:'经验沉淀 → Wiki草稿'};
 global.mountContributionBatch=function(box,rows){
  const intro=box.parentElement?.querySelector(':scope > .sub');if(intro)intro.textContent='管理员核对正文、来源、适用范围及分类后，可一次审核通过并发布到RAG；未核验资料保留待审核。已通过但尚未发布的资料可在“已通过”列表继续发布。';
  rows.forEach((row,i)=>{
   const article=box.querySelectorAll(':scope > article')[i];
   if(row.meta?.publication?.state==='published'&&article){const state=document.createElement('p');state.textContent='已发布，索引已建立';article.prepend(state);}
   const saved=row.meta?.reviewClassification;if(!saved)return;
   const card=box.querySelectorAll(':scope > article')[i];if(!card)return;
   const badge=document.createElement('div');badge.className='contrib-target';badge.textContent='已确认分类：'+(labels[saved.category]||saved.category)+' · '+saved.format;card.prepend(badge);
  });
  const eligible=rows.filter(r=>['pending','approved'].includes(r.status)&&!r.meta?.publication&&['wiki','material'].includes(r.kind));
  if(!eligible.length)return;
  const bar=document.createElement('div');bar.className='contribution-batch bar';
  bar.innerHTML='<label><input type="checkbox" data-select-all> 全选本页待发布资料</label><button class="btn" data-batch-approve>批量审核通过并发布</button><button class="btn ghost" data-batch-stop disabled>停止后续</button><span role="status" aria-live="polite">核对正文、来源、适用范围和分类后发布；未确认的保留待核验。</span>';
  box.prepend(bar);const selections=[];let busy=false,stop=false;
  for(const row of eligible){
   let button=Array.from(box.querySelectorAll('[data-capprove]')).find(b=>b.dataset.capprove===row.id);
   const card=button?.closest('article')||box.querySelectorAll(':scope > article')[rows.indexOf(row)];if(!card)continue;
   if(!button){button=document.createElement('button');button.className='btn';card.append(button);}
   button.textContent=row.status==='approved'?'发布到RAG / 重试发布':'审核通过并发布';
   const area=document.createElement('div');area.className='contribution-classification';
   const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label','选择 '+row.title);
   const select=document.createElement('select');select.setAttribute('aria-label','分类 '+row.title);
   for(const [value,text] of Object.entries(labels)){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
   select.value=row.meta?.reviewClassification?.category|| (row.suggestion?.category in labels?row.suggestion.category:'material');
   if(row.status==='approved')select.disabled=true;
   const hint=document.createElement('span');hint.className='sub';hint.textContent=(row.suggestion?.format||'文本')+' · '+(row.suggestion?.reason||'请手动确认分类')+'。仅辅助分类，不代表效力已核验。';
   area.append(check,select,hint);card.prepend(area);const item={row,check,select,card};selections.push(item);
   button.onclick=()=>run([item]);
  }
  const status=bar.querySelector('[role="status"]'),all=bar.querySelector('[data-select-all]');
  all.onchange=()=>selections.forEach(s=>{if(!s.check.disabled)s.check.checked=all.checked;});
  bar.querySelector('[data-batch-stop]').onclick=()=>{stop=true;status.textContent='等待当前请求结束，随后停止';};
  bar.querySelector('[data-batch-approve]').onclick=()=>run(selections.filter(s=>s.check.checked&&!s.check.disabled));
  async function run(items){
   if(busy)return;if(!items.length){status.textContent='请先勾选要通过的资料';return;}
   const counts={};items.forEach(s=>counts[labels[s.select.value]]=(counts[labels[s.select.value]]||0)+1);
   if(!global.confirm('确认已核对这 '+items.length+' 项正文、来源、适用范围和分类，并允许用于RAG检索？\n'+Object.entries(counts).map(([k,v])=>k+'：'+v+'项').join('\n')+'\n将自动分流并建立索引；不完整或未核实资料请取消并保留待核验。'))return;
   busy=true;stop=false;let done=0,passed=0;
   const controls=Array.from(box.querySelectorAll('button,input,select'));controls.forEach(e=>{e.disabled=true;});bar.querySelector('[data-batch-stop]').disabled=false;
   // 禁止切换状态时销毁正在处理的队列；页面刷新仍由后台事务保证单条原子性。
   const tabs=Array.from(document.querySelectorAll('[data-cstatus]'));tabs.forEach(b=>b.disabled=true);
   try{for(const item of items){
    if(stop||!box.isConnected)break;
    status.textContent='审核并建立索引 '+done+'/'+items.length+'（正在处理当前项）';
    const result=document.createElement('div');result.className='contrib-note';item.card.append(result);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
    try{
     const response=await fetch('/api/contributions',{method:'POST',headers:global.authHeaders(),signal:controller.signal,body:JSON.stringify({action:'approvePublish',id:item.row.id,classification:item.select.value,note:'管理员核对并发布：'+labels[item.select.value]})});
     const d=await response.json();if(d.status==='approved')item.row.status='approved';if(!response.ok||!d.ok)throw new Error(d.error||'审核失败');
     item.done=true;item.check.checked=false;passed++;result.textContent=d.message+' · '+(d.target?.module||'');
     const badge=item.card.querySelector('.contrib-head > .contrib-kind');if(badge)badge.textContent='可检索';
     const sourceState=item.card.querySelector(':scope > p');if(sourceState)sourceState.textContent='已发布，索引已建立';
     box.dispatchEvent(new CustomEvent('contribution-published',{bubbles:true,detail:{id:item.row.id}}));
    }catch(e){result.textContent=e.name==='AbortError'?'请求超时：请刷新核对后台状态后再决定是否重试':'未完成：'+e.message;}
    finally{clearTimeout(timer);}done++;
   }}finally{
    busy=false;controls.forEach(e=>e.disabled=false);tabs.forEach(b=>b.disabled=false);bar.querySelector('[data-batch-stop]').disabled=true;
    selections.filter(s=>s.done).forEach(s=>s.card.querySelectorAll('button,input,select').forEach(e=>e.disabled=true));
    selections.filter(s=>s.row.status==='approved').forEach(s=>s.select.disabled=true);
    status.textContent=(stop?'已停止':'处理结束')+' '+done+'/'+items.length+'，成功 '+passed+' 项。逐条结果见下方；刷新以后台已保存状态为准。';
   }
  }
 };
})(window);
