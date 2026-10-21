'use strict';
require('../scripts/windows-browser-lockout-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');
const XLSX = require('../xlsx.full.min.js');
const JSZip = require('../local-server/node_modules/jszip');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['report-logic-admin.js', 'report-logic-export-ui.js', 'report-logic-export.js', 'report-writing-policy.js', 'report-writing-standard.js', 'xlsx.full.min.js', 'assets/vendor/jszip-3.10.1.min.js'];
const clone = value => JSON.parse(JSON.stringify(value));

test('隔离HTTP真实鉴权与SQLite快照到浏览器Excel下载：正式版、编辑稿、批量最新版', async t => {
  const { onRequestGet } = await import('../functions/api/reportlogicexport.js');
  const { signToken } = await import('../functions/api/_auth.js');
  const connection = new DatabaseSync(':memory:');
  const calls = [], sqlCalls = [], errors = [], consoleErrors = [];
  const USER = '[系统测试]逻辑导出浏览器';
  const env = { SESSION_SECRET: 'synthetic-export-browser-secret-only', ADMIN_USERS: USER, DB: { prepare(sql) {
    sqlCalls.push(sql);
    assert.match(sql, /^\s*(SELECT|WITH)\b/i, 'download must remain SQL read-only');
    const statement = connection.prepare(sql);
    let params = [];
    return { bind(...values) { params = values; return this; }, async first() { return statement.get(...params) || null; }, async all() { return { results: statement.all(...params) }; }, async run() { assert.fail('Export attempted to mutate SQLite'); } };
  } } };
  connection.exec('CREATE TABLE account_security(user_id INTEGER PRIMARY KEY,disabled INTEGER,revoked_before INTEGER,updated_at INTEGER); CREATE TABLE report_logic_sets(id TEXT PRIMARY KEY,project_type TEXT,name TEXT,version INTEGER,status TEXT,data TEXT,source_name TEXT,created_at INTEGER,created_by TEXT,published_at INTEGER)');
  const rent = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/report-logic-rent-v1.json'), 'utf8'));
  const gaibao = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/report-logic-gaibao-v1.json'), 'utf8'));
  function add(type, version, data, status = 'published') {
    connection.prepare('INSERT INTO report_logic_sets VALUES(?,?,?,?,?,?,?,?,?,?)').run(type + '-' + version, type, data.name, version, status, JSON.stringify(data), data.source.fileName, 1000 + version, USER, 2000 + version);
  }
  const old = clone(gaibao);
  old.globalRequirements.housing_conversion = '上一真实发布版的全篇要求';
  add('rent', 1, rent);
  add('gaibao', 1, old, 'archived');
  add('gaibao', 2, gaibao);
  const token = await signToken({ SESSION_SECRET: env.SESSION_SECRET }, 101901, USER);
  const sources = Object.fromEntries(FILES.map(file => ['/' + file, fs.readFileSync(path.join(ROOT, file))]));
  let origin, adminReloadGate = null;
  const html = '<!doctype html><meta charset="utf-8"><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:30px;--line:#d8e3ed;--soft:#536576;--bp:#286296;--bp-deep:#194c76}.btn{border:1px solid #abc5df;background:white;padding:9px 12px;border-radius:6px;cursor:pointer}textarea,input{padding:8px}.rla-rule{background:white}</style><div id="listBox"></div><div id="editBox"></div><script>window.authHeaders=()=>({Authorization:' + JSON.stringify('Bearer ' + token) + '});window.unlockStdEdit=next=>next();</script>' + FILES.filter(file => !file.includes('xlsx') && !file.includes('jszip') && file !== 'report-logic-admin.js').map(file => '<script src="/' + file + '"></script>').join('') + '<script src="/report-logic-admin.js"></script><script>renderReportLogicAdminTab("gaibao");</script>';
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      if (url.pathname.startsWith('/api/')) {
        calls.push({ path: url.pathname, method: req.method });
        if (req.method !== 'GET') { res.writeHead(405).end('Read-only fixture'); return; }
        if (url.pathname === '/api/reportlogicexport') {
          const result = await onRequestGet({ env, request: new Request(url, { headers: req.headers }) });
          res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text()); return;
        }
        if (url.pathname === '/api/reportlogic') {
          // Only the existing admin bootstrap is a fixture; all export requests use the real handler above.
          if (adminReloadGate) await adminReloadGate;
          const row = connection.prepare("SELECT * FROM report_logic_sets WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").get(url.searchParams.get('projectType'));
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, set: { id: row.id, projectType: row.project_type, version: row.version, data: JSON.parse(row.data) } })); return;
        }
        res.writeHead(403).end('Unexpected API'); return;
      }
      if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return; }
      if (sources[url.pathname]) { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }).end(sources[url.pathname]); return; }
      res.writeHead(404).end('Not found');
    } catch (error) { errors.push(error.message); res.writeHead(500).end('Fixture failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
  let page, output, releaseAdminReload;
  t.after(async () => {
    if (releaseAdminReload) releaseAdminReload();
    if (page && output && !page.isClosed()) {
      try {
        const state = await page.evaluate(() => ({ cancelVisible: Boolean(document.querySelector('#rlaCancel')), unlockVisible: Boolean(document.querySelector('#rlaUnlock')), status: document.querySelector('.rle-status')?.textContent, statusKind: document.querySelector('.rle-status')?.dataset.state, batchHidden: document.querySelector('.rle-batch')?.hidden, scopes: Array.from(document.querySelectorAll('[data-rle-scope]'), node => node.dataset.rleScope) }));
        fs.writeFileSync(path.join(output, 'last-state.json'), JSON.stringify({ calls, pageErrors: errors, consoleErrors, state }, null, 2));
        await page.screenshot({ path: path.join(output, 'last-state.png'), fullPage: false });
      } catch (error) { fs.writeFileSync(path.join(output, 'capture-error.txt'), String(error)); }
    }
    await browser.close(); await new Promise(resolve => server.close(resolve)); connection.close();
  });
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, viewport: { width: 1500, height: 1000 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const outputRoot = path.join(ROOT, 'outputs/1019-report-logic-export/ui');
  fs.mkdirSync(outputRoot, { recursive: true });
  output = fs.mkdtempSync(path.join(outputRoot, 'download-'));
  const receipts = [];
  async function download(action, label) {
    const waiting = page.waitForEvent('download');
    await page.locator('[data-rle-action=' + action + ']').click();
    const result = await waiting;
    const target = path.join(output, label + '.xlsx');
    await result.saveAs(target);
    assert.equal(await result.failure(), null);
    const bytes = fs.readFileSync(target), book = XLSX.read(bytes, { type: 'buffer' });
    assert.deepEqual(book.SheetNames, ['版本总览', '全篇逻辑', '章节与小节逻辑', '专业成稿标准', '版本变化']);
    const zip = await JSZip.loadAsync(bytes);
    for (let i = 1; i <= 5; i++) assert.match(await zip.file('xl/worksheets/sheet' + i + '.xml').async('string'), /state="frozen"/);
    receipts.push({ label, file: target, suggestedFilename: result.suggestedFilename(), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), rows: Object.fromEntries(book.SheetNames.map(name => [name, XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1 }).length - 1])) });
    await page.locator('.rle-status[data-state=success]').waitFor();
    return book;
  }
  const cells = (book, name) => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1 });
  const dbHash = () => crypto.createHash('sha256').update(JSON.stringify(connection.prepare('SELECT * FROM report_logic_sets ORDER BY id').all())).digest('hex');
  await page.goto(origin, { waitUntil: 'load' });
  await page.locator('#rlaExportPanel').waitFor();
  const before = dbHash();
  const published = await download('current', '住房改造_已发布');
  assert.equal(cells(published, '版本总览')[1][1], '最新已发布');
  assert.equal(Number(cells(published, '版本总览')[1][3]), 2);
  assert.equal(cells(published, '章节与小节逻辑').length - 1, gaibao.rules.filter(rule => !Array.isArray(rule.scenarios) || rule.scenarios.includes('housing_conversion')).length);
  await page.locator('#rlaUnlock').click();
  await page.locator('#rlaGlobalRequirements').fill('【系统测试编辑稿】只存在编辑器中的全篇要求');
  await page.locator('.rla-editor summary').first().click();
  await page.locator('[data-rla-field=writingLogic]').first().fill('【系统测试编辑稿】只存在编辑器中的小节逻辑');
  const draft = await download('draft', '住房改造_编辑稿');
  assert.match(cells(draft, '版本总览')[1][1], /未发布、未保存/);
  assert.match(JSON.stringify(cells(draft, '全篇逻辑')), /只存在编辑器中的全篇要求/);
  assert.match(JSON.stringify(cells(draft, '章节与小节逻辑')), /只存在编辑器中的小节逻辑/);
  assert.equal(dbHash(), before, 'formal and draft exports must not mutate database');
  // Cancel reloads published logic asynchronously and then replaces the whole export panel.
  // Hold that response to exercise the hand-off; wait for the new view, not the old clickable panel.
  adminReloadGate = new Promise(resolve => { releaseAdminReload = resolve; });
  const cancelRead = page.waitForRequest(request => new URL(request.url()).pathname === '/api/reportlogic');
  const oldPanel = await page.locator('#rlaExportPanel').elementHandle();
  await page.locator('#rlaCancel').click();
  await cancelRead;
  assert.equal(await oldPanel.evaluate(node => node.isConnected), true);
  assert.equal(await page.locator('#rlaCancel').isVisible(), true);
  releaseAdminReload();
  adminReloadGate = null;
  await page.locator('#rlaCancel').waitFor({ state: 'detached' });
  await page.locator('#rlaUnlock').waitFor({ state: 'visible' });
  assert.equal(await oldPanel.evaluate(node => node.isConnected), false);
  await oldPanel.dispose();
  await page.locator('[data-rle-action=batch]').click();
  await page.locator('[data-rle-scope=rent]').waitFor();
  await page.locator('[data-rle-action=all]').click();
  const newest = clone(gaibao);
  newest.globalRequirements.housing_conversion += '\n【系统测试新发布】打开选择后新增的服务器要求';
  connection.prepare("UPDATE report_logic_sets SET status='archived' WHERE id='gaibao-2'").run();
  add('gaibao', 3, newest);
  const afterSetup = dbHash();
  const batch = await download('selected', '三类型_点击时最新发布');
  assert.equal(cells(batch, '版本总览').length, 4);
  assert.match(JSON.stringify(cells(batch, '全篇逻辑')), /打开选择后新增的服务器要求/);
  assert.match(JSON.stringify(cells(batch, '版本变化')), /打开选择后新增的服务器要求/);
  assert.equal(dbHash(), afterSetup);
  assert.equal(calls.every(call => call.method === 'GET'), true);
  assert.deepEqual(new Set(calls.map(call => call.path)), new Set(['/api/reportlogic', '/api/reportlogicexport']));
  assert.equal(calls.filter(call => call.path === '/api/reportlogicexport').length, 4);
  assert.equal(sqlCalls.every(sql => /^\s*(SELECT|WITH)\b/i.test(sql)), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  await page.screenshot({ path: path.join(output, 'admin-real-download.png'), fullPage: false });
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ status: 'passed', identity: USER, isolatedSQLite: true, productionServerUsed: false, existingAdminBootstrap: 'fixture', exportApi: 'real onRequestGet + verifyAuth + SQLite SQL', calls, sqlReadOnly: true, pageErrors: errors, consoleErrors, downloads: receipts }, null, 2));
});
