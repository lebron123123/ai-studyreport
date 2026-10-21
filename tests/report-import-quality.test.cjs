require('../scripts/windows-browser-lockout-guard.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Quality = require('../report-import-quality.js');
const Review = require('../report-import-review.js');
const p = (id, text, extra = {}) => ({ id, text, type: 'paragraph', html: '<p>' + text + '</p>', ...extra });
function draft() {
  return { owner: 'alice', id: 'draft-q', revision: 1, confirmed: true, protectedBlockIds: [], outline: [{ blockId: 'h', title: '市场与运营方案', level: 1 }, { blockId: 'h2', title: '8.5 风险', level: 1 }, { blockId: 'h3', title: '8.5 风险', level: 1 }], files: [
    { id: 'main', role: 'main', hash: 'sha-main', parsed: { blocks: [p('h', '市场与运营方案'), p('p', '租金42.44元/㎡·月，出租率85%，改造费用545.2125万元。'), p('q', '【待补：目标客户与实施依据】'), p('h2', '8.5 风险'), p('h3', '8.5 风险')] } },
    { id: 'special', role: 'special', name: '专项.docx', hash: 'sha-special', parsed: { blocks: [p('s', '市场方案：租金44元/㎡·月，出租率90%，改造成本456.65万元。')] } }
  ] };
}
const run = (value, action, id = 'r') => ({ ...value, reviewState: Review.apply(value, action, { requestId: id, now: 100 }), revision: value.revision + 1 });
const begin = { type: 'begin', mode: 'append', scope: 'paragraph', blockId: 'p', instruction: '补充市场客户服务安排', referenceFileIds: ['special'] };

test('two-file facts, duplicate numbering and missing content are reported without claiming a score or modifying originals', () => {
  const value = draft(), before = structuredClone(value), result = Quality.evaluate(value);
  assert.deepEqual(result.findings.filter(row => row.kind === 'fact-conflict').map(row => row.topic).sort(), ['occupancy', 'renovation', 'rent']);
  for (const row of result.findings.filter(row => row.kind === 'fact-conflict')) { assert.equal(row.severity, 'critical'); assert(row.locations.some(loc => loc.fileId === 'main')); assert(row.locations.some(loc => loc.fileId === 'special')); assert(row.locations.every(loc => loc.sourceHash && loc.blockId && loc.text)); }
  for (const kind of ['duplicate-number', 'duplicate-title', 'missing-data', 'section-check', 'thin-section', 'professional-review', 'delivery-review']) assert(result.findings.some(row => row.kind === kind), kind);
  assert.equal(result.score, null); assert.equal(result.factsVerified, false); assert.equal(result.rubric.reduce((sum, row) => sum + row.weight, 0), 100); assert.deepEqual(value, before);
});

test('table column headers provide units without discarding complete source rows', () => {
  const value = draft(); value.files[1].parsed.blocks = [{ id: 't', type: 'table', text: '出租率（%）\t改造费用（万元）\n90\t456.65', html: '<table></table>', rows: [{ cells: [{ text: '出租率（%）' }, { text: '改造费用（万元）' }] }, { cells: [{ text: '90' }, { text: '456.65' }] }] }];
  const conflicts = Quality.evaluate(value).findings.filter(row => row.kind === 'fact-conflict');
  assert(conflicts.some(row => row.topic === 'occupancy' && row.values.includes('90%'))); assert(conflicts.some(row => row.topic === 'renovation' && row.values.includes('456.65万元')));
});

test('unparsed attachments are explicit and accepted supplements enter the check', () => {
  const value = draft(); value.files.push({ id: 'pdf', role: 'reference', hash: 'sha-pdf', name: '扫描件', parsed: null });
  value.reviewState = { schemaVersion: 1, requests: [{ id: 'old', status: 'accepted', acceptedOrder: 1, context: { mode: 'append' }, changes: [{ blockId: 'p', text: '【待补：最终确认口径】', beforeText: '' }] }] };
  const result = Quality.evaluate(value); assert.equal(result.summary.unparsedFiles, 1); assert(result.findings.some(row => row.kind === 'unparsed')); assert(result.findings.some(row => row.kind === 'missing-data' && row.locations[0].text.includes('最终确认口径')));
});

test('manual decisions preserve source and audit history, require a real source, and stale evidence reopens', () => {
  let value = draft(); const conflict = Quality.evaluate(value).findings.find(row => row.topic === 'rent');
  assert.throws(() => run(value, { type: 'quality-decision', findingId: conflict.id, decision: 'confirmed', note: '以主报告已核定租金为准' }), error => error.code === 'REVIEW_FACTS');
  assert.throws(() => run(value, { type: 'quality-decision', findingId: conflict.id, decision: 'not-applicable', note: '忽略不同数字即可' }), error => error.code === 'REVIEW_FACTS');
  value = run(value, { type: 'quality-decision', findingId: conflict.id, decision: 'confirmed', note: '已对照原件，采用主稿当前口径，专项值另属方案。', sourceLocation: conflict.locations[0] });
  let result = Quality.evaluate(value); assert.equal(result.findings.find(row => row.id === conflict.id).status, 'confirmed'); assert.equal(result.factsVerified, false); assert.deepEqual(value.files, draft().files);
  value.files[1].parsed.blocks[0].text += '另行调整。'; result = Quality.evaluate(value); assert.equal(result.findings.find(row => row.topic === 'rent').status, 'open'); assert.equal(value.reviewState.qualityDecisions.length, 1);
});

test('accepting a candidate with numeric conflicts requires recorded choices plus explicit confirmation and never authorizes new numbers', () => {
  let value = run(draft(), begin); value = run(value, { type: 'complete', requestId: 'r', changes: [{ blockId: 'p', text: '补充客户服务组织方案。' }] });
  assert.throws(() => run(value, { type: 'accept', candidateId: 'r', factConfirmation: true }), error => error.code === 'REVIEW_FACTS');
  for (const conflict of Quality.evaluate(value).findings.filter(row => row.kind === 'fact-conflict')) value = run(value, { type: 'quality-decision', findingId: conflict.id, decision: 'confirmed', note: '保留主稿，附件数值属于另一未确认方案。', sourceLocation: conflict.locations.find(loc => loc.fileId === 'main') });
  assert.throws(() => run(value, { type: 'accept', candidateId: 'r' }), error => error.code === 'REVIEW_FACTS');
  const tampered = structuredClone(value); tampered.reviewState.requests[0].changes[0].text = '改用44元/㎡·月。'; assert.throws(() => run(tampered, { type: 'accept', candidateId: 'r', factConfirmation: true }), error => error.code === 'REVIEW_NUMBERS');
  value = run(value, { type: 'accept', candidateId: 'r', factConfirmation: true }); assert.equal(value.reviewState.requests[0].factConfirmation.numericPermission, 'original-only'); assert.equal(Review.project(value).find(row => row.blockId === 'p').appendTexts.length, 1);
});

test('needs-data does not clear critical findings and professional checks cannot be hidden as inapplicable', () => {
  let value = draft(); const check = Quality.evaluate(value).findings.find(row => row.kind === 'professional-review');
  assert.throws(() => run(value, { type: 'quality-decision', findingId: check.id, decision: 'not-applicable', note: '本次无需核实资料' }), error => error.code === 'REVIEW_FACTS');
  value = run(value, { type: 'quality-decision', findingId: check.id, decision: 'needs-data', note: '尚缺财务测算假设的签审材料' }); assert(Quality.evaluate(value).summary.criticalOpen > 0);
});

test('whole-report confirmations reopen after body changes or restore to a distinct draft, while the old audit survives', () => {
  let value = draft(); const finding = Quality.evaluate(value).findings.find(row => row.kind === 'professional-review');
  value = run(value, { type: 'quality-decision', findingId: finding.id, decision: 'confirmed', note: '已对照完整原文和项目依据逐项确认。' });
  assert.equal(Quality.evaluate(value).findings.find(row => row.kind === 'professional-review').status, 'confirmed');
  for (const change of [copy => copy.id = 'restored-copy', copy => copy.files[0].parsed.blocks[1].text += '补充实施条件。']) {
    const copy = structuredClone(value); change(copy);
    assert.equal(Quality.evaluate(copy).findings.find(row => row.kind === 'professional-review').status, 'open');
    assert.equal(copy.reviewState.qualityDecisions.length, 1);
  }
});

test('unselected attachments remain in whole-report findings without acquiring authority over a local candidate', () => {
  let value = run(draft(), { ...begin, referenceFileIds: [] });
  value = run(value, { type: 'complete', requestId: 'r', changes: [{ blockId: 'p', text: '补充原稿已有客户服务安排。' }] });
  value = run(value, { type: 'accept', candidateId: 'r' });
  assert.equal(value.reviewState.requests[0].status, 'accepted');
  assert.equal(Quality.evaluate(value).findings.filter(row => row.kind === 'fact-conflict' && row.status === 'open').length, 3);
});

test('partial adoption applies chosen complete blocks only and undo preserves rejected candidate evidence', () => {
  let value = draft(); value.files = [value.files[0]]; value = run(value, { ...begin, referenceFileIds: [], blockId: 'h', scope: 'section' });
  value = run(value, { type: 'complete', requestId: 'r', changes: [{ blockId: 'p', text: '补充服务组织。' }, { blockId: 'q', text: '补充未采用说明。' }] });
  assert.throws(() => run(value, { type: 'accept', candidateId: 'r', blockIds: [] }), error => error.code === 'REVIEW_SCOPE');
  value = run(value, { type: 'accept', candidateId: 'r', blockIds: ['p'] }); assert.equal(Review.project(value).find(row => row.blockId === 'p').appendTexts.length, 1); assert.equal(Review.project(value).find(row => row.blockId === 'q').appendTexts.length, 0); assert.deepEqual(value.reviewState.requests[0].rejectedBlockIds, ['q']);
  value = run(value, { type: 'undo' }); assert.equal(Review.project(value).find(row => row.blockId === 'p').appendTexts.length, 0); assert.equal(value.reviewState.requests[0].changes.length, 2);
});

test('continuous improvement planning reads accepted additions but leaves the original number allowance fixed', () => {
  let value = draft(); value.files = [value.files[0]]; value = run(value, { ...begin, referenceFileIds: [] }); value = run(value, { type: 'complete', requestId: 'r', changes: [{ blockId: 'p', text: '重点客户为青年家庭，需要通勤服务。' }] }); value = run(value, { type: 'accept', candidateId: 'r' });
  const plan = Review.plan(value, { ...begin, referenceFileIds: [], instruction: '继续说明服务措施，不重复已采用内容' }); assert.equal(plan.blocks[0].appendTexts[0].text, '重点客户为青年家庭，需要通勤服务。'); assert(plan.sourceContext.queryTerms.includes('青年')); assert(!plan.allowedNumbers.includes('44元/㎡·月'));
});

test('durable unknown outcomes forbid a new request and support only same-baseline read-only recovery', () => {
  let value = draft(); value.files = [value.files[0]]; value = run(value, { ...begin, referenceFileIds: [], durable: true }); value = run(value, { type: 'unknown', requestId: 'r' });
  assert.throws(() => run(value, { ...begin, referenceFileIds: [], durable: true }, 'other'), error => error.code === 'REVIEW_PENDING');
  assert.throws(() => run(value, { type: 'complete', requestId: 'r', changes: [{ blockId: 'p', text: '迟到正文。' }] }), error => error.code === 'REVIEW_STATE');
  const changed = structuredClone(value); changed.files[0].hash = 'changed'; assert.throws(() => run(changed, { type: 'complete', requestId: 'r', recovered: true, changes: [{ blockId: 'p', text: '恢复正文。' }] }), error => error.code === 'REVIEW_STALE');
  value = run(value, { type: 'complete', requestId: 'r', recovered: true, changes: [{ blockId: 'p', text: '恢复正文。' }] }); assert.equal(value.reviewState.requests[0].status, 'ready');
});

test('durable cancellation or failure remains unknown unless absence of an external call is confirmed', () => {
  const base = draft(); base.files = [base.files[0]];
  for (const type of ['cancel', 'fail']) { const running = run(base, { ...begin, referenceFileIds: [], durable: true }); assert.equal(run(running, { type, requestId: 'r' }).reviewState.requests[0].status, 'outcome_unknown'); assert.equal(run(running, { type, requestId: 'r', confirmedNoCharge: true }).reviewState.requests[0].status, type === 'fail' ? 'failed' : 'cancelled'); }
  const old = run(run(base, { ...begin, referenceFileIds: [] }), { type: 'fail', requestId: 'r' }); assert.throws(() => run(old, { type: 'complete', requestId: 'r', recovered: true, changes: [{ blockId: 'p', text: '迟到。' }] }), error => error.code === 'REVIEW_STATE');
});

function qualityOnly(mainBlocks, specialBlocks = []) {
  const value = draft(); value.outline = []; value.files[0].parsed.blocks = mainBlocks; value.files[1].parsed.blocks = specialBlocks; return value;
}
const table = (id, rows) => ({ id, type: 'table', text: rows.map(row => row.join('\t')).join('\n'), html: '<table></table>', rows: rows.map(row => ({ cells: row.map(text => ({ text: String(text), colSpan: 1, rowSpan: 1 })) })) });
const conflicts = value => Quality.evaluate(value).findings.filter(row => row.kind === 'fact-conflict');

test('legacy string-matrix tables are read without mutation and retain the same explicit arithmetic checks', () => {
  const modern = table('legacy', [['项目名称', '出租面积（㎡）', '租金（元/㎡/月）', '月合计（元）'], ['甲小区', '10', '20', '999']]);
  const old = { ...modern, rows: modern.rows.map(row => row.cells.map(cell => cell.text)) }, value = qualityOnly([old]), before = structuredClone(value);
  const result = Quality.evaluate(value), expected = Quality.evaluate(qualityOnly([modern]));
  assert.deepEqual(result, expected); assert.equal(result.findings.filter(row => row.kind === 'table-arithmetic').length, 1); assert.deepEqual(value, before);
});

test('unknown legacy table layouts keep numeric text conflicts but never invent arithmetic or break adoption', () => {
  for (const rows of [undefined, null, [null], [{}], [['租金', { unknown: '42' }]]]) {
    const value = qualityOnly([{ id: 'old', type: 'table', text: '项目租金42元/平方米/月。', html: '<table></table>', rows }], [p('other', '项目租金44元/平方米/月。')]), before = structuredClone(value);
    const result = Quality.evaluate(value);
    assert.equal(result.findings.filter(row => row.kind === 'fact-conflict').length, 1); assert.equal(result.findings.filter(row => row.kind === 'table-arithmetic').length, 0); assert.deepEqual(value, before);
  }
  let value = qualityOnly([p('p', '原文与数字 42.44'), { id: 'old', type: 'table', text: '收入 金额 租金 42.44', html: '<table></table>', rows: [['收入', '金额'], ['租金', '42.44']] }]);
  value = run(value, { ...begin, referenceFileIds: [] }); value = run(value, { type: 'complete', requestId: 'r', changes: [{ blockId: 'p', text: '保留金额 42.44，补充实施安排。' }] }); value = run(value, { type: 'accept', candidateId: 'r' });
  assert.equal(value.reviewState.requests[0].status, 'accepted'); assert.deepEqual(value.files[0].parsed.blocks[1].rows, [['收入', '金额'], ['租金', '42.44']]);
});

test('operating stages, comparison statistics, sensitivity and breakeven rates are not pooled as one occupancy conflict', () => {
  const value = qualityOnly([
    p('forecast', '预测项目出租率如下：首年（2027年）入市后经历爬坡期，预计出租率约70.4%；第二年提升至80%左右；第三年进入稳定期，出租率达到85%并长期保持。'),
    p('comparison', '罗湖城发保租房出租率高达95%。本项目将补充区域供给。'),
    p('sensitivity', '项目出租率下降5%时考察收益，项目盈亏平衡出租率约29.2%。'),
    table('stages', [['年度', '出租率（%）'], ['第1年', '70.4'], ['第2年', '80'], ['第3-12年', '85']])
  ], [p('special', '鉴于本项目以家庭客户为主，因此爬坡期拟定为6个月，稳定期出租率为90%。'), p('city', '截至2026年二季度，全市平均出租率94.9%。')]);
  const result = conflicts(value).filter(row => row.topic === 'occupancy');
  assert.equal(result.length, 1); assert.deepEqual(result[0].values, ['85%', '90%']); assert.equal(result[0].scope.period, '稳定期');
  assert(result[0].locations.some(row => row.blockId === 'forecast')); assert(result[0].locations.some(row => row.blockId === 'stages')); assert(!result[0].locations.some(row => ['city', 'comparison', 'sensitivity'].includes(row.blockId)));
});

test('rent comparisons retain object and unit, recognize line-broken headers and do not merge a unit rent with a monthly amount', () => {
  const main = table('rent-main', [['项目名称', '租金（元/平方米/月）', '平均单套租金（元/月）'], ['甲小区', '40', '4000'], ['乙小区', '55', '5500'], ['合计', '42.44', '']]);
  const special = table('rent-special', [['项目名称', '平均租金\n（元/㎡/月）', '平均单套\n租金（元/月）'], ['甲小区', '41.18', '4000'], ['乙小区', '55', '5500'], ['', '44.03', '']]);
  const result = conflicts(qualityOnly([main], [special, p('rounded', '本次合作房源出租均价为44元/平方米/月。'), p('city', '全市平均租金达到80.4元/平方米/月。')]));
  assert.equal(result.length, 2); assert.deepEqual(result.map(row => row.scope.subject).sort(), ['甲小区', '项目整体'].sort());
  assert.deepEqual(result.find(row => row.scope.subject === '甲小区').values, ['40元/㎡/月', '41.18元/㎡/月']); assert(result.every(row => row.scope.unit === '元/㎡/月')); assert(!result.flatMap(row => row.values).some(value => value.startsWith('80.4')));
});

test('unrecognized multi-row table subjects and merged cells do not invent comparable project facts', () => {
  const unknown = table('unknown', [['任意分类', '租金（元/㎡/月）'], ['甲类', '40'], ['乙类', '55']]);
  assert.equal(conflicts(qualityOnly([unknown])).length, 0);
  const merged = table('merged', [['项目名称', '租金（元/㎡/月）'], ['甲小区', '40'], ['甲小区', '55']]); merged.rows[2].cells[0].colSpan = 2;
  assert.equal(conflicts(qualityOnly([merged])).length, 0);
});

test('equivalent money units and shown rounding do not create a conflict; unit renovation cost is not total investment', () => {
  assert.equal(conflicts(qualityOnly([p('a', '项目总投资545.2125万元。租金44.03元/平方米/月。')], [p('b', '项目总投资5452125元。租金44元/㎡/月。')])).length, 0);
  assert.equal(conflicts(qualityOnly([p('a', '改造费用545.21万元。')], [p('b', '改造成本2000元/㎡。年度改造成本摊销45.43万元。')])).length, 0);
});

test('market appraisal, discounted rent and proposed property rent are separate bases', () => {
  const source = table('properties', [['项目名称', '租金（元/㎡/月）'], ['甲小区', '40']]);
  const value = qualityOnly([source, p('market', '甲小区主力户型市场租金50.12元/平方米/月。'), p('discount', '按9折标准，甲小区出租租金45.12元/平方米/月。')], [p('other-market', '甲小区主力户型市场平均租金45.12元/平方米/月。')]);
  const result = conflicts(value); assert.equal(result.length, 1); assert.equal(result[0].scope.basis, '市场评估'); assert.deepEqual(result[0].values, ['50.12元/㎡/月', '45.12元/㎡/月']);
});

test('explicit revenue columns identify row arithmetic and total discrepancy while retaining the original cells', () => {
  const value = qualityOnly([table('revenue', [['序号', '项目名称', '出租面积（㎡）', '租金（元/㎡/月）', '单套平均面积（㎡）', '单套月租（元）', '月合计（元）'], ['1', '愉天小区', '130.60', '55', '65.30', '3918', '7183'], ['2', '松园小区', '584.76', '50', '83.54', '4177', '20981'], ['合计', '—', '715.36', '—', '—', '—', '36421']])]);
  const before = structuredClone(value), findings = Quality.evaluate(value).findings.filter(row => row.kind === 'table-arithmetic');
  assert.deepEqual(findings.map(row => row.calculation.expected), [3591.5, 29238, 28164]); assert(findings.every(row => Number.isInteger(row.locations[0].rowIndex) && Number.isInteger(row.locations[0].columnIndex)));
  assert.deepEqual(value, before); assert(findings.every(row => /不自动改/.test(row.message)));
  const unsupported = structuredClone(value); unsupported.files[0].parsed.blocks[0].rows[0].cells[2].colSpan = 2;
  assert.equal(Quality.evaluate(unsupported).findings.filter(row => row.kind === 'table-arithmetic').length, 0);
});

test('weighted comparable rent uses only disclosed complete weights and prices, never treats the result as approved rent', () => {
  const value = qualityOnly([table('weight', [['指标', '甲', '乙', '丙'], ['权重', '35%', '35%', '30%'], ['调整后租金价格', '5000', '5450', '5150'], ['建议本项目市场租金', '5172.5']])]);
  let result = Quality.evaluate(value).findings.filter(row => row.kind === 'table-arithmetic'); assert.equal(result.length, 1); assert.equal(result[0].calculation.expected, 5202.5); assert.equal(result[0].calculation.actual, 5172.5); assert.equal(result[0].severity, 'warning');
  value.files[0].parsed.blocks[0].rows[1].cells[3].text = '20%'; result = Quality.evaluate(value).findings.filter(row => row.kind === 'table-arithmetic'); assert.equal(result.length, 0);
});

test('partial-year revenue is a basis warning, not an automatic six-month financial correction', () => {
  const base = [['年度', '月租金收入（元）', '年租金收入（万元）', '备注'], ['第1年', '167907', '约201.49', '6-12月按半年计']];
  const value = qualityOnly([table('income', base)]), result = Quality.evaluate(value).findings.find(row => row.kind === 'period-basis-check'); assert(result); assert.equal(result.locations[0].rowIndex, 1); assert.match(result.message, /不擅自/);
  base[1][3] += '；年化指标另列实际现金流'; assert.equal(Quality.evaluate(qualityOnly([table('income', base)])).findings.some(row => row.kind === 'period-basis-check'), false);
});

test('editorial and project-location checks are located suggestions and preserve legitimate city comparisons', () => {
  const body = '运营管理成本按照项目租金收入比例计取，包含物业运维、人工成本、水电能耗、维修保养及管理费用。费用假设须在确定运营组织和服务边界后，对照实际合同和采购方案进一步核实。';
  const value = qualityOnly([p('site', '项目建设地点：深圳市罗湖区、福田区。'), p('repeat1', '（1）' + body), p('repeat2', '（2）' + body + '新增人员调度说明需要保留。')], [p('wrongyear', '深圳20253年居民消费价格指数。'), p('foreign', '项目所在片区是深中门户片区，为宝安区20个重点片区之一。'), p('background', '宝安区市场作为比较资料，项目所在片区仍在罗湖。')]);
  const result = Quality.evaluate(value); for (const kind of ['year-format', 'duplicate-paragraph', 'project-location-check']) assert(result.findings.some(row => row.kind === kind), kind);
  const location = result.findings.filter(row => row.kind === 'project-location-check'); assert.equal(location.length, 1); assert.deepEqual(location[0].locations.map(row => row.blockId), ['site', 'foreign']);
  assert.equal(result.factsVerified, false); assert.equal(result.score, null);
});
