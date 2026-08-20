/* AI PPT conversation helpers. Pure functions are also used by Node tests. */
(function(root){
  "use strict";

  const clone=value=>JSON.parse(JSON.stringify(value==null?{}:value));
  const clean=(value,max=800)=>String(value==null?"":value).trim().slice(0,max);

  function deckContext(plan={}){
    const slides=Array.isArray(plan.slides)?plan.slides:[];
    return {
      title:clean(plan.title,120), audience:clean(plan.audience,100), purpose:clean(plan.purpose,160),
      templateId:clean(plan.templateId,60), stage:clean(plan.workflow&&plan.workflow.stage,30),
      materialCount:Number(plan.evidencePack&&plan.evidencePack.summary&&plan.evidencePack.summary.assetCount)||0,
      slides:slides.map((slide,index)=>({page:index+1,title:clean(slide.title,120),layoutId:clean(slide.layoutId,50),bullets:(slide.bullets||[]).map(x=>clean(x,180)).filter(Boolean).slice(0,8),sourceCount:(slide.sources||[]).length,locked:!!slide.locked}))
    };
  }

  function materialPlanningPrompt(input={}){
    return [
      "你是资深汇报策划师、信息设计师和保障房项目分析顾问。",
      "请真正阅读材料，先识别主题、对象、关键事实、数字、判断、风险和行动，再规划整套PPT。",
      "严禁生成只有标题没有内容的空页面；严禁脱离材料编造数字。",
      "每页必须有一个明确的沟通任务，标题尽量写成结论句，并提供能直接渲染的bullets或content。",
      "数字、表格和关键判断必须在sources中填写对应文件名、Sheet、页码或材料位置；无法定位时写材料文件名。",
      "汇报标题："+clean(input.title,120), "汇报对象："+clean(input.audience,100), "汇报用途："+clean(input.purpose,160),
      "目标页数："+Math.max(5,Math.min(24,Number(input.slideCount)||10)), "可用页面组件："+(input.layouts||[]).join("、"),
      "只输出JSON，不要Markdown代码围栏。JSON结构：",
      '{"title":"","purpose":"","audience":"","communicationJob":"","centralTakeaway":"","narrativeArc":[],"decisionNeeded":"","designSpec":{"direction":"","density":"medium","motif":""},"slides":[{"type":"content","layoutId":"bullets","title":"结论句","job":"","takeaway":"","claim":"","subtitle":"","bullets":[""],"content":{},"visualType":"","visualIntent":"","designRationale":"","assetSlots":[],"sources":[""]}]}',
      "材料全文：\n"+clean(input.evidenceText,70000)
    ].join("\n");
  }

  function applySlidePatch(plan={},args={}){
    const out=clone(plan),slides=Array.isArray(out.slides)?out.slides:[],page=Math.max(1,Math.min(slides.length,Number(args.page)||1)),slide=slides[page-1];
    if(!slide)return{ok:false,error:"页码不存在",plan:out,page};
    if(slide.locked&&!args.force)return{ok:false,error:"该页已人工锁定",plan:out,page};
    const before=clone(slide);
    if(clean(args.title,160))slide.title=clean(args.title,160);
    if(args.subtitle!==undefined)slide.subtitle=clean(args.subtitle,240);
    if(Array.isArray(args.bullets))slide.bullets=args.bullets.map(x=>clean(x,220)).filter(Boolean).slice(0,8);
    if(clean(args.layoutId,60))slide.layoutId=clean(args.layoutId,60);
    if(clean(args.notes,1200))slide.notes=clean(args.notes,1200);
    slide.updatedAt=Date.now();out.updatedAt=Date.now();
    return{ok:true,plan:out,page,before,after:clone(slide)};
  }

  function groundDeck(plan={}){
    const out=clone(plan),pack=out.evidencePack||{},assets=(pack.assets||[]).filter(x=>x&&x.id!=="src_pasted"),sourceNames=assets.map(x=>clean(x.name,160)).filter(Boolean),lines=[];
    assets.forEach(asset=>String(asset.text||"").split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(x=>x.length>=12&&x.length<=220).slice(0,80).forEach(x=>lines.push({text:x,source:asset.name})));
    let filledContent=0,filledSources=0;
    (out.slides||[]).forEach((slide,index)=>{
      if(index===0||slide.type==="cover")return;
      if(!(slide.sources||[]).length&&sourceNames.length){slide.sources=sourceNames.slice(0,Math.min(2,sourceNames.length));filledSources++;}
      const contentKeys=Object.keys(slide.content||{}),hasContent=(slide.bullets||[]).some(Boolean)||contentKeys.length>0;
      if(!hasContent&&lines.length){const start=((index-1)*3)%lines.length,picked=[0,1,2].map(n=>lines[(start+n)%lines.length]).filter(Boolean);slide.bullets=picked.map(x=>x.text);slide.sources=[...new Set((slide.sources||[]).concat(picked.map(x=>x.source)))].filter(Boolean).slice(0,4);filledContent++;}
    });
    const slides=(out.slides||[]).filter((x,i)=>i===0||x.type==="cover"||(x.bullets||[]).some(Boolean)||Object.keys(x.content||{}).length),grounded=(out.slides||[]).filter((x,i)=>i===0||(x.sources||[]).length);
    return{plan:out,filledContent,filledSources,contentCoverage:out.slides&&out.slides.length?Math.round(slides.length/out.slides.length*100):0,sourceCoverage:out.slides&&out.slides.length?Math.round(grounded.length/out.slides.length*100):0};
  }

  function selectImageSlides(plan={},limit=2){
    const slides=Array.isArray(plan.slides)?plan.slides:[],max=Math.max(0,Math.min(3,Number(limit)||0));
    return slides.map((slide,index)=>{
      if(index===0||slide.type==="cover"||slide.locked||(slide.content&&slide.content.image))return null;
      const layout=clean(slide.layoutId,60),text=[slide.title,slide.subtitle,slide.claim,...(slide.bullets||[])].join(" ");
      if(["table","chart-bar","chart-line","risk","matrix","timeline","process"].includes(layout))return null;
      let score=layout==="image-hero"?100:0;
      if(/项目|区位|城市|住房|建筑|场景|背景|愿景|实施/.test(text))score+=30;
      if((slide.bullets||[]).length<=4)score+=12;
      score+=Math.max(0,8-index);
      return{page:index+1,score,query:clean([slide.title,slide.claim,slide.subtitle].filter(Boolean).join("，"),180)};
    }).filter(Boolean).sort((a,b)=>b.score-a.score||a.page-b.page).slice(0,max);
  }

  function applyGeneratedImage(plan={},page,image={}){
    const out=clone(plan),slide=(out.slides||[])[Number(page)-1];
    if(!slide||!String(image.dataUrl||"").startsWith("data:image/"))return{ok:false,plan:out,error:"图片或页码无效"};
    slide.layoutId="image-hero";
    slide.content={...(slide.content||{}),image:image.dataUrl,imageSource:image.sourceRef||image.provider||"AI生成图片"};
    slide.assetPlan={status:"matched",kind:"image",assetId:image.id||("generated_"+Date.now()),dataUrl:image.dataUrl,sourceRef:image.sourceRef||"AI生成图片",provider:image.provider||"unknown",approvedAt:Date.now(),rationale:"用户选择智能生成整套PPT，系统自动生成并应用主视觉"};
    slide.assetCandidates=[...(slide.assetCandidates||[]),{...slide.assetPlan,id:slide.assetPlan.assetId,label:image.label||"AI生成主视觉",status:"approved",createdAt:Date.now(),slideId:slide.id||""}].slice(-12);
    slide.sources=Array.from(new Set([...(slide.sources||[]),slide.assetPlan.sourceRef])).filter(Boolean);
    out.updatedAt=Date.now();
    return{ok:true,plan:out,page:Number(page)};
  }

  const api={deckContext,materialPlanningPrompt,applySlidePatch,groundDeck,selectImageSlides,applyGeneratedImage};root.PptConversationCore=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
