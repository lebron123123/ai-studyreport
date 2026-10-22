'use strict';
require('../scripts/windows-browser-lockout-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const SOURCE = fs.readFileSync(path.join(__dirname, '../report-logic-export-ui.js'), 'utf8');
const ORIGIN = 'http://report-logic-export.test';
const SCOPES = [{ key: 'rent', label: '出租类', projectType: 'rent', businessScenario: 'rent' }, { key: 'housing_conversion', label: '住房改造', projectType: 'gaibao', businessScenario: 'housing_conversion' }, { key: 'commercial_renovation', label: '商业改造', projectType: 'gaibao', businessScenario: 'commercial_renovation' }];
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) }); });
test.after(async () => { await browser?.close(); });

async function fixture(t, options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  t.after(() => context.close());
  let reply = async (route, index) => route.fulfill({ json: { ok: true, scopes: SCOPES, version: index } });
  const requests = [], errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/reportlogicexport') {
      requests.push({ method: route.request().method(), headers: route.request().headers() });
      await reply(route, requests.length); return;
    }
    if (url.pathname === '/report-logic-export-ui.js') { await route.fulfill({ contentType: 'application/javascript', body: SOURCE }); return; }
    if (url.pathname === '/' || url.pathname === '/again') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><body><textarea id="editor">尚未保存的原文</textarea><div id="root"></div><script>window.authHeaders=()=>({Authorization:"Bearer synthetic-ui-test"});window.downloads=[];window.draftReads=0;window.currentScope="rent";window.ReportLogicExport={scopes:s=>s.scopes,download:async(s,k,o)=>{window.downloads.push({snapshot:s,keys:k,options:o});}};window.mountExport=()=>ReportLogicExportUI.mount(document.getElementById("root"),{getCurrentScope:()=>window.currentScope,isEditing:()=>true,getDraft:()=>{window.draftReads++;return {scope:window.currentScope,set:{data:{globalRequirements:{rent:document.getElementById("editor").value}}}}},requestTimeoutMs:' + Number(options.timeout || 30000) + '});</script><script src="/report-logic-export-ui.js"></script><script>window.exportHandle=mountExport();</script></body></html>' }); return;
    }
    await route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(ORIGIN, { waitUntil: 'load' });
  return { page, requests, errors, setReply(fn) { reply = fn; } };
}
const button = (page, action) => page.locator('[data-rle-action="' + action + '"]');
const state = (page, value) => page.locator('.rle-status[data-state="' + value + '"]').waitFor();

test('正式下载每次读取最新服务器快照，单飞，不读取或覆盖编辑器', async t => {
  const f = await fixture(t);
  let release;
  f.setReply(async (route, index) => {
    if (index === 1) await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: { ok: true, scopes: SCOPES, version: index } });
  });
  await button(f.page, 'current').click();
  await state(f.page, 'loading');
  await f.page.waitForFunction(() => document.querySelector('.rle-panel').getAttribute('aria-busy') === 'true');
  await f.page.evaluate(() => { document.querySelector('[data-rle-action=current]').click(); document.querySelector('[data-rle-action=draft]').click(); });
  assert.equal(f.requests.length, 1);
  assert.equal(await f.page.evaluate(() => draftReads), 0);
  await f.page.locator('#editor').fill('下载期间继续编辑');
  release();
  await state(f.page, 'success');
  await button(f.page, 'current').click();
  await f.page.waitForFunction(() => downloads.length === 2);
  assert.deepEqual(await f.page.evaluate(() => downloads.map(x => x.snapshot.version)), [1, 2]);
  assert.equal(await f.page.evaluate(() => draftReads), 0);
  assert.equal(await f.page.locator('#editor').inputValue(), '下载期间继续编辑');
  assert.equal(f.requests.every(x => x.method === 'GET' && x.headers.authorization === 'Bearer synthetic-ui-test'), true);
  assert.deepEqual(f.errors, []);
});

test('批量目录和点击下载分别取新快照，完整选择和未知文本安全展示', async t => {
  const f = await fixture(t);
  const scopes = [...SCOPES, { key: 'future', label: '<img src=x onerror="window.injected=true">未来类型' }];
  f.setReply((route, index) => route.fulfill({ json: { ok: true, scopes, version: index } }));
  await button(f.page, 'batch').click();
  await f.page.locator('[data-rle-scope=future]').waitFor();
  assert.equal(await f.page.locator('.rle-choices img').count(), 0);
  await button(f.page, 'none').click();
  assert.equal(await button(f.page, 'selected').isDisabled(), true);
  await button(f.page, 'all').click();
  await button(f.page, 'selected').click();
  await state(f.page, 'success');
  assert.equal(f.requests.length, 2);
  const result = await f.page.evaluate(() => downloads[0]);
  assert.equal(result.snapshot.version, 2);
  assert.deepEqual(result.keys, scopes.map(x => x.key));
  assert.deepEqual(f.errors, []);
});

test('已选类型在最新服务器消失时阻止缺项下载，保留选择与编辑原文', async t => {
  const f = await fixture(t);
  f.setReply((route, index) => route.fulfill({ json: { ok: true, scopes: index === 1 ? SCOPES : SCOPES.slice(0, 1) } }));
  await button(f.page, 'batch').click();
  await f.page.locator('[data-rle-scope=housing_conversion]').check();
  await button(f.page, 'selected').click();
  await state(f.page, 'error');
  assert.match(await f.page.locator('.rle-status').innerText(), /已变更|不再有/);
  assert.equal(await f.page.evaluate(() => downloads.length), 0);
  assert.equal(await f.page.locator('[data-rle-scope=housing_conversion]').isChecked(), true);
  assert.equal(await f.page.locator('#editor').inputValue(), '尚未保存的原文');
});

test('编辑稿在点击时读取输入，传给导出核心但不保存、不发布', async t => {
  const f = await fixture(t);
  await f.page.locator('#editor').fill('领导尚未批准的本次修改');
  assert.equal(await f.page.evaluate(() => draftReads), 0);
  await button(f.page, 'draft').click();
  await state(f.page, 'success');
  const result = await f.page.evaluate(() => downloads[0]);
  assert.equal(result.options.draft.set.data.globalRequirements.rent, '领导尚未批准的本次修改');
  assert.equal(result.options.draft.scope, 'rent');
  assert.equal(await f.page.evaluate(() => draftReads), 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, 'GET');
  assert.match(await f.page.locator('.rle-status').innerText(), /未发布、未保存/);
});

test('空目录明确提示，错误和超时不自动重试，恢复后可人工重新下载', async t => {
  const f = await fixture(t, { timeout: 250 });
  f.setReply(route => route.fulfill({ json: { ok: true, scopes: [] } }));
  await button(f.page, 'batch').click();
  await state(f.page, 'empty');
  assert.equal(await button(f.page, 'selected').isDisabled(), true);
  f.setReply(route => route.fulfill({ status: 403, json: { ok: false } }));
  await button(f.page, 'current').click();
  await state(f.page, 'error');
  assert.match(await f.page.locator('.rle-status').innerText(), /没有.*权限/);
  f.setReply(async route => {
    await new Promise(resolve => setTimeout(resolve, 450));
    try { await route.fulfill({ json: { ok: true, scopes: SCOPES } }); } catch (_) {}
  });
  await button(f.page, 'current').click();
  await state(f.page, 'error');
  assert.match(await f.page.locator('.rle-status').innerText(), /超时/);
  assert.equal(f.requests.length, 3);
  assert.equal(await f.page.evaluate(() => downloads.length), 0);
  assert.equal(await f.page.locator('#editor').inputValue(), '尚未保存的原文');
  f.setReply(route => route.fulfill({ json: { ok: true, scopes: SCOPES } }));
  await button(f.page, 'current').click();
  await state(f.page, 'success');
  assert.equal(f.requests.length, 4);
});

test('网络错误转成可操作提示，组件销毁后晚到请求不能下载', async t => {
  const f = await fixture(t);
  f.setReply(route => route.abort('failed'));
  await button(f.page, 'current').click();
  await state(f.page, 'error');
  assert.match(await f.page.locator('.rle-status').innerText(), /检查网络和服务状态/);
  assert.doesNotMatch(await f.page.locator('.rle-status').innerText(), /fetch failed|failed to fetch/i);
  let release;
  f.setReply(async route => {
    await new Promise(resolve => { release = resolve; });
    try { await route.fulfill({ json: { ok: true, scopes: SCOPES } }); } catch (_) {}
  });
  await button(f.page, 'current').click();
  await state(f.page, 'loading');
  await f.page.waitForFunction(() => document.querySelector('.rle-panel').getAttribute('aria-busy') === 'true');
  await f.page.evaluate(() => { exportHandle.destroy(); document.getElementById('root').replaceChildren(); });
  release();
  await f.page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(await f.page.evaluate(() => downloads.length), 0);
  assert.deepEqual(f.errors, []);
});

test('刷新与返回后重新挂载可继续使用，无残留单飞锁', async t => {
  const f = await fixture(t);
  await button(f.page, 'current').click();
  await state(f.page, 'success');
  await f.page.reload({ waitUntil: 'load' });
  await button(f.page, 'current').click();
  await state(f.page, 'success');
  await f.page.goto(ORIGIN + '/again', { waitUntil: 'load' });
  await f.page.goBack({ waitUntil: 'load' });
  await button(f.page, 'batch').click();
  await f.page.locator('[data-rle-scope=rent]').waitFor();
  await button(f.page, 'selected').click();
  await state(f.page, 'success');
  assert.equal(f.requests.length, 4);
  assert.deepEqual(f.errors, []);
});

test('无法解析的响应和生成异常显示失败，不误报成功或改动原文', async t => {
  const f = await fixture(t);
  f.setReply(route => route.fulfill({ contentType: 'text/html', body: '<html>proxy error</html>' }));
  await button(f.page, 'current').click();
  await state(f.page, 'error');
  assert.match(await f.page.locator('.rle-status').innerText(), /无法解析/);
  f.setReply(route => route.fulfill({ json: { ok: true, scopes: SCOPES } }));
  await f.page.evaluate(() => { ReportLogicExport.download = async () => { throw new Error('Excel 生成失败，请检查下载组件。'); }; });
  await button(f.page, 'draft').click();
  await state(f.page, 'error');
  assert.match(await f.page.locator('.rle-status').innerText(), /Excel 生成失败/);
  assert.equal(await f.page.locator('#editor').inputValue(), '尚未保存的原文');
  assert.equal(await button(f.page, 'draft').isDisabled(), false);
});

test('实际后台编辑器联动：场景切换、最新发布下载和未发布输入相互独立', async t => {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1080 } });
  t.after(() => context.close());
  const adminSource = fs.readFileSync(path.join(__dirname, '../report-logic-admin.js'), 'utf8');
  const calls = [], errors = [];
  const gaibao = { projectType: 'gaibao', version: 4, data: { globalRequirements: { housing_conversion: '正式住房全篇要求', commercial_renovation: '正式商业全篇要求' }, rules: [{ id: 'shared-1', chapter: '第一章 项目总论', section: '1.1 项目概况', writingLogic: '正式通用业务逻辑', scenarios: ['housing_conversion', 'commercial_renovation'], scenarioVariants: { housing_conversion: { writingLogic: '正式住房业务逻辑' }, commercial_renovation: { writingLogic: '正式商业业务逻辑' } } }] } };
  const rent = { projectType: 'rent', version: 2, data: { globalRequirements: { rent: '正式出租全篇要求' }, rules: [{ id: 'rent-1', chapter: '第一章 项目总论', section: '1.1 项目概况', writingLogic: '正式出租业务逻辑' }] } };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      calls.push({ path: url.pathname, method: route.request().method() });
      if (url.pathname === '/api/reportlogic') { await route.fulfill({ json: { ok: true, set: url.searchParams.get('projectType') === 'gaibao' ? gaibao : rent } }); return; }
      if (url.pathname === '/api/reportlogicexport') { await route.fulfill({ json: { ok: true, scopes: SCOPES, sets: [rent, gaibao] } }); return; }
      await route.fulfill({ status: 500, json: { ok: false } }); return;
    }
    if (url.pathname === '/report-logic-admin.js') { await route.fulfill({ contentType: 'application/javascript', body: adminSource }); return; }
    if (url.pathname === '/report-logic-export-ui.js') { await route.fulfill({ contentType: 'application/javascript', body: SOURCE }); return; }
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:30px;--line:#d8e3ed;--soft:#536576;--bp:#286296;--bp-deep:#194c76}.btn{border:1px solid #abc5df;background:white;padding:9px 12px;border-radius:6px;cursor:pointer}textarea,input{padding:8px}.rla-rule{background:white}</style><div id="listBox"></div><div id="editBox"></div><script>window.authHeaders=()=>({Authorization:"Bearer synthetic-admin-test"});window.unlockStdEdit=next=>next();window.downloads=[];window.ReportLogicExport={scopes:s=>s.scopes,download:async(s,k,o)=>downloads.push({snapshot:s,keys:k,options:o})};</script><script src="/report-logic-export-ui.js"></script><script src="/report-logic-admin.js"></script><script>renderReportLogicAdminTab("gaibao");</script>' });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(ORIGIN, { waitUntil: 'load' });
  await page.locator('#rlaExportPanel').waitFor();
  assert.equal(await button(page, 'draft').isVisible(), false);
  await page.locator('#rlaUnlock').click();
  await page.locator('#rlaGlobalRequirements').fill('本次编辑的全篇要求，尚未发布');
  await page.locator('.rla-editor summary').click();
  await page.locator('[data-rla-field=writingLogic]').fill('本次编辑的小节逻辑，尚未发布');
  await button(page, 'current').click();
  await state(page, 'success');
  let outputs = await page.evaluate(() => downloads);
  assert.equal(outputs[0].snapshot.sets[1].data.globalRequirements.housing_conversion, '正式住房全篇要求');
  assert.deepEqual(outputs[0].keys, ['housing_conversion']);
  assert.deepEqual(outputs[0].options, {});
  assert.equal(await page.locator('[data-rla-field=writingLogic]').inputValue(), '本次编辑的小节逻辑，尚未发布');
  await button(page, 'draft').click();
  await page.waitForFunction(() => downloads.length === 2);
  outputs = await page.evaluate(() => downloads);
  assert.equal(outputs[1].options.draft.set.data.globalRequirements.housing_conversion, '本次编辑的全篇要求，尚未发布');
  assert.equal(outputs[1].options.draft.set.data.rules[0].scenarioVariants.housing_conversion.writingLogic, '本次编辑的小节逻辑，尚未发布');
  assert.equal(outputs[1].options.draft.set.data.rules[0].scenarioVariants.commercial_renovation.writingLogic, '正式商业业务逻辑');
  await page.locator('#rlaCancel').click();
  await page.locator('[data-rla-scenario=commercial_renovation]').click();
  await button(page, 'current').click();
  await page.waitForFunction(() => downloads.length === 3);
  assert.deepEqual(await page.evaluate(() => downloads[2].keys), ['commercial_renovation']);
  await page.locator('[data-rla-type=rent]').click();
  await page.locator('#rlaBody').filter({ hasText: '正式出租业务逻辑' }).waitFor();
  await button(page, 'batch').click();
  await page.locator('[data-rle-scope=rent]').waitFor();
  await button(page, 'all').click();
  const shots = path.join(__dirname, '../outputs/1019-report-logic-export/ui');
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, 'logic-export-admin.png'), fullPage: true });
  assert.equal(calls.every(call => call.method === 'GET'), true);
  assert.deepEqual(errors, []);
});
