const base=String(process.env.COMFYUI_BASE_URL||"http://127.0.0.1:8188").replace(/\/+$/,"");
const key=String(process.env.COMFYUI_API_KEY||"").trim();
const headers=key?{Authorization:`Bearer ${key}`}:{},timeout=Number(process.env.COMFYUI_REQUEST_TIMEOUT_MS)||10000;
async function get(path){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{const response=await fetch(base+path,{headers,signal:controller.signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);return await response.json();}
  finally{clearTimeout(timer);}
}
try{
  const [stats,nodes]=await Promise.all([get("/system_stats"),get("/object_info")]);
  const required=["CheckpointLoaderSimple","CLIPTextEncode","EmptyLatentImage","KSampler","VAEDecode","SaveImage"];
  const missing=required.filter(name=>!nodes[name]);
  const devices=stats.devices||stats.system?.devices||[];
  console.log(JSON.stringify({ok:missing.length===0,base,devices,requiredNodes:required,missingNodes:missing},null,2));
  if(missing.length)process.exitCode=2;
}catch(error){
  console.error(JSON.stringify({ok:false,base,error:error.name==="AbortError"?"连接超时":error.message},null,2));
  process.exitCode=1;
}
