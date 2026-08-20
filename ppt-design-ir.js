/* AI PPT Design IR v1：视觉导演输出的统一场景协议，浏览器预览与 PPTX 共用。 */
(function(root){
  "use strict";
  const W=13.333,H=7.5;
  const SUPPORTED=new Set(["cover","agenda","statement","section","metric","kpi-tower","timeline","process","comparison","two-column"]);
  const clean=(v,n=500)=>String(v==null?"":v).trim().slice(0,n);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const listOf=s=>Array.isArray(s.content&&s.content.items)?s.content.items:(s.bullets||[]).map((text,i)=>({label:"要点 "+(i+1),text}));
  const textOf=x=>clean(typeof x==="string"?x:(x&&x.text)||"",260);
  function palette(plan={}){
    const d=plan.designSpec||{},id=plan.templateId||"anju-blue";
    const token=root.PptDesignTokens&&root.PptDesignTokens.get?root.PptDesignTokens.get(id):null;
    const presets={
      "anju-blue":{accent:"2387C7",secondary:"70C5DE",dark:"173F63",bg:"F4F9FD",surface:"FFFFFF",muted:"65839A",pale:"DDECF7"},
      "gov-clean":{accent:"1F4E78",secondary:"A77728",dark:"1E2F3D",bg:"FFFFFF",surface:"FFFFFF",muted:"61778A",pale:"E5EEF5"},
      "data-light":{accent:"167D8D",secondary:"E09F3E",dark:"20384B",bg:"F3F8F9",surface:"FFFFFF",muted:"668397",pale:"DCECEE"},
      "business-blue-160":{accent:"003591",secondary:"5385C5",dark:"24292F",bg:"F7F9FC",surface:"FFFFFF",muted:"687786",pale:"DCE7F5"}
    },fallback=presets[id]||presets["anju-blue"],b=token?{accent:token.colors.accent,secondary:token.colors.secondary,dark:token.colors.dark,bg:token.colors.background,surface:token.colors.surface,muted:token.colors.muted,pale:token.colors.pale,titleFont:token.fonts.title,bodyFont:token.fonts.body,chartColors:token.chartColors,shape:token.shape}:fallback;
    return {...b,accent:clean(d.accent,6)||b.accent,secondary:clean(d.secondary,6)||b.secondary,dark:clean(d.text,6)||b.dark,bg:clean(d.background,6)||b.bg,titleFont:clean(d.titleFont,80)||"Microsoft YaHei",bodyFont:clean(d.bodyFont,80)||"Microsoft YaHei"};
  }
  const el=(type,x,y,w,h,props={})=>({type,x,y,w,h,...props});
  const txt=(text,x,y,w,h,props={})=>el("text",x,y,w,h,{text:clean(text,1200),fontSize:props.fontSize||14,color:props.color||"24292F",fontFace:props.fontFace||"Microsoft YaHei",bold:!!props.bold,align:props.align||"left",valign:props.valign||"top",...props});
  const rect=(x,y,w,h,props={})=>el("rect",x,y,w,h,props);
  const line=(x,y,w,h,props={})=>el("line",x,y,w,h,props);
  const ellipse=(x,y,w,h,props={})=>el("ellipse",x,y,w,h,props);
  const image=(dataUrl,x,y,w,h,props={})=>el("image",x,y,w,h,{dataUrl:String(dataUrl||""),fit:props.fit||"contain",...props});
  function addAsset(scene,slide,x=11.88,y=.34,w=.58,h=.58){const a=slide&&slide.assetPlan;if(a&&a.status==="matched"&&a.dataUrl)scene.elements.push(image(a.dataUrl,x,y,w,h,{fit:a.kind==="photo"?"cover":"contain",assetId:a.assetId,sourceRef:a.sourceRef,transparency:a.kind==="photo"?8:0}));}
  function addChrome(scene,slide,p,index,total,kicker){
    scene.elements.push(txt(kicker||"PROJECT INSIGHT",.72,.38,4,.2,{fontFace:"Arial",fontSize:8,bold:true,color:p.accent,charSpacing:2.1}));
    scene.elements.push(txt(slide.title,.72,.69,11.75,.6,{fontFace:p.titleFont,fontSize:27,bold:true,color:p.dark,fit:"shrink"}));
    if(slide.subtitle)scene.elements.push(txt(slide.subtitle,.72,1.29,10.9,.3,{fontFace:p.bodyFont,fontSize:10,color:p.muted,fit:"shrink"}));
    scene.elements.push(line(.72,6.98,11.88,0,{color:p.pale,width:.8}));
    scene.elements.push(txt("AI办公助手 · AI PPT",.72,7.08,3,.16,{fontFace:p.bodyFont,fontSize:7.5,color:p.muted}));
    scene.elements.push(txt(((slide.sources||[]).length)+"项来源",3.65,7.08,1.2,.16,{fontFace:p.bodyFont,fontSize:7.5,color:p.accent}));
    scene.elements.push(txt((index+1)+" / "+total,11.65,7.08,.95,.16,{fontFace:"Arial",fontSize:7.5,color:p.muted,align:"right"}));
    addAsset(scene,slide);
  }
  function sceneBase(slide,plan,index,total,composition){return{schema:"ppt-design-ir",version:1,width:W,height:H,slideId:slide.id||"",layoutId:slide.layoutId,composition,styleId:(slide.visualPlan&&slide.visualPlan.styleId)||plan.templateId||"anju-blue",background:palette(plan).bg,elements:[],meta:{index,total,sourcePages:(slide.visualPlan&&slide.visualPlan.sourcePages)||[]}};}
  function cover(slide,plan,index,total,p){
    const s=sceneBase(slide,plan,index,total,"cover-architectural");s.background=p.dark;
    s.elements.push(rect(0,0,4.15,H,{fill:p.accent}),rect(4.15,0,9.183,H,{fill:"FFFFFF"}));
    for(let i=0;i<8;i++)s.elements.push(rect(8.2+i*.52,5.75-(i%4)*.55,.34,1.75+(i%4)*.55,{fill:i%3===0?p.accent:p.pale,transparency:i%3===0?4:20}));
    s.elements.push(txt("SHENZHEN · HOUSING · DIGITAL",4.72,1.08,6.8,.24,{fontFace:"Arial",fontSize:9,bold:true,color:p.accent,charSpacing:2.8}));
    s.elements.push(txt(plan.title||slide.title,4.72,2.02,7.55,1.28,{fontFace:p.titleFont,fontSize:38,bold:true,color:p.dark,fit:"shrink",valign:"mid"}));
    s.elements.push(line(4.72,3.56,5.95,0,{color:p.pale,width:1}));
    s.elements.push(txt(slide.subtitle||plan.purpose,4.72,3.9,6.9,.66,{fontFace:p.bodyFont,fontSize:16,color:p.muted,fit:"shrink"}));
    s.elements.push(txt((plan.designSpec&&plan.designSpec.brandName)||"深圳市安居集团",4.72,6.35,3.4,.25,{fontFace:p.bodyFont,fontSize:10,color:p.dark}));
    return s;
  }
  function statement(slide,plan,index,total,p){
    const section=slide.layoutId==="section",s=sceneBase(slide,plan,index,total,section?"section-monolith":"statement-focus");s.background=section?p.accent:p.dark;
    s.elements.push(txt(section?"SECTION":"KEY TAKEAWAY",.98,.92,3.7,.25,{fontFace:"Arial",fontSize:9,bold:true,color:section?"FFFFFF":p.secondary,charSpacing:2.8}));
    s.elements.push(line(1.0,1.34,1.05,0,{color:section?"FFFFFF":p.secondary,width:2}));
    s.elements.push(txt(slide.title,1.0,1.68,10.95,1.95,{fontFace:p.titleFont,fontSize:38,bold:true,color:"FFFFFF",fit:"shrink",valign:"mid"}));
    s.elements.push(txt(slide.subtitle||(slide.bullets||[])[0]||"",1.0,4.25,9.65,.85,{fontFace:p.bodyFont,fontSize:17,color:"DCE8F2",fit:"shrink"}));
    s.elements.push(txt(String(index+1).padStart(2,"0"),10.75,5.55,1.25,.7,{fontFace:"Arial",fontSize:44,bold:true,color:"FFFFFF",transparency:68,align:"right"}));return s;
  }
  function agenda(slide,plan,index,total,p){
    const s=sceneBase(slide,plan,index,total,"agenda-modular");addChrome(s,slide,p,index,total,"CONTENTS");
    listOf(slide).slice(0,6).forEach((v,i)=>{const col=i%2,row=Math.floor(i/2),x=.78+col*6.05,y=1.82+row*1.38;
      s.elements.push(txt(String(i+1).padStart(2,"0"),x,y,.62,.35,{fontFace:"Arial",fontSize:17,bold:true,color:p.accent}));
      s.elements.push(txt(textOf(v),x+.82,y-.02,4.95,.68,{fontFace:p.bodyFont,fontSize:15,bold:true,color:p.dark,fit:"shrink"}));
      s.elements.push(line(x+.82,y+.84,4.95,0,{color:p.pale,width:.8}));});return s;
  }
  function metric(slide,plan,index,total,p){
    const s=sceneBase(slide,plan,index,total,"metric-hero-grid");addChrome(s,slide,p,index,total,"KEY METRICS");const rows=((slide.content&&slide.content.metrics)||listOf(slide)).slice(0,4);
    const first=rows[0]||{};s.elements.push(rect(.78,1.82,4.15,4.65,{fill:p.accent,radius:.08,shadow:true}));
    s.elements.push(txt(first.value||first.text||"—",1.08,2.45,3.55,.85,{fontFace:"Arial",fontSize:37,bold:true,color:"FFFFFF",fit:"shrink"}));
    s.elements.push(txt(first.label||"核心指标",1.08,3.48,3.48,.48,{fontFace:p.titleFont,fontSize:17,bold:true,color:"FFFFFF",fit:"shrink"}));
    if(first.text&&first.value)s.elements.push(txt(first.text,1.08,4.3,3.35,.72,{fontFace:p.bodyFont,fontSize:10,color:"DCEAF5",fit:"shrink"}));
    rows.slice(1,4).forEach((m,i)=>{const x=5.18+i*2.46;s.elements.push(rect(x,2.18,2.25,3.75,{fill:"FFFFFF",line:p.pale,radius:.07,shadow:true}));s.elements.push(txt(String(i+2).padStart(2,"0"),x+.22,2.43,.45,.22,{fontFace:"Arial",fontSize:8,bold:true,color:p.muted}));s.elements.push(txt(m.value||m.text||"—",x+.22,3.13,1.82,.66,{fontFace:"Arial",fontSize:25,bold:true,color:p.accent,fit:"shrink"}));s.elements.push(txt(m.label||"关键指标",x+.22,4.02,1.82,.48,{fontFace:p.bodyFont,fontSize:12,bold:true,color:p.dark,fit:"shrink"}));if(m.text&&m.value)s.elements.push(txt(m.text,x+.22,4.72,1.8,.55,{fontFace:p.bodyFont,fontSize:8.5,color:p.muted,fit:"shrink"}));});return s;
  }
  function timeline(slide,plan,index,total,p){
    const s=sceneBase(slide,plan,index,total,slide.layoutId==="process"?"process-stair":"timeline-roadmap");addChrome(s,slide,p,index,total,slide.layoutId==="process"?"EXECUTION PATH":"MILESTONE ROADMAP");const rows=((slide.content&&slide.content.steps)||listOf(slide)).slice(0,6),n=Math.max(1,rows.length),start=.95,end=12.05,gap=(end-start)/Math.max(1,n-1);s.elements.push(line(start,3.14,end-start,0,{color:p.pale,width:6}));s.elements.push(line(start,3.14,end-start,0,{color:p.secondary,width:1.5}));rows.forEach((v,i)=>{const x=start+i*gap,y=slide.layoutId==="process"&&i%2?3.52:2.76;s.elements.push(ellipse(x-.25,2.88,.5,.5,{fill:i===0?p.accent:"FFFFFF",line:p.accent,width:1.5}));s.elements.push(txt(String(i+1).padStart(2,"0"),x-.18,3.02,.36,.14,{fontFace:"Arial",fontSize:7.5,bold:true,color:i===0?"FFFFFF":p.accent,align:"center"}));s.elements.push(txt(v.label||v.title||("阶段"+(i+1)),Math.max(.55,x-.72),y+(i%2?0:.72),1.45,.38,{fontFace:p.titleFont,fontSize:11,bold:true,color:p.dark,align:"center",fit:"shrink"}));s.elements.push(txt(v.text||v.detail||"",Math.max(.48,x-.8),y+(i%2?.48:1.16),1.6,.76,{fontFace:p.bodyFont,fontSize:8.2,color:p.muted,align:"center",fit:"shrink"}));});return s;
  }
  function comparison(slide,plan,index,total,p){
    const s=sceneBase(slide,plan,index,total,"comparison-editorial");addChrome(s,slide,p,index,total,"DECISION COMPARE");const data=slide.content||{},rows=Array.isArray(data.columns)?data.columns:[{title:"方案 A",items:(slide.bullets||[]).slice(0,Math.ceil((slide.bullets||[]).length/2))},{title:"方案 B",items:(slide.bullets||[]).slice(Math.ceil((slide.bullets||[]).length/2))}];rows.slice(0,2).forEach((c,i)=>{const x=.78+i*6.03,fill=i===0?p.accent:"FFFFFF",fg=i===0?"FFFFFF":p.dark;s.elements.push(rect(x,1.82,5.74,4.34,{fill,line:i===0?p.accent:p.pale,radius:.08,shadow:true}));s.elements.push(txt(String.fromCharCode(65+i),x+.34,2.12,.55,.34,{fontFace:"Arial",fontSize:15,bold:true,color:i===0?"FFFFFF":p.accent}));s.elements.push(txt(c.title||("方案 "+String.fromCharCode(65+i)),x+.34,2.72,4.95,.5,{fontFace:p.titleFont,fontSize:20,bold:true,color:fg,fit:"shrink"}));(c.items||[]).slice(0,5).forEach((v,j)=>{s.elements.push(ellipse(x+.38,3.52+j*.45,.1,.1,{fill:i===0?p.secondary:p.accent}));s.elements.push(txt(textOf(v),x+.62,3.43+j*.45,4.58,.32,{fontFace:p.bodyFont,fontSize:10,color:i===0?"E5EFF8":p.muted,fit:"shrink"}));});});if(slide.claim)s.elements.push(rect(3.2,6.35,6.95,.48,{fill:p.pale,radius:.05}),txt(slide.claim,3.42,6.47,6.5,.2,{fontFace:p.bodyFont,fontSize:9,bold:true,color:p.accent,align:"center",fit:"shrink"}));return s;
  }
  function buildScene(slide={},plan={},index=0){const id=slide.layoutId||(slide.type==="cover"?"cover":"statement"),p=palette(plan),total=(plan.slides||[]).length||1;if(id==="cover")return cover(slide,plan,index,total,p);if(id==="section"||id==="statement")return statement(slide,plan,index,total,p);if(id==="agenda")return agenda(slide,plan,index,total,p);if(id==="metric"||id==="kpi-tower")return metric(slide,plan,index,total,p);if(id==="timeline"||id==="process")return timeline(slide,plan,index,total,p);if(id==="comparison"||id==="two-column")return comparison(slide,plan,index,total,p);return null;}
  function html(scene){if(!scene)return"";const pct=(v,max)=>(v/max*100).toFixed(4)+"%",style=e=>`left:${pct(e.x,W)};top:${pct(e.y,H)};width:${pct(e.w,W)};height:${pct(e.h,H)};`,nodes=scene.elements.map(e=>{let css=style(e)+`color:#${e.color||"24292F"};`;if(e.type==="text")css+=`font-family:${esc(e.fontFace)};font-size:${(e.fontSize/540*100).toFixed(3)}cqh;font-weight:${e.bold?700:400};text-align:${e.align};justify-content:${e.valign==="mid"?"center":"flex-start"};opacity:${e.transparency!=null?1-e.transparency/100:1};`;else css+=`background:${e.fill?"#"+e.fill:"transparent"};border:${e.line?Math.max(1,e.width||1)+"px solid #"+e.line:"0"};border-radius:${e.type==="ellipse"?"50%":e.radius?"8px":"0"};${e.shadow?"box-shadow:0 8px 22px rgba(24,52,75,.14);":""}`;if(e.type==="line")css+=`height:${Math.max(1,e.width||1)}px;background:#${e.color||"DCE7F5"};`;if(e.type==="image")return `<img class="ppt-ir-el image" src="${esc(e.dataUrl)}" alt="" style="${css}object-fit:${e.fit||"contain"};opacity:${e.transparency!=null?1-e.transparency/100:1}">`;return e.type==="text"?`<div class="ppt-ir-el text" style="${css}">${esc(e.text)}</div>`:`<div class="ppt-ir-el ${e.type}" style="${css}"></div>`;}).join("");return `<div class="ppt-ir-scene" style="background:#${scene.background}">${nodes}</div>`;}
  function inspect(scene){const errors=[],warnings=[];if(!scene)return{ok:false,errors:["Design IR为空"],warnings};const ids=new Set();scene.elements.forEach((e,i)=>{if(!["text","rect","line","ellipse","image"].includes(e.type))errors.push("未知元素类型："+e.type);if([e.x,e.y,e.w,e.h].some(v=>!Number.isFinite(v)))errors.push("第"+(i+1)+"个元素坐标无效");if(e.x<0||e.y<0||e.x+e.w>W+.01||e.y+e.h>H+.01)warnings.push("第"+(i+1)+"个元素超出画布");const key=[e.type,e.x,e.y,e.w,e.h].join("|");if(ids.has(key))warnings.push("发现完全重叠元素");ids.add(key);});return{ok:!errors.length,errors,warnings};}
  const api={WIDTH:W,HEIGHT:H,SUPPORTED,buildScene,renderHtml:html,inspect,palette};root.PptDesignIR=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
