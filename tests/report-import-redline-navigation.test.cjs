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
const OUTPUT = path.join(ROOT, 'outputs/report-import/1015-redline-feature/browser', new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const USER = '[系统测试]通用修改标记';
const PENDING = '【待补：责任单位确认】';
const RED = '原稿已有红字：此前人工审阅意见。';
const EXISTING_INSERT = '<w:ins w:id="90" w:author="原稿审阅人" w:date="2026-09-01T00:00:00Z"><w:r><w:t>原稿已有插入修订</w:t></w:r></w:ins>';
const EXISTING_DELETE = '<w:del w:id="91" w:author="原稿审阅人" w:date="2026-09-01T00:00:00Z"><w:r><w:delText>原稿已有删除修订</w:delText></w:r></w:del>';
const CASES = [
  { key: 'housing', title: '保障性租赁住房运营报告', before: '房源运营安排保持，后续工作有待明确。', after: '房源运营安排保持，实施前明确验收责任并形成交接清单。', anchor: '运营服务应按现有安排组织。', addition: '补充运营建议：建立租户诉求登记和反馈制度。' },
  { key: 'industrial-park', title: '产业园设施更新报告', before: '园区设施维护安排保持，后续工作有待明确。', after: '园区设施维护安排保持，施工前核对现场条件并明确停工协调责任。', anchor: '设施巡查应按现有安排组织。', addition: '补充管理建议：建立设备巡检记录和维修闭环。' }
];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const paragraph = (text, props = '', runProps = '') => '<w:p>' + props + '<w:r>' + runProps + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:p>';
let server, origin, browser;

// Complete, deterministic OOXML rather than a document tailored to either user's report.
// Editable paragraphs intentionally use no character formatting: the product
// protects formatted source paragraphs from rewrite, while allowing append.
async function makeFixture(spec) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + '/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="' + R + '/styles" Target="styles.xml"/><Relationship Id="settings" Type="' + R + '/settings" Target="settings.xml"/><Relationship Id="header" Type="' + R + '/header" Target="header1.xml"/><Relationship Id="image" Type="' + R + '/image" Target="media/retained.png"/></Relationships>');
  zip.file('word/styles.xml', '<w:styles xmlns:w="' + W + '"><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style></w:styles>');
  zip.file('word/settings.xml', '<w:settings xmlns:w="' + W + '"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/></w:settings>');
  zip.file('word/header1.xml', '<w:hdr xmlns:w="' + W + '">' + paragraph('[系统测试] 通用原稿完善与修改审阅') + '</w:hdr>');
  zip.file('word/media/retained.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64'));
  const cell = text => '<w:tc><w:tcPr><w:tcW w:w="4300" w:type="dxa"/></w:tcPr>' + paragraph(text) + '</w:tc>';
  const table = '<w:tbl><w:tblPr><w:tblW w:w="8600" w:type="dxa"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => '<w:' + side + ' w:val="single" w:sz="4" w:color="8093A5"/>').join('') + '</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4300"/><w:gridCol w:w="4300"/></w:tblGrid><w:tr>' + cell('原稿表格：对象') + cell('原稿表格：保留内容') + '</w:tr><w:tr>' + cell(spec.title) + cell('未经人工确认，不更改原始事实') + '</w:tr></w:tbl>';
  const image = '<w:p><w:r><w:t>原稿示意图保持：</w:t></w:r><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="190500" cy="190500"/><wp:docPr id="1" name="原稿占位图"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="retained.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="190500" cy="190500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const body = paragraph('第一章 ' + spec.title, '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>') + paragraph(spec.before) + paragraph(RED, '', '<w:rPr><w:color w:val="C00000"/></w:rPr>') + paragraph('原稿待补事项：' + PENDING, '', '<w:rPr><w:color w:val="C00000"/></w:rPr>') + table + image + paragraph('第二章 实施安排', '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>') + paragraph(spec.anchor) + '<w:p>' + EXISTING_INSERT + EXISTING_DELETE + '</w:p><w:sectPr><w:headerReference w:type="default" r:id="header"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="' + W + '" xmlns:r="' + R + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + '</w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test.before(async () => {
  fs.mkdirSync(OUTPUT, { recursive: true });
  server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) { res.writeHead(400).end(); return; }
    if (pathname.startsWith('/api/')) { res.writeHead(503).end('API must be intercepted'); return; }
    const file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function idle(page) { await page.waitForFunction(() => !document.querySelector('#reportImportRoot [aria-busy="true"]')); }
async function current(page) { return page.evaluate(async () => { const s = ReportImportStore.create({ getOwner: getUser }); return s.load(sessionStorage.getItem('report-import:last:' + encodeURIComponent(getUser()))); }); }
async function download(page, selector) {
  const wait = page.waitForEvent('download'); await page.locator(selector).click(); const item = await wait;
  const bytes = fs.readFileSync(await item.path()); await idle(page); return { bytes, name: item.suggestedFilename() };
}
async function bodyText(locator) { return locator.evaluate(el => { const copy = el.cloneNode(true); copy.querySelectorAll('del,small').forEach(node => node.remove()); return copy.textContent.trim(); }); }

async function open(t, spec) {
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', viewport: { width: 1680, height: 1080 } }); t.after(() => context.close());
  await context.addInitScript(user => { localStorage.setItem('fs_user', user); localStorage.setItem('fs_token', 'synthetic-redline-only'); }, USER);
  const page = await context.newPage(), evidence = { realIndex: true, defaultExport: 'fixed-redline', syntheticFixture: spec.key, mockedAI: 0, actualAI: 0, productSha256: Object.fromEntries(['index.html', 'report-import-core.js', 'report-import-review.js', 'report-import-delivery.js', 'report-import-ui.js', 'report-import.css'].map(name => [name, hash(fs.readFileSync(path.join(ROOT, name)))])), api: [], unexpected: [], external: [], errors: [], consoleErrors: [], served: [] };
  page.setDefaultTimeout(20000); page.on('pageerror', e => evidence.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') evidence.consoleErrors.push(m.text()); });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { evidence.external.push(url.href); await route.fulfill({ status: 204, body: '' }); return; }
    if (!url.pathname.startsWith('/api/')) { evidence.served.push(url.pathname); await route.continue(); return; }
    let input = {}; try { input = req.postDataJSON() || {}; } catch (_) {}
    const row = { path: url.pathname, method: req.method(), action: input.action || url.searchParams.get('action') || '' }; evidence.api.push(row);
    let body;
    if (url.pathname === '/api/reportimportrequest' && req.method() === 'GET' && !url.searchParams.has('id')) body = { capabilities: { single_attempt: true, single_attempt_protocol: 1, durable_import_request_protocol: 1 } };
    else if (url.pathname === '/api/reportimportrequest' && req.method() === 'POST') {
      evidence.mockedAI++;
      const request = JSON.parse(input.generation.messages[0].content), text = request.mode === 'rewrite' ? spec.after : spec.addition + PENDING;
      body = { durable_import_request_protocol: 1, request_id: input.request_id, binding: input.binding, retry_allowed: false, status: 'completed', result: { single_attempt: true, single_attempt_protocol: 1, request_id: input.request_id, finish_reason: 'stop', content: [{ type: 'text', text: JSON.stringify({ edits: [{ blockId: request.blocks[0].blockId, afterText: text }], explanation: '固定隔离测试候选；未连接真实AI。' }) }] } };
    } else if (url.pathname === '/api/outlines' && req.method() === 'GET') body = { ok: true, list: [] };
    else if (url.pathname === '/api/calcconfig' && req.method() === 'GET') body = { ok: true, config: {} };
    else if (url.pathname === '/api/aireport' && req.method() === 'GET') body = { ok: true, state: null };
    else if (url.pathname === '/api/projects' && req.method() === 'GET') body = { ok: true, list: [] };
    else if (url.pathname === '/api/webresearch' && row.action === 'listEvidence') body = { ok: true, evidence: [] };
    else if (url.pathname === '/api/webresearch' && row.action === 'listRequirementRefinements') body = { ok: true, refinements: {} };
    else if (url.pathname === '/api/reportlogic' && row.action === 'adminCapability') body = { ok: true, isAdmin: false };
    else { evidence.unexpected.push(row); body = { ok: false, error: '隔离测试拒绝未列明接口' }; }
    await route.fulfill({ status: 200, json: body });
  });
  await page.goto(origin, { waitUntil: 'load' }); await page.locator('[data-home="homeReportImport"]').click(); await page.locator('#riMain').waitFor(); await idle(page);
  return { page, evidence };
}
async function importFile(page, bytes, title) {
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]' + title + '.docx', mimeType: MIME, buffer: bytes });
  await page.locator('[data-ri-action="import"]').click(); await page.locator('[data-ri-action="confirm"]').waitFor(); await idle(page);
  await page.locator('[data-ri-action="confirm"]').click(); await page.locator('#riReviewPanel').waitFor(); await idle(page);
}
async function candidate(page, id, mode) {
  await page.locator('#ri-source-' + id).click();
  if (mode === 'rewrite') await page.locator('#riProtected').uncheck();
  await page.locator('#riReviewMode').selectOption(mode); await page.locator('#riReviewScope').selectOption('paragraph');
  await page.locator('#riReviewInstruction').fill('完善当前段落的实施安排，保留事实和数字。');
  assert.equal(await page.locator('[data-ri-action="generate-review"]').isEnabled(), true, await page.locator('#riReviewPanel .ri-scope-summary').first().innerText());
  await page.locator('[data-ri-action="generate-review"]').click();
  await page.locator('[data-ri-action="accept-review"]').waitFor(); await idle(page);
}
async function assertPackage(page, sourceBytes, outputBytes, mode, spec) {
  const source = await JSZip.loadAsync(sourceBytes), output = await JSZip.loadAsync(outputBytes), xml = await output.file('word/document.xml').async('string');
  assert.deepEqual(Object.keys(output.files).filter(name => !output.files[name].dir).sort(), Object.keys(source.files).filter(name => !source.files[name].dir).sort());
  const allowed = new Set(mode === 'tracked' ? ['word/document.xml', 'word/settings.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml'] : ['word/document.xml']);
  for (const file of Object.keys(source.files).filter(name => !source.files[name].dir && !allowed.has(name))) assert.deepEqual(await output.file(file).async('uint8array'), await source.file(file).async('uint8array'), file + ' unchanged');
  assert.ok(xml.includes(EXISTING_INSERT)); assert.ok(xml.includes(EXISTING_DELETE));
  const facts = await page.evaluate(({ xml, source, W, mode, before, after }) => {
    const parse = value => new DOMParser().parseFromString(value, 'application/xml'), doc = parse(xml), original = parse(source), serial = new XMLSerializer();
    const descendants = name => Array.from(doc.getElementsByTagNameNS(W, name));
    const properties = run => ({ color: run.getElementsByTagNameNS(W, 'color')[0]?.getAttributeNS(W, 'val') || '', underline: run.getElementsByTagNameNS(W, 'u')[0]?.getAttributeNS(W, 'val') || '', strike: run.getElementsByTagNameNS(W, 'strike')[0]?.getAttributeNS(W, 'val') || '' });
    const plainRuns = descendants('r').filter(node => node.parentElement.localName === 'p').map(node => ({ text: Array.from(node.getElementsByTagNameNS(W, 't'), part => part.textContent).join(''), deletedText: node.getElementsByTagNameNS(W, 'delText').length, ...properties(node) }));
    const accepted = doc.cloneNode(true); Array.from(accepted.getElementsByTagNameNS(W, 'del')).forEach(node => node.remove());
    if (mode === 'review') Array.from(accepted.getElementsByTagNameNS(W, 'r')).filter(node => properties(node).strike === '1').forEach(node => node.remove());
    const rewrite = Array.from(descendants('body')[0].children).filter(node => node.localName === 'p')[1];
    const beforeProjection = rewrite.cloneNode(true); Array.from(beforeProjection.getElementsByTagNameNS(W, 'r')).filter(node => properties(node).underline === 'single').forEach(node => node.remove());
    return {
      invalid: doc.getElementsByTagName('parsererror').length,
      tables: descendants('tbl').map(node => serial.serializeToString(node)),
      originalTables: Array.from(original.getElementsByTagNameNS(W, 'tbl'), node => serial.serializeToString(node)),
      newInsertions: descendants('ins').filter(node => node.getAttributeNS(W, 'author') !== '原稿审阅人').map(node => node.textContent),
      newDeletions: descendants('del').filter(node => node.getAttributeNS(W, 'author') !== '原稿审阅人').map(node => node.textContent),
      revisionIds: Array.from(doc.getElementsByTagName('*')).filter(node => node.hasAttributeNS(W, 'id')).map(node => node.getAttributeNS(W, 'id')),
      accepted: Array.from(accepted.getElementsByTagNameNS(W, 't'), node => node.textContent).join(''),
      beforeProjection: Array.from(beforeProjection.getElementsByTagNameNS(W, 't'), node => node.textContent).join(''),
      plainRuns,
      redRuns: descendants('r').filter(node => /^(?:FF0000|C00000)$/i.test(properties(node).color)).map(node => node.textContent),
      expected: ReportImportReview.diff(before, after)
    };
  }, { xml, source: await source.file('word/document.xml').async('string'), W, mode, before: spec.before, after: spec.after });
  assert.equal(facts.invalid, 0); assert.deepEqual(facts.tables, facts.originalTables); assert.ok(facts.accepted.includes(spec.after)); assert.ok(facts.accepted.includes(spec.addition + PENDING)); assert.ok(!facts.accepted.includes(spec.before));
  assert.ok(facts.redRuns.some(text => text.includes(RED))); assert.ok(facts.redRuns.join('').includes(PENDING));
  const inserted = facts.plainRuns.filter(run => run.underline === 'single'), deleted = facts.plainRuns.filter(run => run.strike === '1');
  if (mode !== 'tracked') { assert.deepEqual(facts.newInsertions, []); assert.deepEqual(facts.newDeletions, []); }
  if (mode === 'clean') { assert.deepEqual(inserted, []); assert.deepEqual(deleted, []); }
  else if (mode === 'review') {
    assert.equal(inserted.map(run => run.text).join(''), facts.expected.filter(part => part.type === 'insert').map(part => part.text).join('') + spec.addition + PENDING);
    assert.equal(deleted.map(run => run.text).join(''), facts.expected.filter(part => part.type === 'delete').map(part => part.text).join(''));
    for (const run of [...inserted, ...deleted]) { assert.equal(run.color, 'FF0000'); assert.equal(run.deletedText, 0, 'fixed redline uses ordinary text'); }
    assert.equal(facts.beforeProjection, spec.before, 'removing only redlined insertion runs reconstructs the uploaded paragraph');
  } else { assert.ok(facts.newInsertions.length >= 2); assert.ok(facts.newDeletions.length >= 1); assert.ok(facts.newInsertions.join('').includes(spec.addition)); assert.equal(new Set(facts.revisionIds).size, facts.revisionIds.length, 'new native revision IDs cannot collide with original revisions'); }
  return { mode, bytes: outputBytes.length, sha256: hash(outputBytes), newInsertions: facts.newInsertions.length, newDeletions: facts.newDeletions.length, redUnderlineRuns: inserted.length, redStrikeRuns: deleted.length, tables: facts.tables.length };
}

for (const spec of CASES) test('real index supports fixed redline, clean and tracked export for ' + spec.key + ' without actual AI', async t => {
  const folder = path.join(OUTPUT, spec.key); fs.mkdirSync(folder);
  const bytes = await makeFixture(spec); fs.writeFileSync(path.join(folder, 'original.docx'), bytes, { flag: 'wx' });
  const { page, evidence } = await open(t, spec); await importFile(page, bytes, spec.title);
  const baseline = await current(page); assert.equal(baseline.files[0].parsed.stats.tables, 1); assert.equal(baseline.files[0].parsed.stats.images, 1);
  assert.equal(evidence.mockedAI, 0);
  await candidate(page, 'source-b1', 'rewrite');
  const pending = await download(page, '[data-ri-action="export-word"]'); assert.equal(hash(pending.bytes), hash(bytes), 'unaccepted candidate must not change the original');
  await page.locator('[data-ri-action="accept-review"]').click(); await idle(page); assert.equal((await current(page)).reviewState.requests.at(-1).status, 'accepted');
  await candidate(page, 'source-b7', 'append'); await page.locator('[data-ri-action="accept-review"]').click(); await idle(page);
  assert.equal(evidence.mockedAI, 2); assert.equal(await page.locator('#riReviewView').inputValue(), 'working');
  const rewrite = page.locator('[data-ri-content="source-b1"]'), append = page.locator('[data-ri-content="source-b7"]');
  assert.ok(await rewrite.locator('ins').count()); assert.ok(await rewrite.locator('del').count()); assert.equal(await bodyText(rewrite), spec.after);
  assert.ok(await append.locator('ins').count()); assert.ok((await bodyText(append)).includes(spec.addition + PENDING));
  const colors = await rewrite.locator('ins,del').evaluateAll(nodes => nodes.map(node => ({ color: getComputedStyle(node).color, decoration: getComputedStyle(node).textDecorationLine, tag: node.tagName })));
  for (const item of colors) { assert.match(item.color, /^rgb\((?:192|198|208|211|220|239|255),\s*(?:0|24|34|38|39|47|68),\s*(?:0|24|34|38|39|47|68)\)$/); assert.ok(item.decoration.includes(item.tag === 'INS' ? 'underline' : 'line-through')); }
  assert.equal(await page.locator('[data-ri-content="source-b2"] ins').count(), 0, 'pre-existing red words are not a new insertion');
  const originalRed = await page.locator('[data-ri-content="source-b2"] span').first().evaluate(node => ({ color: getComputedStyle(node).color, decoration: getComputedStyle(node).textDecorationLine }));
  assert.equal(originalRed.color, 'rgb(192, 0, 0)'); assert.equal(originalRed.decoration, 'none');
  assert.ok(await page.locator('[data-ri-content="source-b3"] .ri-pending-marker').count(), 'pending evidence is visually separate');
  assert.ok(await page.locator('[data-ri-change-summary]').count());
  await page.locator('.ri-document-bar').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(folder, '01-review-view.png') });
  await page.locator('.ri-document').screenshot({ path: path.join(folder, '01-review-content.png') });
  await page.locator('#riReviewView').selectOption('clean');
  assert.equal(await rewrite.locator('ins,del').count(), 0); assert.equal(await rewrite.innerText(), spec.after); assert.ok((await append.innerText()).includes(spec.addition + PENDING));
  assert.ok(await append.locator('.ri-pending-marker').count()); await page.screenshot({ path: path.join(folder, '02-clean-view.png') });
  await page.locator('.ri-document').screenshot({ path: path.join(folder, '02-clean-content.png') });
  await page.locator('#riReviewView').selectOption('original'); assert.equal(await rewrite.innerText(), spec.before); assert.equal(await append.innerText(), spec.anchor); assert.equal(await rewrite.locator('ins,del').count(), 0);
  await page.locator('.ri-document').screenshot({ path: path.join(folder, '03-original-content.png') });
  const original = await download(page, '[data-ri-download]'); assert.equal(hash(original.bytes), hash(bytes));
  await page.locator('#riReviewView').selectOption('working');
  const review = await download(page, '[data-ri-action="export-word"]'), clean = await download(page, '[data-ri-action="export-clean"]');
  assert.equal(await page.locator('details.ri-tracked-export').evaluate(node => node.open), false);
  await page.locator('details.ri-tracked-export > summary').click();
  const tracked = await download(page, '[data-ri-action="export-tracked"]');
  assert.match(review.name, /标红对照版\.docx$/); assert.match(clean.name, /当前工作稿\.docx$/); assert.match(tracked.name, /Word修订版\.docx$/);
  fs.writeFileSync(path.join(folder, 'review.docx'), review.bytes, { flag: 'wx' }); fs.writeFileSync(path.join(folder, 'clean.docx'), clean.bytes, { flag: 'wx' });
  fs.writeFileSync(path.join(folder, 'tracked.docx'), tracked.bytes, { flag: 'wx' });
  evidence.review = await assertPackage(page, bytes, review.bytes, 'review', spec); evidence.clean = await assertPackage(page, bytes, clean.bytes, 'clean', spec); evidence.tracked = await assertPackage(page, bytes, tracked.bytes, 'tracked', spec);
  const adopted = await current(page); assert.deepEqual(adopted.files, baseline.files);
  await page.reload({ waitUntil: 'load' }); await page.locator('#riReviewPanel').waitFor(); await idle(page); assert.equal((await current(page)).id, adopted.id); assert.equal(await bodyText(rewrite), spec.after);
  await page.locator('#tocList .toc-item').filter({ hasText: '返回首页' }).click(); await page.locator('[data-home="homeReportImport"]').click(); await page.locator('#riReviewPanel').waitFor(); await idle(page);
  assert.equal(await bodyText(rewrite), spec.after); assert.ok((await bodyText(append)).includes(spec.addition)); assert.equal(evidence.mockedAI, 2);
  await page.locator('[data-ri-action="undo-review"]').click(); await idle(page); assert.equal(await append.innerText(), spec.anchor); assert.equal(await bodyText(rewrite), spec.after);
  await page.locator('[data-ri-action="undo-review"]').click(); await idle(page); assert.equal(await rewrite.innerText(), spec.before);
  const undone = await download(page, '[data-ri-action="export-word"]'); assert.equal(hash(undone.bytes), hash(bytes));
  assert.equal(evidence.mockedAI, 2); assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.consoleErrors, []); assert.deepEqual(evidence.unexpected, []);
  assert.ok(evidence.served.includes('/')); for (const module of ['/app.js', '/report-import-ui.js', '/report-import-delivery.js']) assert.ok(evidence.served.includes(module));
  assert.equal(await page.evaluate(() => currentProjectId), null);
  evidence.sourceHash = hash(bytes); evidence.originalUntouched = true; evidence.finalStatuses = (await current(page)).reviewState.requests.map(request => request.status); evidence.passed = true;
  fs.writeFileSync(path.join(folder, 'evidence.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' }); console.log('Redline actual-index evidence:', folder);
});
