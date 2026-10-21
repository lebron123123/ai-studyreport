'use strict';
require('../scripts/windows-browser-lockout-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const JSZip = require('../local-server/node_modules/jszip');

// Serve the real application, without starting the production API or using a
// personal browser profile. Every API request is fulfilled inside this context.
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'outputs/report-import/1014-ui');
const USER = '[系统测试]原稿导航';
const RESEARCH = 'test_report_import_research';
const RUN = 'test_report_import_run';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const READ_POSTS = new Set(['/api/webresearch:listEvidence', '/api/webresearch:listRequirementRefinements', '/api/reportlogic:adminCapability']);
let server, origin, browser, sourceBytes;

test.before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (_) { res.writeHead(400).end(); return; }
    if (pathname.startsWith('/api/')) { res.writeHead(503).end('API must be intercepted'); return; }
    const target = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(target, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一章 项目总论</w:t></w:r></w:p><w:p><w:r><w:t>导航合成原文：租金 42.44 元，出租率 85%。</w:t></w:r></w:p></w:body></w:document>');
  sourceBytes = await zip.generateAsync({ type: 'nodebuffer' });
});
test.after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function isolatedApp(t, suffix = '/') {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, viewport: { width: 1680, height: 1000 } });
  t.after(() => context.close());
  await context.addInitScript(({ user }) => {
    localStorage.setItem('fs_user', user);
    localStorage.setItem('fs_token', 'synthetic-report-import-navigation-token');
  }, { user: USER });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], consoleErrors = [], calls = [], external = [], served = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) {
      external.push(url.href);
      // Do not issue a real external request, including CDN and AI services.
      await route.fulfill({ status: 204, body: '' }); return;
    }
    if (!url.pathname.startsWith('/api/')) { served.push(url.pathname); await route.continue(); return; }
    let input = {};
    try { input = request.postDataJSON() || {}; } catch (_) {}
    const call = { path: url.pathname, method: request.method(), action: input.action || url.searchParams.get('action') || '' };
    calls.push(call);
    let body;
    if (url.pathname === '/api/outlines') body = { ok: true, list: [] };
    else if (url.pathname === '/api/calcconfig') body = { ok: true, config: {} };
    else if (url.pathname === '/api/aireport' && request.method() === 'GET') body = { ok: true, state: null };
    else if (url.pathname === '/api/webresearch' && call.action === 'listEvidence') body = { ok: true, evidence: [] };
    else if (url.pathname === '/api/webresearch' && call.action === 'listRequirementRefinements') body = { ok: true, refinements: {} };
    else if (url.pathname === '/api/reportlogic' && call.action === 'adminCapability') body = { ok: true, isAdmin: false };
    else if (url.pathname === '/api/research' && request.method() === 'GET' && !call.action) body = {
      ok: true, userId: 9001014,
      study: { researchId: RESEARCH, title: '[系统测试]研究导航', status: 'active', role: 'owner', visibility: 'private', version: 1 },
      run: { researchId: RESEARCH, runId: RUN, ordinal: 1, status: 'active', version: 1, epoch: 1, state: {} }
    };
    else body = { ok: false, error: '此隔离导航测试禁止调用未列明的接口' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin + suffix, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('userBar') && typeof window.ReportImportUI?.mount === 'function');
  return { context, page, errors, consoleErrors, calls, external, served };
}
async function importReady(page) {
  await page.locator('#reportImportRoot #riMain, #reportImportRoot .ri-document').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#reportImportRoot [aria-busy="true"]'));
}
async function home(page) {
  await page.locator('#tocList .toc-item').filter({ hasText: '返回首页' }).click();
  await page.locator('[data-home="homeReportImport"]').waitFor();
  assert.equal(new URL(page.url()).hash, '');
}
function assertIsolatedClean(app) {
  assert.deepEqual(app.errors, [], 'real application JavaScript errors');
  assert.deepEqual(app.consoleErrors, [], 'real application console errors');
  const allowed = new Set(['/api/outlines', '/api/calcconfig', '/api/aireport', '/api/research']);
  assert.deepEqual(app.calls.filter(call => !(call.method === 'GET' && allowed.has(call.path)) && !(call.method === 'POST' && READ_POSTS.has(call.path + ':' + call.action))), [], 'no mutation, AI generation, extraction or retry requests');
  assert.ok(app.served.includes('/index.html') || app.served.includes('/'), 'real index was served');
  for (const file of ['/app.js', '/ui-route-state.js', '/report-import-core.js', '/report-import-store.js', '/report-import-ui.js', '/report-import.css']) assert.ok(app.served.includes(file), file + ' must be loaded by the actual index');
}

test('full application home entry imports an independent draft, re-enters and restores on refresh', async t => {
  const app = await isolatedApp(t), { page } = app;
  for (const id of ['homeAiReport', 'homeCalc', 'homeReview', 'homeReportImport']) assert.equal(await page.locator('[data-home="' + id + '"]').isVisible(), true);
  await page.locator('[data-home="homeReportImport"]').click();
  await importReady(page);
  assert.equal(new URL(page.url()).hash, '#reportimport');
  assert.match(await page.locator('#reportImportRoot').innerText(), /主报告/);
  assert.equal(await page.locator('#sheet > #reportImportRoot').count(), 1);
  await page.screenshot({ path: path.join(SHOTS, 'full-app-empty.png'), fullPage: true });
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]导航原稿.docx', mimeType: DOCX, buffer: sourceBytes });
  await page.locator('[data-ri-action="import"]').click();
  await page.locator('[data-ri-action="confirm"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('#reportImportRoot [aria-busy="true"]'));
  await page.locator('[data-ri-action="confirm"]').click();
  await page.locator('.ri-document').waitFor();
  assert.match(await page.locator('.ri-document').innerText(), /租金 42\.44 元，出租率 85%/);
  await home(page);
  await page.locator('[data-home="homeReportImport"]').click();
  await page.locator('.ri-document').waitFor();
  assert.match(await page.locator('.ri-document').innerText(), /导航合成原文/);
  await page.reload({ waitUntil: 'load' });
  await page.locator('#reportImportRoot .ri-document').waitFor();
  assert.equal(new URL(page.url()).hash, '#reportimport');
  assert.match(await page.locator('.ri-document').innerText(), /租金 42\.44 元，出租率 85%/);
  assert.equal(await page.evaluate(() => currentProjectId), null);
  assertIsolatedClean(app);
});

test('AI workspace gets only the new import shortcut; existing home AI, finance and review entries remain usable', async t => {
  const app = await isolatedApp(t), { page } = app;
  await page.locator('[data-home="homeAiReport"]').click();
  await page.locator('#airInput').waitFor();
  assert.equal(new URL(page.url()).hash, '#aireport');
  assert.equal(await page.locator('#tocList [data-report-import]').count(), 1);
  assert.equal(await page.locator('#tocList [data-home="homeCalc"], #tocList [data-home="homeReview"]').count(), 0);
  await page.locator('#tocList [data-report-import]').click();
  await importReady(page);
  await home(page);
  await page.locator('[data-home="homeCalc"]').click();
  await page.waitForFunction(() => appMode === 'calc');
  assert.match(await page.locator('#sheet').innerText(), /测算/);
  assert.equal(new URL(page.url()).hash, '#calc');
  await home(page);
  await page.locator('[data-home="homeReview"]').click();
  await page.waitForFunction(() => appMode === 'review');
  assert.match(await page.locator('#sheet').innerText(), /上传|审查/);
  assert.equal(new URL(page.url()).hash, '#review');
  assertIsolatedClean(app);
});

test('research URL refresh retains reportimport while ordinary research still opens AI workspace', async t => {
  const app = await isolatedApp(t, '/?research=' + RESEARCH + '&run=' + RUN + '#reportimport'), { page } = app;
  await importReady(page);
  assert.equal(new URL(page.url()).hash, '#reportimport');
  assert.equal(await page.evaluate(() => ResearchUI.current().run.runId), RUN);
  assert.equal(await page.evaluate(() => ResearchUI.editable()), true);
  await page.reload({ waitUntil: 'load' });
  await importReady(page);
  assert.equal(new URL(page.url()).hash, '#reportimport');
  assert.equal(new URL(page.url()).searchParams.get('research'), RESEARCH);
  assertIsolatedClean(app);
  const ordinary = await isolatedApp(t, '/?research=' + RESEARCH + '&run=' + RUN);
  await ordinary.page.locator('#airInput').waitFor();
  assert.equal(new URL(ordinary.page.url()).hash, '#aireport');
  assert.equal(await ordinary.page.locator('#reportImportRoot').count(), 0);
  assertIsolatedClean(ordinary);
});
