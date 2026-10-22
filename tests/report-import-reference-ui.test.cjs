'use strict';
require('../scripts/windows-browser-lockout-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const JSZip = require('../local-server/node_modules/jszip');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs/report-import', 'reference-ui-' + new Date().toISOString().replace(/[:.]/g, '-'));
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ADDITION = '应结合专项资料核对客群需求与房源匹配关系，未确认条件继续保留。';
const BEFORE = '住房租赁市场需求仍需结合房源及客群情况判断，原有事实保持。';
const SPECIAL = '专项资料独有标记：住房租赁市场的客群需求应结合通勤条件和房源配置进行核对，尚不能认定全部房源可消化。';
const xml = value => String(value).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const p = value => '<w:p><w:r><w:t>' + xml(value) + '</w:t></w:r></w:p>';
let browser, server, origin, mainBytes, specialBytes, unrelatedBytes;
const harness = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/report-import.css"><style>*{box-sizing:border-box}body{margin:0;background:#eef3f7;font-family:system-ui}select{width:100%}#mount{padding:20px;min-width:0}header{padding:10px}</style></head><body><header><button id="leave">返回首页</button><button id="enter">已有报告完善</button></header><main id="mount"></main><script>window.getUser=()=>localStorage.getItem('fs_user')||'';window.authHeaders=()=>({Authorization:'Bearer synthetic-reference-token'});window.currentProjectId='formal-project-must-stay';window.reportData={sentinel:'formal-report-must-stay'};</script>${['report-completion-contract.js','report-writing-standard.js','report-import-core.js','report-import-context.js','report-import-review.js','report-import-quality.js','report-import-store.js','report-import-ai.js','report-import-ui.js'].map(name=>'<script src="/'+name+'"></script>').join('')}<script>document.querySelector('#leave').onclick=()=>document.querySelector('#mount').remove();document.querySelector('#enter').onclick=()=>{let node=document.querySelector('#mount');if(!node){node=document.createElement('main');node.id='mount';document.body.appendChild(node)}ReportImportUI.mount(node)};ReportImportUI.mount(document.querySelector('#mount'));</script></body></html>`;
async function docx(body) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
test.before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  mainBytes = await docx(p('第一章 住房租赁市场') + p(BEFORE) + p('第二章 政策依据') + p('政策文件名称与已确认的发布机关应分别列示，未知信息保留。'));
  specialBytes = await docx(p('住房租赁市场专项资料') + p(SPECIAL));
  unrelatedBytes = await docx(p('ZZQ unrelated attachment') + p('Astronomy nebula observatory telescope pulsar.'));
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/reference-harness') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(harness); return; }
    if (pathname.startsWith('/api/')) { res.writeHead(501).end('Explicit mocks required'); return; }
    const target = path.resolve(ROOT, '.' + decodeURIComponent(pathname));
    if (!target.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(target, (error, bytes) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': path.extname(target) === '.css' ? 'text/css' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
});
test.after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
const idle = page => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
async function draft(page) { return page.evaluate(async () => { const store = ReportImportStore.create({ getOwner: () => getUser() }); return store.load((await store.list())[0].id); }); }
function userJSON(body) { return JSON.parse(body.messages[0].content); }
async function workspace(t, responder) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1680, height: 1050 } });
  t.after(() => context.close());
  await context.addInitScript(() => localStorage.setItem('fs_user', '[系统测试]参考资料验收'));
  const page = await context.newPage(), env = { context, page, requests: [], calls: [], errors: [], console: [], external: [] };
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => env.errors.push(error.message)); page.on('console', m => { if (m.type() === 'error') env.console.push(m.text()); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { env.external.push(url.href); await route.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    env.calls.push({ method: request.method(), path: url.pathname });
    if (url.pathname !== '/api/reportimportrequest') { await route.abort(); return; }
    if (request.method() === 'GET') {
      if (url.search) { await route.fulfill({ json: env.receipts.get(url.searchParams.get('id')) }); return; }
      await route.fulfill({ json: { capabilities: { single_attempt: true, single_attempt_protocol: 1, durable_import_request_protocol: 1 } } }); return;
    }
    const envelope = request.postDataJSON(), body = envelope.generation; env.requests.push(body);
    env.receipts ||= new Map();
    const receipt = { durable_import_request_protocol: 1, request_id: envelope.request_id, binding: envelope.binding, status: 'running', retry_allowed: false, result: null }; env.receipts.set(envelope.request_id, receipt);
    const result = responder ? await responder(body) : { edits: [{ blockId: userJSON(body).blocks[0].blockId, afterText: ADDITION }], explanation: '模拟建议，业务事实仍待人工核实。' };
    if (result.httpStatus) { receipt.status = 'outcome_unknown'; await route.fulfill({ status: result.httpStatus, json: { error: '模拟失败；未重试。' } }); return; }
    receipt.status = 'completed'; receipt.result = { single_attempt: true, single_attempt_protocol: 1, request_id: body.request_id, finish_reason: 'stop', content: [{ type: 'text', text: JSON.stringify(result) }] };
    await route.fulfill({ json: receipt });
  });
  await page.goto(origin + '/reference-harness'); await page.locator('#riMain').waitFor(); await idle(page);
  return env;
}
async function imported(page, extras = 'special') {
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]主报告.docx', mimeType: MIME, buffer: mainBytes });
  const files = extras === 'unparsed' ? [{ name: '[系统测试]扫描参考.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic unparsed') }] : extras === 'mixed' ? [{ name: '[系统测试]专项资料.docx', mimeType: MIME, buffer: specialBytes }, { name: '[系统测试]无关资料.docx', mimeType: MIME, buffer: unrelatedBytes }] : [{ name: extras === 'unrelated' ? '[系统测试]无关资料.docx' : '[系统测试]专项资料.docx', mimeType: MIME, buffer: extras === 'unrelated' ? unrelatedBytes : specialBytes }];
  await page.locator('#riExtras').setInputFiles(files);
  for (let i = 0; i < files.length; i++) await page.locator('[data-ri-role="' + i + '"]').selectOption('special');
  await page.locator('[data-ri-action="import"]').click(); await page.locator('[data-ri-action="confirm"]').waitFor(); await idle(page);
  await page.locator('[data-ri-action="confirm"]').click(); await page.locator('#riReviewPanel').waitFor(); await idle(page);
  await page.locator('#ri-source-source-b1').click();
  await page.locator('#riReviewInstruction').fill('依据所选资料完善需求与房源匹配，保留原文和数字，不新增未经确认的事实。');
}
async function generate(page) { await page.locator('[data-ri-action="generate-review"]').click(); await page.locator('[data-ri-action="accept-review"]').waitFor(); await idle(page); }
function clean(env, failure = false) {
  assert.deepEqual(env.errors, []); assert.deepEqual(env.external, []);
  assert.deepEqual(env.console.filter(text => !(failure && /Failed to load resource.*503/.test(text))), []);
  assert.ok(env.calls.every(call => call.path === '/api/reportimportrequest'));
  assert.ok(env.requests.every(body => body.single_attempt === true && body.stream === false));
}
async function immutable(page, baseline) { const after = await draft(page); assert.deepEqual(after.files, baseline.files); assert.deepEqual(after.outline, baseline.outline); assert.deepEqual(after.protectedBlockIds, baseline.protectedBlockIds); return after; }

test('unselected uploaded reference is not sent; main identity and formal project globals remain untouched', async t => {
  const env = await workspace(t), { page } = env; await imported(page);
  assert.equal(await page.locator('[data-ri-reference]:checked').count(), 0);
  await generate(page);
  assert.deepEqual(userJSON(env.requests[0]).references, []);
  assert.equal(env.requests.length, 1); assert.ok(!JSON.stringify(env.requests[0]).includes(SPECIAL));
  assert.deepEqual(await page.evaluate(() => [currentProjectId, reportData.sentinel]), ['formal-project-must-stay', 'formal-report-must-stay']);
  clean(env);
});
test('selected reference enters real adapter payload with exact excerpt positions and shared writing rules', async t => {
  const env = await workspace(t), { page } = env; await imported(page);
  await page.locator('[data-ri-reference]').first().check(); await page.locator('#riWritingProfile').selectOption('market');
  await generate(page);
  const body = env.requests[0], payload = userJSON(body), current = await draft(page), reference = current.files.find(f => f.role !== 'main');
  assert.ok(payload.references.length); assert.ok(payload.references.some(r => r.text.includes('专项资料独有标记')));
  assert.ok(payload.references.every(r => r.label === reference.name && r.fileId === reference.id && r.sourceHash === reference.hash && r.positions?.length));
  assert.match(body.system, /report-writing-standard-v1/); assert.match(body.system, /direct-business-v2/); assert.match(body.system, /市场与项目影响/);
  assert.match(await page.locator('#riReferenceContext').innerText(), /专项资料/);
  await page.screenshot({ path: path.join(OUT, 'selected-reference-desktop.png'), fullPage: true }); clean(env);
});
test('no-match attachment blocks every generation request and leaves originals intact', async t => {
  const env = await workspace(t), { page } = env; await imported(page, 'unrelated'); const before = await draft(page);
  await page.locator('[data-ri-reference]').check();
  assert.match(await page.locator('#riReferenceContext').innerText(), /未命中|未找到相关片段|无.*片段/);
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true);
  assert.equal(env.calls.length, 0); await immutable(page, before); clean(env);
});
test('selected unparsed attachment blocks generation instead of implying it was read', async t => {
  const env = await workspace(t), { page } = env; await imported(page, 'unparsed'); const before = await draft(page);
  await page.locator('[data-ri-reference]').check();
  assert.match(await page.locator('#riReferenceContext').innerText(), /未解析|尚无|只保留原件/);
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true);
  assert.equal(env.calls.length, 0); await immutable(page, before); clean(env);
});
test('one matched and one unmatched selection cannot silently omit the failed reference', async t => {
  const env = await workspace(t), { page } = env; await imported(page, 'mixed');
  for (const box of await page.locator('[data-ri-reference]').all()) await box.check();
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true); assert.equal(env.calls.length, 0);
  await page.locator('[data-ri-reference]').nth(1).uncheck(); await generate(page);
  assert.ok(userJSON(env.requests[0]).references.every(r => /专项资料/.test(r.label))); clean(env);
});
test('reference generation failure keeps selection and instruction without an automatic retry', async t => {
  const env = await workspace(t, () => ({ httpStatus: 503 })), { page } = env; await imported(page);
  await page.locator('[data-ri-reference]').check(); await page.locator('[data-ri-action="generate-review"]').click();
  await page.locator('[role="alert"]').waitFor(); await idle(page); await page.waitForTimeout(400);
  assert.equal(env.requests.length, 1); assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'outcome_unknown');
  assert.equal(await page.locator('[data-ri-reference]').isChecked(), true); assert.match(await page.locator('#riReviewInstruction').inputValue(), /保留原文/); clean(env, true);
});
test('AI timeout preserves the uncertain-charge message through refresh without calling it a storage timeout', async t => {
  const env = await workspace(t), { page } = env; await imported(page); const before = await draft(page);
  await page.locator('[data-ri-reference]').check();
  await page.evaluate(() => {
    const api = ReportImportAI;
    const adapter = api.create({ timeoutMs: 2500, fetch: (url, init) => {
      const response = fetch(url, init);
      return init.method === 'POST' ? response.then(() => new Promise(() => {})) : response;
    } });
    window.ReportImportAI = { ...api, generate: adapter.generate };
  });
  await page.locator('[data-ri-action="generate-review"]').click();
  await page.locator('[role="alert"]').waitFor(); await idle(page);
  const message = await page.locator('[role="alert"]').evaluate(element => { const copy = element.cloneNode(true); copy.querySelectorAll('button').forEach(button => button.remove()); return copy.textContent.trim(); });
  assert.match(message, /AI 生成超时/); assert.match(message, /可能仍计费/); assert.match(message, /未自动重试/);
  assert.match(message, /核对本次结果与费用/); assert.doesNotMatch(message, /本浏览器保存超时|保存工作稿.*重试/);
  const failed = (await immutable(page, before)).reviewState.requests.at(-1);
  assert.equal(failed.status, 'outcome_unknown'); assert.equal(failed.message, message);
  assert.equal(await page.locator('[data-ri-action="accept-review"]').count(), 0);
  await page.reload(); await page.locator('#riReviewPanel').waitFor(); await idle(page);
  await page.locator('.ri-review-history > summary').click();
  assert.match(await page.locator('.ri-review-history').innerText(), /AI 生成超时.*可能仍计费/s);
  assert.equal((await draft(page)).reviewState.requests.at(-1).message, message);
  assert.equal(env.requests.length, 1); clean(env);
});
test('a returned candidate storage timeout remains a save error and save-only recovery does not regenerate', async t => {
  const env = await workspace(t), { page } = env; await imported(page); const before = await draft(page);
  const inject = `(function () { const api = ReportImportStore; window.ReportImportStore = { ...api, create(options) {
    const saved = api.create(options); let failOnce = true; return { ...saved, review(...args) {
      if (failOnce && args[2]?.type === 'complete') { failOnce = false; return Promise.reject(Object.assign(new Error('Simulated save timeout'), { code: 'TIMEOUT' })); }
      return saved.review(...args);
    } };
  } }; })();\n`;
  await page.route('**/report-import-ui.js', route => route.fulfill({ contentType: 'text/javascript', body: inject + fs.readFileSync(path.join(ROOT, 'report-import-ui.js'), 'utf8') }));
  await page.reload(); await page.locator('#riReviewPanel').waitFor(); await idle(page);
  await page.locator('#ri-source-source-b1').click();
  await page.locator('#riReviewInstruction').fill('保留原文，补充匹配关系。');
  await page.locator('[data-ri-action="generate-review"]').click();
  await page.locator('[data-ri-action="save-review"]').waitFor(); await idle(page);
  const message = await page.locator('[role="alert"]').innerText();
  assert.match(message, /本浏览器保存超时/); assert.doesNotMatch(message, /AI 生成超时|结果与费用/);
  assert.equal(env.requests.length, 1);
  await page.locator('[data-ri-action="save-review"]').click();
  await page.locator('[data-ri-action="accept-review"]').waitFor(); await idle(page);
  assert.equal((await immutable(page, before)).reviewState.requests.at(-1).status, 'ready');
  assert.equal(env.requests.length, 1); clean(env);
});
test('candidate provenance survives refresh, adoption, returning and undo without another request', async t => {
  const env = await workspace(t), { page } = env; await imported(page); const before = await draft(page);
  await page.locator('[data-ri-reference]').check(); await generate(page);
  const ready = await draft(page), readyContext = ready.reviewState.requests[0].context;
  assert.ok(JSON.stringify(readyContext).includes('专项资料独有标记'));
  await page.reload(); await page.locator('[data-ri-action="accept-review"]').waitFor(); await idle(page);
  assert.deepEqual((await draft(page)).reviewState.requests[0].context, readyContext);
  assert.match(await page.locator('#riReviewPanel').innerText(), /专项资料/);
  await page.locator('[data-ri-action="accept-review"]').click(); await idle(page); await immutable(page, before);
  assert.equal(await page.locator('.ri-adopted-addition').count(), 1);
  await page.locator('#leave').click(); await page.locator('#enter').click(); await page.locator('[data-ri-action="undo-review"]').waitFor(); await idle(page);
  await page.reload(); await page.locator('[data-ri-action="undo-review"]').waitFor(); await idle(page);
  await page.locator('[data-ri-action="undo-review"]').click(); await idle(page); await immutable(page, before);
  assert.equal(await page.locator('.ri-adopted-addition').count(), 0); assert.equal(env.requests.length, 1); clean(env);
});
test('directory auto profile follows selected section; mobile sources remain readable', async t => {
  const env = await workspace(t), { page } = env; await imported(page);
  await page.locator('#ri-source-source-b3').click();
  await page.locator('#riWritingProfile').selectOption('auto'); await generate(page);
  assert.match(env.requests[0].system, /依据清单/); assert.match(env.requests[0].system, /不写政策解读/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#riReferenceContext').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.ok((await page.locator('.ri-document-bar strong').boundingBox()).width >= 160);
  await page.screenshot({ path: path.join(OUT, 'reference-mobile.png'), fullPage: true }); clean(env);
});
