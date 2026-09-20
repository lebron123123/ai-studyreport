// Explicit local integration check. Only one named test research is written.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import {packState} from '../research-state-codec.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const db=createD1Shim(process.env.DATABASE_URL);let browser;
try{
 const owner=await db.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
 const token=await signToken(process.env,owner.id,owner.username),headers={'content-type':'application/json',authorization:'Bearer '+token};
 async function call(path,body){const r=await fetch('http://localhost:8080'+path,{headers,signal:AbortSignal.timeout(60000),...(body?{method:'POST',body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,data.error||'HTTP '+r.status);return data;}
 const created=await call('/api/research',{action:'create',title:'[系统测试]分块存储与浏览器恢复',requestId:crypto.randomUUID()});
 const query='/api/research?researchId='+created.researchId+'&runId='+created.runId;
 const loaded=await call(query);assert.equal(loaded.storageProtocol,'parts-v1');
 const state={draft:{project:{name:'[系统测试]分块存储与浏览器恢复'},kb:[{title:'测试资料',content:'仅用于验证完整保存。'.repeat(100000)}],chapters:[{cn:1,name:'总论',checked:true,sections:[{t:'概述',content:'完整正文。'.repeat(3000)}]}]}};
 const first=await packState(state),scope={researchId:created.researchId,runId:created.runId,epoch:1,userId:owner.id};
 const body={action:'save',...scope,expectedVersion:1,requestId:crypto.randomUUID(),packed:{manifest:first.manifest,objects:[...first.objects]}};
 await call('/api/research',body);assert.deepEqual((await call(query)).run.state,state);
 state.draft.chapters[0].sections[0].content+='末尾校验';
 const second=await packState(state),delta={action:'save',...scope,expectedVersion:2,requestId:crypto.randomUUID(),packed:{manifest:second.manifest,objects:[...second.objects].filter(([id])=>!first.objects.has(id))}};
 const receipt=await call('/api/research',delta);assert.equal(receipt.acceptedVersion,3);
 assert.equal((await call('/api/research',delta)).acceptedVersion,3);
 assert.deepEqual((await call(query)).run.state,state);
 const authority=await call(query+'&action=authority');assert.equal(authority.run.state,undefined);
 assert.ok(JSON.stringify(delta).length<JSON.stringify(state).length/10);
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8080/research-state-codec.mjs');
 const local=await page.evaluate(async()=>{
  const store=await import('/research-local-state.mjs');
  const identity={userId:'system-test',run:{researchId:'storage-check',runId:'local-only',epoch:1,version:1}};
  const state={text:'本机正文'.repeat(3000),material:'资料'.repeat(100000)};
  const id=await store.saveLocal(identity,state),restored=await store.loadLocal(identity,id);
  if(JSON.stringify(restored.state)!==JSON.stringify(state))throw Error('本机回读不一致');
  if(await store.loadLocal({...identity,userId:'other'},id)!==null)throw Error('本机账号串写');
  for(let n=0;n<25;n++){const current=await store.saveLocal(identity,{...state,n});await store.acknowledgeLocal(identity,current,2);}
  const rows=await store.listDrafts(identity);
  if(rows.filter(r=>r.acknowledged).length!==20||!rows.some(r=>r.id===id&&!r.acknowledged))throw Error('回收误删未同步副本');
  return {scope:identity,id,confirmed:20};
 });
 await page.reload();
 assert.equal(await page.evaluate(async({scope,id})=>!!(await (await import('/research-local-state.mjs')).loadLocal(scope,id)),local),true);
 assert.deepEqual(errors,[]);
 const generated=await call('/api/generate',{system:'只回复一行测试结果。',messages:[{role:'user',content:'请回复：存储升级后生成接口正常。'}],max_tokens:200});
 assert.ok(generated.content?.some(x=>x.text?.trim()));
 await call('/api/projects');
 console.log(JSON.stringify({ok:true,testResearch:created.researchId,firstBytes:Buffer.byteLength(JSON.stringify(body)),deltaBytes:Buffer.byteLength(JSON.stringify(delta)),authorityBytes:Buffer.byteLength(JSON.stringify(authority)),browserRefresh:true,scopeIsolation:true,unsyncedPreserved:true,realGenerate:true}));
}finally{await browser?.close();await db._close();}
