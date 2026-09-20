import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRagObjectStore,ragObjectStorageKey} from '../local-server/rag-object-store.js';
import {createResearch,readResearch,restartPrivateResearch,saveResearchRun} from '../functions/api/_research-store.js';
import {storeResearchOriginal,researchMaterialVerifier,onRequestGet} from '../functions/api/researchmaterials.js';
import {signToken} from '../functions/api/_auth.js';

function fixture(){
 const con=new DatabaseSync(':memory:');con.exec(fs.readFileSync(new URL('../migrations/0034_research_identity.sql',import.meta.url),'utf8'));
 const db={prepare(sql){let args=[];return {bind(...x){args=x;return this;},async first(){return con.prepare(sql).get(...args)||null;},async run(){return {meta:{changes:Number(con.prepare(sql).run(...args).changes)}};}};}};
 const scoped={...db,_transaction:fn=>fn(scoped)};let tail=Promise.resolve();
 db._transaction=fn=>{const op=tail.catch(()=>{}).then(async()=>{con.exec('BEGIN');try{const r=await fn(scoped);con.exec('COMMIT');return r;}catch(e){con.exec('ROLLBACK');throw e;}});tail=op;return op;};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'research-original-test-'));
 return {env:{DB:db,RAG_OBJECTS:createRagObjectStore(root),RESEARCH_IDENTITY_ENABLED:'1',SESSION_SECRET:crypto.randomUUID()},close(){con.close();fs.rmSync(root,{recursive:true,force:true});}};
}
test('research originals use immutable scoped receipts; restart retains bytes without trusting forged paths',async()=>{
 const f=fixture(),env=f.env,uid=981111;try{
  const r=await createResearch(env.DB,uid,{title:'[系统测试]资料',requestId:crypto.randomUUID()});
  const input={...r,epoch:1,expectedVersion:1,name:'原件.txt',mimeType:'text/plain',dataBase64:btoa('original content')};
  const saved=await storeResearchOriginal(env,uid,input),again=await storeResearchOriginal(env,uid,input);
  assert.equal(saved.fileId,again.fileId);assert.equal((await readResearch(env.DB,uid,r.researchId,r.runId)).run.version,1);
  assert.ok(saved.object.storageKey.startsWith('research/'+uid+'/'+r.researchId+'/'+r.runId+'/sha256/'));
  await assert.rejects(storeResearchOriginal(env,uid+1,input),e=>e.status===404);
  const other=await createResearch(env.DB,uid+1,{title:'[系统测试]另一个人',requestId:crypto.randomUUID()});
  const otherSaved=await storeResearchOriginal(env,uid+1,{...input,...other});assert.notEqual(saved.object.storageKey,otherSaved.object.storageKey);
  const verify=researchMaterialVerifier(env,uid,r.researchId);
  assert.equal(await verify('material',{...otherSaved.materialRef,storageKey:saved.object.storageKey}),null);
  assert.equal(await verify('fact',{verified:true,value:123}),null);
  await saveResearchRun(env.DB,uid,{...r,epoch:1,expectedVersion:1,requestId:crypto.randomUUID(),state:{materialRefs:[saved.materialRef,otherSaved.materialRef],confirmedFacts:[{verified:true}],draft:{chapters:['旧正文']}}});
  const next=await restartPrivateResearch(env.DB,uid,{...r,epoch:1,expectedVersion:2,requestId:crypto.randomUUID(),mode:'verified'},verify);
  const state=(await readResearch(env.DB,uid,r.researchId,next.runId)).run.state;
  assert.deepEqual(state.materialRefs,[saved.materialRef]);assert.deepEqual(state.confirmedFacts,[]);assert.equal(state.draft,undefined);
  await assert.rejects(storeResearchOriginal(env,uid,{...input,expectedVersion:2}),e=>e.status===409);
  const token=await signToken(env,uid,'[系统测试]'),q=new URLSearchParams({...saved.materialRef,actorId:String(uid)});
  const response=await onRequestGet({env,request:new Request('http://test/api/researchmaterials?'+q,{headers:{authorization:'Bearer '+token}})});
  assert.equal(response.status,200);assert.equal(await response.text(),'original content');
  const badToken=await signToken(env,uid+1,'[系统测试]');assert.equal((await onRequestGet({env,request:new Request('http://test/api/researchmaterials?'+q,{headers:{authorization:'Bearer '+badToken}})})).status,404);
 }finally{f.close();}
});
test('object namespace is optional and rejects traversal',()=>{
 const hash='a'.repeat(64);assert.equal(ragObjectStorageKey(hash),'sha256/aa/'+hash);
 assert.throws(()=>ragObjectStorageKey(hash,'../../private'));
});
