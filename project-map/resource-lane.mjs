// One scene owns the entire fetch -> decode -> upload -> material-settle lane.
// Budgets are conservative accounting estimates, NOT measured physical VRAM.
export const MIB=1024*1024;
export function estimateSceneResources(scene,engine){
 let geometry=0,textures=0;const seen=new Set();
 for(const g of scene.geometries||[]){
  for(const kind of g.getVerticesDataKinds?.()||[]){const data=g.getVerticesData(kind);if(data&&!seen.has(data)){seen.add(data);geometry+=data.byteLength??data.length*4;}}
  const indices=g.getIndices?.();if(indices&&!seen.has(indices)){seen.add(indices);geometry+=indices.byteLength??indices.length*4;}
 }
 for(const t of new Set(engine.getLoadedTexturesCache?.()||[])){
  const component=t.type===1?4:t.type===2?2:1;
  textures+=Math.max(1,t.width||0)*Math.max(1,t.height||0)*4*component*(t.isCube?6:1)*(t.generateMipMaps?4/3:1)*Math.max(1,t.samples||1);
 }
 const targets=engine.getRenderWidth()*engine.getRenderHeight()*32;
 return {geometry:geometry*2,textures:Math.ceil(textures),targets,total:geometry*2+Math.ceil(textures)+targets};
}
export function createResourceLane(isActive=()=>true,options={}){
 const limit=options.limit??384*MIB,transient=options.transient??96*MIB;
 let tail=Promise.resolve(),queued=0,active=0,peak=0,blocked=0,stopped=false,label='',cooldown=0;
 const evictors=new Set(),abort=new AbortController();
 const measure=()=>Math.max(0,Number(options.measure?.())||0);
 function trim(target){for(const evict of evictors){if(measure()<=target)break;evict();}}
 function run(task,settings={}){
  if(stopped||queued>=16||Date.now()<cooldown)return settings.required?Promise.reject(Error('必要资源未加载：队列暂停或预算冷却中，请稍后重新加载。')):Promise.resolve(null);
  queued++;
  const next=tail.then(async()=>{
   queued--;
   if(stopped||!isActive()||settings.wanted?.()===false)return null;
   const reserve=settings.reserve??transient;
   trim(limit-reserve);
   if(measure()+reserve>limit){blocked++;cooldown=Date.now()+2000;options.onPressure?.();if(settings.required)throw Error('必要资源超过当前预算，初始化未完成。');return null;}
   active=1;label=settings.label||'资源';peak=Math.max(peak,measure()+reserve);
   try{
    const value=await task(abort.signal);
    if(!stopped&&isActive())await options.settle?.(abort.signal);
    const current=measure();peak=Math.max(peak,current+reserve);
    if(current>limit-reserve){trim(limit-reserve);options.onPressure?.();}
    return value;
   }finally{active=0;label='';await new Promise(resolve=>setTimeout(resolve,options.delay??80));}
  });
  tail=next.catch(()=>{});return next;
 }
 run.registerEvictor=fn=>{evictors.add(fn);return ()=>evictors.delete(fn);};
 run.isActive=()=>!stopped&&isActive();
 run.stop=()=>{stopped=true;abort.abort();};
 Object.defineProperty(run,'stats',{get:()=>({resident:measure(),limit,reserve:active?transient:0,peak,active,queued,blocked,label,stopped})});
 return run;
}

export async function settleSceneTextures(scene,isActive,signal,timeout=20000){
 const start=Date.now();
 while(isActive()&&!signal.aborted&&(scene.textures||[]).some(t=>!t.isReady()&&!t.loadingError)){
  if(Date.now()-start>timeout){const pending=(scene.textures||[]).filter(t=>!t.isReady()&&!t.loadingError).map(t=>({name:t.name,url:t.url,kind:t.getClassName?.(),delay:t.delayLoadState}));console.warn('Pending scene textures',JSON.stringify(pending));throw Error('材质加载超时，已停止本批资源；可重试或返回二维');}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
}
