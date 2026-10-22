const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const docx = require('../docx.umd.js');
const buildDocx = require('../docxgen.js');
const JSZip = require('../local-server/node_modules/jszip');

test('reconciling real figure and raw tables preserves notes, captions and wrappers in place without duplicates', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
  try {
    const page = await browser.newPage();
    for (const file of ['report-output-policy.js', 'report-table-templates.js', 'report-section-layout.js', 'export.js']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '..', file) });
    }
    const result = await page.evaluate(() => {
      const template = { id: 'notes-roundtrip', title: '目录默认名称', segments: [
        { gridWidths: [1, 1], rows: [{ cells: [{ col: 0, text: '科目' }, { col: 1, text: '金额' }] }] },
        { gridWidths: [1, 1], rows: [{ cells: [{ col: 0, text: '年度' }, { col: 1, text: '收入' }] }] },
      ] };
      const library = { forSection: () => [structuredClone(template)], renderTemplate: ReportTableTemplates.renderTemplate,
        fromFigure: ReportTableTemplates.fromFigure };
      ReportTableTemplates.exportTemplate = () => structuredClone(template);
      window.reportTableProjectType = () => 'rent';
      const context = { type: 'rent', chapter: '财务', section: '明细', number: '1.1' };
      const original = '<figure class="rpt-template-card" data-template-id="notes-roundtrip">'
        + '<figcaption><b>项目实际费用及收入表</b><span>编辑器标记</span></figcaption>'
        + '<p data-test-note="before">表前口径：金额以万元计。</p>'
        + '<div class="rpt-template-segment" data-segment="0"><div class="rpt-template-segment-title">第一期实际费用表</div>'
        + '<div class="rpt-template-scroll"><table><tr><th>科目</th><th>金额</th></tr><tr><td>工程</td><td>18</td></tr>'
        + '<tr><td></td><td></td></tr></table></div><p data-test-note="first">注：本表为不含税，尚未审签。</p></div>'
        + '<div class="project-note"><p data-test-note="between">两期之间说明：已核实付款时点。</p></div>'
        + '<details open><summary>展开续表</summary><div class="rpt-template-segment" data-segment="1">'
        + '<div class="rpt-template-segment-title">第二期实际收入表</div><div class="rpt-template-scroll">'
        + '<table><tr><th>年度</th><th>收入</th></tr><tr><td>2026</td><td>100</td></tr><tr><td></td><td></td></tr></table>'
        + '</div><div class="project-note"><p data-test-note="last">结尾说明：以最终审签为准。</p></div></div></details></figure>';
      const raw = '<table><tr><th>科目</th><th>金额</th></tr><tr><td>工程</td><td>18</td></tr><tr><td>运营</td><td>42</td></tr></table>'
        + '<table><tr><th>年度</th><th>收入</th></tr><tr><td>2026</td><td>100</td></tr><tr><td>2027</td><td>120</td></tr></table>';
      const once = ReportSectionLayout.compose(original + raw, context, library);
      const twice = ReportSectionLayout.compose(once, context, library);
      const thrice = ReportSectionLayout.compose(twice, context, library);
      const dom = new DOMParser().parseFromString(once, 'text/html');
      const figure = dom.querySelector('figure');
      const before = new DOMParser().parseFromString(original, 'text/html').querySelector('figure');
      const shell = node => {
        const copy = node.cloneNode(true);
        copy.querySelectorAll('table').forEach(table => table.replaceWith(copy.ownerDocument.createElement('table')));
        return copy.outerHTML;
      };
      return { stable: once === twice && twice === thrice, originalShell: shell(before), actualShell: shell(figure),
        tables: Array.from(dom.querySelectorAll('table'), table => Array.from(table.rows, row => Array.from(row.cells, cell => cell.textContent))),
        notes: Array.from(dom.querySelectorAll('[data-test-note]'), node => node.textContent), blocks: htmlToBlocks(once) };
    });
    assert.equal(result.stable, true);
    assert.equal(result.actualShell, result.originalShell, 'only native table nodes may change during reconciliation');
    assert.deepEqual(result.tables, [
      [['科目', '金额'], ['工程', '18'], ['运营', '42']],
      [['年度', '收入'], ['2026', '100'], ['2027', '120']],
    ]);
    assert.deepEqual(result.notes, ['表前口径：金额以万元计。', '注：本表为不含税，尚未审签。',
      '两期之间说明：已核实付款时点。', '结尾说明：以最终审签为准。']);
    const buffer = await docx.Packer.toBuffer(buildDocx(docx, { project: { name: '[系统测试]原表备注保留' },
      chapters: [{ cn: '一', name: '财务', sections: [{ title: '明细', blocks: result.blocks }] }] }));
    const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
    let position = -1;
    for (const value of [result.notes[0], '第一期实际费用表', '18', '42', result.notes[1], result.notes[2],
      '第二期实际收入表', '100', '120', result.notes[3]]) {
      const index = xml.indexOf('>' + value + '<');
      assert.ok(index > position, value + ' must retain its relative place in the actual DOCX');
      position = index;
    }
    for (const note of result.notes) assert.equal(xml.split(note).length - 1, 1, 'note must appear exactly once');
    assert.equal((xml.match(/<w:tbl>/g) || []).length, 2);
  } finally { await browser.close(); }
});

test('document-wide reconciliation retains a figure note when incoming values conflict', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
  try {
    const page = await browser.newPage();
    for (const file of ['report-table-templates.js', 'report-section-layout.js']) await page.addScriptTag({ path: path.resolve(__dirname, '..', file) });
    const result = await page.evaluate(() => {
      const template = { id: 'notes-conflict', title: '费用表', segments: [{ rows: [
        { cells: [{ col: 0, text: '科目' }, { col: 1, text: '金额' }] },
        { cells: [{ col: 0, text: '', role: 'value' }, { col: 1, text: '', role: 'value' }] },
      ] }] };
      const library = { forSection: () => [template], renderTemplate: ReportTableTemplates.renderTemplate,
        fromFigure: ReportTableTemplates.fromFigure };
      const html = '<figure class="rpt-template-card" data-template-id="notes-conflict"><div class="rpt-template-segment">'
        + '<div class="rpt-template-segment-title">已确认费用表</div><table><tr><th>科目</th><th>金额</th></tr>'
        + '<tr><td>工程</td><td>18</td></tr></table><p>原表备注：2026年度，不含税。</p></div></figure>'
        + '<table><tr><th>科目</th><th>金额</th></tr><tr><td>工程</td><td>42</td></tr></table>';
      const entries = [{ html, context: { type: 'rent', chapter: '财务', section: '明细', number: '1.1' } }];
      const once = ReportSectionLayout.composeDocument(entries, library);
      const twice = ReportSectionLayout.composeDocument(entries.map((entry, i) => ({ ...entry, html: once[i] })), library);
      const dom = new DOMParser().parseFromString(once[0], 'text/html');
      return { stable: JSON.stringify(once) === JSON.stringify(twice), html: once[0], text: dom.body.textContent,
        figureText: dom.querySelector('figure').textContent,
        supplement: dom.querySelector('[data-report-supplement]')?.textContent || '' };
    });
    assert.equal(result.stable, true);
    assert.equal(result.text.split('原表备注：2026年度，不含税。').length - 1, 1);
    assert.ok(result.figureText.includes('18'));
    assert.ok(result.supplement.includes('42'), 'conflicting source value must remain visible, not replace the approved figure value');
  } finally { await browser.close(); }
});
