// Asset and root-orientation convention reused from GTA_SZ city-world.ts.
// Independent observer only: no game loop, characters, traffic, HDR or sound.
export function createModelViewer(canvas){
  window.BABYLON.MeshoptCompression.Configuration.decoder.url=new URL('./vendor/meshopt_decoder.js',import.meta.url).href;
  const B=window.BABYLON,engine=new B.Engine(canvas,true,{preserveDrawingBuffer:false,stencil:true});
  engine.setHardwareScalingLevel(Math.max(1,window.devicePixelRatio||1));
  const scene=new B.Scene(engine);scene.clearColor=new B.Color4(.90,.94,.97,1);
  const camera=new B.ArcRotateCamera('observer',-Math.PI/2,1.05,350,B.Vector3.Zero(),scene);
  camera.attachControl(canvas,true);camera.minZ=.5;camera.maxZ=15000;camera.lowerRadiusLimit=12;camera.upperRadiusLimit=6000;camera.wheelDeltaPercentage=.02;
  new B.HemisphericLight('sky',new B.Vector3(0,1,0),scene).intensity=1.2;
  const sun=new B.DirectionalLight('sun',new B.Vector3(-.4,-1,.3),scene);sun.intensity=1.8;
  let disposed=false,home=null;
  const render=()=>{if(!disposed)scene.render();},resize=()=>{if(!disposed)engine.resize();};
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  engine.runRenderLoop(render);
  return {
    async load(item,catalog){
      for(const name of ['landmarks','landmark-detail']){
        if(disposed)return;
        const result=await B.SceneLoader.ImportMeshAsync('', './models/',name+'.glb',scene);
        if(disposed){for(const m of result.meshes)m.dispose();return;}
        if(result.meshes[0])result.meshes[0].rotationQuaternion=B.Quaternion.Identity();
        for(const mesh of result.meshes){
          if(name==='landmarks'&&catalog.replacedMeshPrefixes.some(p=>mesh.name.startsWith(p))){mesh.dispose();continue;}
          if(mesh.material){mesh.material.backFaceCulling=false;mesh.material.environmentIntensity=.7;}
        }
      }
      if(disposed)return;
      const radius=Number(item.photoDistance)||Math.max(250,(Number(item.height)||100)*3);
      home={target:new B.Vector3(item.x,Number(item.photoTargetHeight)||Math.max(20,(Number(item.height)||80)/2),item.z),radius};
      camera.setTarget(home.target);camera.radius=home.radius;
      await scene.whenReadyAsync();if(!disposed){resize();scene.render();}
    },
    reset(){if(home&&!disposed){camera.setTarget(home.target);camera.radius=home.radius;camera.alpha=-Math.PI/2;camera.beta=1.05;}},
    pause(hidden){if(disposed)return;engine.stopRenderLoop(render);if(!hidden)engine.runRenderLoop(render);},
    dispose(){if(disposed)return;disposed=true;observer.disconnect();engine.stopRenderLoop();scene.dispose();engine.dispose();}
  };
}
