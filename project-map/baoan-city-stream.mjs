import {scenePoint} from './core.mjs';
import {adoptSceneAsset} from './container-ownership.mjs';
// Convert each source ENU footprint back to WGS84 before using the author's flat frame.
export function tileVertex(x,y,z,center,catalog){
 const [lo,la]=center.map(v=>v*Math.PI/180),s=Math.sin(la),c=Math.cos(la),sl=Math.sin(lo),cl=Math.cos(lo),e2=.00669437999014;
 const n=6378137/Math.sqrt(1-e2*s*s),north=-z;
 const X=n*c*cl-sl*x-s*cl*north,Y=n*c*sl+cl*x-s*sl*north,Z=n*(1-e2)*s+c*north;
 const lon=Math.atan2(Y,X),r=Math.hypot(X,Y);let lat=Math.atan2(Z,r*(1-e2));
 for(let i=0;i<5;i++){const N=6378137/Math.sqrt(1-e2*Math.sin(lat)**2);lat=Math.atan2(Z+e2*N*Math.sin(lat),r);}
 const p=scenePoint([lon*180/Math.PI,lat*180/Math.PI],catalog);return [p.x,y*catalog.scale,-p.z];
}
export function nearbyTiles(tiles,point,catalog,focus=point){return tiles.map(t=>{const a=scenePoint(t.bounds.slice(0,2),catalog),b=scenePoint(t.bounds.slice(2),catalog),distance=p=>Math.hypot(Math.max(a.x-p.x,0,p.x-b.x),Math.max(a.z-p.z,0,p.z-b.z));return {...t,d:Math.min(distance(point),distance(focus)+300)};}).filter(t=>t.d<1800).sort((a,b)=>a.d-b.d).slice(0,9);}
export function absoluteTextures(buffer,url){
 const view=new DataView(buffer),length=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)));
 for(const image of json.images||[])if(image.uri)image.uri=new URL(image.uri,url).href;
 const bytes=new TextEncoder().encode(JSON.stringify(json)),padded=Math.ceil(bytes.length/4)*4,out=new Uint8Array(buffer.byteLength-length+padded),dv=new DataView(out.buffer);
 out.set(new Uint8Array(buffer,0,20));dv.setUint32(8,out.length,true);dv.setUint32(12,padded,true);out.fill(32,20,20+padded);out.set(bytes,20);out.set(new Uint8Array(buffer,20+length),20+padded);return out;
}
export function createBaoanStream(scene,catalog,notify,upload=task=>task()){
 const B=globalThis.BABYLON,loaded=new Map(),pending=new Set(),failed=new Set(),overviews=[];let wanted=new Set(),dead=false,estimate=false,last=0,mode='sunset';
 function syncOverview(){for(const a of overviews)for(const m of a.meshes)if(m.name.startsWith('baoan-overview-'))m.setEnabled(!loaded.has(m.name.slice(15)+'-known'));}
 function lightAsset(a){for(const m of a.materials)if(m.emissiveTexture){m.emissiveColor=new B.Color3(1,.94,.83);m.emissiveIntensity=mode==='day'?0:mode==='night'?1.35:.45;}}
 function release(a){a.dispose();}
 async function load(t,layer){const key=t.key+'-'+layer;pending.add(key);let acquired;
  try{await upload(async signal=>{const url=new URL('/project-map/'+(t.assetBase||'baoan-lod-v2')+'/mesh/'+(t.sourceKey||t.key)+'-'+layer+'-fine.glb',location.href).href;
   const response=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});if(!response.ok)throw Error('HTTP '+response.status);
   const data=absoluteTextures(await response.arrayBuffer(),url);
   if(dead||upload.isActive?.()===false)return;
   const a=await B.LoadAssetContainerAsync(data,scene,{pluginExtension:'.glb'});acquired=a;
   if(dead||upload.isActive?.()===false||!wanted.has(key)){release(a);return;}
   const root=a.meshes[0];root.rotationQuaternion=B.Quaternion.Identity();root.scaling.set(1,1,-1);
   for(const m of a.meshes){const pos=m.getVerticesData(B.VertexBuffer.PositionKind);if(!pos)continue;
    for(let i=0;i<pos.length;i+=3){const p=tileVertex(pos[i],pos[i+1],pos[i+2],t.center,catalog);pos[i]=p[0];pos[i+1]=p[1];pos[i+2]=p[2];}
    m.setVerticesData(B.VertexBuffer.PositionKind,pos);m.refreshBoundingInfo();m.metadata={baoan:true,estimated:layer==='estimated'};
   }
   const textured=a.materials.filter(m=>m.albedoTexture);
   if(textured.length){const mask=new B.Texture('/project-map/city/textures/architecture/warm-residential-windows.png',scene,false,false);adoptSceneAsset(a,scene,'textures',mask);for(const m of textured)m.emissiveTexture=mask;lightAsset(a);}
   if(layer==='known'){
    const sw=scenePoint(t.bounds.slice(0,2),catalog),ne=scenePoint(t.bounds.slice(2),catalog);
    const ground=B.MeshBuilder.CreateGround('baoan-ground-'+key,{width:ne.x-sw.x,height:ne.z-sw.z},scene);ground.position.set((sw.x+ne.x)/2,-.6,(sw.z+ne.z)/2);ground.isPickable=false;
    const mat=new B.StandardMaterial('baoan-ground-material-'+key,scene);mat.diffuseColor=new B.Color3(.16,.19,.17);mat.specularColor=B.Color3.Black();ground.material=mat;adoptSceneAsset(a,scene,'meshes',ground);adoptSceneAsset(a,scene,'materials',mat);
   }
   a.addAllToScene();loaded.set(key,a);syncOverview();scene.metadata.baoanLoaded=loaded.size;
  },{label:'补充分块 '+layer,wanted:()=>!dead&&Date.now()>=pressureUntil&&wanted.has(key)});
  }catch(e){loaded.delete(key);acquired?.dispose();syncOverview();failed.add(key);if(!dead){scene.metadata.baoanError=String(e.message||e);console.warn('[city-block]',key,e);const reason=e.name==='TimeoutError'||e.name==='AbortError'?'读取超时':/^HTTP \d+$/.test(e.message)?e.message:'模型解析失败';if(wanted.has(key))notify((t.districtName||'宝安')+'分块 '+(t.sourceKey||t.key)+' '+reason+'；移开再返回可重试，原有地图仍可使用。',true);}}
  finally{pending.delete(key);}
 }
 scene.metadata={...scene.metadata,baoanLoaded:0};
 let pressureUntil=0;
 const unregister=upload.registerEvictor?.(()=>{for(const a of loaded.values())release(a);loaded.clear();syncOverview();pressureUntil=Date.now()+30000;});
 return {async initOverview(){for(const path of ['city-stream-v1/baoan-overview.glb',...(catalog.districts||[]).filter(d=>d.id!=='baoan').map(d=>d.id+'-lod-v2/overview.glb')]){if(dead)return;try{await upload(async signal=>{const r=await fetch('/project-map/'+path,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);if(dead||upload.isActive?.()===false)return;const a=await B.LoadAssetContainerAsync(new Uint8Array(await r.arrayBuffer()),scene,{pluginExtension:'.glb'});if(dead||upload.isActive?.()===false){a.dispose();return;}a.meshes[0].rotationQuaternion=B.Quaternion.Identity();a.addAllToScene();overviews.push(a);syncOverview();scene.metadata.baoanOverview=true;},{label:'片区概览'});}catch(e){if(!dead)notify('部分片区概览暂未载入；附近详细建筑仍可浏览，刷新可重试。',true);}}},setMode(v){mode=v;for(const a of loaded.values())lightAsset(a);},setEstimate(v){estimate=!!v;last=0;},update(point,focus=point){if(dead||performance.now()-last<500)return;last=performance.now();
  const near=point.y>2000?[]:nearbyTiles(catalog.baoanTiles||[],point,catalog,focus);wanted=new Set(near.flatMap(t=>[t.key+'-known',...(estimate&&t.count>t.known?[t.key+'-estimated']:[])]));
  for(const [k,a] of loaded)if(!wanted.has(k)){release(a);loaded.delete(k);}
  for(const k of failed)if(!wanted.has(k))failed.delete(k);
  if(Date.now()>=pressureUntil)for(const t of near)for(const layer of ['known',...(estimate&&t.count>t.known?['estimated']:[])]){const k=t.key+'-'+layer;if(pending.size<2&&!loaded.has(k)&&!pending.has(k)&&!failed.has(k))load(t,layer);}
  syncOverview();scene.metadata.baoanLoaded=loaded.size;
 },dispose(){dead=true;unregister?.();wanted.clear();for(const a of loaded.values())release(a);loaded.clear();for(const a of overviews)a.dispose();overviews.length=0;}};
}
