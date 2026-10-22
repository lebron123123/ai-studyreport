'use strict';
require('../scripts/windows-browser-lockout-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const JSZip = require('../local-server/node_modules/jszip');
const { chromium } = require('playwright');
const core = require('../report-import-core.js');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const run = text => '<w:r><w:t xml:space="preserve">' + core.escapeHtml(text) + '</w:t></w:r>';
const para = (text, properties = '') => '<w:p>' + properties + run(text) + '</w:p>';
const cell = (text, properties = '') => '<w:tc>' + properties + para(text) + '</w:tc>';
let browser;
test.before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
});
test.after(async () => { await browser?.close(); });

async function fixture(body, entries = {}, compression = 'DEFLATE') {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<w:document xmlns:w="' + W + '" xmlns:r="' + R + '" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' + body + '</w:body></w:document>');
  for (const [name, data] of Object.entries(entries)) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer', compression });
}
async function pageFor(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('**/*', route => route.abort());
  await page.addScriptTag({ path: path.resolve(__dirname, '../local-server/node_modules/jszip/dist/jszip.min.js') });
  await page.addScriptTag({ path: path.resolve(__dirname, '../report-import-core.js') });
  return page;
}
async function parse(page, buffer, fileName = '[系统测试]原稿.docx', asFile = false) {
  return page.evaluate(async ({ data, fileName, asFile }) => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const input = asFile ? new File([bytes], fileName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) : bytes.buffer;
    return ReportImportCore.parseDocx(input, { fileName });
  }, { data: buffer.toString('base64'), fileName, asFile });
}

test('imports full long body without the old 80,000 character slice; stable original block ids', async t => {
  const page = await pageFor(t), original = '保留原文及数值 42.44 元。'.repeat(6500);
  const bytes = await fixture(para('第一章 项目总论') + para('8.5 财务评价') + para(original));
  const imported = await parse(page, bytes, undefined, true), repeated = await parse(page, bytes);
  assert.equal(imported.blocks[2].text, original);
  assert.ok(imported.plainText.length > 80000);
  assert.equal(imported.stats.characters, imported.plainText.length);
  assert.deepEqual(imported.blocks.map(b => b.id), repeated.blocks.map(b => b.id));
  assert.deepEqual(imported.outline.map(h => [h.level, h.title, h.confidence]), [[1, '第一章 项目总论', 'suggested'], [2, '8.5 财务评价', 'suggested']]);
  assert.equal(imported.stats.sourceBytes, bytes.length);
});

test('retains run formatting and escaped literal markup and inherits heading styles', async t => {
  const page = await pageFor(t);
  const styles = '<w:styles xmlns:w="' + W + '"><w:style w:styleId="HeadingBase"><w:name w:val="Heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="C00000"/></w:rPr></w:style><w:style w:styleId="Custom"><w:basedOn w:val="HeadingBase"/><w:name w:val="自定义标题"/></w:style></w:styles>';
  const body = para('2.1 既有项目', '<w:pPr><w:pStyle w:val="Custom"/></w:pPr>')
    + '<w:p><w:r><w:rPr><w:b/><w:i/><w:u w:val="single"/><w:color w:val="FF0000"/></w:rPr><w:t>&lt;img src=x onerror=alert(1)&gt;原文红字</w:t><w:tab/><w:t>数字 85%</w:t><w:br/><w:t>下一行</w:t></w:r></w:p>';
  const imported = await parse(page, await fixture(body, { 'word/styles.xml': styles }));
  assert.equal(imported.outline[0].level, 2);
  assert.equal(imported.outline[0].source, 'word-outline');
  assert.match(imported.blocks[0].html, /color:#C00000/);
  const rendered = await page.evaluate(html => { document.body.innerHTML = html; const p = document.querySelector('p'); return { text: p.textContent, imgs: document.querySelectorAll('img').length, color: getComputedStyle(p.querySelector('span')).color, bold: !!p.querySelector('strong'), italic: !!p.querySelector('em') }; }, imported.blocks.map(b => b.html).join(''));
  assert.equal(rendered.imgs, 0); assert.equal(rendered.color, 'rgb(255, 0, 0)');
  assert.equal(rendered.bold, true); assert.equal(rendered.italic, true);
  assert.match(imported.blocks[1].text, /\t数字 85%\n下一行/);
});

test('preserves tables with horizontal and vertical merges plus nested table text', async t => {
  const page = await pageFor(t);
  const body = '<w:tbl><w:tr>' + cell('合并标题', '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>') + '</w:tr><w:tr>'
    + cell('跨两行', '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>') + cell('42.44') + '</w:tr><w:tr>'
    + cell('', '<w:tcPr><w:vMerge/></w:tcPr>') + '<w:tc><w:tbl><w:tr>' + cell('嵌套 90%') + '</w:tr></w:tbl></w:tc></w:tr></w:tbl>';
  const result = await parse(page, await fixture(body));
  assert.equal(result.blocks[0].type, 'table');
  assert.equal(result.blocks[0].rows[0].cells[0].colSpan, 2);
  assert.equal(result.blocks[0].rows[1].cells[0].rowSpan, 2);
  assert.equal(result.blocks[0].rows[2].cells.length, 1);
  assert.match(result.plainText, /42\.44/); assert.match(result.plainText, /嵌套 90%/);
  const rows = await page.evaluate(html => { document.body.innerHTML = html; return { span: document.querySelectorAll('table')[0].rows[0].cells[0].colSpan, nested: document.querySelectorAll('table').length }; }, result.blocks[0].html);
  assert.deepEqual(rows, { span: 2, nested: 2 });
});

test('embeds only local raster images and blocks external images and active links', async t => {
  const page = await pageFor(t);
  let requests = 0; page.on('request', () => requests++);
  const image = id => '<w:r><w:drawing><wp:inline><wp:docPr id="1" name="图片 &quot;测试&quot;"/><a:graphic><a:graphicData><a:blip r:embed="' + id + '"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="' + R + '/image" Target="media/one.png"/><Relationship Id="external" Type="' + R + '/image" Target="https://example.invalid/track.png" TargetMode="External"/><Relationship Id="link" Type="' + R + '/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>';
  const bytes = await fixture('<w:p>' + run('图片前') + image('image1') + run('图片后') + image('external') + '</w:p><w:p><w:hyperlink r:id="link">' + run('安全展示文字') + '</w:hyperlink></w:p>', { 'word/_rels/document.xml.rels': rels, 'word/media/one.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64') });
  const result = await parse(page, bytes);
  assert.equal(result.stats.images, 1);
  assert.match(result.blocks[0].html, /data:image\/png;base64,/);
  assert.ok(result.warnings.some(w => w.code === 'IMAGE_UNAVAILABLE'));
  assert.equal(result.completeness, 'needs-original-check');
  await page.evaluate(html => { document.body.innerHTML = html; }, result.blocks.map(b => b.html).join(''));
  assert.equal(await page.locator('a').count(), 0);
  assert.equal(requests, 0);
});

test('retains tracked insertions and deletions without silently accepting either', async t => {
  const page = await pageFor(t);
  const body = '<w:p>' + run('原文') + '<w:del w:id="1"><w:r><w:delText>旧租金 42.44</w:delText></w:r></w:del><w:ins w:id="2">' + run('新租金 44') + '</w:ins></w:p>'
    + '<w:del w:id="3">' + para('删除的整段仍保留') + '</w:del>';
  const result = await parse(page, await fixture(body));
  assert.match(result.plainText, /旧租金 42\.44新租金 44/);
  assert.match(result.plainText, /删除的整段仍保留/);
  assert.match(result.blocks[0].html, /<del data-original-revision="true">/);
  assert.match(result.blocks[0].html, /<ins data-original-revision="true">/);
  assert.ok(result.warnings.some(w => w.code === 'TRACKED_CHANGES'));
});

test('warns for comments, notes, auto numbers, non-previewable drawings and external document chunks', async t => {
  const page = await pageFor(t);
  const body = '<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:commentRangeStart w:id="1"/>' + run('有特殊结构') + '<w:r><w:footnoteReference w:id="1"/><w:drawing/></w:r></w:p><w:altChunk r:id="chunk1"/>';
  const result = await parse(page, await fixture(body));
  for (const code of ['COMMENTS', 'NOTES', 'AUTOMATIC_NUMBERING', 'DRAWING_UNSUPPORTED', 'ALTCHUNK_UNSUPPORTED']) assert.ok(result.warnings.some(w => w.code === code), code);
  assert.equal(result.blocks[1].type, 'unsupported');
  assert.match(result.plainText, /\[注\]/);
});

test('cached TOC controls and inherited TOC styles retain source blocks but not navigation; ordinary controls retain headings', async t => {
  const page = await pageFor(t);
  const styles = '<w:styles xmlns:w="' + W + '"><w:style w:styleId="TOC1"><w:name w:val="toc 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:styleId="CustomTOC"><w:basedOn w:val="TOC1"/></w:style></w:styles>';
  const body = '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>'
    + para('第一章 项目总论\t5') + para('1.1 项目概况\t5') + '</w:sdtContent></w:sdt>'
    + '<w:sdt><w:sdtPr><w:tag w:val="project-content"/></w:sdtPr><w:sdtContent>' + para('第一章 项目总论') + '</w:sdtContent></w:sdt>'
    + para('第二章 样式缓存\t8', '<w:pPr><w:pStyle w:val="CustomTOC"/></w:pPr>') + para('第二章 建设内容');
  const bytes = await fixture(body, { 'word/styles.xml': styles });
  const result = await parse(page, bytes), repeated = await parse(page, bytes);
  assert.deepEqual(result.blocks.map(b => b.id), ['source-b0-b0', 'source-b0-b1', 'source-b1-b0', 'source-b2', 'source-b3']);
  assert.deepEqual(result.blocks.map(b => [b.id, b.text]), repeated.blocks.map(b => [b.id, b.text]));
  assert.deepEqual(result.blocks.map(b => b.text), ['第一章 项目总论\t5', '1.1 项目概况\t5', '第一章 项目总论', '第二章 样式缓存\t8', '第二章 建设内容']);
  assert.deepEqual(result.outline.map(h => h.blockId), ['source-b1-b0', 'source-b3']);
  assert.equal(result.warnings.find(w => w.code === 'CACHED_TOC').count, 3);
  const visible = await page.evaluate(html => { document.body.innerHTML = html; return { text: document.body.textContent, headingCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length }; }, result.blocks.map(b => b.html).join(''));
  assert.match(visible.text, /第一章 项目总论\t5/); assert.equal(visible.headingCount, 2);
});

test('closed TOC fields exclude only their cached range, with split instructions, nested page fields and simple fields', async t => {
  const page = await pageFor(t);
  const field = kind => '<w:r><w:fldChar w:fldCharType="' + kind + '"/></w:r>';
  const body = '<w:p>' + field('begin') + '<w:r><w:instrText> T</w:instrText></w:r><w:r><w:instrText>OC \\o "1-3"</w:instrText></w:r>' + field('separate') + run('第一章 缓存总论') + '</w:p>'
    + '<w:p>' + run('1.1 缓存概况\t') + field('begin') + '<w:r><w:instrText>PAGEREF _Toc1</w:instrText></w:r>' + field('separate') + run('5') + field('end') + field('end') + '</w:p>'
    + para('第一章 正文总论')
    + '<w:p><w:fldSimple w:instr=" TOC \\o &quot;1-3&quot; ">' + run('第二章 简单域缓存') + '</w:fldSimple></w:p>'
    + '<w:p><w:fldSimple w:instr="DATE">' + run('第三章 普通域正文') + '</w:fldSimple></w:p>'
    + '<w:p>' + field('begin') + '<w:r><w:instrText>DATE</w:instrText></w:r>' + field('separate') + run('第四章 普通复杂域正文') + field('end') + '</w:p>';
  const result = await parse(page, await fixture(body));
  assert.deepEqual(result.outline.map(h => h.blockId), ['source-b2', 'source-b4', 'source-b5']);
  assert.deepEqual(result.blocks.map(b => b.text), ['第一章 缓存总论', '1.1 缓存概况\t5', '第一章 正文总论', '第二章 简单域缓存', '第三章 普通域正文', '第四章 普通复杂域正文']);
  assert.equal(result.warnings.find(w => w.code === 'CACHED_TOC').count, 3);
  assert.ok(!result.warnings.some(w => w.code === 'TOC_FIELD_UNCLOSED'));
});

test('unclosed TOC fields warn without suppressing later body navigation', async t => {
  const page = await pageFor(t);
  const body = '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-3"</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>' + run('第一章 可能是缓存') + '</w:p>'
    + para('第二章 后续真实正文');
  const result = await parse(page, await fixture(body));
  assert.deepEqual(result.outline.map(h => h.title), ['第一章 可能是缓存', '第二章 后续真实正文']);
  assert.ok(result.warnings.some(w => w.code === 'TOC_FIELD_UNCLOSED'));
  assert.equal(result.completeness, 'needs-original-check');
  assert.equal(result.blocks.length, 2);
});

test('simple numbered lists remain source text for manual confirmation rather than becoming top-level headings', async t => {
  const page = await pageFor(t);
  const body = para('深圳市住房租赁市场', '<w:pPr><w:outlineLvl w:val="2"/></w:pPr>')
    + para('1.深圳总体情况') + para('2.出租率') + para('1.存量资产权属证明、不动产权证')
    + para('8.5 财务评价') + para('1.明确设置的标题', '<w:pPr><w:outlineLvl w:val="3"/></w:pPr>');
  const result = await parse(page, await fixture(body));
  assert.deepEqual(result.outline.map(h => [h.title, h.level]), [['深圳市住房租赁市场', 3], ['8.5 财务评价', 2], ['1.明确设置的标题', 4]]);
  assert.deepEqual(result.blocks.slice(1, 4).map(b => [b.text, b.headingLevel]), [['1.深圳总体情况', null], ['2.出租率', null], ['1.存量资产权属证明、不动产权证', null]]);
  assert.equal(result.warnings.find(w => w.code === 'POSSIBLE_HEADINGS').count, 3);
  assert.equal(core.inferHeading('1.深圳总体情况'), null);
});

test('automatic numbering warnings include inherited styles, honor numId zero, and tolerate missing or cyclic parents', async t => {
  const page = await pageFor(t);
  const styles = '<w:styles xmlns:w="' + W + '">'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:outlineLvl w:val="0"/><w:numPr><w:numId w:val="9"/></w:numPr></w:pPr><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>'
    + '<w:style w:styleId="NumberedBase"><w:pPr><w:outlineLvl w:val="2"/><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>'
    + '<w:style w:styleId="Derived"><w:basedOn w:val="NumberedBase"/></w:style>'
    + '<w:style w:styleId="Cancelled"><w:basedOn w:val="Derived"/><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr></w:style>'
    + '<w:style w:styleId="Missing"><w:basedOn w:val="Absent"/></w:style>'
    + '<w:style w:styleId="CycleA"><w:basedOn w:val="CycleB"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>'
    + '<w:style w:styleId="CycleB"><w:basedOn w:val="CycleA"/></w:style></w:styles>';
  const props = (style, extra = '') => '<w:pPr><w:pStyle w:val="' + style + '"/>' + extra + '</w:pPr>';
  const body = para('默认样式编号') + para('继承编号标题', props('Derived'))
    + para('段落取消编号', props('Derived', '<w:numPr><w:numId w:val="0"/></w:numPr>'))
    + para('样式取消编号', props('Cancelled')) + para('父样式缺失', props('Missing'))
    + para('循环样式', props('CycleA')) + para('直接编号', props('Missing', '<w:numPr><w:numId w:val="2"/></w:numPr>'))
    + para('只覆盖编号层级', props('Derived', '<w:numPr><w:ilvl w:val="2"/></w:numPr>'));
  const result = await parse(page, await fixture(body, { 'word/styles.xml': styles }));
  assert.equal(result.warnings.find(w => w.code === 'AUTOMATIC_NUMBERING').count, 5);
  assert.match(result.warnings.find(w => w.code === 'AUTOMATIC_NUMBERING').message, /尚未还原/);
  assert.equal(result.blocks[1].text, '继承编号标题');
  assert.equal(result.blocks[0].headingLevel, null, 'numbering detection does not change default heading inference');
  assert.doesNotMatch(result.blocks[0].html, /color:#FF0000/, 'numbering detection does not change default text formatting');
  assert.equal(result.outline.find(h => h.blockId === 'source-b1').level, 3);
  assert.equal(result.blocks.length, 8);
  assert.equal(result.completeness, 'needs-original-check');
});

test('rejects wrong extension, corrupt XML, XML entities, and empty documents explicitly', async t => {
  const page = await pageFor(t), bytes = await fixture(para('原文'));
  await assert.rejects(parse(page, bytes, '原文.doc'), /\.docx/);
  const broken = await fixture('', { 'word/document.xml': '<broken>' });
  await assert.rejects(parse(page, broken), /XML 已损坏/);
  const entity = await fixture('', { 'word/document.xml': '<!DOCTYPE document [<!ENTITY secret SYSTEM "file:///local/private">]><w:document xmlns:w="' + W + '"><w:body><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:body></w:document>' });
  await assert.rejects(parse(page, entity), /外部实体/);
  await assert.rejects(parse(page, await fixture('')), /没有可读取的正文/);
});

test('preserves formula characters and flags approximate math and hidden text', async t => {
  const page = await pageFor(t);
  const body = '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>隐藏的原文</w:t></w:r><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:f><m:num><m:r><m:t>85</m:t></m:r></m:num><m:den><m:r><m:t>100</m:t></m:r></m:den></m:f></m:oMath></w:p>';
  const result = await parse(page, await fixture(body));
  assert.match(result.plainText, /隐藏的原文\[公式字符：85 100（结构请对照原文件）\]/);
  assert.doesNotMatch(result.plainText, /85100/);
  assert.ok(result.warnings.some(w => w.code === 'MATH_LAYOUT'));
  assert.ok(result.warnings.some(w => w.code === 'HIDDEN_TEXT'));
  assert.equal(result.completeness, 'needs-original-check');
});

test('rejects unsafe archive paths and declared expansion bombs before extraction', async t => {
  const page = await pageFor(t);
  const unsafe = await fixture(para('正文'), { '../outside.txt': 'unsafe' });
  await assert.rejects(parse(page, unsafe), /不安全/);
  const declaredBomb = Buffer.from(await fixture(para('正文')));
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]), entry = declaredBomb.indexOf(signature);
  declaredBomb.writeUInt32LE(25 * 1024 * 1024, entry + 24);
  await assert.rejects(parse(page, declaredBomb), /安全读取范围/);
  await assert.rejects(parse(page, Buffer.from('not a zip file at all')), /有效的 Word/);
});

test('CommonJS surface is isolated and manual outline suggestions remain editable data', () => {
  assert.equal(typeof core.parseDocx, 'function');
  assert.equal(core.inferHeading('正文是一句话。'), null);
  assert.equal(core.inferHeading('（二）建设条件').level, 2);
  assert.equal(core.inferHeading('3.4.1 运营机制').level, 3);
  assert.equal(core.escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(Object.isFrozen(core), true);
});
