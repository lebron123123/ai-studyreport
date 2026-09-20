import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root='project-map/baoan-lod-v2/';
test('overview batching preserves vertex counts and ECEF coordinates within 1 cm',()=>{
 function read(uri){const b=fs.readFileSync(root+uri),length=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+length));return {g,positions(p){const a=g.accessors[p.attributes.POSITION],v=g.bufferViews[a.bufferView];return new Float32Array(b.buffer,b.byteOffset+28+length+v.byteOffset,a.count*3);}};}
 const world=(p,m)=>[m[0]*p[0]+m[8]*p[1]-m[4]*p[2]+m[12],m[1]*p[0]+m[9]*p[1]-m[5]*p[2]+m[13],m[2]*p[0]+m[10]*p[1]-m[6]*p[2]+m[14]];
 for(const layer of ['known','estimated']){const original=JSON.parse(fs.readFileSync(root+layer+'.json')),overview=JSON.parse(fs.readFileSync(root+'overview-'+layer+'.json'));const seen=[];
 for(const batch of overview.root.children){const combined=read(batch.content.uri),offsets=new Map();
  for(const uri of batch.extras.sourceTiles){seen.push(uri);const tile=original.root.children.find(t=>t.content.uri===uri);assert.ok(tile);const source=read(tile.content.uri);for(const p of source.g.meshes[0].primitives){const a=source.positions(p),target=combined.positions(combined.g.meshes[0].primitives.find(x=>x.material===p.material)),offset=offsets.get(p.material)||0;
   for(const i of [0,Math.floor(a.length/6)*3,a.length-3]){const x=world(a.subarray(i,i+3),tile.transform),y=world(target.subarray(offset+i,offset+i+3),batch.transform);assert.ok(Math.hypot(...x.map((v,k)=>v-y[k]))<.01);}
   offsets.set(p.material,offset+a.length);
  }}
  for(const p of combined.g.meshes[0].primitives)assert.equal(combined.positions(p).length,offsets.get(p.material));
  assert.ok(combined.g.meshes[0].primitives.length<=5);
 }
  assert.deepEqual(seen.sort(),original.root.children.map(t=>t.content.uri).sort());
  assert.ok(overview.geometricError>0,'single-root tileset must remain eligible for Cesium traversal');
 }
});
test('all source features accounted for and estimates remain explicitly separate',()=>{
 const index=JSON.parse(fs.readFileSync(root+'index.json'));
 assert.equal(index.tiles.reduce((n,t)=>n+t.count,0),23000);
 assert.equal(index.tiles.filter(t=>t.count===0).length,149,'context-only cells must not be omitted from the basemap');
 assert.equal(index.counts.tag+index.counts.levels+index.counts.unknown,23000);
 for(const tile of index.tiles){const rows=JSON.parse(fs.readFileSync(root+'metadata/'+tile.key+'.json'));assert.equal(rows.length,tile.count);for(const row of rows){assert.ok(row.height>0&&row.height<=1000);assert.ok(row.base<row.height);if(row.kind==='unknown')assert.match(row.basis,/非实测/);}}
});
test('tile frames preserve WGS84 location and generated height axis',()=>{
 const manifest=JSON.parse(fs.readFileSync(root+'known.json'));
 for(const tile of manifest.root.children){
  const m=tile.transform,r=tile.boundingVolume.region;
  const lon=Math.atan2(m[13],m[12]);let lat=Math.atan2(m[14],Math.hypot(m[12],m[13])*(1-.00669437999014));
  for(let i=0;i<5;i++){const n=6378137/Math.sqrt(1-.00669437999014*Math.sin(lat)**2);lat=Math.atan2(m[14]+.00669437999014*n*Math.sin(lat),Math.hypot(m[12],m[13]));}
  assert.ok(lon>=r[0]&&lon<=r[2]&&lat>=r[1]&&lat<=r[3]);
  const b=fs.readFileSync(root+tile.children[0].content.uri),g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
  for(const p of g.meshes[0].primitives){const a=g.accessors[p.attributes.POSITION];assert.ok(a.min[1]>=0&&a.max[1]<=r[5]);assert.ok(Math.max(Math.abs(a.min[0]),Math.abs(a.max[0]),Math.abs(a.min[2]),Math.abs(a.max[2]))<10000);}
  assert.ok(Math.abs(m[8]**2+m[9]**2+m[10]**2-1)<1e-10);
 }
});
test('3D Tiles 1.1 has valid replacement LODs, referenced GLBs and bounded geometry',()=>{
 for(const layer of ['known','estimated']){
  const manifest=JSON.parse(fs.readFileSync(root+layer+'.json'));assert.equal(manifest.asset.version,'1.1');
  for(const tile of manifest.root.children){assert.equal(tile.refine,'REPLACE');assert.equal(tile.transform.length,16);assert.equal(tile.children[0].geometricError,0);
   for(const node of [tile,...tile.children]){const b=fs.readFileSync(root+node.content.uri);assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(8),b.length);const length=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+length).toString());
    assert.equal(g.asset.version,'2.0');assert.ok(g.meshes[0].primitives.length);for(const a of g.accessors){const v=g.bufferViews[a.bufferView];assert.ok(v.byteOffset+v.byteLength<=g.buffers[0].byteLength);assert.ok(a.count>0);if(a.min)assert.ok([...a.min,...a.max].every(Number.isFinite));}
   }
  }
 }
});
