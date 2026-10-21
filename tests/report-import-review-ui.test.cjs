'use strict';
require('../scripts/windows-browser-lockout-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const JSZip = require('../local-server/node_modules/jszip');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'outputs/report-import', 'review-ui-' + new Date().toISOString().replace(/[:.]/g, '-'));
const FIXTURE = '/tests/fixtures/report-import-review-ui-harness.html';
const USER = '[系统测试]候选审阅甲';
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const BEFORE = '原有修缮安排保持，具体施工组织需要完善。';
const AFTER = '原有修缮安排保持，施工前明确责任分工并核对现场条件。';
const APPEND = '补充建议：实施前核对现场条件并明确责任分工。';
const esc = value => String(value).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const para = value => '<w:p><w:r><w:t>' + esc(value) + '</w:t></w:r></w:p>';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
let server, origin, browser, mainBytes, specialBytes;

async function makeDocx(body, image = false) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<w:document xmlns:w="' + W + '" xmlns:r="' + R + '" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' + body + '</w:body></w:document>');
  if (image) {
    zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="' + R + '/image" Target="media/one.png"/></Relationships>');
    zip.file('word/media/one.png', png);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test.before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) { res.writeHead(400).end(); return; }
    if (pathname.startsWith('/api/')) { res.writeHead(501).end('Test requires an explicit API mock.'); return; }
    const target = path.resolve(ROOT, '.' + pathname);
    if (!target.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(target, (error, bytes) => {
      if (error) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
  const cell = (text, props = '') => '<w:tc>' + props + para(text) + '</w:tc>';
  const table = '<w:tbl><w:tr>' + cell('原始测算口径', '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>') + '</w:tr><w:tr>' + cell('租金') + cell('42.44 元，出租率 85%') + '</w:tr></w:tbl>';
  const image = '<w:p><w:r><w:t>原始位置图</w:t><w:drawing><wp:inline><wp:docPr id="1" name="原图"/><a:graphic><a:graphicData><a:blip r:embed="image1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  mainBytes = await makeDocx(para('第一章 项目安排') + para(BEFORE) + para('原稿租金 42.44 元，稳定出租率 85%。') + table + image + para('第二章 实施要求') + para('相邻章节原文保持不变。'), true);
  specialBytes = await makeDocx(para('专项参考意见') + para('专项稿租金 44 元，出租率 90%，尚待确认，不自动采用。'));
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function waitReady(page) { await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]')); }
async function proposedText(locator) {
  return locator.evaluate(element => { const copy = element.cloneNode(true); copy.querySelectorAll('del,small').forEach(node => node.remove()); return copy.textContent.trim(); });
}
async function waitForPost(env) {
  for (let count = 0; count < 200 && !env.requests.length; count++) await env.page.waitForTimeout(25);
  assert.ok(env.requests.length, 'the real adapter must reach the mocked POST within five seconds');
}
async function draft(page) {
  return page.evaluate(async () => {
    const store = ReportImportStore.create({ getOwner: () => getUser() });
    const rows = await store.list();
    return rows.length ? store.load(rows[0].id) : null;
  });
}
function responseFor(body, result) {
  return { durable_import_request_protocol: 1, request_id: body.request_id, binding: body.binding, status: 'completed', retry_allowed: false, result: { single_attempt: true, single_attempt_protocol: 1, request_id: body.request_id, finish_reason: 'stop', content: [{ type: 'text', text: JSON.stringify(result) }] } };
}
async function workspace(t, responder = () => ({ edits: [{ blockId: 'source-b1', afterText: AFTER }], explanation: '按所选段落完善施工安排，未调整数字。' })) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1680, height: 1000 } });
  t.after(() => context.close());
  await context.addInitScript(({ user }) => {
    if (!localStorage.getItem('fs_user')) localStorage.setItem('fs_user', user);
    if (!localStorage.getItem('fs_token')) localStorage.setItem('fs_token', 'report-review-fixture-token');
  }, { user: USER });
  const page = await context.newPage(), errors = [], consoleErrors = [], api = [], external = [], requests = [], capabilities = [], receipts = new Map();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.href); await route.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    api.push({ method: request.method(), path: url.pathname });
    if (url.pathname !== '/api/reportimportrequest') { await route.abort(); return; }
    if (request.method() === 'GET') {
      if (url.search) { await route.fulfill({ json: receipts.get(url.searchParams.get('id')) }); return; }
      capabilities.push(url.href);
      await route.fulfill({ json: { capabilities: { single_attempt: true, single_attempt_protocol: 1, durable_import_request_protocol: 1 } } }); return;
    }
    if (request.method() !== 'POST') { await route.abort(); return; }
    const envelope = request.postDataJSON(), body = envelope.generation; requests.push(body);
    receipts.set(envelope.request_id, { durable_import_request_protocol: 1, request_id: envelope.request_id, binding: envelope.binding, status: 'running', retry_allowed: false, result: null });
    try {
      const result = await responder(body, requests.length);
      if (result?.httpStatus) { receipts.get(envelope.request_id).status = 'outcome_unknown'; await route.fulfill({ status: result.httpStatus, json: { error: result.error || '模拟生成失败，未重试。' } }); }
      else { const receipt = responseFor(envelope, result); receipts.set(envelope.request_id, receipt); await route.fulfill({ json: receipt }); }
    } catch (error) {
      if (!page.isClosed() && !/Target.*closed|Request.*(failed|cancel)|Invalid InterceptionId|already handled/i.test(String(error))) throw error;
    }
  });
  await page.goto(origin + FIXTURE);
  await page.locator('#riMain').waitFor(); await waitReady(page);
  return { context, page, errors, consoleErrors, api, external, requests, capabilities, receipts };
}
async function importMain(page, extra = false) {
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]候选主报告.docx', mimeType: MIME, buffer: mainBytes });
  if (extra) {
    await page.locator('#riExtras').setInputFiles({ name: '[系统测试]专项参考.docx', mimeType: MIME, buffer: specialBytes });
    await page.locator('[data-ri-role="0"]').selectOption('special');
  }
  await page.locator('[data-ri-action="import"]').click();
  await page.locator('[data-ri-action="confirm"]').waitFor(); await waitReady(page);
  await page.locator('[data-ri-action="confirm"]').click();
  await page.locator('#riReviewPanel').waitFor(); await waitReady(page);
}
async function prepare(page, { blockId = 'source-b1', mode = 'rewrite', scope = 'paragraph', instruction = '仅完善本段施工安排，保留全部事实和数字。' } = {}) {
  await page.locator('#ri-source-' + blockId).click();
  await page.locator('#riProtected').uncheck();
  await page.locator('#riReviewMode').selectOption(mode);
  await page.locator('#riReviewScope').selectOption(scope);
  await page.locator('#riReviewInstruction').fill(instruction);
}
async function generate(page) {
  await page.locator('[data-ri-action="generate-review"]').click();
  try { await page.locator('[data-ri-action="accept-review"]').waitFor(); await waitReady(page); }
  catch (error) {
    await page.screenshot({ path: path.join(SHOTS, 'diagnostic-' + Date.now() + '.png'), fullPage: true });
    const alert = await page.locator('[role="alert"]').allTextContents();
    const panel = await page.locator('#riReviewPanel').innerText();
    throw new Error(error.message + '\nUI alert: ' + JSON.stringify(alert) + '\nReview panel: ' + panel);
  }
}
async function originalDownload(page) {
  const event = page.waitForEvent('download');
  await page.locator('[data-ri-download]').first().click();
  const download = await event, stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  await waitReady(page);
  return Buffer.concat(chunks);
}
function cleanNetwork(env, allowHttpFailure = false) {
  assert.deepEqual(env.errors, []);
  assert.deepEqual(env.external, []);
  assert.ok(env.api.every(call => call.path === '/api/reportimportrequest'), 'must not invoke project, research or cloud save APIs');
  assert.ok(env.requests.every(request => request.single_attempt === true && request.stream === false && typeof request.request_id === 'string'), 'every generation is an explicit non-streaming single attempt');
  assert.equal(new Set(env.requests.map(request => request.request_id)).size, env.requests.length, 'manual attempts have independent request IDs');
  const unexpected = env.consoleErrors.filter(message => !(allowHttpFailure && /Failed to load resource.*503/.test(message)));
  assert.deepEqual(unexpected, []);
}

test('ready candidate survives refresh; accepting and undoing preserve originals, tables and images', async t => {
  const env = await workspace(t), { page } = env;
  await importMain(page);
  assert.equal(await page.locator('#riReviewView').inputValue(), 'working');
  await prepare(page);
  const baseline = await draft(page);
  await generate(page);
  assert.equal(env.requests.length, 1);
  assert.match(await page.locator('[data-ri-review-before]').innerText(), /具体施工组织需要完善/);
  assert.equal(await proposedText(page.locator('[data-ri-review-after]')), AFTER);
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'ready');
  await page.screenshot({ path: path.join(SHOTS, '01-candidate-desktop.png'), fullPage: true });
  await page.reload(); await page.locator('[data-ri-action="accept-review"]').waitFor(); await waitReady(page);
  assert.equal(env.requests.length, 1, 'refresh must not request another model result');
  await page.locator('[data-ri-action="accept-review"]').click(); await waitReady(page);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'accepted', (await page.locator('[role="alert"]').allTextContents()).join(' / '));
  assert.equal(await proposedText(page.locator('#ri-source-source-b1')), AFTER);
  await page.locator('#riReviewView').selectOption('original');
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  assert.equal(hash(await originalDownload(page)), hash(mainBytes));
  const after = await draft(page);
  assert.deepEqual(after.files.map(file => file.parsed), baseline.files.map(file => file.parsed));
  assert.equal(await page.locator('.ri-document table').count(), 1);
  assert.equal(await page.locator('.ri-document td[colspan="2"]').count(), 1);
  await page.waitForFunction(() => [...document.querySelectorAll('.ri-document img')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator('.ri-document img').count(), 1);
  await page.reload(); await page.locator('[data-ri-action="undo-review"]').waitFor(); await waitReady(page);
  await page.locator('[data-ri-action="undo-review"]').click(); await waitReady(page);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'undone');
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  await page.locator('#fixtureLeave').click(); await page.locator('#fixtureEnter').click();
  await page.locator('#riReviewPanel').waitFor(); await waitReady(page);
  assert.equal(env.requests.length, 1);
  assert.equal(await page.locator('#ri-source-source-b6').innerText(), '相邻章节原文保持不变。');
  cleanNetwork(env);
});

test('redline is the net adopted change against uploaded text; continuous rewrites, view changes and undo survive refresh', async t => {
  const env = await workspace(t, (_body, count) => ({ edits: [{ blockId: 'source-b1', afterText: count === 1 ? AFTER : BEFORE }], explanation: '固定候选验证连续修改。' })), { page } = env;
  await importMain(page);
  assert.match(await page.locator('[data-ri-change-summary]').innerText(), /没有网页内已采用/);
  assert.match(await page.locator('[data-ri-change-summary]').innerText(), /无法据此判断上传前/);
  await prepare(page); await generate(page);
  assert.match(await page.locator('[data-ri-change-summary]').innerText(), /没有网页内已采用/, 'a ready candidate is not an adopted change');
  await page.locator('[data-ri-action="accept-review"]').click(); await waitReady(page);
  assert.match(await page.locator('[data-ri-change-summary]').innerText(), /已有 1 处文字修改：改写 1 段，补充 0 段/);
  assert.ok(await page.locator('#ri-source-source-b1 ins').count() > 0);
  assert.ok(await page.locator('#ri-source-source-b1 del').count() > 0);
  assert.equal(await page.locator('#ri-source-source-b1 del').first().evaluate(el => getComputedStyle(el).color), 'rgb(192, 0, 0)');
  await page.locator('#riReviewView').selectOption('clean');
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), AFTER);
  assert.equal(await page.locator('.ri-document ins,.ri-document del').count(), 0);
  await page.locator('#riReviewView').selectOption('original');
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  await page.locator('#riReviewView').selectOption('working');
  await prepare(page); await generate(page);
  assert.match(await page.locator('[data-ri-change-summary]').innerText(), /已有 1 处文字修改/, 'an unaccepted reversal does not alter the adopted draft');
  await page.locator('[data-ri-action="accept-review"]').click(); await waitReady(page);
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  assert.equal(await page.locator('.ri-document ins,.ri-document del').count(), 0);
  assert.match(await page.locator('[data-ri-change-summary]').innerText(), /没有网页内已采用/, 'rewriting back to the original has no net redline');
  await page.reload(); await page.locator('[data-ri-action="undo-review"]').waitFor(); await waitReady(page);
  assert.match(await page.locator('[data-ri-change-summary]').innerText(), /没有网页内已采用/);
  await page.locator('[data-ri-action="undo-review"]').click(); await waitReady(page);
  assert.equal(await proposedText(page.locator('#ri-source-source-b1')), AFTER);
  assert.match(await page.locator('[data-ri-change-summary]').innerText(), /已有 1 处文字修改/);
  await page.locator('#fixtureLeave').click(); await page.locator('#fixtureEnter').click(); await waitReady(page);
  assert.equal(await proposedText(page.locator('#ri-source-source-b1')), AFTER);
  assert.equal(env.requests.length, 2);
  cleanNetwork(env);
});

test('redline, working-draft and optional tracked downloads choose explicit modes, block duplicate clicks and preserve a pending candidate on failure', async t => {
  const env = await workspace(t), { page } = env;
  await importMain(page); await prepare(page); await generate(page);
  const before = await draft(page);
  assert.equal(await page.locator('details.ri-tracked-export').evaluate(details => details.open), false);
  assert.equal(await page.locator('[data-ri-action="export-tracked"]').isVisible(), false);
  await page.evaluate(() => {
    window.__downloadCalls = []; window.__downloadFail = false;
    window.ReportImportDelivery = { exportDocx: async (draft, original, options) => {
      __downloadCalls.push({ mode: options.mode, requests: draft.reviewState.requests.map(item => item.status), text: ReportImportReview.project(draft)[1].text });
      if (__downloadFail) throw new Error('[系统测试] Word 导出失败，工作稿保留。');
      if (window.__holdDownload) await new Promise(resolve => { window.__releaseDownload = resolve; });
      return { blob: original, fileName: '[系统测试]-' + options.mode + '.docx', receipt: { coarseDiffBlocks: options.mode === 'review' ? ['source-b1'] : [] } };
    } };
    window.__holdDownload = true;
  });
  const downloadReady = page.waitForEvent('download');
  await page.locator('[data-ri-action="export-word"]').evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => typeof window.__releaseDownload === 'function');
  assert.equal(await page.locator('[data-ri-action="export-word"]').isDisabled(), true);
  assert.equal(await page.locator('[data-ri-action="export-clean"]').isDisabled(), true);
  assert.equal(await page.locator('[data-ri-action="export-tracked"]').isDisabled(), true);
  assert.equal(await page.evaluate(() => __downloadCalls.length), 1);
  await page.evaluate(() => { window.__holdDownload = false; __releaseDownload(); });
  await downloadReady; await waitReady(page);
  assert.match(await page.locator('.ri-message').innerText(), /整段对照，不代表逐字差异/);
  assert.match(await page.locator('.ri-message').innerText(), /固定红字.*打开即可查看/);
  assert.doesNotMatch(await page.locator('.ri-message').innerText(), /所有标记/);
  const cleanDownload = page.waitForEvent('download');
  await page.locator('[data-ri-action="export-clean"]').click(); await cleanDownload; await waitReady(page);
  assert.match(await page.locator('.ri-message').innerText(), /当前工作稿/);
  assert.doesNotMatch(await page.locator('.ri-message').innerText(), /所有标记/);
  await page.locator('details.ri-tracked-export summary').click();
  const trackedDownload = page.waitForEvent('download');
  await page.locator('[data-ri-action="export-tracked"]').click(); await trackedDownload; await waitReady(page);
  assert.match(await page.locator('.ri-message').innerText(), /Word 修订版.*接受或拒绝.*颜色随软件设置.*所有标记/);
  assert.deepEqual(await page.evaluate(() => __downloadCalls.map(call => call.mode)), ['review', 'clean', 'tracked']);
  assert.deepEqual(await page.evaluate(() => __downloadCalls.map(call => call.requests)), [['ready'], ['ready'], ['ready']]);
  assert.deepEqual(await page.evaluate(() => __downloadCalls.map(call => call.text)), [BEFORE, BEFORE, BEFORE]);
  await page.evaluate(() => { window.__downloadFail = true; });
  await page.locator('[data-ri-action="export-clean"]').click(); await waitReady(page);
  assert.match(await page.locator('[role="alert"]').innerText(), /Word 导出失败，工作稿保留/);
  assert.equal(await page.locator('[data-ri-action="accept-review"]').count(), 1);
  assert.equal((await draft(page)).revision, before.revision);
  assert.deepEqual((await draft(page)).reviewState, before.reviewState);
  assert.equal(env.requests.length, 1, 'download and failure must not start AI again');
  cleanNetwork(env);
});

test('formatted source runs keep their existing red and bold style; rewrite stays protected and append works in every view', async t => {
  const env = await workspace(t, () => ({ edits: [{ blockId: 'source-b1', afterText: APPEND }], explanation: '只补充正文，不更改原有格式。' })), { page } = env;
  const redWords = '原有红色粗体事实', sourceText = redWords + '，后半句保持待完善。';
  const formatted = await makeDocx(para('第一章 项目安排') + '<w:p><w:r><w:rPr><w:b/><w:color w:val="C00000"/></w:rPr><w:t>' + redWords + '</w:t></w:r><w:r><w:t>，后半句保持待完善。</w:t></w:r></w:p>');
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]原有文字格式.docx', mimeType: MIME, buffer: formatted });
  await page.locator('[data-ri-action="import"]').click(); await page.locator('[data-ri-action="confirm"]').waitFor(); await waitReady(page);
  await page.locator('[data-ri-action="confirm"]').click(); await page.locator('#riReviewPanel').waitFor(); await waitReady(page);
  const inspectSource = () => page.locator('[data-ri-content="source-b1"]').evaluate((element, text) => {
    const run = [...element.querySelectorAll('*')].find(node => node.textContent === text && ![...node.children].some(child => child.textContent === text));
    if (!run) return null;
    const style = getComputedStyle(run); return { text: run.textContent, color: style.color, weight: style.fontWeight, insertion: !!run.closest('ins') };
  }, redWords);
  const baselineStyle = await inspectSource();
  assert.equal(baselineStyle.color, 'rgb(192, 0, 0)'); assert.ok(Number(baselineStyle.weight) >= 700); assert.equal(baselineStyle.insertion, false);
  await prepare(page, { mode: 'rewrite', instruction: '保留前半句红色粗体，只完善后半句。' });
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true);
  assert.match(await page.locator('#riReviewPanel').innerText(), /含复杂文字格式，仅支持补充，不能改写/);
  assert.equal(env.requests.length, 0);
  await page.locator('#riReviewMode').selectOption('append'); await generate(page);
  await page.locator('[data-ri-action="accept-review"]').click(); await waitReady(page);
  for (const view of ['working', 'clean', 'original']) {
    await page.locator('#riReviewView').selectOption(view);
    assert.deepEqual(await inspectSource(), baselineStyle, view + ' keeps red and bold without calling them an insertion');
    assert.ok((await page.locator('[data-ri-content="source-b1"]').innerText()).includes(sourceText));
    assert.equal((await page.locator('[data-ri-content="source-b1"]').innerText()).includes(APPEND), view !== 'original');
  }
  assert.deepEqual(await originalDownload(page), formatted);
  assert.equal(env.requests.length, 1);
  cleanNetwork(env);
});

test('empty and protected scopes cannot request AI; rejecting append leaves all original content unchanged', async t => {
  const env = await workspace(t, () => ({ edits: [{ blockId: 'source-b1', afterText: APPEND }], explanation: '只提出追加建议。' })), { page } = env;
  await importMain(page, true);
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true);
  await page.locator('#ri-source-source-b1').click();
  await page.locator('#riReviewMode').selectOption('rewrite');
  await page.locator('#riReviewInstruction').fill('只补充本段的实施建议。');
  assert.equal(await page.locator('#riProtected').isChecked(), true);
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true);
  assert.equal(env.requests.length, 0);
  await prepare(page, { mode: 'append', instruction: '只补充本段的实施建议。' });
  await generate(page);
  await page.locator('[data-ri-action="reject-review"]').click(); await waitReady(page);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'rejected');
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  await page.reload(); await page.locator('#riReviewPanel').waitFor(); await waitReady(page);
  assert.equal(env.requests.length, 1);
  assert.equal(await page.locator('[data-ri-action="accept-review"]').count(), 0);
  const supplement = await page.locator('#riFile option').evaluateAll(options => options.find(option => option.textContent.includes('专项参考')).value);
  await page.locator('#riFile').selectOption(supplement);
  await page.locator('#riReviewInstruction').fill('改写这个专项参考。');
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true);
  assert.equal(env.requests.length, 1);
  cleanNetwork(env);
});

test('an unknown request blocks another POST; explicit recovery only reads the same receipt', async t => {
  const env = await workspace(t, () => ({ httpStatus: 503 })), { page } = env;
  await importMain(page); await prepare(page);
  await page.locator('[data-ri-action="generate-review"]').click();
  await page.locator('[role="alert"]').waitFor(); await waitReady(page);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'outcome_unknown');
  await page.waitForTimeout(350);
  assert.equal(env.requests.length, 1);
  assert.equal(await page.locator('#riReviewInstruction').inputValue(), '仅完善本段施工安排，保留全部事实和数字。');
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  assert.equal(await page.locator('[data-ri-action="accept-review"]').count(), 0);
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true);
  await page.locator('[data-ri-action="recover-review"]').click(); await waitReady(page);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'outcome_unknown');
  assert.equal(env.requests.length, 1);
  assert.equal(env.api.filter(call => call.method === 'GET').length, 2);
  cleanNetwork(env, true);
});

test('changed numerical facts are rejected and table or image paragraphs are never rewrite targets', async t => {
  const env = await workspace(t, () => ({ edits: [{ blockId: 'source-b2', afterText: '原稿租金 44 元，稳定出租率 90%。' }], explanation: '模拟未确认口径变动。' })), { page } = env;
  await importMain(page); await prepare(page, { blockId: 'source-b2' });
  await page.locator('[data-ri-action="generate-review"]').click();
  await page.locator('[role="alert"]').waitFor(); await waitReady(page);
  assert.equal(await page.locator('[data-ri-action="accept-review"]').count(), 0);
  assert.match(await page.locator('#ri-source-source-b2').innerText(), /42\.44.*85%/);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'outcome_unknown');
  for (const blockId of ['source-b3', 'source-b4']) {
    await page.locator('#ri-source-' + blockId).click();
    const protectedControl = page.locator('#riProtected');
    if (await protectedControl.count() && await protectedControl.isEnabled()) await protectedControl.uncheck();
    assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true, blockId + ' is not plain editable text');
  }
  assert.equal(env.requests.length, 1);
  assert.equal(hash(await originalDownload(page)), hash(mainBytes));
  cleanNetwork(env);
});

test('duplicate clicks issue one request; cancelling ignores a late response and never resumes on reload', async t => {
  const gate = deferred();
  const env = await workspace(t, async () => { await gate.promise; return { edits: [{ blockId: 'source-b1', afterText: AFTER }], explanation: '已取消请求的迟回。' }; }), { page } = env;
  t.after(() => gate.resolve());
  await importMain(page); await prepare(page);
  await page.locator('[data-ri-action="generate-review"]').evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => !!document.querySelector('[data-ri-action="cancel-review"]'));
  await waitForPost(env);
  assert.equal(env.requests.length, 1);
  assert.equal(await page.locator('#riReviewInstruction').isDisabled(), true);
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true);
  await page.locator('[data-ri-action="cancel-review"]').click(); await waitReady(page);
  gate.resolve(); await page.waitForTimeout(100);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'outcome_unknown');
  assert.equal(await page.locator('[data-ri-action="accept-review"]').count(), 0);
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  await page.reload(); await page.locator('#riReviewPanel').waitFor(); await waitReady(page);
  assert.equal(env.requests.length, 1);
  cleanNetwork(env);
});

test('account change rejects an in-flight response without writing a candidate for the new account', async t => {
  const gate = deferred();
  const env = await workspace(t, async () => { await gate.promise; return { edits: [{ blockId: 'source-b1', afterText: AFTER }], explanation: '旧账号迟回。' }; }), { page, context } = env;
  t.after(() => gate.resolve());
  await importMain(page); await prepare(page);
  await page.locator('[data-ri-action="generate-review"]').click();
  await waitForPost(env);
  const peer = await context.newPage(); await peer.goto(origin + FIXTURE);
  await peer.evaluate(() => localStorage.setItem('fs_user', '[系统测试]候选审阅乙'));
  await page.locator('#riMain').waitFor(); await waitReady(page);
  gate.resolve(); await page.waitForTimeout(100);
  assert.equal(await draft(page), null);
  assert.equal(await page.locator('[data-ri-open]').count(), 0);
  assert.equal(await page.locator('[data-ri-action="accept-review"]').count(), 0);
  await peer.close();
  assert.equal(env.requests.length, 1);
  cleanNetwork(env);
});

test('a newer revision saved in another tab is not overwritten by a late candidate', async t => {
  const gate = deferred();
  const env = await workspace(t, async () => { await gate.promise; return { edits: [{ blockId: 'source-b1', afterText: AFTER }], explanation: '旧版本迟回。' }; }), { page, context } = env;
  t.after(() => gate.resolve());
  await importMain(page); await prepare(page);
  await page.locator('[data-ri-action="generate-review"]').click();
  await waitForPost(env);
  const peer = await context.newPage(); await peer.goto(origin + FIXTURE);
  const peerRevision = await peer.evaluate(async () => {
    const store = ReportImportStore.create({ getOwner: () => getUser() });
    const item = await store.load((await store.list())[0].id);
    item.title = '[系统测试]另一标签的新版本';
    return (await store.save(item, item.revision)).revision;
  });
  gate.resolve(); await page.locator('[role="alert"]').waitFor(); await waitReady(page);
  const current = await draft(page);
  assert.equal(current.title, '[系统测试]另一标签的新版本');
  assert.equal(current.revision, peerRevision);
  assert.equal(current.reviewState.requests.some(request => request.status === 'ready' || request.status === 'accepted'), false);
  assert.equal(await page.locator('[data-ri-action="accept-review"]').count(), 0);
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  assert.equal(env.requests.length, 1);
  await peer.close(); cleanNetwork(env);
});

test('candidate review remains readable on a phone and escapes model text without executing HTML', async t => {
  const hostile = AFTER + ' <img src="https://invalid.example/steal" onerror="window.__reviewInjected=true">';
  const env = await workspace(t, () => ({ edits: [{ blockId: 'source-b1', afterText: hostile }], explanation: '<script>window.__reviewInjected=true</script>' })), { page } = env;
  await importMain(page); await prepare(page); await generate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const filenameBox = await page.locator('.ri-document-bar strong').boundingBox();
  assert.ok(filenameBox.width >= 160, 'mobile filename must retain a full readable row');
  assert.equal(await page.locator('#riReviewPanel').isVisible(), true);
  assert.equal(await page.locator('[data-ri-review-before]').isVisible(), true);
  assert.equal(await page.locator('[data-ri-review-after]').isVisible(), true);
  assert.match(await page.locator('[data-ri-review-after]').innerText(), /<img/);
  assert.equal(await page.evaluate(() => !!window.__reviewInjected), false);
  assert.equal(await page.locator('#riReviewPanel img').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(SHOTS, '02-candidate-phone.png'), fullPage: true });
  await page.locator('[data-ri-action="accept-review"]').click(); await waitReady(page);
  assert.equal(await page.evaluate(() => !!window.__reviewInjected), false);
  assert.match(await page.locator('#ri-source-source-b1').innerText(), /<img/);
  assert.equal(await page.locator('#ri-source-source-b1 img').count(), 0);
  cleanNetwork(env);
});

test('chapter scope includes only eligible paragraphs before the next chapter and append preserves protected source blocks', async t => {
  const env = await workspace(t, body => {
    const payload = JSON.parse(body.messages[0].content);
    return { edits: payload.blocks.map(block => ({ blockId: block.blockId, afterText: APPEND })), explanation: '各段只增加补充建议，表图和相邻章节保持。' };
  }), { page } = env;
  await importMain(page, true);
  const baseline = await draft(page);
  await page.locator('[data-ri-anchor="source-b0"]').click();
  await page.locator('#riReviewScope').selectOption('section');
  await page.locator('#riReviewInstruction').fill('对这一章增加实施建议，不改变原文数字和保护标记。');
  await generate(page);
  const payload = JSON.parse(env.requests[0].messages[0].content);
  assert.equal(payload.mode, 'append');
  assert.deepEqual(payload.blocks.map(block => block.blockId), ['source-b1', 'source-b2']);
  assert.equal(payload.references.length, 0, 'supplemental reports are not silently included or merged');
  assert.equal(await page.locator('[data-ri-review-after]').count(), 2);
  assert.match(await page.locator('.ri-review-compose .ri-scope-summary').innerText(), /3 处标题、表图或受保护内容保持原样/);
  assert.match(await page.locator('#riReviewPanel').innerText(), /AI 说明（未经核实）：各段只增加补充建议/);
  await page.locator('[data-ri-action="accept-review"]').click(); await waitReady(page);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'accepted');
  assert.match(await page.locator('#ri-source-source-b1').innerText(), new RegExp(esc(APPEND)));
  assert.match(await page.locator('#ri-source-source-b2').innerText(), /42\.44.*85%/);
  assert.equal(await page.locator('#ri-source-source-b6').innerText(), '相邻章节原文保持不变。');
  assert.equal(await page.locator('#ri-source-source-b6 .ri-adopted-addition').count(), 0);
  const saved = await draft(page);
  assert.deepEqual(saved.protectedBlockIds, baseline.protectedBlockIds);
  assert.deepEqual(saved.files.map(file => file.parsed), baseline.files.map(file => file.parsed));
  await page.reload(); await page.locator('[data-ri-action="undo-review"]').waitFor(); await waitReady(page);
  assert.equal(env.requests.length, 1);
  assert.equal(await page.locator('.ri-adopted-addition').count(), 2);
  await page.locator('#riReviewView').selectOption('original');
  assert.equal(await page.locator('.ri-adopted-addition').count(), 0);
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  assert.equal(hash(await originalDownload(page)), hash(mainBytes));
  cleanNetwork(env);
});

test('refreshing a running request exposes local recovery without repeating the model request', async t => {
  const gate = deferred();
  const env = await workspace(t, async () => { await gate.promise; return { edits: [{ blockId: 'source-b1', afterText: AFTER }], explanation: '刷新前的迟回。' }; }), { page } = env;
  t.after(() => gate.resolve());
  await importMain(page); await prepare(page);
  await page.locator('[data-ri-action="generate-review"]').click(); await waitForPost(env);
  page.once('dialog', dialog => dialog.accept());
  await page.reload(); await page.locator('[data-ri-action="recover-review"]').waitFor(); await waitReady(page);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'running');
  assert.match(await page.locator('#riReviewPanel').innerText(), /结果未确认前保留记录，不重新生成/);
  assert.equal(env.requests.length, 1);
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isDisabled(), true);
  await page.locator('[data-ri-action="recover-review"]').click(); await waitReady(page);
  gate.resolve(); await page.waitForTimeout(100);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'running');
  assert.equal(await page.locator('[data-ri-action="accept-review"]').count(), 0);
  assert.equal(await page.locator('#ri-source-source-b1').innerText(), BEFORE);
  assert.equal(env.requests.length, 1);
  cleanNetwork(env);
});

test('partial candidate choices survive quality decisions and refresh; only selected changes are adopted', async t => {
  const env = await workspace(t, body => ({ edits: JSON.parse(body.messages[0].content).blocks.map(block => ({ blockId: block.blockId, afterText: APPEND })), explanation: '只补充实施建议。' })), { page } = env;
  await importMain(page);
  await page.locator('[data-ri-anchor="source-b0"]').click();
  await page.locator('#riReviewScope').selectOption('section');
  await page.locator('#riReviewInstruction').fill('为本章补充实施建议，保留全部原文事实。');
  await generate(page);
  await page.locator('[data-ri-accept-block="source-b1"]').uncheck();
  const findingId = await page.evaluate(async () => {
    const store = ReportImportStore.create({ getOwner: () => getUser() });
    const current = await store.load((await store.list())[0].id);
    return ReportImportQuality.evaluate(current).findings.find(row => row.kind === 'professional-review').id;
  });
  const finding = page.locator('[data-ri-finding="' + findingId + '"]');
  await finding.locator('summary').click();
  assert.equal(await finding.locator('[data-ri-quality-decision="not-applicable"]').count(), 0);
  await finding.locator('[data-ri-quality-note]').fill('已按本测试原件核对，仅记录人工审阅，不认证事实。');
  await finding.locator('[data-ri-quality-decision="confirmed"]').click(); await waitReady(page);
  assert.equal(await page.locator('[data-ri-accept-block="source-b1"]').isChecked(), false);
  assert.equal(await page.locator('[data-ri-accept-block="source-b2"]').isChecked(), true);
  assert.match(await finding.locator('summary').innerText(), /已人工确认/);
  await page.reload(); await page.locator('[data-ri-action="accept-review"]').waitFor(); await waitReady(page);
  assert.equal(await page.locator('[data-ri-accept-block="source-b1"]').isChecked(), false);
  assert.equal(await page.locator('[data-ri-accept-block="source-b2"]').isChecked(), true);
  assert.match(await finding.locator('summary').innerText(), /已人工确认/);
  assert.equal(env.requests.length, 1, 'quality recording and refresh must never generate again');
  await page.locator('[data-ri-action="accept-review"]').click(); await waitReady(page);
  const saved = await draft(page), request = saved.reviewState.requests.at(-1);
  assert.equal(request.status, 'accepted');
  assert.deepEqual(request.acceptedBlockIds, ['source-b2']);
  assert.deepEqual(request.rejectedBlockIds, ['source-b1']);
  assert.equal(await page.locator('#ri-source-source-b1 .ri-adopted-addition').count(), 0);
  assert.equal(await page.locator('#ri-source-source-b2 .ri-adopted-addition').count(), 1);
  assert.equal(saved.reviewState.qualityDecisions.length, 1);
  const professional = await page.evaluate(value => ReportImportQuality.evaluate(value).findings.find(row => row.kind === 'professional-review'), saved);
  assert.equal(professional.status, 'open', 'a changed document reopens the whole-document confirmation without erasing history');
  await page.screenshot({ path: path.join(SHOTS, '03-partial-accept-after-quality.png'), fullPage: true });
  await page.locator('[data-ri-action="undo-review"]').click(); await waitReady(page);
  assert.equal(await page.locator('.ri-adopted-addition').count(), 0);
  assert.equal(hash(await originalDownload(page)), hash(mainBytes));
  cleanNetwork(env);
});

test('dirty and conflicted work can fork from its known revision without saving or overwriting the source', async t => {
  const env = await workspace(t), { page, context } = env;
  await importMain(page);
  const baseline = await draft(page);
  await page.locator('#ri-source-source-b1').click();
  await page.locator('#riProtected').uncheck();
  await page.locator('[data-ri-action="outline"]').click();
  await page.locator('[data-ri-heading-title="source-b0"]').fill('第一章 当前未保存的目录校正');
  const peer = await context.newPage(); await peer.goto(origin + FIXTURE); await waitReady(peer);
  const peerSaved = await peer.evaluate(async id => {
    const store = ReportImportStore.create({ getOwner: () => getUser() });
    const current = await store.load(id);
    return store.save({ ...current, title: '[系统测试]另一标签已保存版本' }, current.revision);
  }, baseline.id);
  await page.locator('[data-ri-action="save"]').click(); await waitReady(page);
  assert.match(await page.locator('[role="alert"]').innerText(), /已在其他页面更新.*另存副本/);
  assert.equal(await page.locator('[data-ri-heading-title="source-b0"]').inputValue(), '第一章 当前未保存的目录校正');
  await page.locator('[data-ri-action="fork"]').click(); await waitReady(page);
  const values = await page.evaluate(async originalId => {
    const store = ReportImportStore.create({ getOwner: () => getUser() });
    const listed = await store.list();
    return { source: await store.load(originalId), copies: await Promise.all(listed.filter(row => row.id !== originalId).map(row => store.load(row.id))) };
  }, baseline.id);
  assert.deepEqual(values.source, peerSaved, 'fork must not rewrite the newer source revision');
  assert.equal(values.copies.length, 1);
  const copy = values.copies[0];
  assert.equal(copy.title, baseline.title + '（副本）');
  assert.equal(copy.outline.find(row => row.blockId === 'source-b0').title, '第一章 当前未保存的目录校正');
  assert.equal(copy.protectedBlockIds.includes('source-b1'), false);
  assert.equal(copy.confirmed, false);
  assert.equal(copy.restoredFrom.revision, baseline.revision, 'the copy starts at the user-visible historical revision, not a peer edit');
  assert.equal(copy.revision, baseline.revision + 1, 'only the independent copy gets a revision for the dirty edits');
  assert.deepEqual(copy.files.map(file => file.hash), baseline.files.map(file => file.hash));
  assert.equal(values.source.protectedBlockIds.includes('source-b1'), true);
  assert.equal(env.requests.length, 0);
  await page.reload(); await page.locator('[data-ri-heading-title="source-b0"]').waitFor(); await waitReady(page);
  assert.equal(await page.locator('[data-ri-heading-title="source-b0"]').inputValue(), '第一章 当前未保存的目录校正');
  await peer.close(); cleanNetwork(env);
});

test('an unsaved returned candidate blocks fork and can be saved later without another AI request', async t => {
  const env = await workspace(t), { page } = env;
  await page.addInitScript(() => {
    window.__failCandidateSave = true;
    Object.defineProperty(window, 'ReportImportStore', { configurable: true, set(api) {
      Object.defineProperty(window, 'ReportImportStore', { configurable: true, value: { ...api, create(options) {
        const target = api.create(options);
        return { ...target, review(...args) {
          if (window.__failCandidateSave && args[2]?.type === 'complete') return Promise.reject(Object.assign(new Error('模拟候选保存空间不足'), { code: 'STORAGE' }));
          return target.review(...args);
        } };
      } } });
    } });
  });
  await page.reload(); await page.locator('#riMain').waitFor(); await waitReady(page);
  await importMain(page); await prepare(page);
  await page.locator('[data-ri-action="generate-review"]').click();
  await page.locator('[data-ri-action="save-review"]').waitFor(); await waitReady(page);
  const beforeFork = await draft(page);
  assert.equal(beforeFork.reviewState.requests.at(-1).status, 'running');
  assert.equal(env.requests.length, 1);
  await page.locator('[data-ri-action="fork"]').click(); await waitReady(page);
  assert.match(await page.locator('[role="alert"]').innerText(), /先点“仅重试保存建议”/);
  assert.equal(await page.locator('[data-ri-action="save-review"]').count(), 1);
  assert.deepEqual(await draft(page), beforeFork);
  assert.equal(await page.evaluate(async () => (await ReportImportStore.create({ getOwner: () => getUser() }).list()).length), 1);
  await page.evaluate(() => { window.__failCandidateSave = false; });
  await page.locator('[data-ri-action="save-review"]').click(); await waitReady(page);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'ready');
  assert.equal(env.requests.length, 1);
  await page.locator('[data-ri-action="accept-review"]').click(); await waitReady(page);
  assert.equal((await draft(page)).reviewState.requests.at(-1).status, 'accepted');
  assert.equal(await proposedText(page.locator('#ri-source-source-b1')), AFTER);
  assert.equal(hash(await originalDownload(page)), hash(mainBytes));
  cleanNetwork(env);
});
