/* PPT图片Provider注册表：项目素材、部门素材、本地插图、云端与本地AI生图统一入口。 */
(function(root){
  "use strict";
  const providers=new Map();
  const svgData=svg=>typeof Buffer!=="undefined"
    ?"data:image/svg+xml;base64,"+Buffer.from(svg,"utf8").toString("base64")
    :"data:image/svg+xml;base64,"+btoa(unescape(encodeURIComponent(svg)));
  const esc=s=>String(s==null?"":s).replace(/[<&]/g,"").slice(0,80);

  function register(id,provider){
    if(!id||!provider||typeof provider.search!=="function")throw new Error("图片Provider必须提供search方法");
    providers.set(id,provider);
    if(root.document)root.document.documentElement.dataset.pptImageProviderCount=String(providers.size);
  }

  function projectAssets(plan={},query=""){
    const q=String(query).toLowerCase();
    const assets=((plan.evidencePack&&plan.evidencePack.assets)||[]).filter(a=>a.kind==="image"&&a.dataUrl);
    return assets.filter(a=>!q||String(a.name||"").toLowerCase().includes(q)).map(a=>({
      id:a.id||a.name,label:a.name,kind:"image",dataUrl:a.dataUrl,sourceRef:a.name,provider:"project-assets"
    }));
  }

  register("project-assets",{name:"项目材料图片",local:true,async search(query,ctx){return projectAssets(ctx&&ctx.plan,query);}});
  register("department-assets",{name:"部门审核素材",local:true,async search(query,ctx){
    const q=String(query||"").toLowerCase();
    if(root.PptAssetCenter&&typeof root.PptAssetCenter.api==="function"){
      const listed=await root.PptAssetCenter.api({action:"list",scope:"department",search:q,limit:12});
      const details=await Promise.all((listed.items||[]).slice(0,12).map(x=>root.PptAssetCenter.api({action:"get",id:x.id}).catch(()=>null)));
      return details.filter(Boolean).map(x=>x.item).filter(x=>x&&x.dataUrl).map(x=>({id:x.id,libraryAssetId:x.id,label:x.title,kind:"image",dataUrl:x.dataUrl,sourceRef:"部门素材中心："+x.title,provider:"department-assets",tags:x.tags||[]}));
    }
    return((ctx&&ctx.plan&&ctx.plan.departmentAssets)||[])
      .filter(x=>x.status==="approved"&&x.dataUrl&&(!q||String([x.name,...(x.tags||[])].join(" ")).toLowerCase().includes(q)))
      .map(x=>({...x,id:x.id||x.name,label:x.name,sourceRef:x.sourceRef||"部门审核素材",provider:"department-assets"}));
  }});
  register("local-illustration",{name:"本地智能插图",local:true,async search(query,ctx){
    const label=esc(query||"项目研判").slice(0,20),accent=(ctx&&ctx.accent)||"2387C7";
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#F4F9FD"/><circle cx="960" cy="120" r="180" fill="#DDECF7"/><path d="M0 590L230 380l155 130 205-270 180 170 145-120 285 300z" fill="#B8D8EE"/><path d="M95 590V330h120v260m55 0V250h150v340m50 0V365h105v225m70 0V205h165v385m55 0V315h115v275" fill="none" stroke="#'+accent+'" stroke-width="18"/><g fill="#'+accent+'"><circle cx="155" cy="300" r="13"/><circle cx="345" cy="218" r="13"/><circle cx="727" cy="170" r="13"/></g><text x="74" y="100" font-family="Microsoft YaHei" font-size="42" font-weight="700" fill="#173F63">'+label+'</text><text x="76" y="148" font-family="Arial" font-size="18" letter-spacing="5" fill="#65839A">LOCAL · TRACEABLE · EDITABLE</text></svg>';
    return[{id:"local-illustration:"+label,label:"本地插图："+label,kind:"illustration",dataUrl:svgData(svg),sourceRef:"系统本地智能插图生成器",provider:"local-illustration",prompt:label}];
  }});

  function browserAuthHeaders(){
    try{return typeof root.authHeaders==="function"?root.authHeaders():{};}catch{return{};}
  }
  function buildPrompt(query,ctx={}){
    const style=ctx.style||"专业政务商务风";
    return[
      String(query||"保障性住房项目主视觉"),
      `风格：${style}，深圳现代城市与保障性住房，浅蓝和深蓝配色，构图高级、规整、真实。`,
      "16:9横向PPT主视觉，主体位于画面右侧或中下部，左侧保留文字安全区。",
      "图片中不要出现文字、数字、标志、水印、图表或虚构数据。"
    ].join("\n");
  }
  function apiProvider(id,name,local){
    return{name,local,async search(query,ctx={}){
      if(typeof root.fetch!=="function")return[];
      const options=ctx.imageProviderOptions||{};
      const response=await root.fetch("/api/ppt-image-generate",{
        method:"POST",
        headers:{"Content-Type":"application/json",...browserAuthHeaders()},
        body:JSON.stringify({
          provider:id,
          prompt:buildPrompt(query,ctx),
          aspectRatio:options.aspectRatio||"16:9",
          imageSize:options.imageSize||"1K",
          mode:options.mode||"standard",
          workflow:options.workflow||"ppt-image-hero"
        })
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(data.error||`${name}调用失败`);
      return data.image?[{...data.image,provider:id}]:[];
    }};
  }
  register("nano-banana",apiProvider("nano-banana","Nano Banana云端生图",false));
  register("comfyui",apiProvider("comfyui","ComfyUI本地生图",true));
  register("local-ai-image",{name:"自定义本地AI生图",local:true,async search(query,ctx){
    if(!ctx||typeof ctx.imageGenerator!=="function")return[];
    const rows=await ctx.imageGenerator({prompt:String(query||""),style:ctx.style||"business"});
    return(rows||[]).map(x=>({...x,provider:"local-ai-image",sourceRef:x.sourceRef||"自定义本地AI生图"}));
  }});
  register("placeholder",{name:"系统图形占位",local:true,async search(query){
    const label=esc(query||"项目图片").slice(0,16),svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#edf5fb"/><path d="M0 540L260 310l180 150 245-280 515 495H0z" fill="#b8d8ee"/><text x="600" y="600" text-anchor="middle" font-size="34" fill="#397aa8" font-family="Microsoft YaHei">'+label+'</text></svg>';
    return[{id:"placeholder:"+label,label,kind:"illustration",dataUrl:svgData(svg),sourceRef:"系统生成占位图",provider:"placeholder"}];
  }});

  async function search(query,ctx={},ids){
    const use=ids&&ids.length?ids:Array.from(providers.keys()),out=[];
    for(const id of use){
      const provider=providers.get(id);if(!provider)continue;
      try{for(const item of await provider.search(query,ctx)||[])out.push({...item,provider:id});}
      catch(error){out.push({provider:id,error:error.message});}
    }
    return out;
  }
  const api={register,search,projectAssets,list:()=>Array.from(providers.entries()).map(([id,p])=>({id,name:p.name,local:!!p.local}))};
  root.PptImageProviders=api;
  if(root.document)root.document.documentElement.dataset.pptImageProviderCount=String(providers.size);
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
