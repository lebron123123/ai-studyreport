import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHQGeometry,triangulateRing} from '../project-map/anju-hq-geometry.mjs';
const catalog={origin:[114.025,22.536],scale:.6};
test('concave roof clipping preserves area rather than spanning a concavity',()=>{
 const {ring,triangles}=triangulateRing([[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]]);
 let area=0;for(let i=0;i<triangles.length;i+=3){const [a,b,c]=triangles.slice(i,i+3).map(j=>ring[j]);area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}
 assert.equal(area,7);
});
test('HQ has four source-specific bodies and finite bounded geometry',()=>{
 const g=buildHQGeometry(catalog);assert.equal(g.bodies.length,4);
 let bytes=0;
 for(const b of g.bodies)for(const part of [b.shell,b.panels,b.frames]){
  assert.ok(part.positions.every(Number.isFinite));assert.equal(part.indices.length%3,0);
  assert.equal(part.colors.length,part.positions.length/3*4);
  assert.ok(part.indices.every(i=>i>=0&&i<part.positions.length/3));
  for(let i=1;i<part.positions.length;i+=3)assert.ok(part.positions[i]>=0&&part.positions[i]<=299.1*.6+1e-7);
  bytes+=(part.positions.length+part.indices.length+part.colors.length)*4;
 }
 assert.ok(bytes<8*1024*1024,`HQ geometry too large: ${bytes}`);
 assert.equal(g.logo.host,'tower-a');assert.equal(g.logo.position.y,291.1*.6);
 assert.equal(g.status,'reference-reconstruction-not-accepted');
});
test('reconstruction is deterministic, with no random facade churn on reload',()=>{
 assert.deepEqual(buildHQGeometry(catalog),buildHQGeometry(catalog));
});
