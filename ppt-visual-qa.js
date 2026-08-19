/* Design IR visual QA: five-dimensional scoring and deterministic repair recommendations. */
(function(root){
  "use strict";
  const clone=x=>JSON.parse(JSON.stringify(x));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const issue=(page,code,severity,message,repairable=true)=>({page,code,severity,message,repairable});
  const area=e=>Math.max(0,e.w)*Math.max(0,e.h);
  function overlap(a,b){const x=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),y=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return x*y;}
  function inspectScene(scene,slide,page){
    if(!scene)return{score:68,dimensions:{hierarchy:70,composition:65,density:65,readability:75,assets:55},issues:[issue(page,"ir_missing","warning","本页尚未进入统一视觉蓝图渲染",false)]};
    const els=scene.elements||[],texts=els.filter(e=>e.type==="text"),visuals=els.filter(e=>e.type!=="text"&&e.type!=="line"),issues=[];
    let hierarchy=100,composition=100,density=100,readability=100,assets=100;
    els.forEach((e,i)=>{if(e.x<0||e.y<0||e.x+e.w>scene.width+.01||e.y+e.h>scene.height+.01){issues.push(issue(page,"scene_outside","error","视觉元素超出画布"));composition-=20;}if(e.type==="text"&&e.fontSize<8&&e.h>.25){issues.push(issue(page,"font_too_small","warning","正文存在低于8pt的文字"));readability-=14;}if(e.type==="text"&&String(e.text||"").length>100&&e.h<.55){issues.push(issue(page,"text_density","warning","长文本容器高度不足"));density-=12;}});
    const title=texts.filter(e=>e.bold).sort((a,b)=>(b.fontSize||0)-(a.fontSize||0))[0],body=texts.filter(e=>e!==title&&String(e.text||"").length>8).sort((a,b)=>(b.fontSize||0)-(a.fontSize||0))[0];
    if(title&&body&&(title.fontSize||0)<(body.fontSize||0)*1.55){issues.push(issue(page,"weak_hierarchy","warning","标题与正文的字号层级不足"));hierarchy-=18;}
    const occupied=clamp(els.reduce((n,e)=>n+area(e),0)/(scene.width*scene.height),0,2);if(occupied<.34){issues.push(issue(page,"too_empty","warning","页面有效视觉占比偏低"));density-=16;}if(occupied>1.18){issues.push(issue(page,"too_dense","warning","页面视觉密度偏高"));density-=14;}
    for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){const ov=overlap(texts[i],texts[j]);if(ov>.03&&texts[i].text!==texts[j].text){issues.push(issue(page,"text_overlap","error","文字区域发生重叠"));composition-=22;i=texts.length;break;}}
    const hasAsset=els.some(e=>e.type==="image")||visuals.length>=2;if(!hasAsset){issues.push(issue(page,"visual_missing","warning","页面缺少明确视觉载体"));assets-=22;}
    const ap=slide&&slide.assetPlan;if(ap&&ap.status==="matched"&&!ap.sourceRef){issues.push(issue(page,"asset_source_missing","error","匹配素材缺少来源"));assets-=28;}else if(ap&&ap.status==="matched")assets=100;else if(slide&&["cover","image-hero"].includes(slide.layoutId)){issues.push(issue(page,"asset_match_missing","warning","重点视觉页未匹配到项目素材，已使用系统图形兜底"));assets-=16;}
    const dims={hierarchy:clamp(hierarchy,0,100),composition:clamp(composition,0,100),density:clamp(density,0,100),readability:clamp(readability,0,100),assets:clamp(assets,0,100)};
    return{score:Math.round(Object.values(dims).reduce((a,b)=>a+b,0)/5),dimensions:dims,issues};
  }
  function inspectDeck(plan,opts={}){
    const selected=opts.pages?new Set(opts.pages.map(Number)):null,details=[],issues=[];for(let i=0;i<(plan.slides||[]).length;i++){if(selected&&!selected.has(i+1))continue;const s=plan.slides[i],scene=root.PptDesignIR&&root.PptDesignIR.buildScene?root.PptDesignIR.buildScene(s,plan,i):null,r=inspectScene(scene,s,i+1);details.push({page:i+1,...r});issues.push(...r.issues);}
    const comps=(plan.slides||[]).map(s=>s.visualPlan&&s.visualPlan.compositionId||s.layoutId),counts={};comps.forEach(x=>counts[x]=(counts[x]||0)+1);Object.entries(counts).forEach(([k,n])=>{if(n>=4&&n/(comps.length||1)>.45)issues.push(issue(0,"deck_monotony","warning","整套PPT中“"+k+"”构图重复偏多"));});
    const dimensions={};["hierarchy","composition","density","readability","assets"].forEach(k=>dimensions[k]=Math.round(details.reduce((n,x)=>n+x.dimensions[k],0)/Math.max(1,details.length)));
    const score=Math.round(Object.values(dimensions).reduce((a,b)=>a+b,0)/5),errors=issues.filter(x=>x.severity==="error").length;
    const benchmark=root.PptQualityBenchmark&&root.PptQualityBenchmark.inspect?root.PptQualityBenchmark.inspect(plan):null;
    return{ok:errors===0&&(!benchmark||benchmark.score>=60),score,dimensions,issues,details,errors,warnings:issues.length-errors,benchmark,mode:selected?"design-ir-selective":"design-ir-five-dimension",checkedAt:Date.now()};
  }
  function repair(plan,opts={}){
    const out=clone(plan),requested=opts.pages?new Set(opts.pages.map(Number)):null,maxRounds=Math.max(1,Math.min(2,Number(opts.maxRounds)||1)),before=inspectDeck(out,requested?{pages:[...requested]}:{}),changed=[];let rounds=0;
    for(let round=0;round<maxRounds;round++){rounds++;const report=inspectDeck(out,requested?{pages:[...requested]}:{}),byPage=new Map(report.details.map(x=>[x.page,x]));let roundChanged=0;
      (out.slides||[]).forEach((s,i)=>{const n=i+1;if(s.locked||(requested&&!requested.has(n)))return;const page=byPage.get(n),codes=new Set((page&&page.issues||[]).map(x=>x.code));s.qa={...(s.qa||{}),visualBefore:s.qa&&s.qa.visualBefore||page&&page.score,visualIssues:[...codes]};
        if(codes.has("text_density")||codes.has("too_dense")||codes.has("font_too_small")){s.qa.compact=true;if((s.bullets||[]).length>5)s.bullets=s.bullets.slice(0,5);changed.push(n);roundChanged++;}
        if(codes.has("too_empty")){s.visualPlan={...(s.visualPlan||{}),density:"expanded",variant:i%2?"editorial":"feature"};changed.push(n);roundChanged++;}
        if(codes.has("weak_hierarchy")){s.visualPlan={...(s.visualPlan||{}),titleScale:1.08};changed.push(n);roundChanged++;}
      });
      if(!roundChanged)break;
    }
    const seen={};(out.slides||[]).forEach((s,i)=>{const n=i+1;if(s.locked||(requested&&!requested.has(n)))return;const k=s.visualPlan&&s.visualPlan.compositionId||s.layoutId,count=seen[k]||0;seen[k]=count+1;if(count>=2){s.visualPlan={...(s.visualPlan||{}),variant:count%2?"alternate":"feature"};changed.push(n);}});
    const after=inspectDeck(out,requested?{pages:[...requested]}:{}),afterByPage=new Map(after.details.map(x=>[x.page,x]));(out.slides||[]).forEach((s,i)=>{if(!s.locked&&(!requested||requested.has(i+1)))s.qa={...(s.qa||{}),visualAfter:afterByPage.get(i+1)&&afterByPage.get(i+1).score};});
    out.visualQa={...after,beforeScore:before.score,afterScore:after.score,changedPages:Array.from(new Set(changed)),repairRounds:rounds,scope:requested?"changed-pages":"whole-deck",status:after.ok?"passed":"needs-review"};
    return{plan:out,before,after,changedPages:out.visualQa.changedPages};
  }
  const api={inspectScene,inspectDeck,repair,repairPages:(plan,pages,opts={})=>repair(plan,{...opts,pages})};root.PptVisualQA=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
