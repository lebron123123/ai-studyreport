import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createResearch,stageResearchObjects,saveResearchRun,readResearch} from '../functions/api/_research-store.js';
import {packState} from '../research-state-codec.mjs';
const target=testDatabaseUrl();
const capacityMode=process.env.STORAGE_CAPACITY_300==='1';
test(capacityMode?'100/300独立账号容量探测（非生产混合负载认证）':'10/30/50独立账号并发保存、读取及重试不串写',{skip:!target,timeout:180000},async()=>{
 const db=createD1Shim(target),metrics=[];
 try{
  for(const count of (capacityMode?[100,300]:[10,30,50])){
   const times=[],start=performance.now();
   await Promise.all(Array.from({length:count},async(_,i)=>{
    const username='[系统测试]负载'+crypto.randomUUID();
    await db.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(username,'disabled','disabled',Date.now()).run();
    const user=Number((await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id),t=performance.now();
    const ids=await createResearch(db,user,{requestId:crypto.randomUUID(),title:username}),scope={...ids,epoch:1,expectedVersion:1};
    const state={owner:username,material:('完整资料'+i).repeat(30000),chapters:Array.from({length:43},(_,j)=>({title:'小节'+j,content:'正文待核'.repeat(100)}))},packed=await packState(state);
    await stageResearchObjects(db,user,{...scope,objects:[...packed.objects]});
    const save={...scope,requestId:crypto.randomUUID(),packed:{manifest:packed.manifest,objects:[]}};
    const first=await saveResearchRun(db,user,save),again=await saveResearchRun(db,user,save);assert.equal(first.acceptedVersion,again.acceptedVersion);
    assert.deepEqual((await readResearch(db,user,ids.researchId,ids.runId)).run.state,state);
    times.push(performance.now()-t);
   }));
   times.sort((a,b)=>a-b);metrics.push({concurrentAccounts:count,totalMs:Math.round(performance.now()-start),p95WorkflowMs:Math.round(times[Math.ceil(times.length*.95)-1]),failed:0});
  }
  console.log('STORAGE_LOAD '+JSON.stringify(metrics));
 }finally{await db._close();}
});
