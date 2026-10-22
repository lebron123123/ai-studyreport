import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {signToken} from '../functions/api/_auth.js';
import {onRequestPost,onRequestGet} from '../functions/api/reportimportrequest.js';
import {claimImportRequest,ensureImportRequests,findImportRequest,importReceipt} from '../functions/api/_report-import-request.js';
const target=testDatabaseUrl();
test('独立 PostgreSQL：导入稿请求先登记、并发只调用一次、回执恢复与未知不补发',{skip:!target},async t=>{
  const url=new URL(target);assert.match(url.pathname,/^\/studyreport_restore_\d+$/);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const DB=createD1Shim(target),env={DB,SESSION_SECRET:crypto.randomUUID(),DEFAULT_LLM_PROVIDER:'deepseek-cloud',DEEPSEEK_API_URL:'https://example.invalid/mock-durable-model',DEEPSEEK_API_KEY:'isolated-test-placeholder',DEEPSEEK_MODEL:'mock-durable-model'};
  const originalFetch=globalThis.fetch;let paidCalls=0,hold=null;
  globalThis.fetch=async(url,init)=>{
    assert.match(String(url),/^https:\/\/example\.invalid\/mock-durable-model/);paidCalls++;
    const payload=JSON.parse(init.body);assert.equal(payload.stream,false);assert.equal(payload.max_tokens,4000);
    if(hold)await hold(init);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({edits:[{blockId:'source-b1',afterText:'【待补：项目客群核实资料】'}],explanation:'[系统测试]完整候选，不用于正式报告。'})}}],usage:{prompt_tokens:10,completion_tokens:20}});
  };
  try {
    async function user(){const name='[系统测试]导入回执'+crypto.randomUUID();const row=await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?) RETURNING id').bind(name,'disabled-no-login','disabled',Date.now()).first();return {id:Number(row.id),headers:{Authorization:'Bearer '+await signToken(env,Number(row.id),name),'Content-Type':'application/json'}};}
    const owner=await user(),other=await user();
    const input=(id=crypto.randomUUID())=>({request_id:id,binding:{draftId:'draft-isolated',sourceHash:'a'.repeat(64),contextHash:'b'.repeat(64)},generation:{single_attempt:true,request_id:id,stream:false,kind:'batch',latency_profile:'standard',max_tokens:4000,response_format:{type:'json_object'},system:'[系统测试]仅结构化候选',messages:[{role:'user',content:'[系统测试]原文'}]}});
    const post=(body,account=owner,extra={})=>onRequestPost({env,request:new Request('http://test/api/reportimportrequest',{method:'POST',headers:account.headers,body:JSON.stringify(body),...extra}),waitUntil:p=>p.catch(()=>{})});
    const get=(body,account=owner)=>onRequestGet({env,request:new Request('http://test/api/reportimportrequest?'+new URLSearchParams({id:body.request_id,...body.binding}),{headers:account.headers})});
    await t.test('首次回查只读且不存在时不创建台账/不调模型',async()=>{
      const before=paidCalls,r=await get(input());assert.equal(r.status,404);assert.equal((await r.json()).code,'NOT_FOUND');assert.equal(paidCalls,before);
      assert.equal(await DB.prepare("SELECT table_name FROM information_schema.tables WHERE table_name='report_import_requests'").first(),null);
    });
    await t.test('未登录、无效输入、旧服务探测不占模型次数',async()=>{
      const before=paidCalls;
      assert.equal((await onRequestPost({env,request:new Request('http://test',{method:'POST',body:'{}'})})).status,401);
      const malformed=input();malformed.generation.provider='other';assert.equal((await post(malformed)).status,400);
      const capability=await onRequestGet({env,request:new Request('http://test/api/reportimportrequest',{headers:owner.headers})});assert.equal((await capability.json()).capabilities.durable_import_request_protocol,1);assert.equal(paidCalls,before);
    });
    await t.test('十个并发重复请求只有一个模型调用，结果完整持久化、重复只复用',async()=>{
      const body=input(),before=paidCalls;let release,started;
      const began=new Promise(r=>{started=r;});hold=()=>new Promise(r=>{release=r;started();});
      const first=post(body);await began;
      const dup=await Promise.all(Array.from({length:9},()=>post(body)));
      assert.ok(dup.every(r=>r.status===202));assert.equal(paidCalls-before,1);
      const running=await (await get(body)).json();assert.equal(running.status,'running');assert.equal(running.retry_allowed,false);
      hold=null;release();const complete=await (await first).json();assert.equal(complete.status,'completed');
      assert.deepEqual((await (await get(body)).json()).result,complete.result);
      const repeated=await (await post(body)).json();assert.deepEqual(repeated.result,complete.result);assert.equal(paidCalls-before,1);
      const row=await findImportRequest(env,owner.id,body.request_id,body.binding);assert.equal(row.response_json,JSON.stringify(complete.result));
    });
    await t.test('响应丢失/浏览器取消仍保存结果，重新连接数据库可只GET恢复',async()=>{
      const body=input(),controller=new AbortController(),before=paidCalls;let release,started,upstreamSignal;
      const began=new Promise(r=>{started=r;});hold=init=>new Promise(r=>{upstreamSignal=init.signal;release=r;started();});
      const pending=post(body,owner,{signal:controller.signal});await began;controller.abort();assert.equal(upstreamSignal.aborted,false);hold=null;release();await pending;
      const freshDB=createD1Shim(target);
      try {const recovered=await onRequestGet({env:{...env,DB:freshDB},request:new Request('http://test/api/reportimportrequest?'+new URLSearchParams({id:body.request_id,...body.binding}),{headers:owner.headers})});assert.equal((await recovered.json()).status,'completed');}
      finally{await freshDB._close();}
      assert.equal(paidCalls-before,1);
    });
    await t.test('账号与输入隔离：不能读另一账号，不能换草稿、原件、范围或提示词',async()=>{
      const body=input();await post(body);const before=paidCalls;
      assert.equal((await get(body,other)).status,404);
      for(const key of ['draftId','sourceHash','contextHash']){const changed=structuredClone(body);changed.binding[key]=key==='contextHash'?'c'.repeat(64):'different';assert.equal((await get(changed)).status,409);assert.equal((await post(changed)).status,409);}
      const changed=structuredClone(body);changed.generation.system='different';assert.equal((await post(changed)).status,409);assert.equal(paidCalls,before);
    });
    await t.test('进程中断遗留/供应商失败/旧请求不存在，均不会以重试补发',async()=>{
      const body=input(),before=paidCalls;await claimImportRequest(env,owner.id,body.request_id,body.binding,body.generation);
      await DB.prepare('UPDATE report_import_requests SET created_at=? WHERE user_id=? AND request_id=?').bind(Date.now()-181000,owner.id,body.request_id).run();
      assert.equal((await (await get(body)).json()).status,'outcome_unknown');assert.equal((await (await post(body)).json()).status,'outcome_unknown');assert.equal(paidCalls,before);
      const unknown=input();hold=()=>{throw new Error('isolated simulated provider disconnect');};const failed=await (await post(unknown)).json();hold=null;assert.equal(failed.status,'outcome_unknown');assert.equal(failed.billing_confirmed,false);assert.equal(paidCalls,before+1);
      await post(unknown);await get(unknown);assert.equal(paidCalls,before+1);
      assert.equal((await get(input())).status,404);assert.equal(paidCalls,before+1);
    });
    await t.test('完成后写回失败留未知，不重发模型，初始化可重复且无项目写入',async()=>{
      const body=input(),before=paidCalls;let rejectSave=true;
      const wrapped={_schemaParent:DB,prepare(sql){if(rejectSave&&sql.startsWith('UPDATE report_import_requests SET status=?')){rejectSave=false;return {bind(){return {run(){throw new Error('isolated save failure');}};}};}return DB.prepare(sql);}};
      const response=await onRequestPost({env:{...env,DB:wrapped},request:new Request('http://test/api/reportimportrequest',{method:'POST',headers:owner.headers,body:JSON.stringify(body)})});assert.equal((await response.json()).status,'outcome_unknown');await post(body);assert.equal(paidCalls,before+1);
      await ensureImportRequests(env);await ensureImportRequests(env);
      assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id=?').bind(owner.id).first()).n),0);
      assert.equal(importReceipt({request_id:'id',draft_id:'d',source_hash:'s',context_hash:'h',status:'running',created_at:1,updated_at:1},181002).status,'outcome_unknown');
    });
  } finally {globalThis.fetch=originalFetch;await DB._close();}
});
