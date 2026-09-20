import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceLane,estimateSceneResources} from '../project-map/resource-lane.mjs';
test('required initialization cannot silently pass a budget rejection',async()=>{
 const lane=createResourceLane(()=>true,{limit:100,transient:20,measure:()=>95,delay:0});
 await assert.rejects(lane(()=>{throw Error('must not execute');},{required:true}),/预算/);
 await assert.rejects(lane(()=>true,{required:true}),/冷却/);
});
test('budget evicts detail before admitting work and rejects unrecoverable pressure',async()=>{
 let resident=90,calls=0;const lane=createResourceLane(()=>true,{limit:100,transient:20,measure:()=>resident,delay:0});
 const unregister=lane.registerEvictor(()=>resident=60);
 await lane(()=>calls++);assert.equal(calls,1);unregister();resident=95;
 assert.equal(await lane(()=>calls++),null);assert.equal(calls,1);assert.equal(lane.stats.blocked,1);
});
test('stop aborts in-flight signal and prevents queued work',async()=>{
 const lane=createResourceLane(()=>true,{delay:0});let aborted=false,called=false;
 const first=lane(async signal=>{lane.stop();aborted=signal.aborted;});
 const second=lane(()=>called=true);await first;await second;assert.ok(aborted);assert.equal(called,false);
});
test('shared geometry and texture are counted once including render targets',()=>{
 const data=new Float32Array(3),texture={width:2,height:2};
 const g={getVerticesDataKinds:()=>['position'],getVerticesData:()=>data};
 const value=estimateSceneResources({geometries:[g,g]},{getLoadedTexturesCache:()=>[texture,texture],getRenderWidth:()=>1,getRenderHeight:()=>1});
 assert.equal(value.total,24+16+32);
});
test('one scene lane serializes uploads and survives an individual failure',async()=>{
 const run=createResourceLane(),events=[];
 const a=run(async()=>{events.push('a');throw Error('failed');});
 const b=run(async()=>{events.push('b');return 2;});
 await assert.rejects(a);assert.equal(await b,2);assert.deepEqual(events,['a','b']);
});
test('disposed scenes do not run queued uploads',async()=>{
 let active=true,called=false;
 const run=createResourceLane(()=>active);
 const first=run(async()=>{active=false;});
 const second=run(async()=>{called=true;});
 await first;assert.equal(await second,null);assert.equal(called,false);
});
