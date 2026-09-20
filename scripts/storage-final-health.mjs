// Final service check: no business records written, one real AI request.
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const db=createD1Shim(process.env.DATABASE_URL);
try {
  const owner=await db.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
  const headers={'content-type':'application/json',authorization:'Bearer '+await signToken(process.env,owner.id,owner.username)};
  for(const path of ['/', '/api/projects']) {
    const response=await fetch('http://localhost:8080'+path,{headers,signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200); await response.text();
  }
  const research=await db.prepare('SELECT s.id research_id,r.id run_id FROM research_studies s JOIN research_runs r ON r.research_id=s.id WHERE s.owner_user_id=? ORDER BY s.created_at DESC,r.ordinal DESC LIMIT 1').bind(owner.id).first();
  let storageCapacityChecked=false;
  if(research){
    const response=await fetch('http://localhost:8080/api/research?researchId='+encodeURIComponent(research.research_id)+'&runId='+encodeURIComponent(research.run_id)+'&action=authority',{headers,signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.storageProtocol,'parts-v1');
    assert.equal(result.storageUploadBatchBytes,1024*1024);
    assert.equal(result.storageLogicalStateBytes,128*1024*1024);
    assert.equal(result.storageRunObjectBytes,256*1024*1024);
    storageCapacityChecked=true;
  }
  const response=await fetch('http://localhost:8080/api/generate',{method:'POST',headers,signal:AbortSignal.timeout(60000),body:JSON.stringify({system:'只回复测试成功。',messages:[{role:'user',content:'测试连接'}],max_tokens:100})});
  assert.equal(response.status,200);
  const result=await response.json();assert.ok(result.content?.some(item=>item.text?.trim()));
  console.log(JSON.stringify({site:true,projects:true,storageCapacityChecked,logicalStateMiB:storageCapacityChecked?128:null,uploadBatchMiB:storageCapacityChecked?1:null,realGenerate:true,businessWrites:0}));
} finally { await db._close(); }
