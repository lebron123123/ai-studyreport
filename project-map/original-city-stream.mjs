export function distanceToBlock(p,b){return Math.hypot(Math.max(b[0]-p.x,0,p.x-b[2]),Math.max(b[1]-p.z,0,p.z-b[3]));}
export async function readOriginalBlock(url,signal){
 for(let attempt=0;attempt<2;attempt++)try{signal?.throwIfAborted();const response=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});if(!response.ok){const e=Error('HTTP '+response.status);e.permanent=response.status>=400&&response.status<500;throw e;}return new Uint8Array(await response.arrayBuffer());}catch(e){if(signal?.aborted||e.permanent||attempt===1)throw e;}
}
// Coarse geometry remains as the district overview; fine containers really dispose.
export function createOriginalCityStream(scene,apply,notify,upload=task=>task(),processBuildings=()=>{}){
 const B=globalThis.BABYLON,coarse=new Map(),fine=new Map(),pending=new Set(),failed=new Set(),lifetime=new AbortController();let tiles=[],dead=false,wanted=new Set(),stamp=0;
 function release(a){a.dispose();}
 async function load(t,lod){const key=t.key+'-'+lod;pending.add(key);const assets=[];
  try{await upload(async signal=>{for(const part of t.parts){const data=await readOriginalBlock(`/project-map/city-stream-v1/${part}-${t.key}-${lod}.glb`,signal);if(dead||upload.isActive?.()===false)break;const a=await B.LoadAssetContainerAsync(data,scene,{pluginExtension:'.glb'});assets.push(a);if(dead||upload.isActive?.()===false)break;a.meshes[0].rotationQuaternion=B.Quaternion.Identity();for(const m of a.meshes){m.metadata={...m.metadata,originalBlock:t.key,lod};}if(lod==='fine')apply(a.meshes,part);}
   if(dead||upload.isActive?.()===false||(lod==='fine'&&!wanted.has(t.key))){assets.forEach(release);return;}
   assets.forEach((a,i)=>{if(t.parts[i]==='buildings')processBuildings(a.meshes);a.addAllToScene();});(lod==='fine'?fine:coarse).set(t.key,assets);if(lod==='fine')coarse.get(t.key)?.forEach(a=>a.meshes[0].setEnabled(false));
  },{label:'原城区 '+lod,wanted:()=>!dead&&(lod==='coarse'||Date.now()>=pressureUntil&&wanted.has(t.key))});
  }catch(e){(lod==='fine'?fine:coarse).delete(t.key);if(lod==='fine')coarse.get(t.key)?.forEach(a=>a.meshes[0].setEnabled(true));assets.forEach(release);failed.add(key);if(!dead){scene.metadata.originalError=String(e.message||e);console.warn('Original city block',key,scene.metadata.originalError);notify('原城区部分资源未载入，保留已有概览；可刷新重试。',true);}}
  finally{pending.delete(key);if(!dead&&scene.metadata){scene.metadata.originalFine=fine.size;scene.metadata.originalCoarse=coarse.size;}}
 }
 let pressureUntil=0;
 const unregister=upload.registerEvictor?.(()=>{for(const [k,assets] of fine){assets.forEach(release);coarse.get(k)?.forEach(a=>a.meshes[0].setEnabled(true));}fine.clear();pressureUntil=Date.now()+30000;});
 return {async init(){const r=await fetch('/project-map/city-stream-v1/index.json',{signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(20000)])});if(!r.ok)throw Error('分区目录 HTTP '+r.status);const index=await r.json();if(dead)return;tiles=index.tiles;scene.metadata.originalBlocks=tiles.length;},update(camera,focus){if(dead||performance.now()-stamp<500)return;stamp=performance.now();
  wanted=new Set(tiles.map(t=>({...t,d:Math.min(distanceToBlock(camera,t.bounds),distanceToBlock(focus,t.bounds))})).filter(t=>t.d<1100&&camera.y<2000).sort((a,b)=>a.d-b.d).slice(0,12).map(t=>t.key));
  for(const [k,as] of fine)if(!wanted.has(k)){coarse.get(k)?.forEach(a=>a.meshes[0].setEnabled(true));as.forEach(release);fine.delete(k);}
  for(const k of failed)if(k.endsWith('-fine')&&!wanted.has(k.slice(0,-5)))failed.delete(k);
  const order=[...tiles].sort((a,b)=>distanceToBlock(focus,a.bounds)-distanceToBlock(focus,b.bounds));
  for(const t of order){for(const lod of ['coarse',...(Date.now()>=pressureUntil&&wanted.has(t.key)&&coarse.has(t.key)?['fine']:[])]){const k=t.key+'-'+lod;if(pending.size>=2)break;if(!(lod==='fine'?fine:coarse).has(t.key)&&!pending.has(k)&&!failed.has(k))load(t,lod);}}
  scene.metadata.originalFine=fine.size;scene.metadata.originalCoarse=coarse.size;
 },get bounds(){return tiles.map(t=>t.bounds);},dispose(){dead=true;lifetime.abort();unregister?.();wanted.clear();for(const a of [...coarse.values(),...fine.values()].flat())release(a);coarse.clear();fine.clear();}};
}
