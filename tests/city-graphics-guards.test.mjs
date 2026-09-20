import test from 'node:test';
import assert from 'node:assert/strict';
import {skyBoxSize} from '../project-map/sky-bounds.mjs';

test('sky corners remain inside the far plane at arbitrary camera angles',()=>{
 for(const far of [1000,60000,100000]) {
  const half=skyBoxSize(far)/2;
  assert.ok(Math.hypot(half,half,half)<far);
 }
 for(const bad of [0,-1,NaN,Infinity])assert.throws(()=>skyBoxSize(bad));
});

test('context pause stops queued facades and disposes a late import before integration',async t=>{
 const original=globalThis.BABYLON;
 let resolveImport,imports=0,released=0;
 globalThis.BABYLON={ImportMeshAsync:()=>{imports++;return new Promise(r=>resolveImport=r);},Quaternion:{Identity:()=>({})},PBRMaterial:class{}};
 t.after(()=>{if(original===undefined)delete globalThis.BABYLON;else globalThis.BABYLON=original;});
 const {CityFacadeStream}=await import('../project-map/reference/city-facade-stream.mjs');
 const stream=new CityFacadeStream({onDisposeObservable:{addOnce(){}}},()=>{},()=>{throw Error('Paused asset must not integrate');});
 stream.tiles=[{id:'test',x:0,z:0}];
 const pending=stream.pump();assert.equal(imports,1);
 stream.setPaused(true);
 resolveImport({meshes:[{dispose(recursive,textures){assert.equal(textures,true);released++;}}]});
 await pending;
 assert.equal(released,1);assert.equal(stream.resident.size,0);
 await stream.pump();assert.equal(imports,1);
 stream.visible=false;stream.setPaused(false);
 assert.equal(stream.paused,false);assert.equal(imports,1);
});
