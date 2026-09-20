import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createTour} from '../project-map/tour.mjs';
import {replacementFilter} from '../project-map/model-footprints.mjs';
test('replacement footprints are explicit geographic polygons, not a city-wide mask',()=>{
 const c=JSON.parse(fs.readFileSync(new URL('../project-map/models/catalog.json',import.meta.url)));
 const d=JSON.parse(fs.readFileSync(new URL('../project-map/models/landmark-detail.json',import.meta.url)));
 const mask=replacementFilter(c,d)[2][1][1];assert.equal(mask.type,'MultiPolygon');assert.equal(mask.coordinates.length,24);
 for(const [ring] of mask.coordinates){assert.ok(ring.length>=4);for(const p of ring)assert.ok(p.every(Number.isFinite));assert.ok(Math.abs(ring[0][0]-ring.at(-1)[0])<1e-9);}
});
test('tour is finite and cancellation prevents stale callbacks',()=>{
 const pending=new Map();let id=0;const seen=[];
 const tour=createTour({fly:x=>seen.push(x),rotate:()=>seen.push('rotate'),stopCamera:()=>{},changed:()=>{},schedule:fn=>{pending.set(++id,fn);return id;},cancel:key=>pending.delete(key)});
 const tick=()=>{const [key,fn]=pending.entries().next().value;pending.delete(key);fn();};
 tour.start(['a','b']);assert.equal(tour.active,true);tick();tick();tick();tick();assert.equal(tour.active,false);assert.deepEqual(seen,['a','rotate','b','rotate']);
 tour.start(['c']);const stale=[...pending.values()][0];tour.stop();stale();assert.equal(pending.size,0);assert.equal(tour.active,false);assert.equal(seen.at(-1),'c');
 tour.start([]);assert.equal(tour.active,false);
});
import {coordinate,toWgs84,publicSnapshot,landmarkCoordinate,scenePoint,inCityCoverage} from '../project-map/core.mjs';
test('city coordinates round trip and uncovered Baoan is rejected',()=>{
 const c=JSON.parse(fs.readFileSync(new URL('../project-map/models/catalog.json',import.meta.url)));
 for(const m of c.landmarks.filter(m=>Number.isFinite(m.x)&&Number.isFinite(m.z))){
  const p=scenePoint(landmarkCoordinate({x:m.x,z:m.z},c),c);
  assert.ok(Math.abs(p.x-m.x)<1e-6);assert.ok(Math.abs(p.z-m.z)<1e-6);
 }
 assert.equal(inCityCoverage([113.88,22.6],c),false);
 assert.equal(inCityCoverage(c.origin,c),true);
 assert.equal(inCityCoverage(null,c),false);
});
test('coordinates reject blanks, invalid ranges and unknown CRS',()=>{
  for(const v of ['',',','x,22','181,22',[1,2,3]])assert.equal(coordinate(v),null);
  assert.equal(toWgs84('114,22','unknown'),null);assert.deepEqual(toWgs84('114,22','WGS84'),[114,22]);
});
test('Shenzhen GCJ coordinate is converted, not blindly reused',()=>{
  const p=toWgs84('114.0559,22.5385','GCJ02');assert.ok(p[0]>114.050&&p[0]<114.052);assert.ok(p[1]>22.540&&p[1]<22.542);
});
test('project snapshot excludes report, tokens and mutation',()=>{
  const p={name:'项目',poiLoc:'114,22',token:'private',report:'private'};const s=publicSnapshot(p);
  assert.deepEqual(Object.keys(s),['name','location','crs']);assert.equal(p.poiLoc,'114,22');
});
test('author catalog has real models with exact source hashes',()=>{
  const c=JSON.parse(fs.readFileSync(new URL('../project-map/models/catalog.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
  assert.ok(c.landmarks.length>=13);
  const ids=new Set();
  for(const file of ['landmarks','landmark-detail']){const b=fs.readFileSync(new URL('../project-map/models/'+file+'.glb',import.meta.url));const gltf=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));for(const n of gltf.nodes){const m=n.name?.match(/^(landmark|detail)_([^_]+)_/);if(m)ids.add(m[2]);}}
  assert.deepEqual([...ids].sort(),[...c.modelIds].sort());
  for(const a of c.assets){const b=fs.readFileSync(new URL('../project-map/models/'+a.file,import.meta.url));assert.equal(b.length,a.bytes);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),a.sha256);}
  for(const m of c.landmarks){const p=landmarkCoordinate(m,c);assert.ok(p[0]>113&&p[0]<115&&p[1]>22&&p[1]<23);}
});
