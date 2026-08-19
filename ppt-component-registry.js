/* AI PPT 正式组件注册表v1：组件意图、来源页、容量与可解释选型。 */
(function(root){
  "use strict";
  const COMPONENTS=[
    ["brand-cover","品牌封面","cover","cover",["cover"],[],0,0,[1,2]],
    ["section-statement","章节幕","section","statement",["section"],[],0,2,[3,4,5,6]],
    ["executive-takeaway","一句话结论","statement","statement",["summary","decision"],[],0,2,[57]],
    ["agenda-grid","目录导航","agenda","index",["agenda"],["items"],3,6,[7,8]],
    ["insight-list","结构化要点","bullets","list",["evidence","analysis"],["items"],2,6,[9,10]],
    ["metric-cards","核心指标卡","metric","metric",["evidence","summary"],["metrics"],2,4,[24,119]],
    ["kpi-tower","KPI高低差异","kpi-tower","metric",["evidence","comparison"],["metrics"],3,4,[24]],
    ["comparison-columns","双栏对比","comparison","compare",["comparison","decision"],["columns"],2,6,[19,28]],
    ["parallel-columns","双栏信息","two-column","compare",["analysis","evidence"],["columns"],2,8,[30,35]],
    ["three-insight-cards","三项洞察卡","three-cards","cards",["analysis","summary"],["items"],3,3,[77,100,101]],
    ["milestone-timeline","里程碑时间轴","timeline","timeline",["process","plan"],["steps"],3,6,[17,20,21]],
    ["process-path","实施流程路径","process","process",["process","decision"],["steps"],3,6,[50]],
    ["matrix-2x2","四象限矩阵","matrix","matrix",["analysis","comparison"],["items"],4,4,[72,75]],
    ["risk-response","风险影响对策","risk","risk",["risk","decision"],["items"],2,4,[85,105]],
    ["system-relationship","系统关系图","system-map","diagram",["structure","analysis"],["items"],3,6,[67,91]],
    ["native-bar","原生柱状图","chart-bar","chart",["evidence","comparison"],["series"],2,10,[119,121]],
    ["native-line","原生趋势图","chart-line","chart",["trend","evidence"],["series"],3,12,[145]],
    ["data-table","原生数据表","table","table",["evidence","detail"],["table"],2,8,[16,22,23,25]],
    ["image-judgement","大图判断","image-hero","image",["context","evidence"],["image"],1,3,[9,19]],
    ["decision-actions","决策与行动","conclusion","decision",["conclusion","decision"],["items"],2,5,[159,160]],
    ["chart-with-insight","图表与洞察","chart-bar","chart-insight",["evidence","analysis"],["series","commentary"],2,8,[119,121,145]],
    ["gantt-investment","甘特与投资计划","timeline","timeline",["plan","evidence"],["steps","metrics"],3,8,[17,20,21]],
    ["evidence-table","表格与关键发现","table","table",["evidence","analysis"],["table","commentary"],2,8,[16,22,23,25]],
    ["decision-comparison","方案比选与建议","comparison","compare",["comparison","decision"],["columns","commentary"],2,6,[19,28,30]]
  ].map(([id,name,layoutId,family,roles,signals,minItems,maxItems,sourcePages])=>({id,name,layoutId,family,roles,signals,minItems,maxItems,sourcePages,status:"active",version:1}));
  const PREMIUM=[
    ["premium-cover","高级品牌封面","cover","premium-cover",["cover"],[],0,0,[1,2]],
    ["premium-agenda","战略目录导航","agenda","premium-agenda",["agenda"],["items"],3,6,[7,8]],
    ["premium-verdict","高管结论页","statement","premium-verdict",["summary","decision"],["items"],1,3,[57,58]],
    ["premium-insight","非对称洞察页","bullets","premium-insight",["analysis","evidence","decision"],["items"],2,5,[57,63]],
    ["premium-metrics","指标与判断组合","metric","premium-metrics",["evidence","summary"],["metrics"],2,4,[85,100]],
    ["premium-compare","推荐型方案对比","comparison","premium-compare",["comparison","decision"],["columns"],2,8,[57,72]],
    ["premium-roadmap","里程碑路线图","timeline","premium-roadmap",["plan"],["steps"],3,6,[28,50]],
    ["premium-risk","风险优先级面板","risk","premium-risk",["risk","decision"],["items"],3,4,[105,106]],
    ["premium-chart","图表与决策结论","chart-bar","premium-chart",["evidence","comparison"],["series"],2,10,[119,121]],
    ["premium-chart-line","趋势图与决策结论","chart-line","premium-chart",["evidence","trend","comparison"],["series"],3,12,[145]],
    ["premium-table","数据表与发现侧栏","table","premium-table",["evidence","detail"],["table"],2,8,[16,22]],
    ["premium-image","项目图片与判断","image-hero","premium-image",["context","evidence"],["image"],1,4,[9,19]],
    ["premium-decision","决策行动收束页","conclusion","premium-decision",["conclusion","decision"],["items"],2,4,[159,160]]
  ].map(([id,name,layoutId,family,roles,signals,minItems,maxItems,sourcePages])=>({id,name,layoutId,family,roles,signals,minItems,maxItems,sourcePages,status:"active",version:3,premium:true}));
  COMPONENTS.push(...PREMIUM);
  const byId=new Map(COMPONENTS.map(x=>[x.id,x]));
  function numeric(value){return Number.isFinite(Number(String(value==null?"":value).replace(/[^\d.-]/g,"")));}
  function shapeOf(slide={}){
    const c=slide.content||{},items=Array.isArray(c.items)?c.items:(slide.bullets||[]),metrics=Array.isArray(c.metrics)?c.metrics:[],series=Array.isArray(c.series)?c.series:[],rows=Array.isArray(c.rows)?c.rows:[],steps=Array.isArray(c.steps)?c.steps:[];
    const text=[slide.title,slide.subtitle,slide.claim,slide.takeaway,...(slide.bullets||[])].filter(Boolean).join(" ");
    let role=slide.type==="cover"?"cover":slide.type==="section"?"section":slide.type==="conclusion"?"conclusion":"analysis";
    if(/风险|问题|难点|应对|对策/.test(text))role="risk";else if(/对比|比较|方案.{0,8}(选择|比选)|差异|优劣/.test(text))role="comparison";else if(/工期|进度|计划|阶段|节点|流程|步骤/.test(text))role="plan";else if(/趋势|同比|环比|历年|逐年/.test(text))role="trend";else if(/结论|建议|决策|行动/.test(text))role="decision";else if(metrics.length||series.length||rows.length)role="evidence";
    return{role,text,items,metrics,series,rows,steps,hasImage:typeof c.image==="string"&&c.image.length>20,numericMetrics:metrics.filter(x=>numeric(x&&x.value)).length};
  }
  function signalMatch(signal,s){
    if(signal==="items")return s.items.length>0;if(signal==="metrics")return s.numericMetrics>=2;if(signal==="series")return s.series.filter(x=>numeric(x&&x.value)).length>=2;if(signal==="table")return s.rows.length>0;if(signal==="steps")return s.steps.length>=2||s.items.length>=3;if(signal==="image")return s.hasImage;if(signal==="columns")return/对比|比较|方案|差异|两类|两种/.test(s.text)||s.items.length>=2;if(signal==="commentary")return!!s.text;return true;
  }
  function score(component,slide,context={}){
    const s=shapeOf(slide),count=Math.max(s.items.length,s.metrics.length,s.series.length,s.rows.length,s.steps.length),reasons=[];let value=0;
    if(component.premium){value+=14;reasons.push("高级组件优先");}
    if(component.roles.includes(s.role)){value+=34;reasons.push("页面角色匹配");}
    const matched=component.signals.filter(x=>signalMatch(x,s)).length;if(component.signals.length){value+=Math.round(matched/component.signals.length*30);if(matched===component.signals.length)reasons.push("数据形态匹配");}
    else value+=18;
    if((!component.minItems||count>=component.minItems)&&(!component.maxItems||count<=component.maxItems)){value+=18;reasons.push("内容容量合适");}else if(component.maxItems&&count>component.maxItems)value-=Math.min(24,(count-component.maxItems)*6);
    if(slide.layoutId===component.layoutId)value+=8;
    if(context.previousLayout&&context.previousLayout===component.layoutId)value-=12;
    if(root.PptDesignLearning&&root.PptDesignLearning.adjustment)value+=root.PptDesignLearning.adjustment("component",component.id,context);
    if(component.family==="chart"&&s.series.length<2)value-=40;if(component.family==="table"&&!s.rows.length)value-=40;if(component.family==="image"&&!s.hasImage)value-=35;
    return{componentId:component.id,name:component.name,layoutId:component.layoutId,score:Math.max(0,Math.min(100,value)),reasons,sourcePages:component.sourcePages};
  }
  function eligible(component,slide={}){
    const type=slide.type||"content";
    if(type==="cover")return component.roles.includes("cover");
    if(type==="section")return component.roles.includes("section");
    if(type==="agenda")return component.roles.includes("agenda");
    if(type==="conclusion")return component.roles.includes("conclusion")||component.roles.includes("decision");
    return !component.roles.some(x=>["cover","section","agenda","conclusion"].includes(x));
  }
  function recommend(slide,context={}){const candidates=COMPONENTS.filter(x=>x.status==="active"&&eligible(x,slide)).map(x=>score(x,slide,context)).sort((a,b)=>b.score-a.score||a.componentId.localeCompare(b.componentId));return{selected:candidates[0]||null,candidates:candidates.slice(0,3)};}
  function get(id){return byId.get(id)||null;}
  const api={components:COMPONENTS,get,shapeOf,score,eligible,recommend};root.PptComponentRegistry=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
