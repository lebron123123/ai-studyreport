/* Premium PPT workflow bridge: design brief, asset scheduling, rendered QA and persistent learning. */
(function(root){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const state=()=>root.PptWorkspace&&root.PptWorkspace.state;
  const plan=()=>{const s=state();return s&&s.current&&s.current.data;};
  const selectedSlide=()=>{const s=state(),p=plan();return p&&p.slides&&p.slides[Math.max(0,Math.min(s.selected||0,p.slides.length-1))];};
  function label(value){return({metric:"核心指标卡",comparison:"方案对比",timeline:"里程碑路线图",risk:"风险响应",cover:"品牌封面",agenda:"汇报目录",statement:"结论先行",bullets:"洞察拆解","chart-bar":"数据图表","chart-line":"趋势图表",table:"数据表格","image-hero":"项目视觉",conclusion:"决策行动"})[value]||value||"内容页";}
  function briefCard(slide){
    const b=slide&&slide.designBrief||{},sources=(slide&&slide.sources||[]).length,missing=b.missingEvidence||[],asset=({"project-photo":"项目图片","native-chart":"原生可编辑图表","editable-component":"可编辑结构组件"})[b.assetRequirement]||b.assetRequirement||"结构组件";
    return '<section class="ppt-design-brief-card"><header><b>本页设计说明</b><span class="'+(missing.length?'gap':'ready')+'">'+(missing.length?'证据待补齐':'内容与视觉已就绪')+'</span></header><div class="ppt-design-brief-grid"><p><small>本页任务</small><b>'+esc(b.communicationJob||slide.title)+'</b></p><p><small>表达形式</small><b>'+esc(label(b.visualForm||slide.layoutId))+'</b></p><p><small>视觉锚点</small><b>'+esc(b.visualAnchor||"结论与结构")+'</b></p><p><small>素材策略</small><b>'+esc(asset)+'</b></p></div><footer><span>来源 '+sources+' 项</span><span>组件 '+esc(b.componentId||slide.visualPlan&&slide.visualPlan.componentId||"自动匹配")+'</span>'+(missing.length?'<em>缺口：'+missing.slice(0,2).map(esc).join('；')+'</em>':'<em>单页结论：'+esc(b.singleTakeaway||slide.claim||slide.title)+'</em>')+'</footer></section>';
  }
  function deckCapability(p){
    const slides=p.slides||[],images=slides.filter(s=>s.content&&s.content.image||s.assetPlan&&s.assetPlan.status==="matched").length,charts=slides.filter(s=>["chart-bar","chart-line"].includes(s.layoutId)).length,tables=slides.filter(s=>s.layoutId==="table").length,gaps=slides.filter(s=>s.contentStatus==="evidence-gap").length,premium=slides.filter(s=>s.visualPlan&&Number(s.visualPlan.version)>=3).length;
    return '<div class="ppt-premium-capability"><span><b>'+premium+'/'+slides.length+'</b> 高级组件页</span><span><b>'+images+'</b> 图片页</span><span><b>'+charts+'</b> 图表页</span><span><b>'+tables+'</b> 表格页</span><span class="'+(gaps?'gap':'ok')+'"><b>'+gaps+'</b> 证据缺口</span></div>';
  }
  function persistPreference(action){
    const p=plan(),slide=selectedSlide();if(!p||!slide||!root.PptDesignLearning)return;
    root.PptDesignLearning.record({action,strategyId:slide.expressionStrategy&&slide.expressionStrategy.strategyId,compositionId:slide.visualPlan&&slide.visualPlan.compositionId,componentId:slide.visualPlan&&slide.visualPlan.componentId,templateId:p.templateId,pageRole:slide.pageRole});
    p.designPreferenceProfile=root.PptDesignLearning.snapshot();p.designPreferenceProfile.savedAt=Date.now();
    const w=root.PptWorkspace;if(w&&typeof w.saveProject==="function")Promise.resolve(w.saveProject("记录PPT设计偏好")).catch(()=>{});
  }
  function bindLearning(){
    [["pptAcceptChange","accept"],["pptRejectChange","reject"],["pptUndoAgent","undo"]].forEach(([id,action])=>{const el=document.getElementById(id);if(!el||el.dataset.premiumLearning)return;el.dataset.premiumLearning="1";el.addEventListener("click",()=>setTimeout(()=>persistPreference(action),0));});
  }
  function install(){
    const p=plan();if(!p)return;const design=document.querySelector(".ppt-agent-design")||document.querySelector(".ppt-chat-drawer .ppt-editor"),slide=selectedSlide();if(design&&slide&&!design.querySelector(".ppt-design-brief-card")){const head=design.querySelector(".ppt-agent-design-head,.ppt-panel-head");if(head)head.insertAdjacentHTML("afterend",briefCard(slide));}
    const compactCard=design&&design.querySelector(".ppt-design-brief-card");if(compactCard&&design.classList.contains("ppt-editor")){const grid=compactCard.querySelector(".ppt-design-brief-grid"),footer=compactCard.querySelector("footer");if(grid)grid.style.gridTemplateColumns="repeat(2,minmax(0,1fr))";if(footer){footer.style.flexWrap="wrap";const em=footer.querySelector("em");if(em){em.style.marginLeft="0";em.style.maxWidth="100%";}}}
    const threadHead=document.querySelector(".ppt-thread-design-head");if(threadHead&&!threadHead.parentElement.querySelector(".ppt-premium-capability"))threadHead.insertAdjacentHTML("afterend",deckCapability(p));
    bindLearning();
  }
  if(root.document&&!document.getElementById("pptPremiumWorkflowStyle")){const style=document.createElement("style");style.id="pptPremiumWorkflowStyle";style.textContent='.ppt-design-brief-card{margin:12px 0;padding:14px 16px;border:1px solid #cdddea;border-radius:10px;background:linear-gradient(135deg,#f8fbfd,#eef6fb)}.ppt-design-brief-card header{display:flex;align-items:center;justify-content:space-between}.ppt-design-brief-card header b{font-size:14px;color:#173f63}.ppt-design-brief-card header span{padding:4px 9px;border-radius:999px;font-size:11px}.ppt-design-brief-card header .ready{background:#e7f5ef;color:#23735f}.ppt-design-brief-card header .gap{background:#fff1df;color:#9b6419}.ppt-design-brief-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}.ppt-design-brief-grid p{margin:0;padding:10px 12px;background:#fff;border:1px solid #dbe7ef;border-radius:8px}.ppt-design-brief-grid small{display:block;margin-bottom:6px;color:#71889a}.ppt-design-brief-grid b{display:block;color:#183247;white-space:normal}.ppt-design-brief-card footer{display:flex;gap:16px;margin-top:10px;color:#61798b;font-size:11px}.ppt-design-brief-card footer em{margin-left:auto;max-width:52%;font-style:normal;color:#2a6d9e}.ppt-premium-capability{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}.ppt-premium-capability span{padding:10px;border:1px solid #d8e5ee;border-radius:8px;background:#f8fbfd;color:#61798b;font-size:11px}.ppt-premium-capability b{display:block;margin-bottom:3px;color:#17496f;font-size:16px}.ppt-premium-capability .gap b{color:#b17422}.ppt-premium-capability .ok b{color:#23735f}@media(max-width:900px){.ppt-design-brief-grid,.ppt-premium-capability{grid-template-columns:repeat(2,minmax(0,1fr))}.ppt-design-brief-card footer{flex-wrap:wrap}.ppt-design-brief-card footer em{margin-left:0;max-width:100%}}';document.head.appendChild(style);}
  const observer=new MutationObserver(()=>queueMicrotask(install));observer.observe(document.documentElement,{childList:true,subtree:true});queueMicrotask(install);
  root.PptPremiumWorkflow={install,briefCard,deckCapability,persistPreference};
})(window);
