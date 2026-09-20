import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkAdmission,admitResponse} from '../local-server/work-admission.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('流式响应返回头部后仍占用名额，读完或取消才释放',async()=>{
 for(const cancel of [false,true]){
  const gate=createWorkAdmission({concurrency:1,maxQueued:0});let source;
  const response=await admitResponse(gate,async()=>new Response(new ReadableStream({start(c){source=c;}}),{headers:{'content-type':'text/event-stream'}}));
  assert.equal(gate.stats().active,1);
  await assert.rejects(admitResponse(gate,async()=>new Response('other')),e=>e.status===429);
  if(cancel)await response.body.cancel();else{source.enqueue(new TextEncoder().encode('data: ok\n\n'));source.close();assert.equal(await response.text(),'data: ok\n\n');}
  await new Promise(r=>setImmediate(r));assert.equal(gate.stats().active,0);
 }
});
test('有界排队、先进先出及任务失败后释放',async()=>{
 const gate=createWorkAdmission({concurrency:1,maxQueued:1}),hold=deferred(),order=[];
 const first=gate.run(()=>hold.promise),second=gate.run(()=>{order.push(2);throw Error('failed');});
 const checked=assert.rejects(second,/failed/);
 await assert.rejects(gate.run(()=>{}),e=>e.status===429);assert.equal(gate.stats().active,1);
 hold.resolve();await first;await checked;await new Promise(r=>setImmediate(r));
 assert.deepEqual(order,[2]);assert.equal(gate.stats().active,0);
});
test('取消等待及超时不执行任务，运行中取消不提前释放',async()=>{
 const gate=createWorkAdmission({concurrency:1,maxQueued:2,waitMs:20}),hold=deferred(),running=new AbortController();let executed=0;
 const first=gate.run(()=>hold.promise,{signal:running.signal});running.abort();assert.equal(gate.stats().active,1);
 const waiting=new AbortController();const second=gate.run(()=>executed++,{signal:waiting.signal});const checked=assert.rejects(second,e=>e.status===499);waiting.abort();await checked;
 await assert.rejects(gate.run(()=>executed++),e=>e.status===503);assert.equal(executed,0);
 hold.resolve();await first;
});
