// GTA_SZ: x east, y up, z north. Undo 0.60 game scale without changing originals.
export function createCityLayer(catalog,onState){
 const B=window.BABYLON;let disposed=false,ready=false,scene,engine,camera,world,owner;
 return {id:'anju-landmarks',type:'custom',renderingMode:'3d',
  onAdd(map,gl){
   owner=map;
   const origin=maplibregl.MercatorCoordinate.fromLngLat(catalog.origin),unit=origin.meterInMercatorCoordinateUnits()/catalog.scale;
   world=B.Matrix.Compose(new B.Vector3(unit,unit,unit),B.Quaternion.FromEulerAngles(Math.PI/2,0,0),new B.Vector3(origin.x,origin.y,0));
   engine=new B.Engine(gl,true,{useHighPrecisionMatrix:true},true);
   scene=new B.Scene(engine);scene.autoClear=false;scene.autoClearDepthAndStencil=false;scene.detachControl();scene.beforeRender=()=>engine.wipeCaches(true);
   camera=new B.Camera('map-camera',B.Vector3.Zero(),scene);
   new B.HemisphericLight('sky',new B.Vector3(0,1,0),scene).intensity=1.3;
   B.MeshoptCompression.Configuration.decoder.url=new URL('./vendor/meshopt_decoder.js',import.meta.url).href;
   (async()=>{try{
    for(const file of ['landmarks','landmark-detail']){
     const result=await B.SceneLoader.ImportMeshAsync('',new URL('./models/',import.meta.url).href,file+'.glb',scene);if(disposed)return;
     if(result.meshes[0])result.meshes[0].rotationQuaternion=B.Quaternion.Identity();
     for(const mesh of result.meshes){
      if(file==='landmarks'&&catalog.replacedMeshPrefixes.some(p=>mesh.name.startsWith(p))){mesh.dispose();continue;}
      if(mesh.material){mesh.material.backFaceCulling=false;mesh.material.environmentIntensity=.7;}
     }
    }
    if(disposed)return;ready=true;map.triggerRepaint();
    scene.executeWhenReady(()=>{if(!disposed){map.triggerRepaint();onState('ready');}});
   }catch(e){if(!disposed)onState('error',e.message);}})();
  },
  render(gl,args){if(disposed||!ready||document.hidden||owner.getZoom()<14)return;camera.freezeProjectionMatrix(world.multiply(B.Matrix.FromArray(args.defaultProjectionData.mainMatrix)));scene.render(false);},
  onRemove(){disposed=true;scene?.dispose();engine?.dispose();}
 };
}
