import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHQModel} from '../project-map/anju-hq-model.mjs';
const B=createRequire(import.meta.url)('../project-map/vendor/babylon.js');
test('HQ model repeatedly releases real Babylon meshes, materials and hosts',()=>{
 const engine=new B.NullEngine(),scene=new B.Scene(engine),base=[scene.meshes.length,scene.materials.length,scene.transformNodes.length,scene.textures.length];
 for(let i=0;i<5;i++){
  const model=createHQModel(B,scene,{origin:[114.025,22.536],scale:.6},{withLogo:false});
  assert.equal(model.meshes.length,12);assert.equal(model.root.metadata.status,'reference-reconstruction-not-accepted');
  assert.ok(model.meshes.every(m=>m.getTotalVertices()>0));
  const roof=model.meshes[0].getVerticesData(B.VertexBuffer.NormalKind);
  assert.ok(roof[model.data.bodies[0].ring.length*3+1]>.99,'roof must face the sky');
  const facade=model.meshes[1];
  assert.equal(facade.getVerticesData(B.VertexBuffer.UVKind).length,facade.getTotalVertices()*2);
  assert.ok(facade.material.diffuseTexture,'facade must use filtered texture instead of subpixel fins');
  model.dispose();model.dispose();assert.deepEqual([scene.meshes.length,scene.materials.length,scene.transformNodes.length,scene.textures.length],base);
 }
 scene.dispose();engine.dispose();
});
