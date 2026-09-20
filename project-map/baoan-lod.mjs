// Independent map module; no project/auth/storage mutations.
import {createPlaceLabels} from './place-labels.mjs';
const C=globalThis.Cesium,$=id=>document.getElementById(id),base='baoan-lod-v2/';
let viewer,index,known,estimated,dead=false,pickRevision=0,initRevision=0,tileFailure=false;
let farMode=false;const overviews={},overviewLoading=new Set();
let placeLabels;
async function loadPlaces(){
 try{const data=await fetchJSON('baoan-places.json');if(dead)return;
  placeLabels=createPlaceLabels($('globe'),data.items,item=>{
   const h=viewer.camera.positionCartographic.height;if(h>8000&&item.priority<100)return null;
   const altitude=item.kind==='unknown'&&!$('estimate').checked?3:item.height+8;
   const p=C.Cartesian3.fromDegrees(...item.point,altitude);
   if(C.Cartesian3.distance(p,viewer.camera.positionWC)>Math.max(5000,h*3))return null;
   if(!new C.EllipsoidalOccluder(C.Ellipsoid.WGS84,viewer.camera.positionWC).isPointVisible(p))return null;
   return C.SceneTransforms.worldToWindowCoordinates(viewer.scene,p);
  },item=>{$('info').textContent=item.name+'\n'+item.note;});
  const renderResults=()=>{const q=$('place-query').value.trim();const matches=data.items.filter(i=>!q||i.name.includes(q));$('place-results').replaceChildren(...matches.slice(0,25).map(item=>{const b=document.createElement('button');b.textContent=item.name;b.type='button';b.onclick=()=>{fly(item.point);$('info').textContent=item.name+'\n'+item.note;};return b;}));$('place-count').textContent=matches.length+'项匹配，最多列出25项；无匹配可更换关键词。';};
  $('place-query').oninput=renderResults;renderResults();viewer.scene.requestRender();
 }catch{if(!dead)$('place-count').textContent='地名目录读取失败；地图仍可使用，刷新页面可重试。';}
}
function allTiles(){return [known,estimated,...Object.values(overviews)].filter(Boolean);}
function expose(){if(new URLSearchParams(location.search).get('benchmark')==='1')window.__baoanTilesets=allTiles();}
async function loadOverview(layer){
 if(overviews[layer]||overviewLoading.has(layer))return;overviewLoading.add(layer);const token=initRevision;
 try{const t=await createTiles('overview-'+layer,80);if(dead||token!==initRevision){if(!t.isDestroyed())viewer.scene.primitives.remove(t);return;}overviews[layer]=t;syncOverview();expose();}
 catch(e){if(!dead){tileFailure=true;status('远景合批读取失败，保留原网格。请重试。');$('retry').hidden=false;}}
 finally{overviewLoading.delete(layer);}
}
function syncOverview(){
 if(dead||!known)return;
 const previous=new Map(allTiles().map(t=>[t,t.show]));
 const h=viewer.camera.positionCartographic.height;farMode=h>8000||(farMode&&h>6000);
 const wanted=$('estimate').checked;
 if(farMode&&!tileFailure){loadOverview('known');if(wanted)loadOverview('estimated');}
 for(const [layer,t] of Object.entries(overviews)){t.show=farMode&&(layer==='known'||wanted);if(!t.show)t.trimLoadedTiles();}
 known.show=!(farMode&&overviews.known?.totalMemoryUsageInBytes>0&&overviews.known.tilesLoaded);
 if(estimated)estimated.show=wanted&&!(farMode&&overviews.estimated?.totalMemoryUsageInBytes>0&&overviews.estimated.tilesLoaded);
 for(const t of [known,estimated])if(t&&!t.show)t.trimLoadedTiles();
 document.body.dataset.overview=String(farMode&&!known.show);
 if(allTiles().some(t=>previous.get(t)!==t.show))viewer.scene.requestRender();
}
const status=text=>{if($('status').textContent!==text)$('status').textContent=text;};
const fetchJSON=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();};
function inside(ring,x,y){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function contains(geometry,lon,lat){return geometry.coordinates.some(p=>inside(p[0],lon,lat)&&!p.slice(1).some(r=>inside(r,lon,lat)));}
function updateStatus(){
 if(dead||!known||tileFailure)return;
 const bytes=allTiles().reduce((n,t)=>n+t.totalMemoryUsageInBytes,0);
 status(`${allTiles().filter(t=>t.show).every(t=>t.tilesLoaded)?'当前视野加载完成':'正在按距离加载模型…'} · ${farMode?'高空合批':'近景分格'} · 模型资源约 ${(bytes/1048576).toFixed(1)} MiB（非浏览器总内存）`);
 if(known.tilesLoaded)document.body.dataset.ready='true';
}
function fly(point){viewer.camera.setView({destination:C.Cartesian3.fromDegrees(point[0],point[1]-.006,750),orientation:{heading:0,pitch:C.Math.toRadians(-48),roll:0}});viewer.scene.requestRender();}
async function createTiles(layer,budget){
 const t=await C.Cesium3DTileset.fromUrl(base+layer+'.json',{maximumScreenSpaceError:16,cacheBytes:budget*1048576,maximumCacheOverflowBytes:16*1048576,skipLevelOfDetail:false,preloadWhenHidden:false,preloadFlightDestinations:false});
 if(dead){t.destroy();throw Error('Page disposed');}
 t.tileFailed.addEventListener(()=>{if(dead)return;tileFailure=true;status('部分网格读取失败，已有模型保留；点击重试。');$('retry').hidden=false;});
 // In requestRenderMode the final loading frame may precede the throttled
 // postRender tick. Update visibility on completion, not on a future frame
 // that may never occur while the camera is still. Redraw only if it changed.
 const loaded=()=>{syncOverview();updateStatus();};
 t.initialTilesLoaded.addEventListener(loaded);t.allTilesLoaded.addEventListener(loaded);
 t.maximumScreenSpaceError=Number($('quality')?.value||16);viewer.scene.primitives.add(t);return t;
}
async function estimates(){
 const wanted=$('estimate').checked;
 if(!wanted){if(estimated)estimated.show=false;syncOverview();viewer.scene.requestRender();updateStatus();return;}
 $('estimate').disabled=true;
 try{if(!estimated)estimated=await createTiles('estimated',32);estimated.show=$('estimate').checked;viewer.scene.requestRender();updateStatus();}
 catch(e){if(!dead){$('estimate').checked=false;tileFailure=true;status('估算层加载失败，原图层不受影响。请点击重试。');$('retry').hidden=false;}}
 finally{if(!dead)$('estimate').disabled=false;}
 syncOverview();expose();
}
async function init(){
 const token=++initRevision;tileFailure=false;$('retry').hidden=true;status('正在读取分级模型目录…');
 try{
  index=await fetchJSON(base+'index.json');if(dead||token!==initRevision)return;
  const replacement=await createTiles('known',64);if(dead||token!==initRevision){if(!replacement.isDestroyed())viewer.scene.primitives.remove(replacement);return;}
  if(known)viewer.scene.primitives.remove(known);known=replacement;
  if(estimated){viewer.scene.primitives.remove(estimated);estimated=null;}$('estimate').checked=false;
  for(const [layer,t] of Object.entries(overviews)){viewer.scene.primitives.remove(t);delete overviews[layer];}farMode=false;
  const ordered=[...index.tiles].sort((a,b)=>b.known-a.known);
  $('area').replaceChildren(...ordered.map(t=>{const o=document.createElement('option');o.value=t.key;o.textContent=`网格 ${t.key} · ${t.count===0?'底图区域':t.known+'项带高度/楼层'}`;return o;}));
  fly(ordered[0].center);expose();
 }catch(e){if(dead||token!==initRevision)return;tileFailure=true;status('分级目录读取失败，原场景保留。请重试或返回原版地图。');$('retry').hidden=false;}
}
try{
 viewer=new C.Viewer('globe',{baseLayer:false,baseLayerPicker:false,geocoder:false,animation:false,timeline:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,infoBox:false,selectionIndicator:false,requestRenderMode:true,maximumRenderTimeChange:Infinity});
 viewer.targetFrameRate=30;viewer.resolutionScale=Math.min(1,1.5/devicePixelRatio);viewer.scene.globe.baseColor=C.Color.fromCssColorString('#d1d7c9');
 viewer.scene.screenSpaceCameraController.minimumZoomDistance=10;viewer.scene.screenSpaceCameraController.maximumZoomDistance=100000;
 if(new URLSearchParams(location.search).get('benchmark')==='1')window.__baoanViewer=viewer;
 $('area').onchange=()=>{const t=index?.tiles.find(t=>t.key===$('area').value);if(t)fly(t.center);};
 $('reset').onclick=()=>{if(index)fly([...index.tiles].sort((a,b)=>b.known-a.known)[0].center);};
 $('load').onclick=()=>{viewer.scene.requestRender();updateStatus();};$('retry').onclick=()=>init();$('estimate').onchange=estimates;
 if($('quality'))$('quality').onchange=()=>{for(const t of [known,estimated])if(t)t.maximumScreenSpaceError=Number($('quality').value);viewer.scene.requestRender();};
 viewer.screenSpaceEventHandler.setInputAction(async e=>{
  const token=++pickRevision;const p=viewer.scene.pickPositionSupported?viewer.scene.pickPosition(e.position):viewer.camera.pickEllipsoid(e.position);if(!p||!index)return;
  const c=C.Cartographic.fromCartesian(p),lon=C.Math.toDegrees(c.longitude),lat=C.Math.toDegrees(c.latitude);
  const tiles=index.tiles.filter(t=>lon>=t.bounds[0]&&lon<=t.bounds[2]&&lat>=t.bounds[1]&&lat<=t.bounds[3]).slice(0,6);
  $('info').textContent='正在核对建筑高度依据…';
  try{const items=(await Promise.all(tiles.map(t=>fetchJSON(base+'metadata/'+t.key+'.json')))).flat();if(dead||token!==pickRevision)return;
   const found=items.filter(f=>contains(f.geometry,lon,lat)).sort((a,b)=>Math.abs(a.height-c.height)-Math.abs(b.height-c.height))[0];
   $('info').textContent=found?`${found.name}\n${found.kind==='unknown'&&!$('estimate').checked?'高度缺失，当前只展示轮廓':found.height+'米 · '+found.basis}\n${found.id}`:'此处是底图或尚无可核对的建筑。';
  }catch{if(!dead&&token===pickRevision)$('info').textContent='建筑信息读取失败，请再次点击重试。';}
 },C.ScreenSpaceEventType.LEFT_CLICK);
 viewer.camera.changed.addEventListener(()=>{syncOverview();viewer.scene.requestRender();});
 viewer.scene.postRender.addEventListener(()=>placeLabels?.update());
 let last=0;viewer.scene.postRender.addEventListener(()=>{if(performance.now()-last>1000){last=performance.now();syncOverview();updateStatus();}});
 document.addEventListener('visibilitychange',()=>{if(dead)return;viewer.useDefaultRenderLoop=!document.hidden;if(!document.hidden)viewer.scene.requestRender();});
 window.addEventListener('pagehide',()=>{dead=true;pickRevision++;initRevision++;placeLabels?.dispose();viewer.destroy();},{once:true});
 init();loadPlaces();
}catch(e){status('三维初始化失败，请刷新，或返回原版地图。');console.error(e);}
