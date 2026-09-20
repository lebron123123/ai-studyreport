import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBaoanStream} from '../project-map/baoan-city-stream.mjs';
import {scenePoint} from '../project-map/core.mjs';

test('departed and late district containers are disposed, not merely hidden', async t=>{
 const bytes=await readFile(new URL('../project-map/baoan-lod-v2/mesh/-14_2-known-fine.glb',import.meta.url));
 let now=1000,resolveAsset,disposed=0,added=0;
 const asset=()=>({meshes:[{rotationQuaternion:null,scaling:{set(){}},getVerticesData(){return null;}}],materials:[],textures:[],addAllToScene(){added++;},dispose(){disposed++;}});
 const old={BABYLON:globalThis.BABYLON,location:globalThis.location,fetch:globalThis.fetch,performance:globalThis.performance};
 t.after(()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
 globalThis.performance={now:()=>now};globalThis.location={href:'http://localhost:8080/'};
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
 class Color {static Black(){return new Color();}}
 globalThis.BABYLON={Quaternion:{Identity:()=>({})},VertexBuffer:{PositionKind:'position'},Color3:Color,StandardMaterial:class{constructor(name,scene){scene.materials.push(this);}},MeshBuilder:{CreateGround:(name,options,scene)=>{const mesh={position:{set(){}}};scene.meshes.push(mesh);return mesh;}},LoadAssetContainerAsync:()=>new Promise(resolve=>{resolveAsset=resolve;})};
 const tile={key:'futian:a',sourceKey:'a',assetBase:'futian-lod-v2',center:[114.04,22.54],bounds:[114.039,22.539,114.041,22.541],count:1,known:1};
 const catalog={origin:[114.025,22.536],scale:.6,baoanTiles:[tile]},scene={metadata:{},meshes:[],materials:[],removeMesh(asset){this.meshes.splice(this.meshes.indexOf(asset),1);},removeMaterial(asset){this.materials.splice(this.materials.indexOf(asset),1);}},stream=createBaoanStream(scene,catalog,()=>{}),near={...scenePoint(tile.center,catalog),y:30},far={x:100000,z:100000,y:30};
 const settle=()=>new Promise(r=>setImmediate(r));
 stream.update(near);await settle();assert.equal(typeof resolveAsset,'function');
 now+=600;stream.update(far);resolveAsset(asset());await settle();assert.equal(disposed,1);assert.equal(added,0);
 now+=600;stream.update(near);await settle();resolveAsset(asset());await settle();assert.equal(added,1);assert.equal(scene.metadata.baoanLoaded,1);assert.equal(scene.meshes.length,0);assert.equal(scene.materials.length,0);
 now+=600;stream.update(far);assert.equal(disposed,2);assert.equal(scene.metadata.baoanLoaded,0);
 now+=600;stream.update(near);await settle();stream.dispose();resolveAsset(asset());await settle();assert.equal(disposed,3);assert.equal(added,1);
});
