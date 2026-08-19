/* AI PPT 核心：材料→故事线→设计规格→页面节奏→锁定版式→质量检查。 */
(function(root){
  "use strict";

  if(!root.PptContentDirector&&typeof require==="function"){try{root.PptContentDirector=require("./ppt-content-director.js");}catch(e){}}

  const TEMPLATE_PRESETS=[
    {id:"anju-blue",name:"安居蓝图｜品牌汇报",accent:"2387C7",secondary:"70C5DE",background:"F4F9FD",text:"173F63",description:"保障房、项目进展与经营管理汇报",design:{motif:"城市蓝图与空间网格",density:"medium",titleFont:"Microsoft YaHei",bodyFont:"Microsoft YaHei",chartColors:["2387C7","70C5DE","173F63","8EB6D1"]}},
    {id:"gov-clean",name:"政务简洁｜审查决策",accent:"1F4E78",secondary:"A77728",background:"FFFFFF",text:"1E2F3D",description:"领导决策、正式评审与制度汇报",design:{motif:"克制留白与章序编号",density:"medium",titleFont:"Microsoft YaHei",bodyFont:"Microsoft YaHei",chartColors:["1F4E78","6D8FA8","A77728","B9C9D5"]}},
    {id:"data-light",name:"数据决策｜测算分析",accent:"167D8D",secondary:"E09F3E",background:"F3F8F9",text:"20384B",description:"财务测算、人口、职住与需求分析",design:{motif:"数据坐标与关键数字",density:"high",titleFont:"Microsoft YaHei",bodyFont:"Microsoft YaHei",chartColors:["167D8D","49A6B1","E09F3E","8BC3C8"]}}
  ];
  if(root.PptDesignTokens&&root.PptDesignTokens.toTemplatePreset)TEMPLATE_PRESETS.push(root.PptDesignTokens.toTemplatePreset("business-blue-160"));
  const clean=(v,n=4000)=>String(v==null?"":v).replace(/\r/g,"").trim().slice(0,n);
  const makeId=(prefix="slide")=>prefix+"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  function bullets(text,limit=5){return clean(text,12000).split(/\n|[。；;]+/).map(x=>x.replace(/^[-*•\d.、\s]+/,"").trim()).filter(x=>x.length>3).slice(0,limit);}
  function sourceSections(text){
    const lines=clean(text,50000).split("\n"),out=[];let current=null;
    for(const line of lines){const m=line.match(/^\s*(?:#{1,4}\s+|[一二三四五六七八九十]+[、.]|\d+(?:\.\d+)*[、.\s]+)(.+)$/);if(m){if(current)out.push(current);current={title:clean(m[1],80),body:""};}else if(current)current.body+=(current.body?"\n":"")+line;}
    if(current)out.push(current);return out;
  }
  function preset(id){return TEMPLATE_PRESETS.find(x=>x.id===id)||TEMPLATE_PRESETS[0];}
  function normalizeDesignSpec(input={},templateId="anju-blue"){
    const base=preset(templateId),src=input&&typeof input==="object"?input:{};
    return {version:1,direction:base.id,brandName:clean(src.brandName,80)||"深圳市安居集团",logo:clean(src.logo,500),accent:clean(src.accent,6)||base.accent,secondary:clean(src.secondary,6)||base.secondary,background:clean(src.background,6)||base.background,text:clean(src.text,6)||base.text,motif:clean(src.motif,100)||base.design.motif,density:["low","medium","high"].includes(src.density)?src.density:base.design.density,titleFont:clean(src.titleFont,80)||base.design.titleFont,bodyFont:clean(src.bodyFont,80)||base.design.bodyFont,chartColors:Array.isArray(src.chartColors)&&src.chartColors.length?src.chartColors.slice(0,8):base.design.chartColors.slice(),minBodyPt:Math.max(12,Number(src.minBodyPt)||14),minCaptionPt:Math.max(9,Number(src.minCaptionPt)||10)};
  }
  const LAYOUT_SEQUENCE=["statement","metric","two-column","chart-bar","timeline","risk","system-map","table","three-cards","process"];
  function recommendLayout(section,index){
    const text=((section&&section.title)||"")+" "+((section&&section.body)||"");
    if(/风险|问题|对策|不确定/.test(text))return"risk";
    if(/进度|工期|计划|阶段|节点|时间/.test(text))return"timeline";
    if(/流程|路径|步骤|机制/.test(text))return"process";
    if(/对比|比较|方案|优劣|变化/.test(text))return"comparison";
    if(/指标|规模|投资|收益|人口|需求|数据|测算/.test(text))return index%2?"metric":"chart-bar";
    if(/体系|关系|结构|协同|主体/.test(text))return"system-map";
    return LAYOUT_SEQUENCE[index%LAYOUT_SEQUENCE.length];
  }
  function defaultOutline(sourceText,slideCount=8){
    const sections=sourceSections(sourceText),plain=bullets(sourceText,40),n=Math.max(5,Math.min(20,Number(slideCount)||8));
    const slides=[{type:"cover",layoutId:"cover",title:"项目决策汇报",subtitle:"基于正式材料形成的项目判断",bullets:[]}];
    slides.push({type:"content",layoutId:"statement",title:"本次汇报聚焦项目价值、关键数据与推进决策",subtitle:"先给结论，再用证据和测算逐层支撑"});
    const room=n-3;
    if(sections.length){sections.slice(0,room).forEach((s,i)=>slides.push({type:"content",layoutId:recommendLayout(s,i),title:s.title,claim:bullets(s.body,1)[0]||"",bullets:bullets(s.body,5)}));}
    else{const names=["项目背景与目标","项目定位与实施条件","关键指标与测算判断","需求与市场分析","实施路径与进度","风险及应对","决策事项与责任分工"];for(let i=0;i<room;i++)slides.push({type:"content",layoutId:LAYOUT_SEQUENCE[(i+1)%LAYOUT_SEQUENCE.length],title:names[i]||("专题分析 "+(i+1)),bullets:plain.slice(i*4,i*4+4)});}
    while(slides.length<n-1){const i=slides.length;slides.push({type:"content",layoutId:LAYOUT_SEQUENCE[i%LAYOUT_SEQUENCE.length],title:"专题分析 "+i,bullets:["根据正式材料补充本页证据与结论"]});}
    slides.push({type:"conclusion",layoutId:"conclusion",title:"建议在关键条件核实后推进下一步决策",bullets:["确认核心参数及其来源","完成测算和风险复核","明确责任分工与实施节点"]});
    return slides.slice(0,n);
  }
  function normalizeSlide(slide,index){
    const type=["cover","agenda","content","section","conclusion"].includes(slide&&slide.type)?slide.type:(index===0?"cover":"content"),layout=root.PptComponents&&root.PptComponents.normalizeLayout?root.PptComponents.normalizeLayout(slide&&slide.layoutId,type):(slide&&slide.layoutId)||(type==="cover"?"cover":type==="section"?"section":type==="conclusion"?"conclusion":"bullets"),content=slide&&slide.content&&typeof slide.content==="object"&&!Array.isArray(slide.content)?JSON.parse(JSON.stringify(slide.content)):{};
    return {id:clean(slide&&slide.id,80)||makeId("s"),order:index+1,type,layoutId:layout,title:clean(slide&&slide.title,100)||("第"+(index+1)+"页"),job:clean(slide&&slide.job,180),takeaway:clean(slide&&slide.takeaway,220)||clean(slide&&slide.claim,220),claim:clean(slide&&slide.claim,220),subtitle:clean(slide&&slide.subtitle,180),bullets:(Array.isArray(slide&&slide.bullets)?slide.bullets:bullets(typeof(slide&&slide.content)==="string"?slide.content:"",6)).map(x=>clean(x,240)).filter(Boolean).slice(0,10),content,visualType:clean(slide&&slide.visualType,40),visualIntent:clean(slide&&slide.visualIntent,200),designRationale:clean(slide&&slide.designRationale,240),assetSlots:Array.isArray(slide&&slide.assetSlots)?slide.assetSlots.slice(0,8):[],dataBindings:Array.isArray(slide&&slide.dataBindings)?slide.dataBindings.slice(0,20):[],notes:clean(slide&&slide.notes,2000),sources:Array.isArray(slide&&slide.sources)?slide.sources.slice(0,20):[],locked:!!(slide&&slide.locked),qa:slide&&slide.qa&&typeof slide.qa==="object"?slide.qa:{}};
  }
  function buildRhythmPlan(slides){return (slides||[]).map((s,i)=>({page:i+1,title:s.title,job:s.job||(["cover","section"].includes(s.type)?"建立阶段认知":s.type==="conclusion"?"形成决策和行动":"证明本页核心判断"),takeaway:s.takeaway||s.claim||s.title,layoutId:s.layoutId,visualType:s.visualType||(root.PptComponents&&root.PptComponents.contract?root.PptComponents.contract(s.layoutId).visualType:"list"),reason:s.designRationale||(s.layoutId+"与本页内容形态匹配"),assetSlots:s.assetSlots||[]}));}
  function numericMetricCount(slide){
    const list=(slide.content&&Array.isArray(slide.content.metrics)?slide.content.metrics:[]);
    const valid=root.PptComponents&&root.PptComponents.isMetricValue?root.PptComponents.isMetricValue:v=>/\d/.test(String(v||""));
    return list.filter(x=>valid(x&&x.value)).length;
  }
  function labelItem(text,index){
    const raw=clean(text,240),parts=raw.split(/[：:｜|—–-]/),label=clean(parts.shift(),32)||("要点 "+(index+1)),detail=clean(parts.join(" · "),180)||raw;
    return{label,text:detail};
  }
  function enrichSlideContent(slide){
    const list=(slide.bullets||[]).map(labelItem),c=slide.content||(slide.content={});
    if(!slide.claim&&slide.takeaway)slide.claim=slide.takeaway;
    if(!slide.claim&&slide.bullets&&slide.bullets.length){
      const preferred=["comparison","two-column"].includes(slide.layoutId)&&slide.bullets.find(x=>/推荐|最优|更适合|更匹配|优先/.test(x));
      slide.claim=clean(preferred||slide.bullets[0],120);
    }
    if(["three-cards","risk","matrix","system-map"].includes(slide.layoutId)&&!Array.isArray(c.items))c.items=list;
    if(["comparison","two-column"].includes(slide.layoutId)&&!Array.isArray(c.columns)&&!Array.isArray(c.items))c.items=list;
    if(["timeline","process"].includes(slide.layoutId)&&!Array.isArray(c.steps))c.steps=list.map(x=>({label:x.label,text:x.text}));
    return slide;
  }
  function splitOverloadedSlides(slides){
    const out=[];
    (slides||[]).forEach(slide=>{
      const list=slide.bullets||[],splittable=!slide.locked&&slide.type==="content"&&["bullets","three-cards","comparison","two-column","risk"].includes(slide.layoutId);
      if(!splittable||list.length<=6){out.push(slide);return;}
      for(let start=0,part=0;start<list.length;start+=5,part++){
        const copy=part===0?slide:JSON.parse(JSON.stringify(slide));copy.bullets=list.slice(start,start+5);
        if(part){copy.id=makeId("split");copy.title=clean(slide.title.replace(/（续\d*）$/,""),88)+"（续"+(part+1)+"）";copy.locked=false;}
        if(copy.content&&Array.isArray(copy.content.items))copy.content.items=copy.content.items.slice(start,start+5);
        copy.splitFrom=slide.id;copy.splitPart=part+1;out.push(copy);
      }
    });
    return out;
  }
  function chooseSemanticLayout(slide,index,imageAssets=[]){
    if(slide.locked||["cover","section","conclusion"].includes(slide.type))return slide.layoutId;
    const id=slide.layoutId,text=[slide.title,slide.subtitle,slide.claim,...(slide.bullets||[])].join(" "),content=slide.content||{},count=(slide.bullets||[]).length;
    const selection=root.PptComponentRegistry&&root.PptComponentRegistry.recommend?root.PptComponentRegistry.recommend(slide,{index,previousLayout:index>0?slide.previousLayout:""}):null;
    if(selection)slide.componentSelection=selection;
    if(["metric","kpi-tower"].includes(id)){
      const metrics=Array.isArray(content.metrics)?content.metrics:[],valid=numericMetricCount(slide);
      if(metrics.length&&valid!==metrics.length&&valid>=2)return"matrix";
      if(valid<2){slide.contentStatus="evidence-gap";return id;}
    }
    if(id.startsWith("chart-")&&(!Array.isArray(content.series)||content.series.filter(x=>Number.isFinite(Number(String(x&&x.value).replace(/[^\d.-]/g,"")))).length<2)){slide.contentStatus="evidence-gap";return id;}
    if(id==="table"&&(!Array.isArray(content.headers)||!Array.isArray(content.rows)||!content.rows.length)){slide.contentStatus="evidence-gap";return id;}
    if(id==="image-hero"&&!content.image&&imageAssets.length)return"image-hero";
    if(imageAssets.length&&["bullets","three-cards","two-column"].includes(id)&&/项目现场|区位|效果图|规划图|总平|实景|形象|建筑|图片/.test(text))return"image-hero";
    if(["bullets","two-column"].includes(id)&&/风险|问题|难点|对策|应对/.test(text)&&count>=3)return"risk";
    if(["bullets","two-column"].includes(id)&&/阶段|节点|工期|进度|步骤|流程/.test(text)&&count>=3)return/工期|进度|节点|阶段/.test(text)?"timeline":"process";
    if(id==="bullets"&&count===3)return"three-cards";
    if(id==="bullets"&&/对比|比较|方案|前后|差异/.test(text)&&count>=2)return"comparison";
    return selection&&selection.selected&&selection.selected.score>=78?selection.selected.layoutId:id;
  }
  function directSlides(slides,evidencePack,force=false){
    const images=((evidencePack&&evidencePack.assets)||[]).filter(x=>x.kind==="image"&&x.dataUrl);let imageIndex=0;
    const assetCatalog=root.PptAssetLayer&&root.PptAssetLayer.buildCatalog?root.PptAssetLayer.buildCatalog(evidencePack,{}):null,usedAssetIds=[];
    let previousRecipeId="",previousStrategyId="";
    return slides.map((slide,index)=>{
      if(slide.locked&&!force)return slide;
      enrichSlideContent(slide);
      const old=slide.layoutId;
      if(root.PptExpressionStrategy&&root.PptExpressionStrategy.planSlide){const strategy=root.PptExpressionStrategy.planSlide(slide,{previousStrategyId});slide.expressionStrategy=strategy;if(!slide.layoutManual)slide.layoutId=strategy.layoutId;previousStrategyId=strategy.strategyId;}
      const next=chooseSemanticLayout(slide,index,images);slide.layoutId=next;
      if(slide.componentSelection){
        slide.componentSelection.appliedLayoutId=next;
        slide.componentSelection.applied=!!(slide.componentSelection.selected&&slide.componentSelection.selected.layoutId===next&&slide.componentSelection.selected.score>=78);
      }
      if(next!==old){
        if(["metric","kpi-tower"].includes(old)&&Array.isArray(slide.content.metrics)&&!["metric","kpi-tower"].includes(next))slide.content.items=slide.content.metrics.slice(0,4).map((m,i)=>({label:m.label||("项目 "+(i+1)),text:[m.value,m.text].filter(Boolean).join(" · ")}));
        slide.visualType=root.PptComponents&&root.PptComponents.contract?root.PptComponents.contract(next).visualType:"list";slide.designRationale="视觉导演纠偏：内容形态不满足“"+old+"”的使用条件，已改用“"+next+"”";
      }
      if(next==="image-hero"&&!slide.content.image&&images.length){const asset=images[imageIndex++%images.length];slide.content.image=asset.dataUrl;slide.content.imageAssetId=asset.id;slide.sources=Array.from(new Set([...(slide.sources||[]),asset.name]));}
      if(root.PptLayoutRecipes&&root.PptLayoutRecipes.recommend){
        const manual=slide.recipeManual&&root.PptLayoutRecipes.get&&root.PptLayoutRecipes.get(slide.recipeId),recipe=root.PptLayoutRecipes.recommend(slide,{previousRecipeId});slide.recipeSelection=recipe;
        if(manual&&manual.layouts.includes(slide.layoutId)){slide.pageRole=recipe.role;slide.density=recipe.density;previousRecipeId=manual.id;}
        else if(recipe.selected){slide.recipeId=recipe.selected.id;slide.pageRole=recipe.role;slide.density=recipe.density;previousRecipeId=recipe.selected.id;}
      }
      if(root.PptDesignIR&&root.PptDesignIR.SUPPORTED&&root.PptDesignIR.SUPPORTED.has(slide.layoutId)){
        const composition=(slide.expressionStrategy&&slide.expressionStrategy.compositionId)||{cover:"cover-architectural",agenda:"agenda-modular",statement:"statement-focus",section:"section-monolith",metric:"metric-hero-grid","kpi-tower":"metric-hero-grid",timeline:"timeline-roadmap",process:"process-stair",comparison:"comparison-editorial","two-column":"comparison-editorial",bullets:"insight-sidebar","three-cards":"three-insight-cards",risk:"risk-response-grid",matrix:"risk-matrix","system-map":"system-orbit","image-hero":"image-judgement",conclusion:"decision-board"}[slide.layoutId];
        const recipeInfo=root.PptLayoutRecipes&&root.PptLayoutRecipes.get?root.PptLayoutRecipes.get(slide.recipeId):null;
        slide.visualPlan={version:2,engine:"design-ir-v2",styleId:"inherit",compositionId:composition,density:slide.density||slide.expressionStrategy&&slide.expressionStrategy.density||"medium",focalPoint:["cover","statement","section","metric","kpi-tower","image-hero"].includes(slide.layoutId)?"dominant":"balanced",assetStrategy:slide.expressionStrategy&&slide.expressionStrategy.assetRequirement|| (slide.layoutId==="cover"?"architectural-geometry":"native-editable"),visualAnchor:slide.expressionStrategy&&slide.expressionStrategy.visualAnchor||"结构化信息",sourcePages:recipeInfo?recipeInfo.sourcePages.slice():[]};
      }
      if(assetCatalog&&root.PptAssetLayer&&root.PptAssetLayer.matchAsset){
        const preferred=["cover","image-hero"].includes(slide.layoutId)?"photo":"icon",match=root.PptAssetLayer.matchAsset(slide,assetCatalog,{kind:preferred,usedIds:usedAssetIds});slide.assetPlan=match;
        if(match.status==="matched"){usedAssetIds.push(match.assetId);if(match.kind==="photo"&&slide.layoutId==="image-hero"&&!slide.content.image){slide.content.image=match.dataUrl;slide.content.imageAssetId=match.assetId;}if(match.provider!=="builtin"&&match.sourceRef)slide.sources=Array.from(new Set([...(slide.sources||[]),match.sourceRef]));}
      }
      return slide;
    });
  }
  function applyVisualDirector(plan,opts={}){
    if(!plan||!Array.isArray(plan.slides))return plan;
    const copy=opts.mutate?plan:JSON.parse(JSON.stringify(plan)),prepared=opts.allowSplit===false?copy.slides:splitOverloadedSlides(copy.slides);copy.slides=directSlides(prepared,copy.evidencePack,!!opts.force);copy.slides.forEach((s,i)=>{s.order=i+1;});copy.rhythmPlan=buildRhythmPlan(copy.slides);if(root.PptAssetLayer&&root.PptAssetLayer.buildCatalog)copy.assetCatalogSummary=root.PptAssetLayer.buildCatalog(copy.evidencePack,{}).summary;copy.updatedAt=Date.now();return copy;
  }
  function buildDeckPlan(input={}){
    const sourceText=clean(input.sourceText,80000),raw=Array.isArray(input.slides)&&input.slides.length?input.slides:defaultOutline(sourceText,input.slideCount),template=preset(input.templateId),slides=directSlides(splitOverloadedSlides(raw.map(normalizeSlide)),input.evidencePack);
    return {schemaVersion:5,designPipelineVersion:6,migratingFromVersion:Number(input.schemaVersion)||0,title:clean(input.title,120)||"未命名汇报",purpose:clean(input.purpose,200)||"项目汇报",audience:clean(input.audience,120)||"项目决策与审查人员",templateId:template.id,exportMode:input.exportMode==="native"?"native":"preview",designSpec:normalizeDesignSpec(input.designSpec,template.id),sourceText,sourceRefs:Array.isArray(input.sourceRefs)?input.sourceRefs.slice(0,100):[],evidencePack:input.evidencePack&&typeof input.evidencePack==="object"?input.evidencePack:null,story:input.story&&typeof input.story==="object"?input.story:null,generationMode:clean(input.generationMode,30)||"rule",slides,rhythmPlan:buildRhythmPlan(slides),createdAt:Number(input.createdAt)||Date.now(),updatedAt:Date.now()};
  }
  function validateDeckPlan(plan){
    const errors=[],warnings=[];if(!plan||!Array.isArray(plan.slides))return{ok:false,errors:["缺少逐页内容"],warnings,score:0};
    if(plan.slides.length<3)errors.push("至少需要3页");if(plan.slides.length>30)warnings.push("超过30页，建议拆分汇报");const ids=new Set(),layouts=[];
    plan.slides.forEach((s,i)=>{if(!s.title)errors.push("第"+(i+1)+"页缺少标题");if(ids.has(s.id))errors.push("第"+(i+1)+"页ID重复");ids.add(s.id);layouts.push(s.layoutId);if(s.title&&s.title.length>34)warnings.push("第"+(i+1)+"页标题较长，建议写成简洁结论句");if((s.bullets||[]).length>6)warnings.push("第"+(i+1)+"页要点超过6条，建议拆页");if((s.bullets||[]).some(x=>x.length>90))warnings.push("第"+(i+1)+"页存在过长要点");const visible=JSON.stringify([s.title,s.subtitle,s.claim,s.bullets,s.content]);if(/\d/.test(visible)&&!(s.sources||[]).length&&i>0)warnings.push("第"+(i+1)+"页包含数字但没有来源");if(root.PptComponents&&root.PptComponents.inspect)root.PptComponents.inspect(s,i).forEach(x=>(x.severity==="error"?errors:warnings).push(x.message));});
    const body=layouts.filter(x=>!["cover","section","conclusion"].includes(x)),unique=new Set(body);if(plan.slides.length>=10&&unique.size<7)warnings.push("10页以上建议至少使用7种主体版式，当前仅"+unique.size+"种");else if(plan.slides.length>=7&&unique.size<5)warnings.push("7页以上建议至少使用5种主体版式，当前仅"+unique.size+"种");for(let i=2;i<body.length;i++)if(body[i]===body[i-1]&&body[i]===body[i-2])warnings.push("存在连续3页相同版式（"+body[i]+"），建议调整页面节奏");
    const score=Math.max(0,100-errors.length*20-warnings.length*4);return{ok:errors.length===0,errors,warnings,score,summary:errors.length?"存在必须修复项":warnings.length?"可导出，建议继续优化":"结构与视觉规则检查通过"};
  }
  function stripJson(text){const s=clean(text,120000),fenced=s.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fenced)return fenced[1].trim();const a=s.indexOf("{"),b=s.lastIndexOf("}");return a>=0&&b>a?s.slice(a,b+1):s;}
  function parseAiPlan(text,base={}){let obj;try{obj=JSON.parse(stripJson(text));}catch(e){throw new Error("AI返回内容不是有效JSON");}const slides=Array.isArray(obj.slides)?obj.slides:[];if(slides.length<3)throw new Error("AI返回的逐页方案不足3页");return buildDeckPlan({...base,title:obj.title||base.title,purpose:obj.purpose||base.purpose,audience:obj.audience||base.audience,designSpec:obj.designSpec||base.designSpec,story:{communicationJob:clean(obj.communicationJob,300),centralTakeaway:clean(obj.centralTakeaway,300),narrativeArc:Array.isArray(obj.narrativeArc)?obj.narrativeArc.slice(0,12):[],decisionNeeded:clean(obj.decisionNeeded,300)},generationMode:"ai",slides});}
  function fallbackAiPlan(input={}){
    const pack=input.evidencePack||{},facts=(pack.facts||[]).slice(0,10),tables=pack.tables||[],n=Math.max(6,Math.min(20,Number(input.slideCount)||10)),src=(pack.sourceRefs||[]).map(x=>x.label||x.id).slice(0,8),slides=[{type:"cover",layoutId:"cover",title:input.title||"项目决策汇报",subtitle:input.purpose||"项目分析与决策建议",sources:src},{type:"content",layoutId:"statement",title:"本次汇报聚焦项目价值、测算结论与实施决策",subtitle:"基于已导入材料形成可追溯的项目判断",sources:src}];
    if(facts.length)slides.push({type:"content",layoutId:"metric",title:"关键数据勾勒项目基本盘",content:{metrics:facts.slice(0,4).map((f,i)=>({label:"指标"+(i+1),value:(f.values||[])[0]||"待核实",text:f.statement}))},bullets:facts.slice(0,4).map(x=>x.statement),sources:facts.slice(0,4).map(x=>x.sourceLabel+"｜"+x.locator)});
    if(tables.length)slides.push({type:"content",layoutId:"table",title:"核心数据表支持进一步判断",content:{headers:(tables[0].rows[0]||[]).slice(0,6),rows:tables[0].rows.slice(1,7)},sources:[tables[0].sourceLabel+"｜"+tables[0].locator]});
    const generic=[["项目定位需要同时满足政策目标与实施条件","two-column",["政策目标与项目来源","建设条件与实施边界"]],["核心指标决定项目财务可承受能力","chart-bar",["总投资与建设成本","收益和现金流指标","关键敏感参数"]],["实施工作应围绕关键节点有序推进","timeline",["条件确认","方案深化","测算复核","审批决策","组织实施"]],["主要风险均应配置责任主体与控制动作","risk",["需求及市场风险","工程和进度风险","资金及收益风险","合规和运营风险"]],["项目推进依赖多专业协同闭环","system-map",["投资测算","规划设计","市场需求","建设实施","运营管理"]]];
    for(const [title,layout,bs] of generic){if(slides.length>=n-1)break;slides.push({type:"content",layoutId:layout,title,bullets:bs,sources:src});}while(slides.length<n-1){const i=slides.length;slides.push({type:"content",layoutId:LAYOUT_SEQUENCE[i%LAYOUT_SEQUENCE.length],title:"专题分析 "+i,bullets:["根据正式材料补充本页证据与结论"],sources:src});}slides.push({type:"conclusion",layoutId:"conclusion",title:"建议在关键条件核实后推进下一步决策",bullets:["确认核心参数及其来源","完成测算和风险复核","明确责任分工与实施节点"],sources:src});
    return buildDeckPlan({...input,story:{communicationJob:"让决策与审查人员基于可追溯证据理解项目并形成下一步决策",centralTakeaway:"项目判断应同时由材料证据、白箱测算与业务规则支撑",narrativeArc:["结论","证据","分析","风险","决策"]},generationMode:"fallback",slides});
  }
  function aiPrompt(input={}){const layouts=(root.PptComponents&&root.PptComponents.definitions||[]).map(x=>x.id+":"+x.use+"（最多"+(x.maxItems||"-")+"项）").join("；");return"你是投资与保障房项目的高级汇报策划师和信息设计师。先形成故事线和页面节奏，再选择锁定版式；禁止连续堆砌标题加文字框。\n汇报标题："+clean(input.title,120)+"\n汇报对象："+clean(input.audience,120)+"\n用途："+clean(input.purpose,160)+"\n目标页数："+Number(input.slideCount||10)+"\n可用版式："+layouts+"\n规则：每页只承担一个叙事任务；标题写成结论句；10页至少使用7种主体版式；数字页必须写sources；内容放不下时拆页，不得缩成小字。\n只返回JSON：{title,purpose,audience,communicationJob,centralTakeaway,narrativeArc:[],decisionNeeded,designSpec:{direction,density,motif},slides:[{type,layoutId,title,job,takeaway,claim,subtitle,bullets:[],content:{},visualType,visualIntent,designRationale,assetSlots:[],sources:[]}]}。\ncontent可使用 metrics、columns、steps、series、headers、rows、image。\n\n材料证据：\n"+clean(input.evidenceText,65000);}
  function diffDeckPlans(before,after){const a=new Map(((before&&before.slides)||[]).map(x=>[x.id,x])),changes=[];for(const s of((after&&after.slides)||[])){const old=a.get(s.id);if(!old){changes.push({slideId:s.id,type:"added",title:s.title});continue;}const fields=["layoutId","title","claim","takeaway","subtitle","bullets","content","notes","sources","locked"].filter(k=>JSON.stringify(old[k])!==JSON.stringify(s[k]));if(fields.length)changes.push({slideId:s.id,type:"changed",title:s.title,fields});a.delete(s.id);}a.forEach(s=>changes.push({slideId:s.id,type:"removed",title:s.title}));return changes;}
  function prepareContent(plan){if(root.PptContentDirector&&root.PptContentDirector.applyToDeck){plan=root.PptContentDirector.applyToDeck(plan,{mutate:true});plan.rhythmPlan=buildRhythmPlan(plan.slides);}return plan;}
  const api={TEMPLATE_PRESETS,normalizeDesignSpec,recommendLayout,buildRhythmPlan,applyVisualDirector:(plan,opts)=>prepareContent(applyVisualDirector(plan,opts)),buildDeckPlan:input=>prepareContent(buildDeckPlan(input)),validateDeckPlan,diffDeckPlans,normalizeSlide,enrichSlideContent,splitOverloadedSlides,parseAiPlan:(text,base)=>prepareContent(parseAiPlan(text,base)),fallbackAiPlan:input=>prepareContent(fallbackAiPlan(input)),aiPrompt};root.PptCore=api;if(root.document)root.document.documentElement.dataset.pptCore="loaded";if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
