import {ProjectObserver as CityObserver} from './project-observer.mjs';
import {createArchitectureMaterials} from './reference/city-architecture-materials.mjs';
import {createFacadeDiversity} from './reference/city-facade-diversity.mjs';
import {CityFacadeStream} from './reference/city-facade-stream.mjs';
import {createCinematicLook} from './reference/city-cinematic.mjs';
import {createRenderBudget} from './render-budget.mjs';
import {scenePoint,landmarkCoordinate,inCityCoverage} from './core.mjs';
import {createBaoanStream} from './baoan-city-stream.mjs';
import {createOriginalCityStream} from './original-city-stream.mjs';
import {createPlaceLabels} from './place-labels.mjs';
import {createCityReliefStream} from './city-relief-stream.mjs';
import {createRoadSurface} from './road-surface.mjs';
import {skyBoxSize} from './sky-bounds.mjs';
import {initializeSceneStages} from './scene-initialization.mjs';
import {loadDistrictGround} from './district-ground.mjs';
import {createResourceLane,estimateSceneResources,settleSceneTextures,MIB} from './resource-lane.mjs';
import {bindContextLifecycle} from './context-lifecycle.mjs';
import {createHQCity} from './anju-hq-city.mjs';

// A graphics-only scene: no vehicles, game physics, pedestrians or game loop.
export function createDetailedCity(container,catalog,notify,onManual,onPick=()=>{},onRestore=()=>{}){
 const B=globalThis.BABYLON,canvas=document.createElement('canvas');canvas.tabIndex=0;canvas.style.cssText='width:100%;height:100%;display:block;touch-action:none';canvas.setAttribute('aria-label','三维城市：WASD移动，QE升降，方向键转头');container.replaceChildren(canvas);
 B.MeshoptCompression.Configuration.decoder.url=new URL('./vendor/meshopt_decoder.js',import.meta.url).href;
 const engine=new B.Engine(canvas,false,{preserveDrawingBuffer:false,stencil:true,doNotHandleContextLost:true});engine.setHardwareScalingLevel(Math.max(1,window.devicePixelRatio||1)*1.25);
 const scene=new B.Scene(engine);scene.clearColor=new B.Color4(.62,.76,.84,1);
 const camera=new B.FreeCamera('city-observer',new B.Vector3(0,300,0),scene);camera.minZ=.5;camera.maxZ=60000;camera.fov=.85;scene.activeCamera=camera;
 const sun=new B.DirectionalLight('sun',new B.Vector3(.95,-.19,.31),scene),hemi=new B.HemisphericLight('sky-fill',new B.Vector3(0,1,0),scene);
 sun.intensity=2;hemi.intensity=.6;
 const skyBox=B.MeshBuilder.CreateBox('atmosphere',{size:skyBoxSize(camera.maxZ),sideOrientation:B.Mesh.BACKSIDE},scene);skyBox.isPickable=false;skyBox.setEnabled(false);
 // Start without HDR or post-processing. Enable the expensive original look explicitly.
 let pipeline=null;
 let architecture,diversity;
 const observer=new CityObserver(),keys=new Set(),events=new AbortController();
 const roads=createRoadSurface(scene);
 scene.onDisposeObservable.add(()=>roads.dispose());
 const apply=(meshes,name)=>{if(name.startsWith('facade-tiles/'))hq.filter(meshes);architecture?.applyMeshes(meshes,name);diversity?.applyMeshes(meshes,name);if(name==='roads')roads.applyMeshes(meshes);};
 let disposed=false,cinematic=null,light='sunset',last=0,facadeAt=0,orbit=false,drag=null,current=null,facadesReady=false,streamsReady=false,contextLost=false;
 const budget=createRenderBudget();
 const active=()=>!disposed&&!contextLost;
 const upload=createResourceLane(active,{measure:()=>estimateSceneResources(scene,engine).total,settle:signal=>settleSceneTextures(scene,active,signal),onPressure:()=>notify('资源预算保护：已释放近景细节，保留片区概览；新细节延后加载。')});
 const hq=createHQCity(scene,catalog,upload,notify);
 scene.onDisposeObservable.add(()=>hq.dispose());
 scene.onBeforeRenderObservable.add(()=>{if(streamsReady&&!contextLost)hq.update(camera.position);});
 const hqStatus=document.createElement('div');hqStatus.style.cssText='position:absolute;left:12px;bottom:42px;z-index:2;background:#ffffffdf;color:#17445b;padding:4px 8px;font-size:12px;pointer-events:none';container.append(hqStatus);
 scene.onBeforeRenderObservable.add(()=>{const s=hq.stats;hqStatus.textContent=`总部参考模型：${s.detail?'幕墙与 LOGO':'远景轮廓'} · 旧楼替换 ${s.removedTriangles} 面`;});
 scene.onDisposeObservable.add(()=>hqStatus.remove());
 const facades=new CityFacadeStream(scene,()=>{},apply,upload);
 const blockBounds=(catalog.baoanTiles||[]).map(t=>{const a=scenePoint(t.bounds.slice(0,2),catalog),b=scenePoint(t.bounds.slice(2),catalog);return [a.x,a.z,b.x,b.z];});
 const extent=[Math.min(-26000,...blockBounds.map(b=>b[0]))-1000,Math.min(-4000,...blockBounds.map(b=>b[1]))-1000,Math.max(7000,...blockBounds.map(b=>b[2]))+1000,Math.max(23000,...blockBounds.map(b=>b[3]))+1000];
 const baoan=createBaoanStream(scene,catalog,notify,upload);
 const original=createOriginalCityStream(scene,apply,notify,upload,meshes=>hq.filter(meshes));
 const relief=createCityReliefStream(scene,catalog,notify,upload);
 scene.onBeforeRenderObservable.add(()=>{if(streamsReady&&!contextLost)relief.update(camera.position);});
 scene.onDisposeObservable.add(()=>relief.dispose());
 const streamStatus=document.createElement('div');streamStatus.style.cssText='position:absolute;right:18px;top:220px;z-index:2;background:#ffffffdd;color:#17445b;padding:5px 8px;font-size:12px;pointer-events:none';container.append(streamStatus);
 let diagnosticAt=0,stage='准备';
 scene.onBeforeRenderObservable.add(()=>{if(performance.now()-diagnosticAt<1000)return;diagnosticAt=performance.now();const m=scene.metadata||{},r=roads.stats,s=upload.stats;const text=`阶段：${stage} · 估算资源 ${(s.resident/MIB).toFixed(0)} / ${s.limit/MIB} MiB（非物理显存） · 预留 ${s.reserve/MIB} MiB · 排队 ${s.queued} · ${s.label||'空闲'}\n原城区概览 ${m.originalCoarse||0}/${m.originalBlocks||159} · 精细 ${m.originalFine||0} · 补充 ${m.baoanLoaded||0} · 山体 ${relief.stats.fine} · 道路 ${r.materials?r.ready?'就绪':'读取中':'远景'}`;streamStatus.style.whiteSpace='pre-line';streamStatus.textContent=text;});scene.onDisposeObservable.add(()=>streamStatus.remove());
 scene.onBeforeRenderObservable.add(()=>{if(streamsReady&&!contextLost){baoan.update(camera.position,observer.focus);original.update(camera.position,observer.focus);}skyBox.position.copyFrom(camera.position);});
 scene.onDisposeObservable.add(()=>baoan.dispose());
 scene.onDisposeObservable.add(()=>original.dispose());
 const overview=document.createElement('select');overview.setAttribute('aria-label','片区全貌');overview.style.cssText='position:absolute;right:18px;top:185px;z-index:2;max-width:230px';overview.innerHTML='<option value="">查看片区全貌</option><option value="original">原有城区全貌</option><option value="baoan">宝安区全貌（简化）</option>';container.append(overview);
 for(const d of catalog.districts||[])if(d.id!=='baoan'){const o=document.createElement('option');o.value=d.id;o.textContent=d.name+'扩展区域全貌';overview.append(o);}
 overview.onchange=()=>{if(!overview.value)return;const bounds=overview.value!=='original'?(catalog.baoanTiles||[]).filter(t=>(t.district||'baoan')===overview.value&&t.count>0).map(t=>{const a=scenePoint(t.bounds.slice(0,2),catalog),b=scenePoint(t.bounds.slice(2),catalog);return [a.x,a.z,b.x,b.z];}):original.bounds;if(!bounds?.length)return;onManual();orbit=false;observer.overview([Math.min(...bounds.map(b=>b[0])),Math.min(...bounds.map(b=>b[1])),Math.max(...bounds.map(b=>b[2])),Math.max(...bounds.map(b=>b[3]))]);notify('片区概览：保留简化轮廓；靠近后自动换为详细模型，未知楼高不补造。');};scene.onDisposeObservable.add(()=>overview.remove());
 const estimateToggle=document.createElement('button');estimateToggle.textContent='补充区域估算楼高：关';estimateToggle.style.cssText='position:absolute;right:18px;top:130px;z-index:2';let showEstimates=false;estimateToggle.onclick=()=>{showEstimates=!showEstimates;baoan.setEstimate(showEstimates);estimateToggle.textContent='补充区域估算楼高：'+(showEstimates?'开（非实测）':'关');};container.append(estimateToggle);scene.onDisposeObservable.add(()=>estimateToggle.remove());
 const labels=createPlaceLabels(container,catalog.landmarks.map(m=>m.point?{...m,...scenePoint(m.point,catalog)}:m).filter(m=>Number.isFinite(m.x)&&Number.isFinite(m.z)).map(m=>({...m,priority:m.priority||100,note:m.note||m.area+' · 作者地标名称，模型非测绘成果'})),item=>{
  const point=new B.Vector3(item.x,item.kind==='unknown'&&!showEstimates?1:(item.height||120)+15,item.z);
  if(B.Vector3.Distance(camera.position,point)>9000)return null;
  const p=B.Vector3.Project(point,B.Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()));
  if(p.z<0||p.z>1)return null;return {x:p.x*container.clientWidth/engine.getRenderWidth(),y:p.y*container.clientHeight/engine.getRenderHeight()};
 },item=>notify(item.name+' · '+item.note),{hover:true});
 scene.onAfterRenderObservable.add(()=>{if(streamsReady)labels.update();});
 scene.onDisposeObservable.add(()=>labels.dispose());
 function focus(item,ground=false){
  let x=item.x,z=item.z;if(item.point){const p=scenePoint(item.point,catalog);if(!p)return false;({x,z}=p);}
  if(!Number.isFinite(x)||!Number.isFinite(z))return false;
  if(!inCityCoverage(landmarkCoordinate({x,z},catalog),catalog)){notify('此位置超出已接入的三维数据覆盖范围，请用二维地图查看；不会伪造周边建筑。',true);return false;}
  current={...item,x,z};observer.begin({x,y:ground?2:item.photoTargetHeight??(item.height||120)*.38,z},ground?18:item.photoDistance??Math.max(180,(item.height||150)*1.65),item.photoAngle??.65,ground?.12:item.photoElevation??.32);return true;
 }
 focus(catalog.landmarks.find(m=>m.id.includes('tencent'))||catalog.landmarks[0]);
 const listen=(target,name,fn,options={})=>target.addEventListener(name,fn,{...options,signal:events.signal});
 bindContextLifecycle(canvas,{signal:events.signal,notify,pause:()=>{contextLost=true;upload.stop();facades.setPaused(true);last=0;drag=null;keys.clear();orbit=false;engine.stopRenderLoop();},restore:()=>{if(!disposed)return onRestore();}});
 listen(canvas,'keydown',e=>{if(/^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code)){e.preventDefault();if(!keys.size)onManual();keys.add(e.code);orbit=false;}});
 listen(window,'keyup',e=>keys.delete(e.code));listen(window,'blur',()=>keys.clear());listen(canvas,'blur',()=>keys.clear());listen(document,'visibilitychange',()=>{keys.clear();last=0;});
 listen(canvas,'pointerdown',e=>{canvas.focus();canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,distance:0,pan:e.shiftKey||e.button===2};orbit=false;onManual();onPick(null);});
 listen(canvas,'pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.distance+=Math.hypot(dx,dy);drag.pan?observer.pan(dx,dy,canvas.clientHeight,e.shiftKey):observer.rotate(dx,dy);drag.x=e.clientX;drag.y=e.clientY;});
 listen(canvas,'pointerup',e=>{
  const click=drag&&drag.distance<5&&!drag.pan&&e.button===0;drag=null;
  if(!click||!streamsReady||contextLost)return;
  const rect=canvas.getBoundingClientRect();
  if(e.altKey){
   // The camera-centred sky box can be nearer than a distant surface; inspect
   // actual city geometry first, then the sky, rather than masking the culprit.
   const predicate=m=>m.name!=='atmosphere'&&m.isEnabled()&&m.isVisible&&m.getTotalVertices()>0;
   const surface=scene.pick(e.clientX-rect.left,e.clientY-rect.top,predicate);
   const inspected=surface?.hit?surface:scene.pick(e.clientX-rect.left,e.clientY-rect.top,m=>m.name==='atmosphere');
   const mesh=inspected?.pickedMesh;
   if(mesh){const p=inspected.pickedPoint;notify(`对象诊断：${mesh.name} · 材质 ${mesh.material?.name||'无'} · 三角形 ${inspected.faceId} · 位置 ${p.asArray().map(v=>v.toFixed(1)).join(', ')} · 顶点 ${mesh.getTotalVertices()}`);}
   else notify('对象诊断：未命中几何体（可能是天空或屏幕后处理）。');
   return;
  }
  // Explicit click only: do not enable expensive continuous mesh picking.
  const hit=scene.pick(e.clientX-rect.left,e.clientY-rect.top,m=>m.name!=='atmosphere'&&m.isEnabled()&&m.isVisible&&m.getTotalVertices()>0);
  if(hit?.hit&&hit.pickedPoint)onPick(landmarkCoordinate({x:hit.pickedPoint.x,z:hit.pickedPoint.z},catalog));
 });listen(canvas,'pointercancel',()=>drag=null);listen(canvas,'contextmenu',e=>e.preventDefault());listen(canvas,'wheel',e=>{e.preventDefault();onPick(null);observer.zoom(e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1));orbit=false;onManual();},{passive:false});
 const resize=new ResizeObserver(()=>engine.resize());resize.observe(container);
 engine.runRenderLoop(()=>{if(disposed||contextLost||document.hidden)return;const now=performance.now();const state=JSON.stringify([observer.focus,observer.yaw,observer.pitch,observer.distance,light,canvas.width,canvas.height]);if(!budget.shouldRender(now,{active:keys.size>0||orbit||!!drag||!streamsReady,state}))return;const dt=last?Math.min(.05,(now-last)/1000):0;last=now;if(orbit)observer.yaw+=dt*.12;observer.step(keys,dt,relief.heightAt,extent);const p=observer.pose();camera.position.set(p.x,p.y,p.z);camera.setTarget(new B.Vector3(observer.focus.x,observer.focus.y,observer.focus.z));if(facadesReady&&now-facadeAt>500){facadeAt=now;facades.update(p.y>2000?1e8:p.x,p.y>2000?1e8:p.z,p.y<=2000,350);}scene.render();});
 async function load(name){return upload(async()=>{if(!active())return;notify('正在读取原版城市：'+name+'…');const result=await B.ImportMeshAsync('/project-map/city/'+name+'.glb',scene);if(!active()){for(const mesh of result.meshes)mesh.dispose(false,true);return;}result.meshes[0].rotationQuaternion=B.Quaternion.Identity();for(const mesh of result.meshes){mesh.isPickable=false;if(mesh.getTotalVertices())mesh.freezeWorldMatrix();}apply(result.meshes,name);},{label:name});}
 function setLight(value){light=value;return upload(async()=>{architecture?.setMode(value);diversity?.setMode(value);baoan.setMode(value);roads.setMode(value);if(cinematic)await cinematic.prepareMode(value);else{sun.intensity=value==='night'?.25:value==='day'?1.5:1;hemi.intensity=value==='night'?.25:.6;}},{label:'昼夜光照',wanted:()=>light===value}).catch(e=>{if(active())notify('光照加载失败：'+e.message,true);});}
 const lightingToggle=document.createElement('button');lightingToggle.textContent='基础光照 · 启用原版 HDR（待稳定性验收）';lightingToggle.style.cssText='position:absolute;right:18px;top:280px;z-index:2';container.append(lightingToggle);
 lightingToggle.onclick=async()=>{if(!streamsReady||!active())return;lightingToggle.disabled=true;try{await upload(async()=>{pipeline=new B.DefaultRenderingPipeline('city-quality',true,scene,[camera]);pipeline.fxaaEnabled=false;pipeline.samples=1;cinematic=await createCinematicLook({scene,sun,hemi,pipeline,camera},{balanced:true});},{label:'手动原版 HDR',required:true});if(active()){await setLight(light);lightingToggle.textContent='原版 HDR 已启用 · 尚未长期验收';}}catch(e){cinematic?.dispose();cinematic=null;pipeline?.dispose();pipeline=null;if(active()){lightingToggle.disabled=false;notify('原版光照未完成：'+e.message,true);}}};scene.onDisposeObservable.add(()=>lightingToggle.remove());
 const ready=(async()=>{
  stage='基础光照';notify('基础光照启动；原版 HDR 暂不自动加载，待逐层验收。');
  await upload(async()=>{architecture=createArchitectureMaterials(scene);diversity=createFacadeDiversity(scene);},{label:'共享材质',required:true});if(!active())return;
  await setLight(light);
  await hq.init();if(!active())return;
  if(!await initializeSceneStages([()=>{stage='地面';return load('terrain');},()=>upload(()=>loadDistrictGround(scene,catalog,active),{label:'罗湖地面'}),()=>{stage='山体';return relief.init();},()=>{stage='道路与建筑概览';return original.init();},()=>baoan.initOverview(),()=>{stage='地标';return load('landmarks');}],active))return;
  for(const mesh of [...scene.meshes])if(['landmark_tencent_','landmark_lianhua_','landmark_civic_'].some(p=>mesh.name.startsWith(p)))mesh.dispose();
  await load('landmark-detail');if(!active())return;
  notify('正在载入原版光照和附近窗格立面…');
  stage='近景窗格';await facades.init(observer.focus.x,observer.focus.z);if(!active())return;facadesReady=true;
  if(upload.stats.blocked)throw Error('部分资源受到预算限制，不能认定初始化完整');
  stage='定位交互与按需细节';streamsReady=true;container.dataset.details='ready';notify('基础画面初始化结束；原版 HDR 未开启，稳定性仍待实测。');
 })();
 // Observe for the UI without converting failed initialization into recovery success.
 ready.catch(e=>{if(!disposed)notify('三维资源加载失败：'+e.message+'；可重新加载或返回二维地图。',true);});
return {ready,focus,setLight,get viewState(){return {observer:observer.snapshot(),light,current:current?{...current}:null};},restoreView(state){if(!observer.restore(state?.observer))return false;current=state.current?{...state.current}:null;if(['day','sunset','night'].includes(state.light))setLight(state.light);return true;},get point(){return landmarkCoordinate({x:observer.focus.x,z:observer.focus.z},catalog);},setSpeed:v=>observer.setSpeed(v),elevate:v=>observer.elevate(v),look:v=>observer.look(0,v),ground:()=>current&&focus(current,true),aerial:()=>current&&focus(current),orbit:()=>orbit=true,stop:()=>{orbit=false;keys.clear();},dispose(){disposed=true;upload.stop();events.abort();resize.disconnect();engine.stopRenderLoop();cinematic?.dispose();scene.dispose();engine.dispose();canvas.remove();delete container.dataset.details;},get stats(){return {resources:upload.stats,stage,camera:observer.status,facades:facades.stats,relief:relief.stats,meshes:scene.meshes.length,renderedFrames:budget.frames};}};
}
