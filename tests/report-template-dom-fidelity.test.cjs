const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const docx = require('../docx.umd.js');
const buildDocx = require('../docxgen.js');
const JSZip = require('../local-server/node_modules/jszip');

let browser;
test.before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
});
test.after(async () => { await browser?.close(); });

const fixture = {
  id: 'dom-fidelity', title: '真实项目明细表', projectType: 'rent',
  segments: [{ gridWidths: [1, 2, 1], rows: [
    { cells: [{ col: 0, text: '对象' }, { col: 1, text: '金额' }, { col: 2, text: '备注' }] },
    { cells: [{ col: 0, text: '目录旧对象', role: 'value' }, { col: 1, text: '999', role: 'value' }, { col: 2, text: '目录旧备注', role: 'value' }] },
  ] }],
};

function figure(table, extra = '') {
  return '<figure class="rpt-template-card" data-template-id="dom-fidelity">'
    + '<figcaption><b>表：真实项目明细表</b><span>标准模板 · 项目数据待填</span></figcaption>'
    + '<div class="rpt-template-segment" data-segment="0"><div class="rpt-template-segment-title">真实项目明细表</div>'
    + '<div class="rpt-template-scroll">' + table + '</div></div>' + extra + '</figure>';
}

async function pageFor(t, catalogue = fixture) {
  const page = await browser.newPage();
  t.after(() => page.close());
  for (const file of ['report-output-policy.js', 'report-table-templates.js', 'report-section-layout.js', 'export.js']) {
    await page.addScriptTag({ path: path.resolve(__dirname, '..', file) });
  }
  await page.evaluate(source => {
    window.reportTableProjectType = () => 'rent';
    ReportTableTemplates.exportTemplate = () => source ? structuredClone(source) : null;
    ReportTableTemplates.forSection = () => source ? [structuredClone(source)] : [];
    window.physicalTables = html => {
      const dom = new DOMParser().parseFromString(html, 'text/html');
      return Array.from(dom.querySelectorAll('table'), table => Array.from(table.rows, (row, ri) =>
        Array.from(row.cells, cell => ({
          text: (()=>{const copy=cell.cloneNode(true);copy.querySelectorAll('br').forEach(br=>br.replaceWith('\n'));copy.querySelectorAll('p,div,li').forEach(block=>block.append('\n'));return copy.textContent.trim();})(),
          colSpan: cell.colSpan,
          rowSpan: cell.rowSpan === 0 ? table.rows.length - ri : Math.min(cell.rowSpan, table.rows.length - ri),
        }))));
    };
  }, catalogue);
  return page;
}

async function composeAndRead(page, html) {
  return page.evaluate(source => {
    const entries = [{ key: '测试 / 明细', html: source, context: { type: 'rent', chapter: '测试', section: '明细', number: '1.1' } }];
    const once = ReportSectionLayout.composeDocument(entries, ReportTableTemplates);
    const twice = ReportSectionLayout.composeDocument(entries.map((e, i) => ({ ...e, html: once[i] })), ReportTableTemplates);
    const thrice = ReportSectionLayout.composeDocument(entries.map((e, i) => ({ ...e, html: twice[i] })), ReportTableTemplates);
    const node = new DOMParser().parseFromString(source, 'text/html').querySelector('figure');
    return {
      before: physicalTables(source), after: physicalTables(thrice[0]),
      stable: JSON.stringify(once) === JSON.stringify(twice) && JSON.stringify(twice) === JSON.stringify(thrice),
      directBlocks: htmlToBlocks(source), blocks: htmlToBlocks(thrice[0]),
      recovered: ReportTableTemplates.fromFigure(node, ReportTableTemplates.exportTemplate()),
    };
  }, html);
}

async function readDocx(page, blocks) {
  const buffer = await docx.Packer.toBuffer(buildDocx(docx, {
    project: { name: '[系统测试]冻结表格无损导出' },
    chapters: [{ cn: '一', name: '测试', sections: [{ title: '明细', blocks }] }],
  }));
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  const physical = await page.evaluate(source => {
    const dom = new DOMParser().parseFromString(source, 'application/xml');
    if (dom.querySelector('parsererror')) throw new Error('Exported document.xml is invalid');
    const direct = (node, name) => Array.from(node.childNodes).filter(child => child.nodeName === name);
    const attr = (node, name) => node?.getAttribute('w:' + name);
    return Array.from(dom.getElementsByTagName('w:tbl'), table => {
      const rows = direct(table, 'w:tr').map(row => {
        let col = 0;
        return direct(row, 'w:tc').map(cell => {
          const colSpan = Number(attr(cell.getElementsByTagName('w:gridSpan')[0], 'val') || 1);
          const merge = cell.getElementsByTagName('w:vMerge')[0];
          const item = { col, colSpan, merge: merge ? attr(merge, 'val') || 'continue' : '',
            text: Array.from(cell.querySelectorAll('*')).filter(n=>n.nodeName==='w:t'||n.nodeName==='w:br').map(n=>n.nodeName==='w:br'?'\n':n.textContent).join('') };
          col += colSpan;
          return item;
        });
      });
      return rows.map((row, ri) => row.filter(cell => cell.merge !== 'continue').map(cell => {
        let rowSpan = 1;
        if (cell.merge === 'restart') {
          while (rows[ri + rowSpan]?.some(next => next.col === cell.col && next.merge === 'continue')) rowSpan++;
        }
        return { text: cell.text, colSpan: cell.colSpan, rowSpan };
      }));
    });
  }, xml);
  return { physical, xml };
}

async function assertRoundtrip(page, result) {
  assert.equal(result.stable, true, 'repeated composition must not mutate the frozen figure');
  assert.deepEqual(result.after, result.before, 'preview must preserve every physical source cell and span');
  for (const blocks of [result.directBlocks, result.blocks]) {
    const output = await readDocx(page, blocks);
    assert.deepEqual(output.physical, result.before, 'native DOCX tables must preserve every physical source cell and span');
    assert.ok(!output.xml.includes('目录旧对象'), 'catalogue values must not overwrite actual project cells');
  }
}

test('missing or stale editor coordinates never replace actual values, inserted rows, zeroes or blanks', async t => {
  const page = await pageFor(t);
  for (const mode of ['missing', 'stale']) {
    const attrs = mode === 'stale' ? ' data-row="99" data-col="8"' : '';
    const cell = (text, tag = 'td') => '<' + tag + attrs + '>' + text + '</' + tag + '>';
    const rows = [['对象', '金额', '备注'], ['税务局', '11.08223', ''], ['人工插入行', '0', '【待补：付款时点】'], ['龙岗', '3630.37001', '实际备注']];
    const html = figure('<table><tbody>' + rows.map((row, i) => '<tr>' + row.map(text => cell(text, i ? 'td' : 'th')).join('') + '</tr>').join('') + '</tbody></table>');
    const result = await composeAndRead(page, html);
    assert.equal(result.recovered.segments[0].rows.length, 4);
    assert.deepEqual(result.recovered.segments[0].rows[1].cells.map(c => c.text), rows[1]);
    await assertRoundtrip(page, result);
  }
});

test('DOM colspan and rowspan govern logical columns and native DOCX merges, not stale catalogue geometry', async t => {
  const page = await pageFor(t);
  const html = figure('<table><colgroup><col style="width:20%"><col style="width:40%"><col style="width:40%"></colgroup><tbody>'
    + '<tr><th rowspan="2" data-col="9">区域</th><th colspan="2">实际金额</th></tr>'
    + '<tr><th>收入</th><th>成本</th></tr>'
    + '<tr><td rowspan="2" colspan="2">联合对象</td><td>18</td></tr>'
    + '<tr><td>42</td></tr><tr><td>尾项</td><td></td><td>0</td></tr></tbody></table>');
  const result = await composeAndRead(page, html);
  assert.deepEqual(result.recovered.segments[0].gridWidths, [20, 40, 40]);
  assert.deepEqual(result.recovered.segments[0].rows[1].cells.map(c => [c.col, c.text, c.vMerge || '']),
    [[0, '', 'continue'], [1, '收入', ''], [2, '成本', '']]);
  await assertRoundtrip(page, result);
});

test('unknown or removed catalogue template exports the real historical figure as native tables', async t => {
  const page = await pageFor(t, null);
  const result = await composeAndRead(page, figure('<table><tr><th>历史对象</th><th>历史取值</th></tr>'
    + '<tr><td>旧项目</td><td>857.29</td></tr><tr><td>空项</td><td></td></tr></table>'));
  assert.equal(result.recovered.id, 'dom-fidelity');
  assert.equal(result.blocks.filter(block => block.type === 'templateTable').length, 1);
  await assertRoundtrip(page, result);
});

test('deleted catalogue segment stays deleted and stale segment indexes do not invent tables', async t => {
  const catalogue = structuredClone(fixture);
  catalogue.longPeriod = true;
  catalogue.segments.push(structuredClone(fixture.segments[0]), structuredClone(fixture.segments[0]));
  const page = await pageFor(t, catalogue);
  const html = figure('<table><tr><th>对象</th><th>实际年度</th></tr><tr><td>保留第一段</td><td>2026</td></tr></table>',
    '<div class="rpt-template-segment" data-segment="2"><div class="rpt-template-segment-title">实际续表</div>'
    + '<table><tr><th>对象</th><th>实际年度</th></tr><tr><td>保留第三段</td><td>2028</td></tr></table></div>');
  const result = await composeAndRead(page, html);
  assert.equal(result.recovered.segments.length, 2);
  assert.equal(result.blocks.filter(block => block.type === 'templateTable').length, 2);
  await assertRoundtrip(page, result);
});

test('placeholder blanks stay empty and rowspan zero covers only existing physical rows', async t => {
  const page = await pageFor(t);
  const html = figure('<table><tr><th>项目</th><th>数据</th></tr>'
    + '<tr><td rowspan="0">同一项目</td><td><span class="rpt-template-empty">&nbsp;</span></td></tr>'
    + '<tr><td>0</td></tr><tr><td>最终值</td></tr></table>');
  const result = await composeAndRead(page, html);
  assert.equal(result.recovered.segments[0].rows[1].cells[1].text, '');
  await assertRoundtrip(page, result);
});

test('line breaks never concatenate numbers and stale placeholder markup never hides actual input', async t => {
  const page = await pageFor(t);
  const html = figure('<table><tr><th>项目</th><th>值</th></tr><tr><td>分月值</td><td>6<br>7</td></tr>'
    + '<tr><td>已填</td><td><span class="rpt-template-empty">&nbsp;</span>42</td></tr>'
    + '<tr><td>多段值</td><td><p>8</p><p>9</p></td></tr></table>');
  const result = await composeAndRead(page, html);
  assert.deepEqual(result.recovered.segments[0].rows.slice(1).map(r=>r.cells[1].text), ['6\n7','42','8\n9']);
  await assertRoundtrip(page, result);
  const {xml} = await readDocx(page,result.blocks);
  assert.ok(xml.includes('<w:br/>'),'multiline cells must use real Word line breaks');
});

test('nested historical figures keep all native tables in original order', async t => {
  const page = await pageFor(t,null);
  const table = value=>'<table><tr><th>金额</th></tr><tr><td>'+value+'</td></tr></table>';
  const html=figure(table('外表1'),figure(table('内表2'))+table('外表3'));
  const result=await composeAndRead(page,html);
  await assertRoundtrip(page,result);
  assert.deepEqual(result.blocks.filter(b=>b.type==='templateTable').map(b=>b.template.segments[0].rows[1].cells[0].text),['外表1','内表2','外表3']);
});

test('real notes and distinct continuation titles retain order without exporting editor badges', async t => {
  const page = await pageFor(t, null);
  const html = figure('<table><tr><th>项目</th><th>首期</th></tr><tr><td>甲</td><td>1</td></tr></table>',
    '<p>首期注释：含建设期。</p><details><summary>编辑器展开按钮</summary>'
    + '<div class="rpt-template-segment"><div class="rpt-template-segment-title">二期实际明细</div>'
    + '<table><tr><th>项目</th><th>二期</th></tr><tr><td>乙</td><td>2</td></tr></table></div></details>'
    + '<p>结尾注释：金额待审签。</p>');
  const result = await composeAndRead(page, html);
  await assertRoundtrip(page, result);
  const { xml } = await readDocx(page, result.blocks);
  const expectedOrder = ['真实项目明细表', '首期注释：含建设期。', '二期实际明细', '结尾注释：金额待审签。'];
  let last = -1;
  for (const text of expectedOrder) {
    const index = xml.indexOf(text);
    assert.ok(index > last, text + ' must remain in document order');
    last = index;
  }
  assert.ok(!xml.includes('编辑器展开按钮'));
  assert.ok(!xml.includes('项目数据待填'));
});
