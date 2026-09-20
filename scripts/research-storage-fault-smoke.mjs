// Writes only the existing named storage test, never a business project.
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import {packState} from '../research-state-codec.mjs';
const db=createD1Shim(process.env.DATABASE_URL);
try{
 const owner=await db.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
 const headers={'content-type':'application/json',authorization:'Bearer '+await signToken(process.env,owner.id,owner.username)};
 const id='76fdc270-a212-407a-bf9a-02b072128734',query='/api/research?researchId='+id;
 async function call(path,body){const response=await fetch('http://localhost:8080'+path,{headers,signal:AbortSignal.timeout(30000),...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
 const initial=(await call(query)).data;
 assert.equal(initial.study.title,'[系统测试]分块存储与浏览器恢复');
 const run=initial.run,base={action:'save',researchId:id,runId:run.runId,epoch:run.epoch,expectedVersion:run.version};
 const state=structuredClone(run.state);state.storageFaultCheck='并发验证';
 const packed=await packState(state),objects=[...packed.objects];
 const corrupt=await call('/api/research',{...base,requestId:crypto.randomUUID(),packed:{manifest:packed.manifest,objects:objects.map(([hash,text],i)=>[hash,i===0?text+'损坏':text])}});
 assert.ok(corrupt.status>=400,'损坏对象应拒绝');
 assert.equal((await call(query)).data.run.version,run.version,'失败不能推进版本');
 const payload={...base,requestId:crypto.randomUUID(),packed:{manifest:packed.manifest,objects}};
 const results=await Promise.all([call('/api/research',payload),call('/api/research',{...payload,requestId:crypto.randomUUID()})]);
 assert.equal(results.filter(x=>x.status===200).length,1);
 assert.equal(results.filter(x=>x.status===409).length,1);
 const winner=results.findIndex(x=>x.status===200);
 if(winner===0)assert.equal((await call('/api/research',payload)).data.acceptedVersion,run.version+1);
 const after=(await call(query)).data;assert.equal(after.run.version,run.version+1);assert.deepEqual(after.run.state,state);
 console.log(JSON.stringify({corruptionRejected:true,rollbackPreserved:true,concurrentWinners:1,conflicts:1,fullReadback:true}));
}finally{await db._close();}
