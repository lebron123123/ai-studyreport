// Preserved initial Entity renderer for same-device benchmark/recovery only.
import {nearestTiles} from './baoan-data.mjs';
const C=globalThis.Cesium,$=id=>document.getElementById(id);
let viewer,index,revision=0,controller,currentFeatures=[];
const status=text=>{$('status').textContent=text;};
async function json(url,signal){const r=await fetch(url,{signal});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}
function draw(features){
 viewer.entities.removeAll();
 for(const f of features){
  const p=f.properties,estimated=p.kind==='unknown'&&$('estimate').checked,height=estimated?12:p.height;
  const color=p.kind==='tag'?C.Color.fromCssColorString('#85b4d1'):p.kind==='levels'?C.Color.fromCssColorString('#d4cbbb'):C.Color.fromCssColorString('#7c8990');
  const description=`${p.name}\n${estimated?'12米仅为示意，不是真实高度':p.label}\n${height?height+'米':''}\n${f.id}`;
  for(const polygon of f.geometry.coordinates){
   const positions=ring=>C.Cartesian3.fromDegreesArray(ring.flatMap(pt=>pt.slice(0,2)));
   viewer.entities.add({name:p.name,properties:{detail:description},polygon:{hierarchy:new C.PolygonHierarchy(positions(polygon[0]),polygon.slice(1).map(r=>new C.PolygonHierarchy(positions(r)))),height:height||0.5,material:color,outline:false}});
   if(height)for(const ring of polygon){
    viewer.entities.add({name:p.name,properties:{detail:description},wall:{positions:positions(ring),minimumHeights:ring.map(()=>0),maximumHeights:ring.map(()=>height),material:new C.ImageMaterialProperty({image:'city/textures/architecture/warm-residential.png',repeat:new C.Cartesian2(1,1),color})}});
   }
  }
 }
 viewer.scene.requestRender();document.body.dataset.ready='true';
}
function center(){const p=viewer.camera.pickEllipsoid(new C.Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2));const c=C.Cartographic.fromCartesian(p||viewer.camera.positionWC);return [C.Math.toDegrees(c.longitude),C.Math.toDegrees(c.latitude)];}
async function load(point=center()){
 const token=++revision;controller?.abort();controller=new AbortController();$('retry').hidden=true;status('正在按需读取附近网格…');
 const timeout=setTimeout(()=>controller?.abort(),20000);
 try{const tiles=nearestTiles(index.tiles,point);const collections=await Promise.all(tiles.map(t=>json(`baoan-data/${t.file}`,controller.signal)));if(token!==revision)return;
  const distance=f=>Math.hypot(f.geometry.coordinates[0][0][0][0]-point[0],f.geometry.coordinates[0][0][0][1]-point[1]);
  const all=collections.flatMap(c=>c.features).sort((a,b)=>distance(a)-distance(b));currentFeatures=all.slice(0,600);draw(currentFeatures);
  status(tiles.length?`本次 ${tiles.length} 个网格，显示 ${currentFeatures.length}/${all.length} 个部件；数据 ${(tiles.reduce((n,t)=>n+t.bytes,0)/1024).toFixed(0)} KiB。${all.length>600?'已触发600个上限，非全部建筑。':''}`:'附近没有已提取网格。请返回样板片区。');
 }catch(e){if(token!==revision)return;status('片区加载失败或超时，原画面保留；请重试。');$('retry').hidden=false;}finally{clearTimeout(timeout);}
}
function fly(point){viewer.camera.setView({destination:C.Cartesian3.fromDegrees(point[0],point[1]-0.006,750),orientation:{heading:0,pitch:C.Math.toRadians(-48),roll:0}});load(point);}
try{
 viewer=new C.Viewer('globe',{baseLayer:false,baseLayerPicker:false,geocoder:false,animation:false,timeline:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,infoBox:false,selectionIndicator:true,requestRenderMode:true,maximumRenderTimeChange:Infinity});
 if(new URLSearchParams(location.search).get('benchmark')==='1')window.__baoanViewer=viewer;
 viewer.resolutionScale=Math.min(1,1.5/devicePixelRatio);viewer.targetFrameRate=30;
 viewer.scene.globe.baseColor=C.Color.fromCssColorString('#304956');
 viewer.scene.screenSpaceCameraController.minimumZoomDistance=10;
 viewer.scene.screenSpaceCameraController.maximumZoomDistance=200000;
 index=await json('baoan-data/index.json',AbortSignal.timeout(20000));
 $('area').replaceChildren(...index.tiles.slice(0,30).map(t=>{const o=document.createElement('option');o.value=t.file;o.textContent=`网格 ${t.file.replace('.geojson','')} · ${t.known}项带高度/楼层`;return o;}));
 $('area').onchange=()=>fly(index.tiles.find(t=>t.file===$('area').value).center);
 $('load').onclick=()=>load();$('retry').onclick=()=>load();$('reset').onclick=()=>fly(index.start);$('estimate').onchange=()=>draw(currentFeatures);
 viewer.screenSpaceEventHandler.setInputAction(e=>{const picked=viewer.scene.pick(e.position);$('info').textContent=picked?.id?.properties?.detail?.getValue()||'未选中建筑。';},C.ScreenSpaceEventType.LEFT_CLICK);
 document.addEventListener('visibilitychange',()=>{viewer.useDefaultRenderLoop=!document.hidden;if(!document.hidden)viewer.scene.requestRender();});
 window.addEventListener('pagehide',()=>{revision++;controller?.abort();viewer.destroy();},{once:true});
 fly(index.start);
}catch(e){status('三维初始化失败，请刷新重试；也可返回原有地图。');console.error(e);}
