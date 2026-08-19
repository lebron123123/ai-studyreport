/* AI PPT expression strategy planner: content semantics -> visual communication strategy. */
(function(root){
  "use strict";
  const STRATEGIES=[
    {id:"brand-opening",name:"品牌开场",roles:["cover"],layouts:["cover"],compositions:["cover-architectural"],anchor:"品牌主视觉",asset:"hero"},
    {id:"navigation-map",name:"汇报导航",roles:["agenda"],layouts:["agenda"],compositions:["agenda-modular"],anchor:"编号导航",asset:"none"},
    {id:"conclusion-first",name:"结论先行",roles:["decision","summary","section"],layouts:["statement","bullets"],compositions:["statement-focus","insight-sidebar"],anchor:"核心结论",asset:"icon"},
    {id:"kpi-dashboard",name:"关键指标看板",roles:["evidence","summary"],signals:["metrics"],layouts:["metric","kpi-tower"],compositions:["metric-hero-grid","metric-dashboard"],anchor:"核心数字",asset:"icon"},
    {id:"option-comparison",name:"方案对比",roles:["comparison","decision"],signals:["columns"],layouts:["comparison","two-column"],compositions:["comparison-editorial","compare-scorecard"],anchor:"差异结论",asset:"icon"},
    {id:"cause-effect",name:"因果链",roles:["analysis"],keywords:/原因|导致|驱动|影响|因果|形成/,layouts:["system-map","process"],compositions:["cause-effect-map","process-stair"],anchor:"因果关系",asset:"icon"},
    {id:"process-path",name:"流程路径",roles:["plan","decision"],keywords:/流程|步骤|路径|闭环/,signals:["steps"],layouts:["process","timeline"],compositions:["process-stair","timeline-roadmap"],anchor:"推进路径",asset:"icon"},
    {id:"milestone-roadmap",name:"里程碑时间轴",roles:["plan"],keywords:/时间|工期|节点|阶段|进度|年度|季度/,layouts:["timeline"],compositions:["timeline-roadmap"],anchor:"时间节点",asset:"none"},
    {id:"risk-heatmap",name:"风险与应对",roles:["risk","decision"],layouts:["risk","matrix"],compositions:["risk-response-grid","risk-matrix"],anchor:"风险等级",asset:"icon"},
    {id:"hierarchy-map",name:"层级关系",roles:["structure","analysis"],keywords:/体系|架构|层级|组织|关系|机制/,layouts:["system-map"],compositions:["system-orbit"],anchor:"中心关系",asset:"icon"},
    {id:"chart-insight",name:"图表加洞察",roles:["trend","evidence","comparison"],signals:["series"],layouts:["chart-line","chart-bar"],compositions:["chart-commentary"],anchor:"原生图表",asset:"chart"},
    {id:"data-table",name:"数据表与发现",roles:["detail","evidence"],signals:["table"],layouts:["table"],compositions:["table-insight"],anchor:"精确数据",asset:"table"},
    {id:"spatial-story",name:"区位与图片叙事",roles:["context","evidence"],signals:["image"],keywords:/区位|周边|现场|规划|建筑|效果图|地图/,layouts:["image-hero"],compositions:["image-judgement"],anchor:"项目图片",asset:"photo"},
    {id:"modular-insights",name:"模块化洞察",roles:["analysis","summary"],signals:["items"],layouts:["three-cards","bullets"],compositions:["three-insight-cards","insight-sidebar"],anchor:"结构化要点",asset:"icon"},
    {id:"decision-actions",name:"决策与行动",roles:["conclusion","decision"],layouts:["conclusion"],compositions:["decision-board"],anchor:"行动清单",asset:"none"}
  ];
  const clean=v=>String(v==null?"":v).trim();
  function facts(slide={}){
    const c=slide.content||{},text=[slide.title,slide.subtitle,slide.claim,slide.takeaway,...(slide.bullets||[])].filter(Boolean).join(" ");
    const metrics=Array.isArray(c.metrics)?c.metrics:[],series=Array.isArray(c.series)?c.series:[],rows=Array.isArray(c.rows)?c.rows:[],steps=Array.isArray(c.steps)?c.steps:[],columns=Array.isArray(c.columns)?c.columns:[],items=Array.isArray(c.items)?c.items:(slide.bullets||[]);
    let role=clean(slide.pageRole||slide.role||slide.type||"analysis");
    if(slide.type==="cover"||slide.layoutId==="cover")role="cover";else if(slide.type==="agenda"||slide.layoutId==="agenda")role="agenda";else if(slide.type==="conclusion"||slide.layoutId==="conclusion")role="conclusion";else if(/风险|问题|挑战|应对|对策/.test(text))role="risk";else if(/对比|比较|方案|差异|优劣/.test(text))role="comparison";else if(/趋势|同比|环比|历年|逐年/.test(text))role="trend";else if(/计划|工期|进度|路径|阶段|节点|流程/.test(text))role="plan";else if(/结论|建议|决策|行动|推荐/.test(text))role="decision";else if(metrics.length||series.length||rows.length)role="evidence";
    return{role,text,metrics,series,rows,steps,columns,items,hasImage:!!(c.image||(slide.assetPlan&&slide.assetPlan.status==="matched")),signals:{metrics:metrics.length>=2,series:series.length>=2,table:rows.length>0,steps:steps.length>=2,columns:columns.length===2,image:!!(c.image||(slide.assetPlan&&slide.assetPlan.status==="matched")),items:items.length>=2}};
  }
  function score(strategy,slide,context={}){
    const f=facts(slide);let value=0,reasons=[];
    if(strategy.roles.includes(f.role)){value+=42;reasons.push("页面角色匹配");}
    if(strategy.keywords&&strategy.keywords.test(f.text)){value+=26;reasons.push("主题语义匹配");}else if(strategy.keywords)value-=24;
    const signals=strategy.signals||[];if(signals.length){const hit=signals.filter(x=>f.signals[x]).length;value+=Math.round(hit/signals.length*28);if(hit===signals.length)reasons.push("数据形态匹配");}else value+=12;
    if(strategy.layouts.includes(slide.layoutId))value+=10;
    if(context.previousStrategyId===strategy.id)value-=18;
    if(strategy.asset==="photo")value+=f.hasImage?14:-20;
    if(root.PptDesignLearning&&root.PptDesignLearning.adjustment)value+=root.PptDesignLearning.adjustment("strategy",strategy.id,context);
    return{strategyId:strategy.id,name:strategy.name,score:Math.max(0,Math.min(100,value)),reasons};
  }
  function planSlide(slide={},context={}){
    const ranked=STRATEGIES.map(x=>({...x,...score(x,slide,context)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)),selected=ranked[0],f=facts(slide);
    const layoutId=(selected.layouts.includes(slide.layoutId)&&slide.layoutId)||selected.layouts[0],compositionId=selected.compositions[Math.min(selected.compositions.length-1,Math.max(0,(f.items.length||f.metrics.length||1)-3))]||selected.compositions[0];
    return{version:1,strategyId:selected.id,strategyName:selected.name,score:selected.score,role:f.role,layoutId,compositionId,visualAnchor:selected.anchor,assetRequirement:selected.asset,density:(f.text.length>280||f.items.length>6)?"high":(f.text.length<90&&f.items.length<=3)?"low":"medium",rationale:selected.reasons.join("；")||"按页面角色与内容形态选择",alternatives:ranked.slice(1,4).map(x=>({strategyId:x.id,name:x.name,score:x.score,layoutId:x.layouts[0],compositionId:x.compositions[0]}))};
  }
  function applyToDeck(plan={},opts={}){
    const out=opts.mutate?plan:JSON.parse(JSON.stringify(plan)),pages=opts.pages?new Set(opts.pages.map(Number)):null;let previous="";
    (out.slides||[]).forEach((slide,i)=>{if((pages&&!pages.has(i+1))||slide.locked){previous=slide.expressionStrategy&&slide.expressionStrategy.strategyId||previous;return;}const result=planSlide(slide,{previousStrategyId:previous});slide.expressionStrategy=result;if(!slide.layoutManual)slide.layoutId=result.layoutId;slide.visualPlan={...(slide.visualPlan||{}),version:2,engine:"design-ir-v2",compositionId:result.compositionId,density:result.density,visualAnchor:result.visualAnchor,assetStrategy:result.assetRequirement};previous=result.strategyId;});
    out.designPlanning={version:1,plannedAt:Date.now(),pageCount:(out.slides||[]).length,mode:"semantic-expression-strategy"};return out;
  }
  const api={strategies:STRATEGIES,facts,score,planSlide,applyToDeck};root.PptExpressionStrategy=api;if(root.document)root.document.documentElement.dataset.pptExpressionStrategy="loaded";if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
