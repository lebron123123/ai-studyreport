/* AI PPT content director: evidence -> page brief -> visual-ready content. */
(function(root){
  "use strict";
  const clean=(v,n=1000)=>String(v==null?"":v).replace(/\s+/g," ").trim().slice(0,n);
  const clone=x=>JSON.parse(JSON.stringify(x==null?{}:x));
  const sentenceList=text=>String(text||"").replace(/\r/g,"").split(/\n+|(?<=[。！？；])/).map(x=>clean(x,260)).filter(x=>x.length>=8);
  const words=text=>clean(text,500).split(/[\s、，。；：:（）()\[\]【】/]+/).filter(x=>x.length>=2);
  const numeric=v=>/[-+]?\d[\d,.]*(?:%|亿元|万元|元|㎡|m²|年|月|个|户|套|公里|km)?/i.test(String(v||""));
  const semanticTokens=text=>{const base=words(text),out=base.slice();base.forEach(token=>{if(/^[\u3400-\u9fff]+$/.test(token)&&token.length>=4){for(let size=2;size<=Math.min(4,token.length);size++)for(let i=0;i<=token.length-size;i++)out.push(token.slice(i,i+size));}});return Array.from(new Set(out));};
  function sourceText(plan={}){
    const assets=((plan.evidencePack&&plan.evidencePack.assets)||[]).filter(x=>x.kind!=="image");
    return [plan.sourceText,...assets.map(x=>x.text)].filter(Boolean).join("\n").slice(0,160000);
  }
  function relevantSentences(slide,plan,limit=6){
    const titleWords=new Set(semanticTokens([slide.title,slide.subtitle,slide.claim].filter(Boolean).join(" "))),all=sentenceList(sourceText(plan));
    return all.map((text,index)=>{let score=0;for(const w of titleWords)if(text.includes(w))score+=4;if(numeric(text))score+=1;if(/项目|投资|需求|建设|实施|风险|市场|结论/.test(text))score+=1;return{text,index,score};}).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(x=>x.text);
  }
  function factsFor(slide,plan,limit=4){
    const all=(plan.evidencePack&&plan.evidencePack.facts)||[],tokens=semanticTokens(slide.title),ranked=all.map((f,index)=>{const text=clean(f.statement,260);let score=numeric(text)?1:0;tokens.forEach(t=>{if(text.includes(t))score+=4;});return{f,index,score};}).sort((a,b)=>b.score-a.score||a.index-b.index);
    return ranked.slice(0,limit).map(x=>x.f);
  }
  function labelDetail(text,index){
    const raw=clean(text,220),parts=raw.split(/[：:；;]/),label=clean(parts.shift(),26)||("要点 "+(index+1)),detail=clean(parts.join("；"),170)||raw;
    return{label,text:detail};
  }
  function evidenceGap(slide){
    const map={
      metric:["关键指标数值及统计期","指标口径与计算公式","数字对应的原始文件位置"],
      "chart-bar":["至少两个可比较的数据点","横纵轴口径及单位","数据来源与统计期"],
      "chart-line":["至少三个连续时期数据","趋势口径与基期","异常波动原因"],
      "image-hero":["项目区位图或现场照片","图片拍摄/形成时间","图片所支撑的判断"],
      comparison:["两个备选方案的统一比较口径","成本、进度和风险差异","推荐方案及理由"],
      timeline:["阶段起止时间","关键里程碑与责任主体","前后置条件"],
      risk:["风险事件及触发条件","影响程度与发生概率","责任人和应对动作"]
    };
    return (map[slide.layoutId]||["支撑本页判断的正式材料","可核验的事实或数字","结论适用边界"]).map((text,i)=>({label:"待补充 "+String(i+1).padStart(2,"0"),text}));
  }
  function pageRole(slide={}){
    if(slide.type==="cover"||slide.layoutId==="cover")return"cover";
    if(slide.type==="conclusion"||slide.layoutId==="conclusion")return"decision";
    if(["metric","chart-bar","chart-line","table"].includes(slide.layoutId))return"evidence";
    if(["comparison","two-column","risk","matrix"].includes(slide.layoutId))return"decision";
    if(["timeline","process"].includes(slide.layoutId))return"plan";
    if(slide.layoutId==="image-hero")return"context";
    return"analysis";
  }
  function recommendLayout(slide={},plan={},index=0){
    const current=slide.layoutId||slide.type||"bullets",heading=clean([slide.title,slide.subtitle,slide.claim].join(" "),500),body=clean((slide.bullets||[]).join(" "),1200),text=clean(heading+" "+body,1600),numericCount=(text.match(/[-+]?\d[\d,.]*(?:%|亿元|万元|元|㎡|m2|年|月|季度|个)?/gi)||[]).length;
    if(index===0&&(slide.type==="cover"||current==="cover"))return"cover";
    const titleHas=(...terms)=>terms.some(term=>heading.includes(term));
    if(titleHas("目录","议程","汇报结构","讨论顺序"))return"agenda";
    if(titleHas("对比","比较","方案差异","路径差异"))return"comparison";
    if(titleHas("指标","核心数据","关键数据","经营数据"))return"metric";
    if(titleHas("项目定位","实施条件","建设条件","政策目标"))return"two-column";
    if(titleHas("项目背景","项目目标","项目概况","建设背景"))return"bullets";
    if(titleHas("市场","需求","客群","人口"))return numericCount>=2?"chart-bar":"bullets";
    if(titleHas("风险","不确定性","问题清单","应对措施"))return"risk";
    if(titleHas("工期","里程碑","进度","节点","实施计划"))return"timeline";
    if(titleHas("流程","闭环","步骤","机制"))return"process";
    if((index===(plan.slides||[]).length-1&&slide.type==="conclusion")||current==="conclusion"&&index===(plan.slides||[]).length-1||/结论|建议|下一步|行动/.test(slide.title||""))return"conclusion";
    if(/目录|议程|汇报内容|汇报结构|讨论顺序|决策问题/.test(heading)||(index===1&&/问题|结构/.test(heading)))return"agenda";
    if(/对比|比较|方案.{0,5}(A|B|一|二)|路径差异|优劣/.test(heading))return"comparison";
    if(/指标|核心数据|关键数据|一页读懂|经营数据/.test(heading))return"metric";
    if(/项目定位|实施条件|建设条件|政策目标/.test(heading))return"two-column";
    if(/项目背景|项目目标|项目概况|建设背景/.test(heading))return"bullets";
    if(/市场|需求|客群|人口/.test(heading))return numericCount>=2?"chart-bar":"bullets";
    if(/风险|不确定性|问题清单|应对/.test(heading))return"risk";
    if(/工期|阶段|里程碑|进度|节点|实施计划/.test(heading))return"timeline";
    if(/趋势|逐年|年度变化|增长|下降|分布|占比/.test(heading)&&numericCount>=2)return"chart-bar";
    if(/区位|效果图|现场|建筑形象|空间|图片/.test(heading)&&((plan.evidencePack&&plan.evidencePack.assets)||[]).some(a=>a.kind==="image"&&a.dataUrl))return"image-hero";
    if(/对比|比较|方案.{0,5}(A|B|一|二)/.test(body))return"comparison";
    if((body.match(/风险|应对/g)||[]).length>=2)return"risk";
    if((body.match(/阶段|里程碑|节点/g)||[]).length>=2)return"timeline";
    if(/趋势|逐年|增长|下降|分布|占比/.test(body)&&numericCount>=3)return"chart-bar";
    return ["cover","conclusion","section","statement"].includes(current)&&index>0?"bullets":current;
  }
  function selectProjectImage(slide={},plan={},index=0){
    const images=((plan.evidencePack&&plan.evidencePack.assets)||[]).filter(a=>a.kind==="image"&&a.dataUrl);if(!images.length)return null;
    const tokens=semanticTokens([slide.title,slide.subtitle,slide.claim].join(" "));
    const ranked=images.map((asset,order)=>{const hay=clean([asset.name,asset.title,asset.alt,asset.caption,(asset.tags||[]).join(" ")].join(" "),500);let score=0;tokens.forEach(t=>{if(hay.includes(t))score+=4;});if(/效果|建筑|区位|现场|项目/.test(hay))score+=1;return{asset,score,order};}).sort((a,b)=>b.score-a.score||a.order-b.order);
    return ranked[index%Math.max(1,Math.min(3,ranked.length))].asset;
  }
  function componentId(layout){return({cover:"premium-cover",agenda:"premium-agenda",statement:"premium-verdict",section:"premium-section",bullets:"premium-insight",metric:"premium-metrics","kpi-tower":"premium-metrics",comparison:"premium-compare","two-column":"premium-compare",timeline:"premium-roadmap",process:"premium-process",risk:"premium-risk",matrix:"premium-risk","chart-bar":"premium-chart","chart-line":"premium-chart",table:"premium-table","image-hero":"premium-image",conclusion:"premium-decision","three-cards":"premium-insight","system-map":"premium-system"})[layout]||"premium-insight";}
  function layoutCompatible(suggested,current){const groups={agenda:["agenda"],comparison:["comparison","two-column","table"],metric:["metric","kpi-tower","chart-bar","chart-line","table"],"two-column":["two-column","comparison","bullets"],bullets:["bullets","three-cards","statement","image-hero"],"chart-bar":["chart-bar","chart-line","metric","table"],risk:["risk","matrix"],timeline:["timeline"],process:["process","system-map"]};return (groups[suggested]||[suggested]).includes(current);}
  function enrichSlide(input={},plan={},index=0){
    let forcedRiskGap=false;
    const slide=clone(input),c=slide.content&&typeof slide.content==="object"?slide.content:{};slide.content=c;
    const suggested=recommendLayout(slide,plan,index),currentLayout=slide.layoutId||slide.type||"bullets",structuralMismatch=(index>0&&currentLayout==="cover")||(index<(plan.slides||[]).length-1&&currentLayout==="conclusion"),overusedStatement=index>1&&currentLayout==="statement"&&!/结论|建议|决策|推荐|判断/.test([slide.title,slide.claim].join(" "));
    if(!slide.locked&&(["","content","bullets","three-cards"].includes(currentLayout)||structuralMismatch||overusedStatement)&&suggested!==slide.layoutId){slide.layoutId=suggested;slide.type=suggested==="cover"?"cover":suggested==="conclusion"?"conclusion":"content";slide.visualPlan={...(slide.visualPlan||{}),layoutReason:structuralMismatch?"修复中间页误用封面/结论版式":"依据标题、数字密度和表达任务自动选择"};}
    const explicitTitleRoute=!slide.layoutManual&&suggested!==slide.layoutId&&!layoutCompatible(suggested,slide.layoutId)&&["目录","议程","汇报结构","讨论顺序","对比","比较","指标","核心数据","关键数据","项目定位","实施条件","项目背景","项目目标","项目概况","市场","需求","客群","人口","风险","不确定性","工期","里程碑","进度","节点","流程","闭环","步骤","机制"].some(term=>[slide.title,slide.subtitle].join(" ").includes(term));
    if(!slide.locked&&explicitTitleRoute){slide.layoutId=suggested;slide.type=suggested==="cover"?"cover":suggested==="conclusion"?"conclusion":"content";slide.visualPlan={...(slide.visualPlan||{}),layoutReason:"按明确标题语义纠正旧版式"};}
    const relevant=relevantSentences(slide,plan,8),facts=factsFor(slide,plan,6),existing=Array.from(new Set([...(slide.bullets||[]),...(Array.isArray(c.items)?c.items.map(x=>typeof x==="string"?x:(x&&x.text)||(x&&x.label)||""):[])].filter(Boolean))),riskSignal=/风险|波动|延误|超支|不确定|合规|安全|缺口|不足|下降|超期|应对|预警|控制/,riskMatches=existing.filter(x=>riskSignal.test(x)),riskRetarget=!slide.layoutManual&&slide.layoutId==="risk"&&existing.length&&riskMatches.length<Math.min(2,existing.length);
    if(riskRetarget){const matched=relevant.filter(x=>riskSignal.test(x));slide.bullets=matched.slice(0,5);delete c.items;delete c.steps;delete c.columns;if(!matched.length){forcedRiskGap=true;c.items=evidenceGap(slide);slide.bullets=c.items.map(x=>x.text);slide.claim="当前正式材料没有足够的风险证据，本页先明确补充清单";}slide.visualPlan={...(slide.visualPlan||{}),contentReason:matched.length?"风险页已按风险语义重新召回正式材料":"风险页无相关证据，转为待补清单"};}
    else if(slide.layoutId==="risk"&&!existing.length){const matched=relevant.filter(x=>riskSignal.test(x));if(matched.length)slide.bullets=matched.slice(0,5);else{forcedRiskGap=true;c.items=evidenceGap(slide);slide.bullets=c.items.map(x=>x.text);slide.claim="当前正式材料没有足够的风险证据，本页先明确补充清单";}}
    else if(!existing.length&&relevant.length)slide.bullets=relevant.slice(0,5);
    else slide.bullets=existing;
    const hasBody=slide.bullets.length||Object.values(c).some(v=>Array.isArray(v)?v.length:!!v);
    if(!hasBody&&!(["cover","section"].includes(slide.layoutId))){
      c.items=evidenceGap(slide);slide.bullets=c.items.map(x=>x.text);slide.contentStatus="evidence-gap";
      if(!slide.claim)slide.claim="当前材料尚不足以形成可靠判断，本页先明确补数清单";
    }else slide.contentStatus=forcedRiskGap?"evidence-gap":"ready";
    if(["metric","kpi-tower"].includes(slide.layoutId)&&!(c.metrics||[]).length&&facts.length){
      c.metrics=facts.slice(0,4).map((f,i)=>({label:clean(f.statement,24)||("指标 "+(i+1)),value:(f.values||[])[0]||"待核验",text:clean(f.statement,110),source:f.sourceLabel||f.locator||""}));
    }
    if(["timeline","process"].includes(slide.layoutId)&&!(c.steps||[]).length)c.steps=(slide.bullets||[]).slice(0,6).map(labelDetail);
    if(["comparison","two-column"].includes(slide.layoutId)&&!(c.columns||[]).length){
      const rows=(slide.bullets||[]).slice(0,8),mid=Math.max(1,Math.ceil(rows.length/2));c.columns=[{title:"方案 A｜稳健路径",items:rows.slice(0,mid)},{title:"方案 B｜增强路径",items:rows.slice(mid)}];
    }
    if(["risk","matrix","three-cards","system-map","bullets"].includes(slide.layoutId)&&!(c.items||[]).length)c.items=(slide.bullets||[]).slice(0,6).map(labelDetail);
    if(["chart-bar","chart-line"].includes(slide.layoutId)&&!(c.series||[]).length){
      const metricFacts=facts.filter(f=>(f.values||[]).length).slice(0,6);if(metricFacts.length>=2)c.series=metricFacts.map((f,i)=>({label:clean(f.statement,18)||("数据 "+(i+1)),value:(f.values||[])[0],source:f.sourceLabel||f.locator||""}));
    }
    const selectedImage=selectProjectImage(slide,plan,index),imageLayouts=["cover","image-hero","metric","kpi-tower"];
    if(imageLayouts.includes(slide.layoutId)&&!c.image&&selectedImage){c.image=selectedImage.dataUrl;c.imageSource=selectedImage.name;slide.assetPlan={status:"matched",kind:"project-image",assetId:selectedImage.id||selectedImage.name,sourceRef:selectedImage.name,provider:"project-assets",matchReason:"按页面主题与素材名称匹配"};slide.sources=Array.from(new Set([...(slide.sources||[]),selectedImage.name].filter(Boolean)));}
    const criticalMissing=(slide.layoutId==="image-hero"&&!c.image)||(["chart-bar","chart-line"].includes(slide.layoutId)&&(!Array.isArray(c.series)||c.series.length<2))||(slide.layoutId==="table"&&(!Array.isArray(c.headers)||!Array.isArray(c.rows)||!c.rows.length))||(["metric","kpi-tower"].includes(slide.layoutId)&&(!Array.isArray(c.metrics)||c.metrics.filter(x=>/\d/.test(String(x&&x.value||""))).length<2));
    if(criticalMissing){c.items=evidenceGap(slide);slide.contentStatus="evidence-gap";if(!slide.claim)slide.claim="当前材料尚不足以形成可靠判断，本页先明确补数清单";}
    if(!slide.claim&&slide.bullets.length)slide.claim=clean(slide.bullets[0],150);
    slide.pageRole=pageRole(slide);slide.designBrief={version:3,communicationJob:slide.job||("用一页完成“"+clean(slide.title,45)+"”的判断"),singleTakeaway:slide.claim||slide.takeaway||slide.title,evidenceNeeded:facts.slice(0,4).map(f=>({statement:f.statement,values:f.values,source:f.sourceLabel,locator:f.locator})),visualForm:slide.layoutId,visualAnchor:["metric","kpi-tower"].includes(slide.layoutId)?"核心数字":["chart-bar","chart-line"].includes(slide.layoutId)?"趋势与差异":slide.layoutId==="image-hero"?"项目图片":slide.layoutId==="timeline"?"里程碑":slide.layoutId==="process"?"流程闭环":"结论与结构",assetRequirement:slide.layoutId==="image-hero"?"project-photo":["chart-bar","chart-line"].includes(slide.layoutId)?"native-chart":"editable-component",missingEvidence:slide.contentStatus==="evidence-gap"?c.items.map(x=>x.text):[],componentId:componentId(slide.layoutId),sourcePages:(slide.visualPlan&&slide.visualPlan.sourcePages)||[]};
    slide.visualPlan={...(slide.visualPlan||{}),version:3,engine:"premium-design-ir",componentId:slide.designBrief.componentId,compositionId:slide.designBrief.componentId,visualAnchor:slide.designBrief.visualAnchor,assetStrategy:slide.designBrief.assetRequirement};
    return slide;
  }
  function applyToDeck(input={},opts={}){const plan=opts.mutate?input:clone(input);plan.slides=(plan.slides||[]).map((s,i)=>s.locked&&!opts.force?s:enrichSlide(s,plan,i));plan.contentDirection={version:7,preparedAt:Date.now(),readyPages:plan.slides.filter(x=>x.contentStatus!=="evidence-gap").length,gapPages:plan.slides.filter(x=>x.contentStatus==="evidence-gap").length,totalPages:plan.slides.length};return plan;}
  function coverage(plan={}){const slides=plan.slides||[],ready=slides.filter(s=>s.contentStatus!=="evidence-gap"),briefs=slides.filter(s=>s.designBrief);return{total:slides.length,ready:ready.length,gaps:slides.length-ready.length,briefCoverage:slides.length?Math.round(briefs.length/slides.length*100):0,visualReady:slides.filter(s=>s.visualPlan&&s.visualPlan.componentId).length};}
  const api={sourceText,relevantSentences,factsFor,evidenceGap,recommendLayout,selectProjectImage,enrichSlide,applyToDeck,coverage,componentId};root.PptContentDirector=api;if(root.document)root.document.documentElement.dataset.pptContentDirector="loaded";if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
