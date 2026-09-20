// Controlled algorithm comparison on synthetic data, NOT a claim about a
// previously recorded user session. Uses a fresh browser profile exclusively.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage();await page.goto('http://localhost:8080/research-state-codec.mjs');
 const result=await page.evaluate(async()=>{
  const store=await import('/research-local-state.mjs'),codec=await import('/research-state-codec.mjs');
  const scope={userId:'benchmark-only',run:{researchId:'benchmark',runId:'round',epoch:1,version:1}};
  const state={material:'资料甲乙丙丁'.repeat(60000),chapters:Array.from({length:43},(_,i)=>({title:'第'+i+'节',content:('正文'+i+'。').repeat(500)}))};
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  let oldBytes=0,lastId;
  for(let i=0;i<20;i++){state.chapters[0].content+='修改'+i;oldBytes+=bytes(state);lastId=await store.saveLocal(scope,state);await store.acknowledgeLocal(scope,lastId,2);}
  const actual=await store.loadLocal(scope,lastId);if(JSON.stringify(actual.state)!==JSON.stringify(state))throw Error('回读不完整');
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('research-state-parts-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const newBytes=await new Promise(resolve=>{let total=0;const tx=db.transaction(['drafts','objects']);for(const name of ['drafts','objects']){const r=tx.objectStore(name).openCursor();r.onsuccess=()=>{const c=r.result;if(c){total+=bytes(c.key)+bytes(c.value);c.continue();}};}tx.oncomplete=()=>resolve(total);});db.close();
  const oldTimes=[],newTimes=[],cache=new Map();
  // Same 100 successive edits. Include final durable write; exclude deliberate
  // debounce waiting time. Baseline is whole JSON on every input.
  for(let round=0;round<7;round++){
   let t=performance.now();for(let i=0;i<100;i++){state.edit=i;localStorage.setItem('synthetic-benchmark',JSON.stringify(state));}oldTimes.push(performance.now()-t);localStorage.removeItem('synthetic-benchmark');
   t=performance.now();for(let i=0;i<100;i++)state.edit=i;const id=await store.saveLocal(scope,state);await store.acknowledgeLocal(scope,id,2);newTimes.push(performance.now()-t);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
  const before=await codec.packState(state,cache);state.chapters[0].content+='仅改本节';const after=await codec.packState(state,cache);
  return {sample:'synthetic,43 sections,20 retained versions,7 timing repetitions',byteMetric:'UTF-8 serialized keys and values, not physical browser allocation',wholeCopiesBytes:oldBytes,deduplicatedBytes:newBytes,storageReductionPercent:100*(1-newBytes/oldBytes),inputBurstBaselineMs:median(oldTimes),inputBurstCoalescedMs:median(newTimes),burstTimeReductionPercent:100*(1-median(newTimes)/median(oldTimes)),baselineSamplesMs:oldTimes,coalescedSamplesMs:newTimes,fullRequestBytes:bytes(state),deltaRequestBytes:bytes({manifest:after.manifest,objects:[...after.objects].filter(([id])=>!before.objects.has(id))}),lossless:true};
 });
 console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
