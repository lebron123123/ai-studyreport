import test from 'node:test';
import assert from 'node:assert/strict';
import {researchHits} from '../project-map/project-hit-test.mjs';
test('项目小圆点扩大命中范围且优先于配套',()=>{
 const calls=[], projects=[{properties:{kind:'project',id:'a'}}];
 const map={getLayer:()=>true,queryRenderedFeatures:(p,o)=>{calls.push([p,o]);return projects;}};
 assert.deepEqual(researchHits(map,{x:30,y:40}),projects);
 assert.deepEqual(calls,[[[[20,30],[40,50]],{layers:['research-points']}]]);
});
test('空项目命中回退配套，未加载不查询',()=>{
 const calls=[]; const map={getLayer:()=>true,queryRenderedFeatures:(p,o)=>{calls.push(o.layers[0]);return [];}};
 assert.deepEqual(researchHits(map,{x:0,y:0}),[]);
 assert.deepEqual(calls,['research-points','research-facilities']);
 assert.deepEqual(researchHits(null,{x:0,y:0}),[]);
});
