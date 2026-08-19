/* Local-first image provider registry. External providers can be added later. */
(function(root){
  "use strict";
  const providers=new Map();
  function register(id,provider){if(!id||!provider||typeof provider.search!=="function")throw new Error("图片Provider必须提供search方法");providers.set(id,provider);}
  function projectAssets(plan={},query=""){const q=String(query).toLowerCase(),assets=((plan.evidencePack&&plan.evidencePack.assets)||[]).filter(a=>a.kind==="image"&&a.dataUrl);return assets.filter(a=>!q||String(a.name||"").toLowerCase().includes(q)).map(a=>({id:a.id||a.name,label:a.name,kind:"image",dataUrl:a.dataUrl,sourceRef:a.name,provider:"project-assets"}));}
  register("project-assets",{name:"项目材料图片",local:true,async search(query,ctx){return projectAssets(ctx&&ctx.plan,query);}});
  register("placeholder",{name:"系统图形占位",local:true,async search(query){const label=String(query||"项目图片").slice(0,16),svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#edf5fb"/><path d="M0 540L260 310l180 150 245-280 515 495H0z" fill="#b8d8ee"/><text x="600" y="600" text-anchor="middle" font-size="34" fill="#397aa8" font-family="Microsoft YaHei">'+label.replace(/[<&]/g,"")+'</text></svg>';return[{id:"placeholder:"+label,label,kind:"illustration",dataUrl:"data:image/svg+xml;base64,"+btoa(unescape(encodeURIComponent(svg))),sourceRef:"系统生成占位图",provider:"placeholder"}];}});
  async function search(query,ctx={},ids){const use=ids&&ids.length?ids:Array.from(providers.keys()),out=[];for(const id of use){const p=providers.get(id);if(!p)continue;try{for(const x of await p.search(query,ctx)||[])out.push({...x,provider:id});}catch(e){out.push({provider:id,error:e.message});}}return out;}
  const api={register,search,projectAssets,list:()=>Array.from(providers.entries()).map(([id,p])=>({id,name:p.name,local:!!p.local}))};root.PptImageProviders=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
