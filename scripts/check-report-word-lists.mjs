import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
require('./windows-browser-lockout-guard.cjs');
const { chromium } = require('playwright');
const D = require('../docx.umd.js');
const build = require('../docxgen.js');
const JSZip = require('../local-server/node_modules/jszip');
const run = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const outputRoot = path.resolve(projectRoot, 'outputs/report-standardization', '1008-word-list-qa-' + randomUUID());
const popplerRoot = process.env.REPORT_QA_POPPLER_BIN || 'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin';
const pythonPath = process.env.REPORT_QA_PYTHON || 'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const fixtureName = '[系统测试]标题与真实列表隔离验收';
const fixtureHtml = `<div>
<h3>1.1.1 运营职责与分类</h3>
<p>本样本只验证导出结构，不代表真实项目数据。普通正文、比例、年份及待补提示必须原样保留。</p>
<h4>一、费用核对</h4>
<ol start="3"><li>按月实际租金比例收楼，比例20%。
<ul><li>运营费用按实际租金的15.7%计算。</li><li>【待补：合同审核责任人】</li></ul>
<p>继续说明：总面积5000㎡，运营期限2027—2031年。</p></li><li>归还本金按当月租金减当月运营费用执行。</li></ol>
<h5>（一）合作边界</h5>
<p>项目保留60%收益，不得因精简正文而删除数值或分类。</p>
<h6>1、执行安排</h6>
<ul><li>核验付款与收入发生月份。</li><li>核验年度合计与逐月数据的勾稽。</li></ul>
<p>以下两张相邻表必须独立，待补字段使用红色。</p>
<table><tr><th>指标</th><th>原样保留数值</th></tr><tr><td>收楼比例</td><td>20%</td></tr><tr><td>运营比例</td><td>15.7%</td></tr></table>
<table><tr><th>核验项</th><th>状态</th></tr><tr><td>合同责任</td><td>【待补：审核依据】</td></tr><tr><td>运营期限</td><td>2027—2031年</td></tr></table>
</div>`;

await fs.mkdir(outputRoot, { recursive: true });
let browser;
let blocks;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.addScriptTag({ path: path.join(projectRoot, 'export.js') });
  blocks = await page.evaluate(html => htmlToBlocks(html), fixtureHtml);
} finally {
  if (browser) await browser.close();
}
assert.deepEqual(blocks.filter(b => b.type === 'h').map(b => b.level), [3, 4, 5, 6]);
const firstList = blocks.find(b => b.type === 'list');
assert.equal(firstList.start, 3);
assert.equal(firstList.items.length, 2);
assert.equal(firstList.items[0].blocks.find(b => b.type === 'list').items.length, 2);

const docxBuffer = await D.Packer.toBuffer(build(D, {
  project: { name: fixtureName },
  documentDate: '2026年10月8日',
  versionNote: '合成样本；未读取、修改或导出任何正式项目',
  chapters: [{ cn: '一', name: '结构核验', sections: [{ title: '层级、列表与数值', blocks }] }],
}));
const archive = await JSZip.loadAsync(docxBuffer);
const documentXml = await archive.file('word/document.xml').async('string');
const numberingXml = await archive.file('word/numbering.xml').async('string');
for (const level of [3, 4, 5, 6]) assert.match(documentXml, new RegExp('w:pStyle w:val="Heading' + level + '"'));
assert.equal((documentXml.match(/<w:numPr>/g) || []).length, 6);
assert.match(numberingXml, /<w:start w:val="3"/);
assert.match(numberingXml, /<w:numFmt w:val="decimal"/);
assert.match(numberingXml, /<w:numFmt w:val="bullet"/);
assert.equal((documentXml.match(/<w:tbl>/g) || []).length, 2);
assert.doesNotMatch(documentXml, /<\/w:tbl>\s*<w:tbl>/);
assert.equal(documentXml.split('合同审核责任人').length - 1, 1);
assert.match(documentXml, /<w:color w:val="C62828"[^>]*\/>[\s\S]*?【待补：合同审核责任人】/);
for (const fact of ['20%', '15.7%', '5000㎡', '2027—2031年', '60%']) assert.ok(documentXml.includes(fact), fact);

const docxPath = path.join(outputRoot, fixtureName + '.docx');
const pdfPath = path.join(outputRoot, fixtureName + '.pdf');
await fs.writeFile(docxPath, docxBuffer);
const rendered = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(projectRoot, 'scripts/render-report-copy.ps1'), '-InputDocx', docxPath, '-OutputPdf', pdfPath], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
const wpsPages = Number(rendered.stdout.match(/Rendered pages:\s*(\d+)/)?.[1]);
assert.ok(Number.isInteger(wpsPages) && wpsPages > 0, 'WPS must provide a real page count');
const info = await run(path.join(popplerRoot, 'pdfinfo.exe'), [pdfPath], { windowsHide: true });
const pdfPages = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
assert.equal(pdfPages, wpsPages);
const text = await run(pythonPath, ['-c', 'import sys; from pypdf import PdfReader; sys.stdout.reconfigure(encoding="utf-8"); print("\\n".join(page.extract_text() or "" for page in PdfReader(sys.argv[1]).pages))', pdfPath], { windowsHide: true, encoding: 'utf8' });
for (const fact of ['20%', '15.7%', '5000', '60%', '合同审核责任人', '一、费用核对', '（一）合作边界', '1、执行安排']) assert.ok(text.stdout.includes(fact), 'Rendered text missing: ' + fact);
assert.match(text.stdout, /3\.\s*按月实际租金比例收楼/);
assert.match(text.stdout, /4\.\s*归还本金/);
await run(path.join(popplerRoot, 'pdftoppm.exe'), ['-r', '110', '-png', pdfPath, path.join(outputRoot, 'page')], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
const pageImages = (await fs.readdir(outputRoot)).filter(name => /^page-\d+\.png$/.test(name)).sort().map(name => path.join(outputRoot, name));
assert.equal(pageImages.length, wpsPages);
const result = { fixtureName, docxPath, pdfPath, wpsPages, pdfPages, pageImages, numberedParagraphs: 6, headingLevels: [3, 4, 5, 6], independentTables: 2, listStart: 3, nestedLevel: 1, browserLockoutGuard: chromium.__nrWindowsLockoutGuard === true || process.platform !== 'win32', paidApiRequests: 0, formalProjectWrites: 0, visualInspection: 'PNG generated; inspect separately', boundary: 'Synthetic fixture only; does not replace long-report page gate or user-project validation.' };
await fs.writeFile(path.join(outputRoot, 'qa.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
