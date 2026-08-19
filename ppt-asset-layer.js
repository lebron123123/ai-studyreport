/* AI PPT asset layer: admission, provenance, semantic matching and generated SVG fallbacks. */
(function(root){
  "use strict";
  const clean=(v,n=500)=>String(v==null?"":v).trim().slice(0,n);
  const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,"0");};
  const words=s=>clean(s,2000).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>1);
  function svgData(svg){const text=String(svg||"");if(typeof Buffer!=="undefined")return"data:image/svg+xml;base64,"+Buffer.from(text,"utf8").toString("base64");return"data:image/svg+xml;base64,"+btoa(unescape(encodeURIComponent(text)));}
  function iconSvg(name,color="2387C7",soft="DDECF7"){
    const paths={building:'<path d="M20 58V20h24v38M12 58h40M27 28h4m6 0h4m-14 9h4m6 0h4m-14 9h4m6 0h4"/>',chart:'<path d="M12 56h42M18 50V36h8v14m7 0V24h8v26m7 0V14h8v36"/>',route:'<path d="M13 48c8-20 16 12 25-10s17-5 18-22M12 48a4 4 0 1 0 0 .1M56 16a4 4 0 1 0 0 .1"/>',people:'<circle cx="24" cy="23" r="7"/><circle cx="44" cy="23" r="7"/><path d="M12 52c1-11 6-17 12-17s11 6 12 17m-3 0c1-10 5-15 11-15s10 5 12 15"/>',shield:'<path d="M34 10l20 8v13c0 14-8 23-20 29-12-6-20-15-20-29V18z"/><path d="M24 34l7 7 14-16"/>',home:'<path d="M10 34L34 13l24 21M17 31v28h34V31M28 59V43h12v16"/>'};
    const body=paths[name]||paths.building;
    return svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 68 68"><circle cx="34" cy="34" r="32" fill="#${soft}"/><g fill="none" stroke="#${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`);
  }
  function normalizeAsset(a={},index=0){
    const dataUrl=String(a.dataUrl||a.src||""),kind=clean(a.assetKind||a.kind,30)==="image"?(dataUrl.includes("svg+xml")?"svg":"photo"):clean(a.assetKind||a.kind,30)||"icon";
    const width=Number(a.width)||0,height=Number(a.height)||0,tags=Array.from(new Set([...(a.tags||[]),...words(a.name),...words(a.text)].map(x=>clean(x,40)).filter(Boolean))).slice(0,30);
    return{id:clean(a.id,100)||"asset_"+hash((a.name||index)+dataUrl.slice(0,200)),name:clean(a.name,160)||"未命名素材",kind,dataUrl,width,height,aspectRatio:width&&height?width/height:Number(a.aspectRatio)||0,tags,sourceRef:clean(a.sourceRef||a.name,240),version:clean(a.version,60)||"本次导入",editable:a.editable!==false,generated:!!a.generated,provider:clean(a.provider,80)||"local",license:clean(a.license,100)||"internal-use",status:clean(a.status,30)||"candidate"};
  }
  function admitAsset(asset){
    const a=normalizeAsset(asset),errors=[],warnings=[];
    if(!["photo","svg","icon","diagram","chart","texture"].includes(a.kind))errors.push("不支持的素材类型");
    if(!a.dataUrl.startsWith("data:image/"))errors.push("素材必须是本地解析后的图片或SVG数据");
    if(!a.sourceRef)errors.push("缺少来源标识");
    if(a.dataUrl.length>16*1024*1024)errors.push("素材超过约12MB准入上限");
    if(a.kind==="photo"&&a.width&&a.height&&Math.min(a.width,a.height)<480)warnings.push("图片分辨率偏低");
    if(!a.tags.length)warnings.push("缺少语义标签，自动匹配精度会降低");
    return{ok:!errors.length,asset:{...a,status:errors.length?"rejected":warnings.length?"admitted-with-warning":"admitted"},errors,warnings};
  }
  function builtinAssets(palette={}){
    const color=palette.accent||"2387C7",soft=palette.pale||"DDECF7";
    return[
      ["building","建筑与项目","建筑 住房 项目 区位 规划"],["chart","数据与指标","数据 指标 测算 投资 收益"],["route","进度与路径","工期 进度 阶段 路径 流程"],
      ["people","人口与客群","人口 客群 需求 职住"],["shield","风险与审查","风险 审查 规则 安全"],["home","保障性住房","保障房 住房 安居 公寓"]
    ].map(([id,name,tags])=>normalizeAsset({id:"builtin_"+id,name,assetKind:"icon",dataUrl:iconSvg(id,color,soft),tags:tags.split(" "),sourceRef:"系统内置可编辑图标库",version:"v1",generated:true,editable:false,provider:"builtin"}));
  }
  function buildCatalog(evidencePack,palette){
    const raw=((evidencePack&&evidencePack.assets)||[]).filter(x=>x.dataUrl).map((x,i)=>normalizeAsset({...x,assetKind:x.kind==="image"?"photo":x.kind,sourceRef:x.name},i));
    const admitted=raw.map(admitAsset),assets=admitted.filter(x=>x.ok).map(x=>x.asset).concat(builtinAssets(palette));
    return{schema:"ppt-asset-catalog",version:1,assets,rejected:admitted.filter(x=>!x.ok),summary:{total:assets.length,project:assets.filter(x=>x.provider!=="builtin").length,builtin:assets.filter(x=>x.provider==="builtin").length,editable:assets.filter(x=>x.editable).length}};
  }
  function matchAsset(slide,catalog,opts={}){
    const text=[slide.title,slide.subtitle,slide.claim,slide.takeaway,...(slide.bullets||[])].join(" "),tokens=new Set(words(text)),used=new Set(opts.usedIds||[]),preferred=opts.kind||((slide.layoutId==="image-hero"||slide.layoutId==="cover")?"photo":"icon");
    const ranked=(catalog&&catalog.assets||[]).map(a=>{let score=0;for(const t of a.tags||[])if(tokens.has(String(t).toLowerCase())||text.includes(t))score+=12;if(a.kind===preferred)score+=22;if(preferred==="photo"&&a.kind==="svg")score+=8;if(a.provider!=="builtin")score+=6;if(used.has(a.id))score-=18;if(a.aspectRatio>=1.25)score+=3;return{asset:a,score};}).sort((a,b)=>b.score-a.score);
    const hit=ranked[0];return hit&&hit.score>10?{assetId:hit.asset.id,kind:hit.asset.kind,dataUrl:hit.asset.dataUrl,name:hit.asset.name,sourceRef:hit.asset.sourceRef,provider:hit.asset.provider,score:hit.score,rationale:"按页面语义、素材类型、横纵比、来源和重复使用情况匹配",editable:hit.asset.editable,status:"matched"}:{assetId:"",status:"no-match",score:0,rationale:"无满足准入和语义阈值的素材，继续使用原生可编辑图形"};
  }
  const api={normalizeAsset,admitAsset,buildCatalog,matchAsset,builtinAssets,iconSvg,svgData};root.PptAssetLayer=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
