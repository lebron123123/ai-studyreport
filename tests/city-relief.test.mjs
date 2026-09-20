import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reliefGeometry,reliefHeight,nearestReliefTiles,validateRelief} from '../project-map/relief-core.mjs';
import {createCityReliefStream} from '../project-map/city-relief-stream.mjs';
const grid={x0:0,z0:0,step:1,columns:2,rows:2};
test('height follows the rendered diagonal and stays bounded',()=>{
 const h=new Float32Array([0,2,4,10]);
 assert.equal(reliefHeight(grid,h,.25,.25),1.5);
 assert.equal(reliefHeight(grid,h,.75,.75),6.5);
 assert.equal(reliefHeight(grid,h,1,1),10);
 assert.equal(reliefHeight(grid,h,-1,0),0);
});
test('stream releases fine geometry, retains overview and disposes on exit',async()=>{
 const originalFetch=globalThis.fetch,originalB=globalThis.BABYLON,objects=[];
 globalThis.fetch=async url=>{const b=readFileSync(url);return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
 class Mesh{constructor(){this.enabled=true;objects.push(this);}freezeWorldMatrix(){}setEnabled(v){this.enabled=v;}dispose(){this.disposed=true;}}
 class VertexData{static ComputeNormals(){}applyToMesh(){}}
 globalThis.BABYLON={Mesh,VertexData,PBRMaterial:class{dispose(){}}};
 let stream;
 try{
  const catalog=JSON.parse(readFileSync(new URL('../project-map/models/catalog.json',import.meta.url)));
  const manifest=JSON.parse(readFileSync(new URL('../project-map/city-relief-v1/manifest.json',import.meta.url)));
  stream=createCityReliefStream({},catalog,e=>assert.fail(e));await stream.init();
  const tile=manifest.tiles[0],p={x:tile.x0+500,z:tile.z0+500,y:100};
  for(let i=0;i<8;i++){stream.update(p);assert.ok(stream.stats.pending<=2);await new Promise(r=>setImmediate(r));}
  assert.ok(stream.stats.fine>0&&stream.stats.fine<=9);const count=stream.stats.fine;
  stream.update({...p,y:3000});assert.equal(stream.stats.fine,0);assert.ok(stream.stats.coarse>0);
  assert.equal(objects.filter(o=>o.disposed).length,count);
  stream.dispose();assert.ok(objects.every(o=>o.disposed));
 }finally{stream?.dispose();globalThis.fetch=originalFetch;globalThis.BABYLON=originalB;}
});
test('geometry rejects corruption and omits zero ground',()=>{
 assert.throws(()=>reliefGeometry(grid,new Float32Array([0,NaN,0,0])));
 assert.throws(()=>reliefGeometry(grid,new Float32Array(3)));
 assert.equal(reliefGeometry(grid,new Float32Array(4)).indices.length,0);
 assert.equal(reliefGeometry(grid,new Float32Array([0,1,0,0])).indices.length,6);
});
test('published data has matching coordinate frame and exact finite buffers',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../project-map/city-relief-v1/manifest.json',import.meta.url)));
 const catalog=JSON.parse(readFileSync(new URL('../project-map/models/catalog.json',import.meta.url)));
 validateRelief(manifest,catalog);
 assert.throws(()=>validateRelief(manifest,{...catalog,scale:1}));
 for(const tile of manifest.tiles){
  const buffer=readFileSync(new URL('../project-map/city-relief-v1/'+tile.file,import.meta.url));
  assert.equal(buffer.byteLength,tile.bytes);
  const heights=new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
  const g=reliefGeometry({...tile,step:manifest.step},heights);assert.ok(g.indices.length>0);
 }
 assert.equal(nearestReliefTiles(manifest,{x:0,z:0,y:2500}).length,0);
 assert.ok(nearestReliefTiles(manifest,{x:0,z:0,y:50}).length<=9);
});
