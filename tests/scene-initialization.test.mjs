import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSceneStages} from '../project-map/scene-initialization.mjs';
test('scene initialization stops after disposal during an awaited stage', async()=>{
 let active=true,release;const calls=[];
 const run=initializeSceneStages([async()=>{calls.push(1);await new Promise(r=>release=r);},()=>calls.push(2)],()=>active);
 active=false;release();assert.equal(await run,false);assert.deepEqual(calls,[1]);
});
test('dead scene never starts; live scene runs ordered stages',async()=>{
 const calls=[];assert.equal(await initializeSceneStages([()=>calls.push(0)],()=>false),false);
 assert.equal(await initializeSceneStages([()=>calls.push(1),()=>calls.push(2)],()=>true),true);
 assert.deepEqual(calls,[1,2]);
});
test('stage failure is not swallowed or followed by more resource loads',async()=>{
 let later=false;await assert.rejects(initializeSceneStages([()=>{throw Error('asset failed');},()=>later=true],()=>true),/asset failed/);assert.equal(later,false);
});
