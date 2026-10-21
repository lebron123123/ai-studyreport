const test = require('node:test');
const assert = require('node:assert/strict');
const docx = require('../docx.umd.js');
const buildDocx = require('../docxgen.js');
const JSZip = require('../local-server/node_modules/jszip');

async function documentXml(blocks) {
  const buffer = await docx.Packer.toBuffer(buildDocx(docx, {
    project: { name: '[系统测试]相邻表格隔离' },
    chapters: [{ cn: '一', name: '市场分析', sections: [{ title: '历史租金', blocks }] }],
  }));
  return (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
}

const tables = xml => [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(match => match[0]);
const betweenTables = xml => [...xml.matchAll(/<\/w:tbl>([\s\S]*?)<w:tbl>/g)].map(match => match[1]);
const ordinary = label => ({ type: 'table', rows: [
  ['地区', '月份', '住宅', '商业', '均值', '说明'],
  [label, '2025-05', '60', '80', '70', '原始数据'],
  [label, '2025-06', '61', '81', '71', '【待补：审核依据】'],
] });
const template = { type: 'templateTable', template: {
  id: 'adjacency-regression', title: '经营情况表', segments: [{ gridWidths: [1, 2], rows: [
    { cells: [{ col: 0, text: '项目', colSpan: 2 }] },
    { cells: [{ col: 0, text: '收入' }, { col: 1, text: '100万元' }] },
  ] }],
} };

test('consecutive report tables stay distinct without changing their XML, rows, cells or formatting', async () => {
  const blocks = [ordinary('深圳'), ordinary('龙岗'), ordinary('布吉')];
  const xml = await documentXml(blocks);
  const actual = tables(xml);
  assert.equal(actual.length, 3);
  assert.doesNotMatch(xml, /<\/w:tbl>\s*<w:tbl>/, 'WPS joins tables with no paragraph between them');
  const separators = betweenTables(xml);
  assert.equal(separators.length, 2);
  for (const separator of separators) {
    assert.equal((separator.match(/<w:p(?:\s|\/?>)/g) || []).length, 1);
    assert.doesNotMatch(separator, /<w:t(?:\s|>)|w:sz|w:pageBreakBefore/,
      'separator is an ordinary empty paragraph, not text, reduced type or a page break');
  }
  for (let i = 0; i < blocks.length; i++) {
    assert.equal(actual[i], tables(await documentXml([blocks[i]]))[0]);
    assert.equal((actual[i].match(/<w:tr>/g) || []).length, 3);
    assert.equal((actual[i].match(/<w:tc>/g) || []).length, 18);
  }
});

test('template-to-ordinary table boundary is separated and merged cells remain intact', async () => {
  const xml = await documentXml([template, ordinary('龙岗')]);
  assert.doesNotMatch(xml, /<\/w:tbl>\s*<w:tbl>/);
  assert.equal(tables(xml).length, 2);
  assert.equal(tables(xml)[0], tables(await documentXml([template]))[0]);
  assert.match(tables(xml)[0], /<w:gridSpan w:val="2"\/>/);
  assert.equal((betweenTables(xml)[0].match(/<w:p(?:\s|\/?>)/g) || []).length, 1);
});

test('existing prose and template captions already separate tables and get no extra paragraph', async () => {
  const prose = await documentXml([ordinary('深圳'), { type: 'p', text: '这段原有说明必须保留。' }, ordinary('龙岗')]);
  assert.match(betweenTables(prose)[0], /这段原有说明必须保留。/);
  assert.equal((betweenTables(prose)[0].match(/<w:p(?:\s|\/?>)/g) || []).length, 1);
  const captioned = await documentXml([ordinary('深圳'), template]);
  assert.match(betweenTables(captioned)[0], /经营情况表/);
  assert.equal((betweenTables(captioned)[0].match(/<w:p(?:\s|\/?>)/g) || []).length, 1);
  const empty = await documentXml([]);
  assert.equal(tables(empty).length, 0);
});

test('ordinary and template table rows keep together while repeating the first header', async () => {
  const xml = await documentXml([ordinary('龙岗'), template]);
  for (const table of tables(xml)) {
    const rows = [...table.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map(match => match[0]);
    assert.ok(rows.length > 1);
    rows.forEach(row => assert.match(row, /<w:cantSplit(?:\s[^>]*)?\/>/));
    assert.match(rows[0], /<w:tblHeader(?:\s[^>]*)?\/>/);
    rows.slice(1).forEach(row => assert.match(row, /<w:tblHeader w:val="false"\/>/));
    assert.doesNotMatch(table, /<w:trHeight/, 'do not constrain or clip a tall row');
  }
});
