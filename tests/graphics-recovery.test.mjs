import test from 'node:test';
import assert from 'node:assert/strict';
import {createGraphicsRecovery} from '../project-map/graphics-recovery.mjs';
test('graphics recovery rebuilds once and stops repeated loss',async()=>{
 let calls=0;const messages=[];const recover=createGraphicsRecovery(async()=>calls++,(s)=>messages.push(s));
 assert.equal(await recover(()=>false),false);assert.equal(calls,0);
 assert.equal(await recover(()=>true),true);assert.equal(calls,1);
 assert.equal(await recover(()=>true),false);assert.equal(calls,1);assert.equal(messages.length,1);
});
test('duplicate restore events do not overlap rebuilds',async()=>{
 let finish;let calls=0;const recover=createGraphicsRecovery(()=>{calls++;return new Promise(r=>finish=r);},()=>{});
 const pending=recover(()=>true);assert.equal(await recover(()=>true),false);finish();await pending;assert.equal(calls,1);
});
test('failed rebuild has actionable error without retry loop',async()=>{
 const messages=[];const recover=createGraphicsRecovery(async()=>{throw Error('GPU');},s=>messages.push(s));
 assert.equal(await recover(()=>true),false);assert.match(messages[0],/重建失败/);
 assert.equal(await recover(()=>true),false);
});
