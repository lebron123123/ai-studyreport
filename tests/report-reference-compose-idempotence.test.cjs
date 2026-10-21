require('../scripts/windows-browser-lockout-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

let browser, page;
test.before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'msedge' }) });
  page = await browser.newPage();
  for (const file of ['report-table-templates.js', 'report-section-layout.js', 'report-completion-contract.js']) {
    await page.addScriptTag({ path: path.resolve(__dirname, '..', file) });
  }
  await page.evaluate(() => {
    window.referenceComposeFixture = () => {
      const financial = { id: 'gaibao-housing-table-11', title: '财务评价指标表', required: false,
        segments: [{ rows: [
          { cells: ['指标名称', '单位', '测算值'].map((text, col) => ({ text, col, role: 'static' })) },
          { cells: ['', '', ''].map((text, col) => ({ text, col, role: 'value' })) },
        ] }] };
      const raw = '<table data-canonical-template="gaibao-housing-table-11"><tr><th>指标名称</th><th>单位</th><th>测算值</th></tr>'
        + '<tr><td>全投资内部收益率</td><td>%</td><td>25.79</td></tr></table>';
      const contexts = [
        { type: 'gaibao-housing', chapter: '财务评价', section: '财务分析', number: '9.2' },
        { type: 'gaibao-housing', chapter: '财务评价', section: '财务评价', number: '9.3' },
      ];
      const entries = contexts.map((context, i) => ({ key: context.chapter + ' / ' + context.section, context,
        html: '<h3>' + context.number + '.1 分析</h3><p>保留本节独有分析。</p>' + raw
          + (i ? '<p>指标注释：测算值并非已实现收益。</p>' : '<p>分析注释：以当前测算口径为准。</p>') }));
      const library = { forSection: () => [financial], renderTemplate: ReportTableTemplates.renderTemplate };
      const compose = html => ReportSectionLayout.composeDocument(entries.map((entry, i) => ({ ...entry, html: html[i] })), library);
      const parse = html => new DOMParser().parseFromString(html, 'text/html');
      return { entries, library, raw, compose, parse, initial: ReportSectionLayout.composeDocument(entries, library) };
    };
  });
});
test.after(async () => { await browser?.close(); });

test('continuous document composition keeps a canonical 9.3 reference, headings, cells and notes byte-stable', async () => {
  const result = await page.evaluate(() => {
    const f = referenceComposeFixture(), twice = f.compose(f.initial), third = f.compose(twice);
    const source = f.parse(f.initial[0]), owner = f.parse(f.initial[1]);
    return { initial: f.initial, twice, third, refs: source.querySelectorAll('.rpt-table-reference').length,
      target: source.querySelector('.rpt-table-reference')?.dataset.reportRefSection,
      hash: source.querySelector('.rpt-table-reference')?.dataset.reportRefTableHash,
      headings: [...source.querySelectorAll('h3')].map(node => node.textContent),
      cells: [...owner.querySelectorAll('table tr')].map(row => [...row.cells].map(cell => cell.textContent)),
      sourceText: source.body.textContent, ownerText: owner.body.textContent };
  });
  assert.deepEqual(result.twice, result.initial);
  assert.deepEqual(result.third, result.initial);
  assert.equal(result.refs, 1);
  assert.equal(result.target, '财务评价 / 财务评价');
  assert.match(result.hash, /^[a-f0-9]{8}$/);
  assert.deepEqual(result.headings, ['9.2.1 分析']);
  assert.ok(result.cells.some(row => row.join('|') === '全投资内部收益率|%|25.79'));
  assert.match(result.sourceText, /保留本节独有分析。.*分析注释：以当前测算口径为准。/);
  assert.match(result.ownerText, /指标注释：测算值并非已实现收益。/);
});

test('deterministically re-prepared financial tables do not append an identical 9.3 reference on each admission', async () => {
  const result = await page.evaluate(() => {
    const f = referenceComposeFixture(), history = [];
    const ownerSnapshot = value => {
      const doc = f.parse(value);
      const colgroups = [...doc.querySelectorAll('colgroup')].map(node => node.outerHTML);
      const tables = [...doc.querySelectorAll('table')].map(table => [...table.rows]
        .map(row => [...row.cells].map(cell => ({ html: cell.outerHTML, text: cell.textContent,
          rowspan: cell.rowSpan, colspan: cell.colSpan }))));
      const headings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(node => node.outerHTML);
      const paragraphs = [...doc.querySelectorAll('p')].map(node => node.outerHTML);
      doc.querySelectorAll('colgroup').forEach(node => node.remove());
      return { colgroups, tables, headings, paragraphs, withoutColgroups: doc.body.innerHTML };
    };
    let html = f.initial;
    for (let i = 0; i < 3; i++) {
      // Financial preparation appends its current raw table to an already
      // composed section. The old reference has a hash; the new one gets it later.
      html = f.compose([html[0] + f.raw, html[1]]);
      history.push({ html, owner: ownerSnapshot(html[1]), refs: f.parse(html[0]).querySelectorAll('.rpt-table-reference').length });
    }
    return { initial: f.initial, initialOwner: ownerSnapshot(f.initial[1]), history };
  });
  assert.deepEqual(result.initialOwner.colgroups, []);
  const renderedGrid = '<colgroup><col style="width:33.333%"><col style="width:33.333%"><col style="width:33.333%"></colgroup>';
  for (const step of result.history) {
    assert.equal(step.refs, 1, 're-preparation must not append a duplicate canonical reference');
    assert.equal(step.html[0], result.initial[0], 'the source section must remain byte-for-byte unchanged');
    // Reconciliation supplies the existing template's equal-width column grid.
    // Only this explicit layout addition is allowed, not a changed table or prose.
    assert.deepEqual(step.owner.colgroups, [renderedGrid]);
    assert.deepEqual(step.owner.tables, result.initialOwner.tables, 'cell HTML/text, row/column order and spans must be unchanged');
    assert.deepEqual(step.owner.headings, result.initialOwner.headings);
    assert.deepEqual(step.owner.paragraphs, result.initialOwner.paragraphs);
    assert.equal(step.owner.withoutColgroups, result.initialOwner.withoutColgroups);
  }
  assert.deepEqual(result.history[2].html, result.history[0].html, 'the permitted column grid must not keep changing');
});

test('only exact completed reference nodes coalesce; different valid targets, inline notes and comments survive', async () => {
  const result = await page.evaluate(() => {
    const f = referenceComposeFixture();
    const original = f.parse(f.initial[0]).querySelector('.rpt-table-reference').outerHTML;
    const noted = original.replace('</p>', '<!--独立审阅注释，不能按纯文本去重--></p>');
    const styled = original.replace('财务评价指标表', '<em>财务评价指标表</em>');
    const otherTable = '<table><tr><th>情景</th><th>收益率</th></tr><tr><td>租金下降</td><td>22.00%</td></tr></table>';
    const otherCells = [...f.parse(otherTable).querySelector('table').rows]
      .map(row => [...row.cells].map(cell => [cell.textContent, cell.rowSpan, cell.colSpan]));
    const otherHash = ReportCompletionContract.fingerprint(otherCells);
    const otherRef = '<p class="rpt-table-reference" data-report-ref-section="不确定性分析 / 情景台账"'
      + ' data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="' + otherHash
      + '">详见第9.4节“情景收益表”。</p>';
    const source = f.initial[0] + original + '<!--重复引用旁的独立注释-->' + noted + styled + otherRef;
    const entries = f.entries.map((entry, i) => ({ ...entry, html: i ? f.initial[i] : source }));
    entries.push({ key: '不确定性分析 / 情景台账',
      context: { type: 'gaibao-housing', chapter: '不确定性分析', section: '情景台账', number: '9.4' },
      html: '<div data-report-independent="true">' + otherTable + '</div>' });
    const once = ReportSectionLayout.composeDocument(entries, f.library);
    const twice = ReportSectionLayout.composeDocument(entries.map((entry, i) => ({ ...entry, html: once[i] })), f.library);
    const refs = [...f.parse(once[0]).querySelectorAll('.rpt-table-reference')].map(node => node.outerHTML);
    const savedOtherCells = [...f.parse(once[2]).querySelector('table').rows]
      .map(row => [...row.cells].map(cell => [cell.textContent, cell.rowSpan, cell.colSpan]));
    return { once, twice, refs, original, noted, styled, otherRef, owner: f.initial[1], otherCells, savedOtherCells };
  });
  assert.deepEqual(result.twice, result.once);
  assert.equal(result.refs.filter(html => html === result.original).length, 1);
  assert.deepEqual(result.refs, [result.original, result.noted, result.styled, result.otherRef]);
  assert.match(result.once[0], /<!--重复引用旁的独立注释-->/);
  assert.equal(result.once[1], result.owner);
  assert.deepEqual(result.savedOtherCells, result.otherCells);
});
