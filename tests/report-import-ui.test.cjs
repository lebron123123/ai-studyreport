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
const SHOTS = path.join(ROOT, 'outputs/report-import', 'ui-' + new Date().toISOString().replace(/[:.]/g, '-'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const esc = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const run = text => '<w:r><w:t>' + esc(text) + '</w:t></w:r>';
const para = text => '<w:p>' + run(text) + '</w:p>';
const cell = (text, props = '') => '<w:tc>' + props + para(text) + '</w:tc>';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
let server, origin, browser, mainBytes, specialBytes;

async function docx(body, withImage = false) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<w:document xmlns:w="' + W + '" xmlns:r="' + R + '" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' + body + '</w:body></w:document>');
  if (withImage) {
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
    const target = path.resolve(ROOT, '.' + pathname);
    if (!target.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(target, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
  const table = '<w:tbl><w:tr>' + cell('原始测算表', '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>') + '</w:tr><w:tr>' + cell('保留租金', '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + cell('42.44 元') + '</w:tr><w:tr>' + cell('', '<w:tcPr><w:vMerge/></w:tcPr>') + cell('85%') + '</w:tr></w:tbl>';
  const image = '<w:p>' + run('原文图片') + '<w:r><w:drawing><wp:inline><wp:docPr id="1" name="原稿像素图"/><a:graphic><a:graphicData><a:blip r:embed="image1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  mainBytes = await docx(para('第一章 项目总论') + '<w:p><w:r><w:rPr><w:color w:val="FF0000"/><w:b/><w:i/></w:rPr><w:t>原文红字：出租率 85%，租金 42.44 元。</w:t></w:r></w:p>' + table + image + para('8.5 财务评价') + para('需要补标的原始小标题'), true);
  specialBytes = await docx(para('第一章 专项定位') + para('专项稿原文：租金 44 元，仅作参考，未替换主报告。'));
});
test.after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function workspace(t) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1680, height: 1000 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [], api = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.href); await route.abort(); return; }
    if (url.pathname.startsWith('/api/')) { api.push(url.pathname); await route.abort(); return; }
    await route.continue();
  });
  await page.goto(origin + '/tests/fixtures/report-import-ui-harness.html');
  await page.locator('#riMain').waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  return { context, page, errors, api, external };
}
async function waitReady(page) { await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]')); }
async function sameAccountTokenUpdate(page, token) {
  const peer = await page.context().newPage();
  try {
    await peer.goto(origin + '/tests/fixtures/report-import-ui-harness.html');
    await page.evaluate(() => {
      window.__fixtureTokenEvent = null;
      const listener = event => {
        if (event.key !== 'fs_token') return;
        window.__fixtureTokenEvent = event.newValue;
        window.removeEventListener('storage', listener);
      };
      window.addEventListener('storage', listener);
    });
    await peer.evaluate(value => localStorage.setItem('fs_token', value), token);
    await page.waitForFunction(value => window.__fixtureTokenEvent === value, token);
  } finally { await peer.close(); }
}
async function downloadBytes(page, selector) {
  const event = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await event, stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  await waitReady(page);
  return { bytes: Buffer.concat(chunks), name: download.suggestedFilename() };
}
async function oneMain(page) {
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]主报告.docx', mimeType: MIME, buffer: mainBytes });
  await page.locator('[data-ri-action="import"]').click();
  await page.locator('[data-ri-action="confirm"]').waitFor();
  await waitReady(page);
}

test('real import UI preserves originals and readings through outline correction, save, refresh and re-entry', async t => {
  const { page, errors, api, external } = await workspace(t);
  await page.screenshot({ path: path.join(SHOTS, '01-upload-empty.png'), fullPage: true });
  assert.match(await page.locator('.ri-library').innerText(), /还没有导入工作稿/);
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]主报告.docx', mimeType: MIME, buffer: mainBytes });
  const pdf = Buffer.from('%PDF-1.4\n% [系统测试] 原件字节保留\n%%EOF', 'utf8');
  await page.locator('#riExtras').setInputFiles([
    { name: '[系统测试]专项稿.docx', mimeType: MIME, buffer: specialBytes },
    { name: '[系统测试]资料.pdf', mimeType: 'application/pdf', buffer: pdf }
  ]);
  await page.locator('[data-ri-role="0"]').selectOption('special');
  await page.locator('[data-ri-role="1"]').selectOption('calculation');
  await page.screenshot({ path: path.join(SHOTS, '02-upload-selected.png'), fullPage: true });
  await page.locator('[data-ri-action="import"]').click();
  await page.locator('[data-ri-action="confirm"]').waitFor(); await waitReady(page);
  assert.equal(await page.locator('[data-ri-heading-title]').count(), 2);
  await page.locator('[data-ri-level="source-b4"]').selectOption('3');
  await page.locator('[data-ri-heading-title="source-b4"]').fill('财务评价（目录显示校正）');
  await page.locator('#riFilter').selectOption('all');
  await page.locator('[data-ri-level="source-b5"]').selectOption('2');
  await sameAccountTokenUpdate(page, '[系统测试]同账号令牌更新-目录');
  assert.equal(await page.locator('[data-ri-heading-title="source-b4"]').inputValue(), '财务评价（目录显示校正）');
  assert.equal(await page.locator('[data-ri-level="source-b4"]').inputValue(), '3');
  assert.equal(await page.locator('[data-ri-level="source-b5"]').inputValue(), '2');
  assert.equal(await page.locator('[data-ri-status]').innerText(), '有未保存修改');
  await page.screenshot({ path: path.join(SHOTS, '03-outline-corrected.png'), fullPage: true });
  await page.locator('[data-ri-action="confirm"]').click();
  await page.locator('.ri-document').waitFor(); await waitReady(page);
  assert.equal(await page.locator('[data-ri-anchor]').count(), 3);
  assert.equal(await page.locator('[data-ri-anchor="source-b4"]').innerText(), '财务评价（目录显示校正）');
  assert.equal(await page.locator('#ri-source-source-b4').innerText(), '8.5 财务评价');
  assert.match(await page.locator('.ri-document').innerText(), /出租率 85%，租金 42\.44 元/);
  await page.waitForFunction(() => {
    const image = document.querySelector('.ri-document img');
    return image && image.complete && image.naturalWidth > 0;
  });
  const render = await page.locator('.ri-document').evaluate(root => ({
    color: getComputedStyle(root.querySelector('#ri-source-source-b1 span[style]')).color,
    bold: !!root.querySelector('strong'), italic: !!root.querySelector('em'),
    colSpan: root.querySelector('table').rows[0].cells[0].colSpan,
    rowSpan: root.querySelector('table').rows[1].cells[0].rowSpan,
    img: root.querySelector('img').src.startsWith('data:image/png;base64,'),
    decodedImage: root.querySelector('img').naturalWidth > 0 && root.querySelector('img').naturalHeight > 0
  }));
  assert.deepEqual(render, { color: 'rgb(255, 0, 0)', bold: true, italic: true, colSpan: 2, rowSpan: 2, img: true, decodedImage: true });
  await page.locator('#ri-source-source-b1').click();
  assert.equal(await page.locator('#riProtected').isChecked(), true);
  await page.locator('#riProtected').uncheck();
  assert.equal(await page.locator('[data-ri-status]').innerText(), '有未保存修改');
  await sameAccountTokenUpdate(page, '[系统测试]同账号令牌更新-保护');
  assert.equal(await page.locator('#riProtected').isChecked(), false);
  assert.equal(await page.locator('[data-ri-status]').innerText(), '有未保存修改');
  await page.locator('[data-ri-action="save"]').click(); await waitReady(page);
  const savedMain = await downloadBytes(page, '[data-ri-download]');
  assert.deepEqual(savedMain.bytes, mainBytes); assert.equal(savedMain.name, '[系统测试]主报告.docx');
  await page.screenshot({ path: path.join(SHOTS, '04-original-reader.png'), fullPage: true });
  const options = await page.locator('#riFile option').evaluateAll(nodes => nodes.map(n => ({ value: n.value, text: n.textContent })));
  assert.ok(options.some(o => /专项稿 ·/.test(o.text))); assert.ok(options.some(o => /测算资料 ·/.test(o.text)));
  await page.locator('#riFile').selectOption(options.find(o => o.text.includes('专项稿.docx')).value);
  assert.match(await page.locator('.ri-document').innerText(), /租金 44 元，仅作参考/);
  assert.deepEqual((await downloadBytes(page, '[data-ri-download]')).bytes, specialBytes);
  await page.locator('#riFile').selectOption(options.find(o => o.text.includes('资料.pdf')).value);
  assert.match(await page.locator('.ri-document').innerText(), /此资料已保留原件/);
  assert.deepEqual((await downloadBytes(page, '[data-ri-download]')).bytes, pdf);
  await page.screenshot({ path: path.join(SHOTS, '05-pdf-original-only.png'), fullPage: true });
  await page.reload(); await page.locator('.ri-document').waitFor(); await waitReady(page);
  assert.equal(await page.locator('[data-ri-anchor="source-b4"]').innerText(), '财务评价（目录显示校正）');
  await page.locator('#ri-source-source-b1').click();
  assert.equal(await page.locator('#riProtected').isChecked(), false);
  assert.match(await page.locator('.ri-document').innerText(), /出租率 85%，租金 42\.44 元/);
  await page.locator('#fixtureLeave').click(); assert.equal(await page.locator('#fixtureMount').count(), 0);
  await page.locator('#fixtureEnter').click(); await page.locator('.ri-document').waitFor(); await waitReady(page);
  assert.equal(await page.locator('[data-ri-anchor]').count(), 3);
  await page.locator('[data-ri-action="library"]').click();
  assert.equal(await page.locator('[data-ri-open]').count(), 1);
  assert.match(await page.locator('[data-ri-open]').innerText(), /目录已确认 · 3 份文件/);
  await page.locator('[data-ri-open]').click(); await page.locator('.ri-document').waitFor(); await waitReady(page);
  assert.deepEqual((await downloadBytes(page, '[data-ri-download]')).bytes, mainBytes);
  await page.setViewportSize({ width: 768, height: 1000 });
  assert.equal(await page.locator('.ri-document').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(SHOTS, '07-narrow-reader.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.ri-document').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(SHOTS, '08-phone-reader.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(api, []); assert.deepEqual(external, []);
});

test('invalid main file leaves selections intact; successful retry requires user action', async t => {
  const { page, errors, api } = await workspace(t);
  await page.locator('#riExtras').setInputFiles({ name: '[系统测试]专项稿.docx', mimeType: MIME, buffer: specialBytes });
  assert.equal(await page.locator('.ri-file-selected').count(), 0);
  await page.locator('.ri-extra>span').click();
  const beforeUnload = page.waitForEvent('dialog');
  const reload = page.evaluate(() => location.reload());
  const dialog = await beforeUnload;
  assert.equal(dialog.type(), 'beforeunload');
  await dialog.dismiss();
  await reload;
  assert.match(await page.locator('.ri-extra').innerText(), /专项稿\.docx/);
  assert.equal(await page.locator('.ri-file-selected').count(), 0);
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]损坏.docx', mimeType: MIME, buffer: Buffer.from('not a docx') });
  await page.locator('[data-ri-action="import"]').click();
  await page.locator('[role="alert"]').waitFor(); await waitReady(page);
  assert.match(await page.locator('[role="alert"]').innerText(), /有效的 Word/);
  assert.match(await page.locator('.ri-file-selected').innerText(), /损坏\.docx/);
  assert.match(await page.locator('.ri-extra').innerText(), /专项稿\.docx/);
  assert.equal(await page.locator('[data-ri-open]').count(), 0);
  await page.screenshot({ path: path.join(SHOTS, '06-invalid-file-preserved.png'), fullPage: true });
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]修复后.docx', mimeType: MIME, buffer: mainBytes });
  await page.locator('[data-ri-action="import"]').click();
  await page.locator('[data-ri-action="confirm"]').waitFor(); await waitReady(page);
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(api, []);
});

test('busy import resists duplicate activation and creates one draft', async t => {
  const { page, errors, api } = await workspace(t);
  await page.addScriptTag({ path: path.join(ROOT, 'assets/vendor/jszip-3.10.1.min.js') });
  await page.evaluate(() => {
    const real = ReportImportCore;
    window.__parseCount = 0;
    const gate = new Promise(resolve => { window.__releaseImport = resolve; });
    window.ReportImportCore = { ...real, parseDocx: async (...args) => { window.__parseCount++; await gate; return real.parseDocx(...args); } };
  });
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]连续点击.docx', mimeType: MIME, buffer: mainBytes });
  await page.locator('[data-ri-action="import"]').evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => window.__parseCount === 1);
  assert.equal(await page.locator('[data-ri-action="import"]').isDisabled(), true);
  assert.equal(await page.locator('#riMain').isDisabled(), true);
  await page.locator('[data-ri-action="import"]').evaluate(button => button.click());
  await page.evaluate(() => window.__releaseImport());
  await page.locator('[data-ri-action="confirm"]').waitFor(); await waitReady(page);
  assert.equal(await page.evaluate(() => window.__parseCount), 1);
  await page.locator('[data-ri-action="library"]').click();
  assert.equal(await page.locator('[data-ri-open]').count(), 1);
  assert.deepEqual(errors, []); assert.deepEqual(api, []);
});

test('outline opens on headings, keeps text readable under full-width global controls and allows manual recovery', async t => {
  const { page, errors } = await workspace(t);
  // The application applies this broad control rule; the isolated harness must exercise the same collision.
  await page.addStyleTag({ content: 'input[type=text],input[type=number],select,textarea{width:100%}' });
  const bytes = await docx(para('') + para('') + para('第一章 项目总论') + para('待补标的目录标题'));
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]目录布局.docx', mimeType: MIME, buffer: bytes });
  await page.locator('[data-ri-action="import"]').click();
  await page.locator('#riFilter').waitFor(); await waitReady(page);
  assert.equal(await page.locator('#riFilter').inputValue(), 'headings');
  assert.equal(await page.locator('.ri-outline-row').count(), 1);
  assert.match(await page.locator('.ri-outline-row p').innerText(), /第一章 项目总论/);
  for (const width of [1680, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await page.locator('.ri-outline-row').evaluate(row => {
      const text = row.querySelector(':scope > div').getBoundingClientRect();
      const control = row.querySelector(':scope > select').getBoundingClientRect();
      return { textWidth: text.width, controlWidth: control.width, overlap: text.right > control.left, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.ok(bounds.textWidth >= 180, `readable title column at ${width}px: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.controlWidth >= 105 && bounds.controlWidth <= 120);
    assert.equal(bounds.overlap, false); assert.equal(bounds.overflow, false);
  }
  await page.locator('#riFilter').selectOption('all');
  assert.equal(await page.locator('.ri-outline-row').count(), 4, 'blank source paragraphs remain available');
  await page.locator('[data-ri-level="source-b3"]').selectOption('2');
  await page.locator('#riFilter').selectOption('headings');
  assert.equal(await page.locator('.ri-outline-row').count(), 2);
  await page.locator('[data-ri-level="source-b3"]').selectOption('0');
  assert.equal(await page.locator('.ri-outline-row').count(), 1);
  await page.locator('[data-ri-action="confirm"]').click();
  await page.locator('.ri-document').waitFor(); await waitReady(page);
  assert.equal(await page.locator('.ri-source-block').count(), 4, 'filtering never removes source blocks');
  assert.deepEqual(errors, []);
});

test('a report without detected headings can be read directly or manually marked', async t => {
  const { page, errors } = await workspace(t);
  const bytes = await docx(para('') + para('未设置标题样式的项目说明'));
  await page.locator('#riMain').setInputFiles({ name: '[系统测试]无标题.docx', mimeType: MIME, buffer: bytes });
  await page.locator('[data-ri-action="import"]').click();
  await page.locator('#riFilter').waitFor(); await waitReady(page);
  assert.match(await page.locator('.ri-outline-list').innerText(), /没有识别到标题/);
  await page.locator('[data-ri-action="confirm"]').click();
  await page.locator('.ri-document').waitFor(); await waitReady(page);
  assert.match(await page.locator('.ri-document').innerText(), /未设置标题样式的项目说明/);
  await page.locator('[data-ri-action="outline"]').click();
  await page.locator('#riFilter').selectOption('all');
  await page.locator('[data-ri-level="source-b1"]').selectOption('1');
  await page.locator('[data-ri-action="confirm"]').click();
  await page.locator('.ri-document').waitFor(); await waitReady(page);
  assert.equal(await page.locator('[data-ri-anchor="source-b1"]').innerText(), '未设置标题样式的项目说明');
  assert.deepEqual(errors, []);
});
