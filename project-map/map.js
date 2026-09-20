import {toWgs84,landmarkCoordinate,inCityCoverage} from './core.mjs';
import {createTour} from './tour.mjs';
import {replacementFilter} from './model-footprints.mjs';
import {offlineStyle,attachOffline} from './offline-map.mjs';
import {showCoverage} from './coverage.mjs';
import {attachMissingMapIcons} from './missing-map-icons.mjs';
import {createGraphicsRecovery} from './graphics-recovery.mjs';
import {attachGraphicsQA} from './graphics-qa.mjs';
import {createResearchWorkbench} from './research-workbench.mjs';
const $=id=>document.getElementById(id),libraries=new Map();
let detailedCity=null;
let pickedCityPoint=null;
const backPoint=document.createElement('button');backPoint.id='back-point';backPoint.textContent='在二维地图查看此处';backPoint.hidden=true;backPoint.style.cssText='position:absolute;bottom:80px;left:16px;z-index:2';$('map').parentElement.append(backPoint);
function pickCityPoint(point){pickedCityPoint=point;backPoint.hidden=!point;}
backPoint.onclick=()=>{if(pickedCityPoint)openMap('city',pickedCityPoint);};
let map=null,marker=null,mode='city',project=null,selected=null,key=null,requestId=0,searchTimer=null,epoch=0,catalog=null,detailLoading=false;
let researchRequestId=0;const researchPending=new Map();
const research=createResearchWorkbench({request(action,args={}){if(!key)return Promise.reject(Error('请从平台“项目地图”入口打开，使用已登录的项目库和配套查询；独立页面支持导入与离线研判。'));return new Promise((resolve,reject)=>{const id=++researchRequestId,timer=setTimeout(()=>{researchPending.delete(id);reject(Error('请求超时，请重试'));},22000);researchPending.set(id,{resolve,reject,timer});send({type:'map-request',id,action,...args});});},locate(point,name,options={}){selected={point,name};if(options.portfolio){marker?.remove();marker=null;map?.flyTo({center:point,zoom:16.3,pitch:mode==='nearby'?60:0,duration:800});}else showPoint(point,name);}});
function script(src){if(libraries.has(src))return libraries.get(src);const p=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>{s.remove();libraries.delete(src);reject(Error('地图组件缺失，请检查部署文件后重试'));};document.head.append(s);});libraries.set(src,p);return p;}
function status(text,failed=false){$('status').textContent=text;$('retry').hidden=!failed;}
async function rebuildView(isCurrent=()=>true){
 if(!isCurrent())return;
 const view=detailedCity?.viewState,targetMode=mode;
 dispose();
 const instance=await openMap(targetMode);
 // openMap can yield while a user changes modes. Never apply an old pose to
 // an unrelated scene or restart a closed view.
 const ticket=epoch;
 if(!view||targetMode!=='nearby'||mode!==targetMode||!instance)return;
 await instance.ready;
 if(epoch===ticket&&detailedCity===instance)instance.restoreView(view);
}
const recoverGraphics=createGraphicsRecovery(rebuildView,status);
const tour=createTour({fly:item=>focus(item,false),rotate:()=>detailedCity?.orbit(),stopCamera:()=>{map?.stop();detailedCity?.stop();},changed:active=>{$('tour').textContent=active?'停止巡游':'自动巡游';$('tour').setAttribute('aria-pressed',String(active));}});
function dispose(){research.detach();tour.stop();pickCityPoint(null);epoch++;detailedCity?.dispose();detailedCity=null;map?.remove();map=null;marker=null;detailLoading=false;delete $('map').dataset.details;}
function setMode(value){mode=value;research.setVisible(value==='city');$('vertical-controls').hidden=value!=='nearby';for(const id of ['city','nearby'])$(id).setAttribute('aria-pressed',String(id===value));}
function showPoint(point,name,duration=800){if(!map||!point)return;marker?.remove();const label=document.createElement('div');label.textContent=name||'查看位置';marker=new maplibregl.Marker({color:'#ce5543'}).setLngLat(point).setPopup(new maplibregl.Popup().setDOMContent(label)).addTo(map);map.flyTo({center:point,zoom:16.3,pitch:mode==='nearby'?60:0,duration});}
async function ensureDetails(){
 const instance=map,ticket=epoch;
 if(!instance||mode!=='nearby'||instance.getZoom()<14||!catalog||detailLoading||instance.getLayer('anju-landmarks'))return;
 detailLoading=true;status('正在将地标精细模型加载到城市原位置…');
 try{await script('vendor/babylon.js');await script('vendor/babylonjs.loaders.min.js');const {createCityLayer}=await import('./city-layer.mjs');const response=await fetch('models/landmark-detail.json');if(!response.ok)throw Error('模型范围文件读取失败');const detail=await response.json();if(ticket!==epoch||mode!=='nearby')return;
  instance.addLayer(createCityLayer(catalog,(state,error)=>{if(ticket!==epoch)return;if(state==='ready'){instance.setFilter('city-buildings',replacementFilter(catalog,detail));$('map').dataset.details='ready';status('三维城市 · 10处地标模型已接入；作者估算模型，非测绘成果');}else{instance.removeLayer('anju-landmarks');status('精细模型加载失败，普通地图仍可操作：'+error,true);}}));
 }catch(e){if(ticket===epoch)status(e.message,true);}finally{if(ticket===epoch)detailLoading=false;}
}
async function openMap(value,returnPoint=null){
 if(value==='nearby'){
  if(detailedCity)return;
  if(catalogLoading)await catalogLoading;else if(!catalog)await loadCatalog();
  if(!catalog){status('三维目录未加载，请重试。',true);return;}
  if(selected&&!inCityCoverage(selected.point,catalog)){status('此位置尚无已验收的三维建筑，保留二维位置；不会跳转到其他区域。');return;}
  dispose();setMode(value);$('city-controls').hidden=false;const ticket=epoch;status('正在加载原版三维城市，首次进入需要读取建筑文件…');
  try{if(!catalog)await loadCatalog();await script('vendor/babylon.js');await script('vendor/babylonjs.loaders.min.js');if(ticket!==epoch)return;const {createDetailedCity}=await import('./detailed-city.mjs');if(ticket!==epoch)return;detailedCity=createDetailedCity($('map'),catalog,(text,failed)=>{if(ticket===epoch)status(text,failed);},()=>tour.stop(),pickCityPoint,()=>recoverGraphics(()=>ticket===epoch&&mode==='nearby'));if(selected)detailedCity.focus(selected);detailedCity.setSpeed($('speed').value);return detailedCity;}catch(e){if(ticket===epoch)status(e.message,true);}return;
 }
 if(detailedCity){selected={point:returnPoint||detailedCity.point,name:returnPoint?'三维点击位置':'三维当前观察位置'};dispose();}$('city-controls').hidden=true;
 tour.stop();setMode(value);
 if(map&&map.getLayer('city-buildings')){
  map.setLayoutProperty('city-buildings','visibility',value==='nearby'?'visible':'none');
  if(value==='city'&&map.getLayer('anju-landmarks')){map.removeLayer('anju-landmarks');map.setFilter('city-buildings',['!=',['get','hide_3d'],true]);delete $('map').dataset.details;}
  map.easeTo({pitch:value==='nearby'?60:0,duration:350});if(selected)showPoint(selected.point,selected.name);ensureDetails();return;
 }
 dispose();setMode(value);const ticket=epoch;status('正在读取城市地图…');
 try{
  await script('vendor/maplibre-gl.js');if(ticket!==epoch)return;
  if(!document.querySelector('[data-map-css]')){const css=document.createElement('link');css.rel='stylesheet';css.href='vendor/maplibre-gl.css';css.dataset.mapCss='1';document.head.append(css);}
  maplibregl.setWorkerCount(2);
  const offline=$('basemap-mode').value==='offline';
  const instance=new maplibregl.Map({container:'map',style:offline?offlineStyle():'https://tiles.openfreemap.org/styles/bright',center:selected?.point||[114.08,22.63],zoom:selected?16.3:9.5,pitch:value==='nearby'?60:0,maxPitch:70,maxTileCacheSize:100,canvasContextAttributes:{antialias:true}});map=instance;
  instance.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');instance.addControl(new maplibregl.ScaleControl());
  const releaseIcons=attachMissingMapIcons(instance);instance.on('remove',releaseIcons);
  const timer=setTimeout(()=>{if(ticket===epoch&&!instance.loaded())status('底图加载较慢，请检查网络后重试。',true);},20000);
  instance.on('remove',()=>clearTimeout(timer));instance.on('error',e=>{if(ticket===epoch){console.warn('Map resource:',e.error?.message);status((offline?'本地底图资源异常：':'在线底图资源异常，可切换本地离线底图：')+String(e.error?.message||'未知错误').slice(0,180),true);}});
  instance.on('movestart',e=>{if(e.originalEvent&&tour.active)tour.stop();});instance.on('moveend',ensureDetails);
  instance.on('click',e=>{
   if(research.click(e))return;
   if(instance.getLayer('landmark-points')&&instance.queryRenderedFeatures(e.point,{layers:['landmark-points']}).length)return;
   selected={point:[e.lngLat.lng,e.lngLat.lat],name:'地图选定位置'};
   marker?.remove();
   const box=document.createElement('div'),button=document.createElement('button');
   button.textContent=inCityCoverage(selected.point,catalog)?'查看此处三维':'此处三维尚未覆盖';
   button.disabled=!inCityCoverage(selected.point,catalog);button.onclick=()=>openMap('nearby');box.append(button);
   marker=new maplibregl.Marker({color:'#ce5543'}).setLngLat(selected.point).setPopup(new maplibregl.Popup().setDOMContent(box)).addTo(instance);marker.togglePopup();
   status('已选择位置：'+selected.point.map(n=>n.toFixed(6)).join(', ')+'；点击“查看此处三维”进入，不改写项目资料。');
  });
  instance.on('load',async()=>{
   if(ticket!==epoch)return;clearTimeout(timer);
   research.attach(instance);
   if(offline){try{await attachOffline(instance,text=>{if(ticket===epoch)status(text);});if(ticket!==epoch)return;research.attach(instance);for(const id of ['research-fill','research-line','research-points'])if(instance.getLayer(id))instance.moveLayer(id);addLandmarks();if(selected)showPoint(selected.point,selected.name);}catch(e){if(ticket===epoch)status(e.message,true);}return;}
   instance.addSource('city-buildings',{type:'vector',url:'https://tiles.openfreemap.org/planet'});
   instance.addLayer({id:'city-buildings',type:'fill-extrusion',source:'city-buildings','source-layer':'building',minzoom:14,layout:{visibility:mode==='nearby'?'visible':'none'},filter:['!=',['get','hide_3d'],true],paint:{'fill-extrusion-height':['max',0,['to-number',['get','render_height'],0]],'fill-extrusion-base':['max',0,['to-number',['get','render_min_height'],0]],'fill-extrusion-color':'#7eaebc','fill-extrusion-opacity':.9}});
   addLandmarks();if(selected){showPoint(selected.point,selected.name);research.frameRange();}status('二维 / 三维使用同一城市；左侧搜索地标，点击飞抵，近景加载模型。');ensureDetails();
  });
 }catch(e){if(ticket===epoch)status(e.message,true);}
}
function addLandmarks(){
 if(!map||!catalog)return;
 if(!map.isStyleLoaded()){const pendingMap=map;map.once('idle',()=>{if(map===pendingMap)addLandmarks();});return;}
 showCoverage(map,catalog,$('coverage-toggle').checked);
 if(map.getSource('landmark-points'))return;
 map.addSource('landmark-points',{type:'geojson',data:{type:'FeatureCollection',features:catalog.landmarks.map(item=>({type:'Feature',properties:{id:item.id,name:item.name},geometry:{type:'Point',coordinates:item.point||landmarkCoordinate(item,catalog)}})).filter(f=>f.geometry.coordinates)}});
 map.addLayer({id:'landmark-points',type:'circle',source:'landmark-points',minzoom:15,paint:{'circle-radius':3,'circle-color':'#ca8434','circle-stroke-width':1,'circle-stroke-color':'#fff'}});
 map.on('click','landmark-points',e=>{const item=catalog.landmarks.find(m=>m.id===e.features?.[0]?.properties?.id);if(item)focus(item);});
}
async function focus(item,manual=true){if(manual)tour.stop();selected={...item,point:item.point||landmarkCoordinate(item,catalog),name:item.name};if(mode==='city'){showPoint(selected.point,selected.name);research.offerPoint(selected.point);status('已在二维定位；项目坐标须人工确认。三维仅在主动切换时加载。');return;}if(!inCityCoverage(selected.point,catalog)){if(detailedCity){dispose();await openMap('city');}showPoint(selected.point,selected.name);status('此位置尚无已验收三维建筑，已保留二维定位。');return;}if(detailedCity&&!detailedCity.focus(selected))return;$('project-hint').textContent='正在查看：'+item.name+'。地标模型含作者估算，非测绘成果。';}
function renderCatalog(){
 if(!catalog)return;const query=$('landmark-query').value.trim().toLowerCase();$('landmarks').replaceChildren();const point=toWgs84(project?.location,project?.crs);
 const items=[...(point?[{id:'current-project',name:project.name,point,area:'当前项目'}]:[]),...catalog.landmarks];
 for(const item of items.filter(i=>(i.name+' '+i.area).toLowerCase().includes(query)).slice(0,60)){const b=document.createElement('button');b.textContent=item.name+' · '+(item.area==='宝安'?'宝安建筑 / 道路':item.point?'项目位置':catalog.modelIds.includes(item.id)?'三维模型':'地图位置');b.dataset.landmark=item.id;b.onclick=()=>focus(item);$('landmarks').append(b);}
  $('catalog-count').textContent=$('landmarks').children.length?'匹配 '+$('landmarks').children.length+' 处 · 滚动选择（含非自有地标）':'暂无目录匹配，可点击搜索查询地址。';
}
 let catalogLoading=null;
 function loadCatalog(){return catalogLoading||(catalogLoading=readCatalog().finally(()=>{catalogLoading=null;}));}
 async function readCatalog(){try{const r=await fetch('models/catalog.json');if(!r.ok)throw Error('目录未部署');catalog=await r.json();
 catalog.landmarks.unshift({id:'anju-hq-reference',name:'深安居总部 · 深圳湾创新科技中心 A/B 座',area:'南山',point:[113.94154,22.531646],height:299.1*catalog.scale,photoTargetHeight:85,photoDistance:460,photoAngle:-1.3,photoElevation:.3,note:'用户图片参考重建；双塔与连桥，展示 LOGO 非现状标识核验'});
 try{const r=await fetch('baoan-lod-v2/index.json',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();catalog.baoanTiles=(await r.json()).tiles;const n=await fetch('baoan-places.json',{signal:AbortSignal.timeout(20000)});if(n.ok)catalog.landmarks.push(...(await n.json()).items.map(m=>({...m,area:'宝安',height:m.height*catalog.scale})));}catch{status('宝安目录暂未读到，原有城市仍可使用；刷新可重试。',true);}
 try{const r=await fetch('city-stream-v1/index.json');if(!r.ok)throw Error();catalog.originalTiles=(await r.json()).tiles;}catch{status('原城区覆盖目录未加载，覆盖提示暂不完整。',true);}
 catalog.districts=[{id:'baoan',name:'宝安'}];
 for(const [id,name] of [['futian','福田'],['nanshan','南山'],['luohu','罗湖']]){
  try{const r=await fetch(id+'-lod-v2/index.json',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();const index=await r.json();catalog.baoanTiles||=[];catalog.baoanTiles.push(...index.tiles.map(t=>({...t,key:id+':'+t.key,sourceKey:t.key,assetBase:id+'-lod-v2',district:id,districtName:name})));catalog.districts.push({id,name});const t=[...index.tiles].sort((a,b)=>b.known-a.known)[0];if(t)catalog.landmarks.push({id:id+'-extension',name:name+' · 补充三维街区',area:name,point:t.center,height:100,photoDistance:700});}catch{status(name+'扩展模型尚未就绪，已有地图仍可浏览。',true);}
 }
 catalog.landmarks.sort((a,b)=>Number(String(b.id).endsWith('-extension'))-Number(String(a.id).endsWith('-extension')));
 renderCatalog();addLandmarks();ensureDetails();}catch(e){$('catalog-count').textContent='地标目录读取失败；可刷新重试。';}}
 $('coverage-toggle').onchange=()=>showCoverage(map,catalog,$('coverage-toggle').checked);
 $('baoan-enter').onclick=async()=>{if(catalogLoading)await catalogLoading;else if(!catalog)await loadCatalog();const tiles=(catalog?.baoanTiles||[]).filter(t=>(t.district||'baoan')==='baoan');if(!tiles.length){status('宝安目录尚未就绪，请刷新重试。',true);return;}const t=tiles.sort((a,b)=>b.known-a.known)[0];focus({name:'宝安 · 建筑与道路',point:t.center,height:100,photoDistance:700,photoElevation:.6});};
function send(data){if(key)parent.postMessage({version:1,key,...data},location.origin);}
window.addEventListener('message',e=>{
 const d=e.data;if(e.origin!==location.origin||e.source!==parent||d?.version!==1)return;
 if(d.type==='init'&&typeof d.key==='string'){key=d.key;project=null;$('project-name').textContent='深圳全市';$('project-hint').textContent='请搜索项目、地址或选择地点；不会自动带入当前报告项目。';renderCatalog();void research.loadPortfolio();
  if(d.facilities===true){const point=toWgs84(d.project?.location,d.project?.crs);if(point){project=d.project;selected={point,name:project.name};$('project-name').textContent=project.name;$('project-hint').textContent='AI可研已确认位置 · 默认2公里配套；仅浏览，不改写报告。';$('locate').hidden=false;showPoint(point,project.name);research.offerPoint(point);}}
 }
 if(d.key===key&&d.type==='request-close'){$('close').click();return;}
 if(d.key===key&&d.type==='map-response'){const pending=researchPending.get(d.id);if(pending){clearTimeout(pending.timer);researchPending.delete(d.id);d.error?pending.reject(Error(d.error)):pending.resolve(d.data);}return;}
 if(d.key!==key||d.type!=='search-result'||d.id!==requestId)return;clearTimeout(searchTimer);$('search').disabled=false;$('results').replaceChildren();if(d.error){status('搜索失败：'+d.error);return;}
 for(const c of Array.isArray(d.candidates)?d.candidates:[]){const point=toWgs84(c.location,'GCJ02');if(!point)continue;const b=document.createElement('button');b.textContent=c.name+' · '+(c.address||'');b.onclick=()=>focus({point,name:c.name});$('results').append(b);}
 status($('results').children.length?'请选择位置候选，不会自动修改项目位置。':'没有匹配位置，请补充“深圳＋项目全名”重试。');
});
$('search-form').onsubmit=e=>{e.preventDefault();const query=$('query').value.trim();if(!query)return;if($('basemap-mode').value==='offline'){$('results').replaceChildren();const items=(catalog?.landmarks||[]).filter(i=>i.name.includes(query)).slice(0,20);for(const item of items){const b=document.createElement('button');b.textContent=item.name+' · 本地目录';b.onclick=async()=>{selected={point:item.point||landmarkCoordinate(item,catalog),name:item.name};if(detailedCity)dispose();await openMap('city');showPoint(selected.point,selected.name);};$('results').append(b);}status(items.length?'请选择本地地点；不访问外网。':'本地地点目录无匹配。可直接点选地图；任意地址检索需要切换在线底图并从平台入口使用。');return;}if(!key){status('请从项目页面打开地图以使用已登录的位置搜索；地标筛选无需登录。');return;}tour.stop();clearTimeout(searchTimer);requestId++;$('search').disabled=true;status('正在搜索位置…');send({type:'search',query,id:requestId});searchTimer=setTimeout(()=>{requestId++;$('search').disabled=false;status('位置搜索超时，请稍后重试。');},25000);};
$('landmark-query').oninput=renderCatalog;
$('city').onclick=()=>openMap('city');$('nearby').onclick=()=>openMap('nearby');
$('basemap-mode').onchange=()=>{if(mode==='city'){if(map)selected={point:map.getCenter().toArray(),name:'当前观察位置'};dispose();openMap('city');}};
$('tour').onclick=async()=>{if(tour.active){tour.stop();return;}if(!catalog)return;await openMap('nearby');if(detailedCity)tour.start(catalog.landmarks.filter(i=>catalog.modelIds.includes(i.id)));};
$('orbit').onclick=async()=>{tour.stop();await openMap('nearby');detailedCity?.orbit();};
$('speed').onchange=()=>detailedCity?.setSpeed($('speed').value);
for(const value of ['day','sunset','night'])$(value).onclick=()=>detailedCity?.setLight(value);
$('ground').onclick=()=>{tour.stop();detailedCity?.ground();};$('aerial').onclick=()=>{tour.stop();detailedCity?.aerial();};
for(const [id,delta] of [['rise',20],['descend',-20]])$(id).onclick=()=>{tour.stop();detailedCity?.elevate(delta);};
for(const [id,delta] of [['look-up',-.15],['look-down',.15]])$(id).onclick=()=>{tour.stop();detailedCity?.look(delta);};
$('locate').onclick=()=>{const point=toWgs84(project?.location,project?.crs);if(!point){status('当前项目没有确认坐标，请先搜索位置。');return;}focus({point,name:project.name});};
$('reset').onclick=()=>{tour.stop();detailedCity?.aerial();map?.easeTo({bearing:0,pitch:0,duration:300});};
$('retry').onclick=async()=>{await rebuildView();if(!catalog)loadCatalog();};
$('close').onclick=async()=>{if(!await research.canClose())return;dispose();if(key)send({type:'close'});else status('地图已关闭，可以关闭此标签页。',true);};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){tour.stop();if(key){e.preventDefault();$('close').click();}}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)tour.stop();else map?.triggerRepaint();});window.addEventListener('pagehide',()=>{clearTimeout(searchTimer);dispose();});
loadCatalog();openMap('city');
attachGraphicsQA({getScene:()=>detailedCity,enter:async()=>detailedCity||await openMap('nearby'),leave:()=>openMap('city'),places:()=>catalog?.landmarks.filter(i=>String(i.id).endsWith('-extension')||i.id==='tencent'||i.name==='宝安体育场')||[]});
