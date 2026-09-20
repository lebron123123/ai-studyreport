import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {adoptSceneAsset} from '../project-map/container-ownership.mjs';
const B=createRequire(import.meta.url)('../project-map/vendor/babylon.js');
test('real Babylon repeated container unload leaves no texture, mesh or material ghosts',()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine);
 try{
  // Establish the real engine regression, not a mock of its registration rules.
  const broken=new B.AssetContainer(scene),texture=new B.Texture(null,scene);
  broken.textures.push(texture);broken.addAllToScene();
  assert.equal(scene.textures.filter(t=>t===texture).length,2);
  broken.dispose();assert.equal(scene.textures.includes(texture),true);
  scene.removeTexture(texture);
  const baseline={textures:scene.textures.length,meshes:scene.meshes.length,materials:scene.materials.length};
  for(let i=0;i<20;i++){
   const a=new B.AssetContainer(scene);
   const entries={textures:new B.Texture(null,scene),meshes:B.MeshBuilder.CreateGround('ground',{},scene),materials:new B.StandardMaterial('ground-material',scene)};
   entries.meshes.material=entries.materials;
   for(const [kind,item]of Object.entries(entries)){
    adoptSceneAsset(a,scene,kind,item);adoptSceneAsset(a,scene,kind,item);
    assert.equal(scene[kind].includes(item),false);assert.equal(a[kind].length,1);
   }
   a.addAllToScene();
   for(const [kind,item]of Object.entries(entries))assert.equal(scene[kind].filter(v=>v===item).length,1);
   a.dispose();
   for(const kind of Object.keys(entries))assert.equal(scene[kind].length,baseline[kind]);
  }
 }finally{engine.dispose();}
});
