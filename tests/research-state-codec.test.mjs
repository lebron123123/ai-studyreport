import test from 'node:test';
import assert from 'node:assert/strict';
import {packState,unpackState,referencedObjects,selectManifestPath} from '../research-state-codec.mjs';
test('storage manifest restores every chapter, candidate, material and duplicate without truncation', async()=>{
 const content='原文材料'.repeat(10000), state={draft:{kb:[{content},{content}],chapters:[{sections:[{content:'正文'.repeat(3000),pendingRevision:{content:'候选'.repeat(3000)},undoStack:[content]}]}]},other:null};
 const packed=await packState(state);
 assert.deepEqual(unpackState(packed.manifest,packed.objects),state);
 assert.equal(packed.objects.size,3);
 assert.equal(referencedObjects(packed.manifest).size,3);
 assert.ok(JSON.stringify(packed.manifest).length<2000);
});
test('one changed section sends no unchanged large materials; missing objects fail closed',async()=>{
 const state={kb:'材料'.repeat(100000),sections:['正文'.repeat(4000)]}, cache=new Map();
 const first=await packState(state,cache);state.sections[0]+='新';const second=await packState(state,cache);
 const changed=[...second.objects].filter(([id])=>!first.objects.has(id));
 assert.equal(changed.length,1);assert.ok(changed[0][1].length<10000);
 assert.throws(()=>unpackState(second.manifest,first.objects),/不完整/);
});
test('reserved field names roundtrip without prototype mutation',async()=>{
 const state=JSON.parse('{"__proto__":{"polluted":true},"constructor":"original","value":[false,0,""]}');
 const packed=await packState(state);assert.deepEqual(unpackState(packed.manifest,packed.objects),state);assert.equal({}.polluted,undefined);
});
test('compact manifest escapes arrays that look like protocol markers and supports slices',async()=>{
 const state={items:[["~s","not-a-reference"],["2",{value:"普通值"}]],nested:{text:'正文'.repeat(3000)}};
 const packed=await packState(state);
 assert.deepEqual(unpackState(packed.manifest,packed.objects),state);
 const selected=selectManifestPath(packed.manifest,['items',0]);
 assert.equal(selected.found,true);
 assert.deepEqual(unpackState(selected.manifest,new Map()),state.items[0]);
});
test('compact manifest does not expand a large state dominated by small values',async()=>{
 const state={rows:Array.from({length:80000},(_,index)=>({index,label:'待补'+index,ok:index%2===0}))};
 const packed=await packState(state);
 assert.ok(JSON.stringify(packed.manifest).length<JSON.stringify(state).length*1.1);
 assert.deepEqual(unpackState(packed.manifest,packed.objects),state);
});
test('chunked research restores more than 100MiB logical content without a 100MiB request',async()=>{
 const block='x'.repeat(1024*1024),state={chapters:Array.from({length:101},(_,index)=>({index,content:block}))};
 const packed=await packState(state);
 // The repeated 128KiB chunks share one content-addressed object.
 assert.equal(packed.objects.size,1);
 assert.ok(JSON.stringify(packed.manifest).length<1024*1024);
 assert.deepEqual(unpackState(packed.manifest,packed.objects),state);
});
test('logical research capacity rejects content above 128MiB without truncation',async()=>{
 const block='x'.repeat(1024*1024),state={chapters:Array.from({length:129},(_,index)=>({index,content:block}))};
 const packed=await packState(state);
 assert.throws(()=>unpackState(packed.manifest,packed.objects),/128MiB/);
});
