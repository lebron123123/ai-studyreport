/* PPT quality benchmark v2: content substance + premium composition + real visual evidence. */
(function(root){
  "use strict";
  const GOLDEN=[
    ["cover","封面",["cover"]],["agenda","目录",["agenda"]],["decision","价值判断",["statement","bullets"]],
    ["metric","关键指标",["metric","kpi-tower"]],["comparison","方案对比",["comparison","two-column"]],
    ["timeline","时间轴",["timeline"]],["process","流程图",["process","system-map"]],["risk","风险",["risk","matrix"]],
    ["spatial","区位/图片",["image-hero"]],["financial","财务图表",["chart-bar","chart-line","table"]],
    ["recommendation","决策建议",["conclusion","statement"]],["closing","结束页",["conclusion"]]
  ].map(([id,name,layouts])=>({id,name,layouts}));
  const clamp=n=>Math.max(0,Math.min(100,Math.round(n)));
  const bodyText=slide=>[slide.claim,slide.takeaway,slide.subtitle,...(slide.bullets||[]),JSON.stringify(slide.content||{})].filter(Boolean).join(" ");
  function pageScore(slide,scene,index){
    const elements=scene&&scene.elements||[],textChars=bodyText(slide).replace(/[\s{}\[\]":,]/g,"").length,layout=slide.layoutId||slide.type,issues=[];
    const realImage=elements.some(x=>x.type==="image"&&String(x.dataUrl||"").length>2000),chart=elements.some(x=>x.type==="chart")||["chart-bar","chart-line"].includes(layout)&&((slide.content&&slide.content.series)||[]).length>=2,table=elements.some(x=>x.type==="table")||layout==="table"&&((slide.content&&slide.content.rows)||[]).length,diagram=["timeline","process","system-map","risk","matrix"].includes(layout)&&elements.length>=10,metric=["metric","kpi-tower"].includes(layout)&&((slide.content&&slide.content.metrics)||[]).filter(x=>/\d/.test(String(x.value||""))).length>=2,premium=Number(scene&&scene.version||0)>=3&&elements.length>=10;
    const evidenceGap=slide.contentStatus==="evidence-gap",anchor=realImage||chart||table||diagram||metric||premium;
    let score=20;if(textChars>=35)score+=20;else if(["cover","section"].includes(layout))score+=18;else issues.push("页面实质内容不足");if(textChars>=90)score+=8;if(premium)score+=22;if(anchor)score+=18;else issues.push("缺少真实视觉锚点");if(realImage||chart||table||metric)score+=10;if((slide.sources||[]).length)score+=6;if(evidenceGap){score=Math.min(score,62);issues.push("正式证据待补充");}if(!scene){score=Math.min(score,48);issues.push("未进入统一渲染层");}
    return{page:index+1,layoutId:layout,componentId:scene&&scene.meta&&scene.meta.componentId||"",elementCount:elements.length,textChars,realImage,chart:!!chart,table:!!table,diagram,metric,premium,anchor,score:clamp(score),issues};
  }
  function inspect(plan={}){
    const slides=plan.slides||[],layouts=new Set(slides.map(x=>x.layoutId)),covered=GOLDEN.filter(g=>g.layouts.some(x=>layouts.has(x))),details=slides.map((slide,i)=>pageScore(slide,root.PptDesignIR&&root.PptDesignIR.buildScene?root.PptDesignIR.buildScene(slide,plan,i):null,i)),issues=[];
    details.forEach(d=>d.issues.forEach(message=>issues.push({page:d.page,code:message==="页面实质内容不足"?"substance_missing":message==="正式证据待补充"?"evidence_gap":"visual_anchor_missing",severity:message==="页面实质内容不足"?"error":"warning",message})));
    const comps=slides.map(s=>s.visualPlan&&s.visualPlan.componentId||s.visualPlan&&s.visualPlan.compositionId||s.layoutId),unique=new Set(comps),repeatPairs=comps.slice(1).filter((x,i)=>x===comps[i]).length;if(repeatPairs>=2)issues.push({page:0,code:"consecutive_repetition",severity:"warning",message:"连续页面构图重复，整套节奏单一"});
    const coverage=clamp(covered.length/GOLDEN.length*100),pageQuality=clamp(details.reduce((n,x)=>n+x.score,0)/Math.max(1,details.length)),variety=clamp(unique.size/Math.max(1,Math.min(slides.length,8))*100),visualEvidence=clamp(details.filter(x=>x.realImage||x.chart||x.table||x.metric||x.diagram).length/Math.max(1,details.length)*100),score=clamp(coverage*.15+pageQuality*.45+variety*.2+visualEvidence*.2);
    const errors=issues.filter(x=>x.severity==="error").length;return{ok:errors===0&&score>=70,score,grade:score>=88?"A":score>=78?"B":score>=68?"C":"D",dimensions:{goldenCoverage:coverage,pageQuality,variety,visualEvidence},coveredTypes:covered.map(x=>x.id),missingTypes:GOLDEN.filter(x=>!covered.includes(x)).map(x=>x.id),details,issues,checkedAt:Date.now(),mode:"content+premium-render+evidence"};
  }
  function buildSuite(){return GOLDEN.map((g,i)=>({id:"golden_"+(i+1),name:g.name,acceptedLayouts:g.layouts.slice(),checks:["内容充实且不编造","真实视觉锚点","高级构图组件","预览导出一致","无溢出遮挡","来源可追溯"]}));}
  const api={goldenTypes:GOLDEN,buildSuite,inspect};root.PptQualityBenchmark=api;if(root.document)root.document.documentElement.dataset.pptQualityBenchmark="v2";if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
