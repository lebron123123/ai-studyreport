import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWorkAdmission} from '../local-server/work-admission.mjs';
const source=fs.readFileSync(new URL('../local-server/agent-worker.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export function','function');
const turn=()=>new Promise(r=>setImmediate(r));
function fixture(gate){
 let claims=0,executions=0,settlements=0,release;
 const work=new Promise(r=>release=r);
 const context={process,AbortController,Math,Number,console,setInterval:()=>({unref(){}}),clearInterval(){},
  claimAgentJob:async()=>{claims++;return {id:'test-job',attempts:1};},
  heartbeatAgentJob:async()=>true,reauthorizeAgentJob:async()=>({ok:true}),
  executeAgentJob:async()=>{executions++;await work;},settleAgentJob:async()=>{settlements++;}};
 vm.createContext(context);vm.runInContext(source,context);
 const worker=context.startAgentWorker({}, {admission:gate});
 return {worker,release,counts:()=>({claims,executions,settlements})};
}
test('直接任务占满时后台任务不提前领取租约，释放后才执行',async()=>{
 const gate=createWorkAdmission({concurrency:1,maxQueued:1});let release;
 const direct=gate.run(()=>new Promise(r=>release=r));await turn();
 const f=fixture(gate);await turn();assert.equal(f.counts().claims,0);assert.equal(gate.stats().queued,1);
 release();await direct;await turn();assert.equal(f.counts().claims,1);assert.equal(f.counts().executions,1);assert.equal(gate.stats().active,1);
 f.release();await turn();assert.equal(f.counts().settlements,1);assert.equal(gate.stats().active,0);f.worker.stop();
});
test('停止等待中的Worker不领取或失败结算持久化任务',async()=>{
 const gate=createWorkAdmission({concurrency:1,maxQueued:1});let release;
 const direct=gate.run(()=>new Promise(r=>release=r));await turn();
 const f=fixture(gate);f.worker.stop();await turn();assert.equal(gate.stats().queued,0);assert.equal(f.counts().claims,0);
 release();await direct;await turn();assert.equal(f.counts().settlements,0);
});
