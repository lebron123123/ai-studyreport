import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {coverageFeatures} from '../project-map/coverage.mjs';
import {inCityCoverage} from '../project-map/core.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const catalog=read('project-map/models/catalog.json');
catalog.originalTiles=read('project-map/city-stream-v1/index.json').tiles;
for(const district of ['futian','nanshan','luohu']){
 test(`${district}: published inventory reconciles with audited input; height uncertainty retained`,()=>{
  const root=`project-map/${district}-lod-v2/`,index=read(root+'index.json'),audit=read(`outputs/${district}-source/audit/coverage.json`);
  assert.equal(index.sourceMd5,audit.md5);assert.equal(index.completeDistrictClaim,false);
  const count=index.tiles.reduce((n,t)=>n+t.count,0);
  assert.equal(count+index.legacyOverlapExcluded,audit.features);
  assert.equal(count,index.counts.tag+index.counts.levels+index.counts.unknown);
  for(const t of index.tiles){
   const rows=read(root+'metadata/'+t.key+'.json');assert.equal(rows.length,t.count);
   assert.equal(rows.filter(r=>r.kind!=='unknown').length,t.known);
   for(const row of rows){assert.ok(row.height>row.base);assert.ok(Number.isFinite(row.height));if(row.kind==='unknown')assert.match(row.basis,/非实测/);}
   assert.ok(fs.existsSync(root+'mesh/'+t.key+'-known-fine.glb'));
  }
  assert.ok(fs.statSync(root+'overview.glb').size>100);
 });
 test(`${district}: every LOD asset and texture resolves; every coverage cell allows 3D entry`,()=>{
  const root=`project-map/${district}-lod-v2/`,index=read(root+'index.json'),c={...catalog,baoanTiles:index.tiles};
  for(const f of coverageFeatures(c).features){const ring=f.geometry.coordinates[0];assert.ok(ring.flat().every(Number.isFinite));assert.ok(inCityCoverage([(ring[0][0]+ring[2][0])/2,(ring[0][1]+ring[2][1])/2],c));}
  for(const layer of ['known','estimated'])for(const tile of read(root+layer+'.json').root.children){
   assert.equal(tile.refine,'REPLACE');assert.equal(tile.transform.length,16);
   for(const n of [tile,...tile.children]){
    const path=root+n.content.uri,b=fs.readFileSync(path);assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(8),b.length);
    const g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
    for(const image of g.images||[])assert.ok(fs.existsSync(new URL(image.uri,new URL(path,'file:///'+process.cwd().replaceAll('\\','/')+'/'))));
    for(const a of g.accessors){assert.ok(a.count>0);if(a.min)assert.ok([...a.min,...a.max].every(Number.isFinite));}
   }
  }
 });
}
