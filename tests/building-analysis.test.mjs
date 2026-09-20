import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeBuildings,validateManifest} from '../project-map/building-analysis-core.mjs';
test('buffer counts nearby records across districts and retains unknown completeness',()=>{
 const r=summarizeBuildings([[114,22.6,100,'福田区'],[114.001,22.6,250,'龙岗区'],[114.2,22.6,500,'其他']],[114,22.6],500);
 assert.equal(r.count,2);assert.equal(r.footprint,350);assert.deepEqual(r.districts,{'福田区':1,'龙岗区':1});assert.equal(r.coverage,'unknown');
});
test('generated city data reconciles every district, grid and density bounds',()=>{
 const read=n=>JSON.parse(readFileSync(new URL('../project-map/building-analysis-v1/'+n,import.meta.url),'utf8'));
 const m=validateManifest(read('manifest.json')),p=read('points.json'),g=read('grid.geojson');
 assert.equal(p.length,m.records);assert.equal(g.features.length,m.gridCells);
 assert.equal(Object.values(m.districtCounts).reduce((a,b)=>a+b,0),p.length);
 for(const d of ['宝安区','南山区','福田区','罗湖区','龙华区','龙岗区','光明区','坪山区','盐田区','大鹏新区','深汕特别合作区'])assert.ok(m.districtCounts[d]>0,d);
 assert.equal(g.features.reduce((n,f)=>n+f.properties.count,0),p.length);
 for(const f of g.features){const v=f.properties;assert.ok(v.density>=0&&v.density<=100);assert.ok(v.footprint>=0&&v.cellArea>0);assert.ok(Math.abs(v.density-100*v.footprint/v.cellArea)<.1);}
 const all=summarizeBuildings(p,[114.057,22.543],2000);assert.ok(all.count>0);assert.equal(all.coverage,'unknown');
});
test('empty data is not complete zero inventory; invalid radii and records fail',()=>{
 assert.equal(summarizeBuildings([],[114,22.6],1000).coverage,'unknown');
 assert.throws(()=>summarizeBuildings([],[114,22.6],0));assert.throws(()=>summarizeBuildings([[114,22.6,-1,'区']],[114,22.6],500));
});
test('manifest rejects complete-city claims and unknown versions',()=>{
 const m={version:1,records:2,completeCityClaim:false,gridSizeMetres:500,districtCounts:{'福田区':2}};
 assert.equal(validateManifest(m),m);assert.throws(()=>validateManifest({...m,completeCityClaim:true}));assert.throws(()=>validateManifest({...m,version:2}));
});
test('3000m buffer includes records outside 2000m',()=>{
 const points=[[114.025,22.6,100,'测试区']];
 assert.equal(summarizeBuildings(points,[114,22.6],2000).count,0);
 assert.equal(summarizeBuildings(points,[114,22.6],3000).count,1);
});
