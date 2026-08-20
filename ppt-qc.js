/* AI PPT 第三批：与导出版式合同一致的视觉QA、自动返修和浏览器渲染检查。 */
(function(root){
  "use strict";
  const clone=x=>JSON.parse(JSON.stringify(x));
  const text=x=>String(x==null?"":x);
  const visible=s=>[s.title,s.subtitle,s.claim,s.takeaway,...(s.bullets||[]),JSON.stringify(s.content||{})].join(" ");
  function rgb(hex){const h=text(hex).replace(/^#/,"");return /^[0-9a-f]{6}$/i.test(h)?[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)):[255,255,255];}
  function lum(hex){return rgb(hex).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);}
  function contrast(a,b){const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
  function issue(page,code,severity,message,repairable=true){return{page,code,severity,message,repairable};}
  function inspectSlide(s,plan,index){
    const page=index+1,id=s.layoutId||"bullets",out=[],contract=root.PptComponents&&root.PptComponents.contract?root.PptComponents.contract(id):{maxItems:6,maxChars:90},body=s.bullets||[],content=s.content||{},chars=visible(s).length;
    if(text(s.title).length>48)out.push(issue(page,"title_overflow","error","标题超过48字，极易换行挤压正文"));
    else if(text(s.title).length>34)out.push(issue(page,"title_long","warning","标题超过34字，建议收束为一句结论"));
    const structuredCount=Math.max(body.length,Array.isArray(content.items)?content.items.length:0,Array.isArray(content.steps)?content.steps.length:0,Array.isArray(content.metrics)?content.metrics.length:0);
    if(contract.maxItems&&structuredCount>contract.maxItems)out.push(issue(page,"content_overflow","error","内容项数超过“"+contract.name+"”容量 "+contract.maxItems+" 项"));
    if(!out.some(x=>x.code==="content_overflow")&&structuredCount>4&&!["timeline","process","chart-bar","chart-line","table","system-map"].includes(id))out.push(issue(page,"content_overflow","error","正文型页面超过4个核心信息块，建议拆页或改用更合适的结构组件"));
    if(!out.some(x=>x.code==="content_overflow")&&text(s.title).length>48&&chars>60)out.push(issue(page,"content_overflow","error","超长标题与正文共同占用过多版面，建议缩短标题或拆分内容"));
    if(body.some(x=>text(x).length>110))out.push(issue(page,"bullet_long","warning","存在超过110字的单条内容，导出后可能被迫缩小字号"));
    if(!["cover","section","statement","conclusion","chart-bar","chart-line","table","image-hero"].includes(id)&&chars<28)out.push(issue(page,"whitespace","warning","正文信息过少，页面可能出现异常大面积留白"));
    if(["metric","kpi-tower"].includes(id)&&((content.metrics||[]).some(x=>text(x.value).length>24)))out.push(issue(page,"metric_overflow","error","指标值过长，不适合大数字卡"));
    if(id==="table"&&((content.rows||[]).length>8||(content.headers||[]).length>6))out.push(issue(page,"table_overflow","error","表格超过8行或6列，应拆成两页"));
    if(id==="image-hero"&&!content.image)out.push(issue(page,"missing_image","warning","大图版式没有真实图片",false));
    if(root.PptComponents&&root.PptComponents.inspect)root.PptComponents.inspect(s,index).forEach(x=>out.push(issue(page,x.code,x.severity,x.message,x.code!=="missing_image")));
    return out;
  }
  function inspect(plan){
    const slides=Array.isArray(plan&&plan.slides)?plan.slides:[],issues=[];slides.forEach((s,i)=>issues.push(...inspectSlide(s,plan,i)));
    for(let i=2;i<slides.length;i++)if(slides[i].layoutId===slides[i-1].layoutId&&slides[i].layoutId===slides[i-2].layoutId&&!slides[i].locked)issues.push(issue(i+1,"layout_repetition","warning","连续3页使用相同版式，页面节奏单一"));
    const d=plan&&plan.designSpec||{},bg=d.background||"FFFFFF",fg=d.text||"173F63",accent=d.accent||"2387C7";
    if(contrast(fg,bg)<4.5)issues.push(issue(0,"contrast_text","error","正文色与背景色对比度不足4.5:1"));
    if(contrast(accent,bg)<3)issues.push(issue(0,"contrast_accent","warning","强调色与背景色对比度不足3:1"));
    const errors=issues.filter(x=>x.severity==="error").length,warnings=issues.length-errors;
    return{ok:errors===0,score:Math.max(0,100-errors*14-warnings*3),errors,warnings,issues,checkedAt:Date.now(),mode:"layout-contract"};
  }
  function splitLongBullets(list){
    const out=[];(list||[]).forEach(v=>{const s=text(v).trim();if(s.length<=110){out.push(s);return;}const parts=s.split(/(?<=[。；;])/).map(x=>x.trim()).filter(Boolean);out.push(...(parts.length>1?parts:[s]));});return out;
  }
  function shortenTitle(slide){
    if(text(slide.title).length<=42)return;
    const parts=text(slide.title).split(/[，；：:。]/).map(x=>x.trim()).filter(Boolean);if(parts.length<2)return;
    const old=slide.title;slide.title=parts.shift().slice(0,42);if(!slide.subtitle)slide.subtitle=parts.join("，").slice(0,100);slide.notes=(slide.notes?slide.notes+"\n":"")+"[视觉QA] 原标题："+old;
  }
  function repair(plan){
    let out=root.PptCore&&root.PptCore.applyVisualDirector?root.PptCore.applyVisualDirector(plan):clone(plan),slides=[],changed=[];
    out.slides.forEach((original,index)=>{
      const s=original;if(s.locked){slides.push(s);return;}const before=JSON.stringify([s.layoutId,s.title,s.subtitle,s.bullets,s.content]);shortenTitle(s);s.bullets=splitLongBullets(s.bullets);
      const cap=root.PptComponents&&root.PptComponents.contract?root.PptComponents.contract(s.layoutId).maxItems:6;
      if(cap&&s.bullets.length>cap&&!(s.qa&&s.qa.capacitySplit)){const keep=s.bullets.slice(0,cap),rest=s.bullets.slice(cap);s.bullets=keep;s.qa=Object.assign({},s.qa,{capacitySplit:true});slides.push(s);const more=clone(s);more.id=s.id+"_qa_"+(index+1);more.title=s.title+"（续）";more.subtitle="";more.bullets=rest;more.layoutId=rest.length===3?"three-cards":"bullets";more.order=0;more.locked=false;more.qa=Object.assign({},more.qa,{capacitySplit:true});more.notes=(more.notes?more.notes+"\n":"")+"[视觉QA] 内容超出单页容量，已自动拆页";slides.push(more);changed.push(index+1);return;}
      if(JSON.stringify([s.layoutId,s.title,s.subtitle,s.bullets,s.content])!==before)changed.push(index+1);slides.push(s);
    });
    out.slides=slides;out.slides.forEach((s,i)=>s.order=i+1);out.rhythmPlan=root.PptCore&&root.PptCore.buildRhythmPlan?root.PptCore.buildRhythmPlan(out.slides):out.rhythmPlan;
    let visual=null;if(root.PptVisualQA&&root.PptVisualQA.repair){const fixed=root.PptVisualQA.repair(out);out=fixed.plan;changed.push(...fixed.changedPages);visual=fixed.after;}
    const result=inspect(out),allIssues=result.issues.concat(visual?visual.issues:[]),errors=allIssues.filter(x=>x.severity==="error").length,warnings=allIssues.length-errors,score=visual?Math.round(result.score*.35+visual.score*.65):result.score;
    out.visualQa={...result,score,errors,warnings,issues:allIssues,dimensions:visual&&visual.dimensions,details:visual&&visual.details,changedPages:Array.from(new Set(changed)),repairRounds:1,status:errors?"needs-review":"passed"};return{plan:out,report:out.visualQa,changedPages:Array.from(new Set(changed))};
  }
  function inspectDom(canvas,page){
    if(!canvas)return[];const issues=[],box=canvas.getBoundingClientRect(),isDesignIr=canvas.classList.contains("ir-v1"),els=canvas.querySelectorAll("h2,p,li,strong,span,b,td,th,.ppt-ir-el.text");
    els.forEach(el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el);if(r.width<1||r.height<1||style.display==="none")return;const measurable=el.clientWidth>0&&el.clientHeight>0;if(measurable&&(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2))issues.push(issue(page,"dom_overflow",isDesignIr?"warning":"error",isDesignIr?"网页预览文字较紧，导出时将按Design IR自动缩小适配":"浏览器逐页渲染发现文字容器溢出"));if(r.left<box.left-2||r.right>box.right+2||r.top<box.top-2||r.bottom>box.bottom+2)issues.push(issue(page,"dom_outside",isDesignIr?"warning":"error",isDesignIr?"网页缩放出现边界取整差异，已以Design IR画布坐标校验为准":"浏览器逐页渲染发现内容超出页面边界"));});
    const rendered=Array.from(canvas.querySelectorAll(".ppt-ir-el")).map(el=>({el,r:el.getBoundingClientRect()})).filter(x=>x.r.width>1&&x.r.height>1),visual=rendered.filter(x=>!x.el.classList.contains("text")&&!x.el.classList.contains("line")),anchors=visual.filter(x=>x.el.matches("img,table,.ppt-ir-chart,.shape")||((x.r.width*x.r.height)/(box.width*box.height)>.025&&(x.r.width*x.r.height)/(box.width*box.height)<.58));
    const chars=Array.from(canvas.querySelectorAll(".ppt-ir-el.text")).reduce((n,el)=>n+String(el.textContent||"").replace(/\s/g,"").length,0);if(chars<32&&anchors.length<2)issues.push(issue(page,"render_sparse","warning","渲染后页面信息和视觉锚点同时偏少，容易显得空洞"));if(visual.length&&!anchors.length)issues.push(issue(page,"render_anchor_missing","warning","渲染后缺少图片、图表或结构化图形作为视觉锚点"));
    if(anchors.length>=3){let left=0,right=0;anchors.forEach(x=>{const weight=Math.min(.25,(x.r.width*x.r.height)/(box.width*box.height)),center=x.r.left+x.r.width/2;center<box.left+box.width/2?left+=weight:right+=weight;});const total=left+right||1;if(Math.abs(left-right)/total>.72)issues.push(issue(page,"render_unbalanced","warning","渲染后视觉重量明显偏向一侧，建议调整主次区域占比"));}
    canvas.querySelectorAll("img.ppt-ir-el").forEach(img=>{const r=img.getBoundingClientRect(),nw=Number(img.naturalWidth||0),nh=Number(img.naturalHeight||0);if(nw&&nh&&(nw<r.width*.8||nh<r.height*.8))issues.push(issue(page,"render_image_lowres","warning","页面图片实际像素不足，导出后可能发虚",false));});
    return issues.filter((x,i,a)=>a.findIndex(y=>y.code===x.code)===i);
  }
  function repairDom(plan,domIssues){
    const out=clone(plan),pages=new Set((domIssues||[]).filter(x=>x.severity==="error"&&["dom_overflow","dom_outside"].includes(x.code)).map(x=>x.page)),slides=[];
    out.slides.forEach((s,index)=>{if(!pages.has(index+1)||s.locked){slides.push(s);return;}shortenTitle(s);if((s.bullets||[]).length>3){const rest=s.bullets.splice(Math.ceil(s.bullets.length/2)),more=clone(s);more.id=s.id+"_dom_"+(index+1);more.title=s.title+"（续）";more.subtitle="";more.bullets=rest;more.layoutId=rest.length===3?"three-cards":"bullets";more.locked=false;more.notes=(more.notes?more.notes+"\n":"")+"[视觉QA] 浏览器渲染溢出，已自动拆页";slides.push(s,more);}else{s.qa=Object.assign({},s.qa,{compact:true});s.notes=(s.notes?s.notes+"\n":"")+"[视觉QA] 浏览器渲染空间紧张，导出采用紧凑字号";slides.push(s);}});
    out.slides=slides;out.slides.forEach((s,i)=>s.order=i+1);out.rhythmPlan=root.PptCore&&root.PptCore.buildRhythmPlan?root.PptCore.buildRhythmPlan(out.slides):out.rhythmPlan;return out;
  }
  function attachDomReport(plan,domIssues){const out=clone(plan),base=inspect(out),visual=root.PptVisualQA&&root.PptVisualQA.inspectDeck?root.PptVisualQA.inspectDeck(out):null,issues=base.issues.concat(visual?visual.issues:[]).concat(domIssues||[]),errors=issues.filter(x=>x.severity==="error").length,warnings=issues.length-errors,score=visual?Math.round(base.score*.3+visual.score*.7):Math.max(0,100-errors*14-warnings*3);out.visualQa={ok:errors===0,score,dimensions:visual&&visual.dimensions,details:visual&&visual.details,errors,warnings,issues,checkedAt:Date.now(),mode:"browser-render+design-ir-five-dimension",status:errors?"needs-review":"passed"};return out;}
  const api={contrast,inspect,repair,inspectDom,repairDom,attachDomReport};root.PptQC=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
