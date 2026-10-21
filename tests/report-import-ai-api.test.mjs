import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { signToken } from '../functions/api/_auth.js';
import { onRequestGet, onRequestPost } from '../functions/api/generate.js';
import { callConfiguredLlm } from '../functions/api/_llm-providers.js';
const env = { SESSION_SECRET: 'isolated-test-signing-secret', DEEPSEEK_API_KEY: 'isolated-provider-key', DEEPSEEK_API_URL: 'https://isolated.invalid/chat', LLM_ENABLE_COMPANY_PROVIDERS: '1', LLM_DEFAULT_PROVIDER: 'deepseek-cloud', COMPANY_DEEPSEEK_API_KEY: 'test', COMPANY_DEEPSEEK_API_URL: 'https://backup.invalid/chat' };
const valid = () => ({ single_attempt: true, request_id: 'isolated_request_123', system: '测试系统', messages: [{ role: 'user', content: '测试内容' }], stream: false, latency_profile: 'standard', response_format: { type: 'json_object' } });
const upstream = (extra = {}) => new Response(JSON.stringify({ choices: [{ message: { content: '{"edits":[{"blockId":"b1","afterText":"候选"}]}' }, finish_reason: 'stop', ...extra }], usage: { total_tokens: 10 } }));
async function context(body, signal) { return { env, request: new Request('http://isolated/api/generate', { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + await signToken(env, 1, 'isolated-account') }, ...(body ? { body: JSON.stringify(body) } : {}), signal }) }; }
async function mocked(fn, work) { const original = globalThis.fetch; globalThis.fetch = fn; try { return await work(); } finally { globalThis.fetch = original; } }
test('真实generate handler能力GET不调用模型，POST单次完整回执', async () => {
  const calls = [];
  await mocked(async (url, init) => { calls.push({ url, init }); return upstream(); }, async () => {
    const caps = await onRequestGet(await context()); assert.equal(caps.headers.get('cache-control'), 'no-store'); assert.equal((await caps.json()).capabilities.single_attempt, true); assert.equal(calls.length, 0);
    const response = await onRequestPost(await context(valid())), data = await response.json(); assert.equal(response.status, 200); assert.equal(calls.length, 1);
    assert.equal(data.single_attempt, true); assert.equal(data.single_attempt_protocol, 1); assert.equal(data.finish_reason, 'stop'); assert.equal(data.request_id, valid().request_id);
    assert.equal(calls[0].url, env.DEEPSEEK_API_URL); assert.equal(JSON.parse(calls[0].init.body).stream, false); assert.equal(data.usage.total_tokens, 10);
    assert.deepEqual(JSON.parse(calls[0].init.body).thinking,{type:'disabled'});
    assert.equal(data.upstream_diagnostics.phase,'body_complete');assert.equal(data.upstream_diagnostics.code,'LLM_RESPONSE_RECEIVED');
  });
});
test('真实handler对503、429、网络失败不fallback或retry', async t => {
  for (const kind of [503, 429, 'network']) await t.test(String(kind), async () => {
    let calls = 0; await mocked(async () => { calls++; if (kind === 'network') throw new TypeError('fetch failed'); return new Response('{}', { status: kind }); }, async () => {
      const response = await onRequestPost(await context(valid())); assert.equal(response.status, 502); assert.equal((await response.json()).single_attempt, true); assert.equal(calls, 1);
    });
  });
});
test('真实handler拒绝缺少完成原因、length、空内容、工具请求及非JSON', async t => {
  for (const value of [upstream({ finish_reason: undefined }), upstream({ finish_reason: 'length' }), upstream({ message: { content: '' } }), upstream({ message: { content: 'x', tool_calls: [{}] } }), new Response('bad-json'), new Response('null'), new Response('{"choices":[]}')]) await t.test('不完整响应', async () => {
    let calls = 0; await mocked(async () => { calls++; return value; }, async () => { const response = await onRequestPost(await context(valid())); assert.equal(response.status, 502); assert.equal((await response.json()).single_attempt, true); assert.equal(calls, 1); });
  });
});
test('真实handler收到取消请求不会调用模型，账号中途停用拒绝晚到内容', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  await mocked(async () => { calls++; return upstream(); }, async () => {
    const response = await onRequestPost(await context(valid(), controller.signal)); assert.equal(response.status, 502); assert.equal(calls, 0);
  });
  let disabled = 0;
  const DB = { prepare(sql) { return { bind() { return this; }, async run() { return {}; }, async first() { return sql.includes('account_security') ? { disabled, revoked_before: 0 } : { cnt: 1 }; } }; } };
  const local = { ...env, DB }, token = await signToken(local, 1, 'isolated-account');
  await mocked(async () => { calls++; disabled = 1; return upstream(); }, async () => {
    const response = await onRequestPost({ env: local, request: new Request('http://isolated', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(valid()) }) });
    assert.equal(response.status, 401); assert.equal(calls, 1); assert.equal((await response.json()).content, undefined);
  });
});
test('真实handler无认证、研究/项目/工具混用、交互模式不调用模型', async () => {
  let calls = 0; await mocked(async () => { calls++; return upstream(); }, async () => {
    assert.equal((await onRequestPost({ env, request: new Request('http://isolated', { method: 'POST', body: JSON.stringify(valid()) }) })).status, 401);
    for (const extra of [{ research: {} }, { projectId: 'formal' }, { tools: [] }, { latency_profile: 'interactive' }, { stream: true }, { messages: [{ role: 'assistant', content: 'x' }] }]) assert.equal((await onRequestPost(await context({ ...valid(), ...extra }))).status, 400);
    assert.equal(calls, 0);
  });
});
test('单次provider配置不完整/无效时失败关闭，健康回退不影响选择', async () => {
  let calls = 0; const fetch = async () => { calls++; return upstream(); };
  await assert.rejects(callConfiguredLlm({ ...env, DEEPSEEK_API_KEY: '' }, '', {}, fetch, { singleAttempt: true }));
  await assert.rejects(callConfiguredLlm(env, 'not-a-provider', {}, fetch, { singleAttempt: true })); assert.equal(calls, 0);
  await callConfiguredLlm({ ...env, LLM_DEFAULT_PROVIDER: 'deepseek' }, '', {}, fetch, { singleAttempt: true, profile: 'interactive' }); assert.equal(calls, 1);
});
test('单次provider响应头之后正文停滞也超时并取消，且只请求一次', async () => {
  let calls = 0, cancelled = false, signal;
  await assert.rejects(callConfiguredLlm(env, '', {}, async (_url, init) => { calls++; signal = init.signal; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } })); }, { singleAttempt: true, timeoutMs: 20 }), error => error.code === 'LLM_TIMEOUT');
  assert.equal(calls, 1); assert.equal(signal.aborted, true); assert.equal(cancelled, true);
});
test('单次provider取消前不请求，运行中取消不产生第二次调用', async () => {
  let calls = 0; const first = new AbortController(); first.abort();
  await assert.rejects(callConfiguredLlm(env, '', {}, async () => { calls++; return upstream(); }, { singleAttempt: true, signal: first.signal }), error => error.name === 'AbortError'); assert.equal(calls, 0);
  const active = new AbortController(); let started; const begun = new Promise(r => { started = r; });
  const pending = callConfiguredLlm(env, '', {}, async () => { calls++; started(); return new Promise(() => {}); }, { singleAttempt: true, signal: active.signal }); await begun; active.abort();
  await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(calls, 1);
});

test('超时诊断分别保留未收响应头、空行保活、部分正文阶段，不含原文或密钥',async t=>{
  for(const [name,content,expected] of [
    ['未收响应头',null,{phase:'awaiting_headers',http_status:null,received_bytes:0,received_non_whitespace:false}],
    ['仅保活空行','\n \r\n',{phase:'receiving_body',http_status:200,received_bytes:4,received_non_whitespace:false}],
    ['部分正文','{"secret-response":',{phase:'receiving_body',http_status:200,received_bytes:19,received_non_whitespace:true}]
  ])await t.test(name,async()=>{
    let calls=0;
    await assert.rejects(callConfiguredLlm(env,'',{messages:[{role:'user',content:'secret-input'}]},async()=>{
      calls++;if(content===null)return new Promise(()=>{});
      return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(content));}}));
    },{singleAttempt:true,timeoutMs:20}),error=>{
      const diagnostic=error.upstreamDiagnostics;
      assert.equal(diagnostic.code,'LLM_TIMEOUT');assert.equal(diagnostic.provider,'deepseek-cloud');assert.ok(diagnostic.elapsed_ms>=15);
      for(const [key,value] of Object.entries(expected))assert.equal(diagnostic[key],value);
      assert.doesNotMatch(JSON.stringify(diagnostic),/secret-input|secret-response|isolated-provider-key|isolated.invalid/);
      return true;
    });assert.equal(calls,1);
  });
});

test('单次HTTP失败诊断随generate回执保留，普通生成不增加该协议字段',async()=>{
  let calls=0;
  await mocked(async()=>{calls++;return new Response('{"error":"secret upstream detail"}',{status:503});},async()=>{
    const r=await onRequestPost(await context(valid())),body=await r.json();assert.equal(r.status,502);
    assert.equal(body.upstream_diagnostics.code,'LLM_UPSTREAM_HTTP');assert.equal(body.upstream_diagnostics.http_status,503);
    assert.equal(body.upstream_diagnostics.phase,'body_complete');assert.doesNotMatch(JSON.stringify(body),/secret upstream detail/);
  });assert.equal(calls,1);
  await mocked(async()=>upstream(),async()=>{
    const body=valid();delete body.single_attempt;const r=await onRequestPost(await context(body));assert.equal(r.status,200);assert.equal((await r.json()).upstream_diagnostics,undefined);
  });
});
