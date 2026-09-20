import test from 'node:test';
import assert from 'node:assert/strict';
import {createHQFootprintTest,filterHQIndices} from '../project-map/anju-hq-city.mjs';
import {buildHQGeometry} from '../project-map/anju-hq-geometry.mjs';
import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync(new URL('../project-map/models/catalog.json',import.meta.url)));
test('replacement requires every triangle vertex; crossing neighbours remain',()=>{
 const r=filterHQIndices([0,1,2,0,2,3],[[0,1,0],[1,1,0],[0,1,1],[20,1,20]],(x,y,z)=>x<2&&z<2);
 assert.deepEqual(r,{indices:[0,2,3],removed:1});
});
test('HQ footprint accepts tower centre but excludes roads and high/underground geometry',()=>{
 const g=buildHQGeometry(catalog),inside=createHQFootprintTest(catalog),ring=g.bodies[0].ring;
 const x=g.anchor.x+ring.reduce((s,p)=>s+p[0],0)/ring.length,z=g.anchor.z+ring.reduce((s,p)=>s+p[1],0)/ring.length;
 assert.ok(inside(x,30,z));assert.ok(!inside(x,-10,z));assert.ok(!inside(x,400,z));assert.ok(!inside(x+1000,30,z));
});
test('coarse model retains all four silhouettes without facade allocation',()=>{
 const g=buildHQGeometry(catalog,undefined,{detail:false});assert.equal(g.bodies.length,4);
 for(const b of g.bodies){assert.ok(b.shell.indices.length);assert.equal(b.panels.indices.length,0);assert.equal(b.frames.indices.length,0);}
});
test('real author GLB blocks retain non-HQ triangles while removing HQ overlap',()=>{
 let removed=0,retained=0;const contains=createHQFootprintTest(catalog);
 for(const key of ['-8_-1','-9_-1'])for(const lod of ['coarse','fine']){
  const buf=fs.readFileSync(new URL(`../project-map/city-stream-v1/buildings-${key}-${lod}.glb`,import.meta.url)),len=buf.readUInt32LE(12),g=JSON.parse(buf.subarray(20,20+len)),bin=buf.subarray(28+len);
  function read(id,i){const a=g.accessors[id],v=g.bufferViews[a.bufferView],n=a.type==='VEC3'?3:1,s={5122:2,5123:2,5125:4,5126:4}[a.componentType];assert.ok(s);const p=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||n*s);return Array.from({length:n},(_,j)=>{const o=p+j*s;return a.componentType===5122?bin.readInt16LE(o)/(a.normalized?32767:1):a.componentType===5123?bin.readUInt16LE(o):a.componentType===5125?bin.readUInt32LE(o):bin.readFloatLE(o);});}
  for(const node of g.nodes){assert.ok(!node.rotation&&!node.matrix);if(node.mesh===undefined)continue;for(const p of g.meshes[node.mesh].primitives){
   const points=Array.from({length:g.accessors[p.attributes.POSITION].count},(_,i)=>read(p.attributes.POSITION,i).map((v,d)=>(v*(node.scale?.[d]??1)+(node.translation?.[d]??0))*(d===2?-1:1)));
   const ids=Array.from({length:g.accessors[p.indices].count},(_,i)=>read(p.indices,i)[0]),r=filterHQIndices(ids,points,contains);
   removed+=r.removed;retained+=r.indices.length/3;assert.equal(ids.length,r.indices.length+r.removed*3);
   assert.equal(filterHQIndices(r.indices,points,contains).removed,0);
  }}
 }
 assert.ok(removed>100);assert.ok(retained>100);console.log({hqTrianglesRemoved:removed,neighbourTrianglesRetained:retained});
});
