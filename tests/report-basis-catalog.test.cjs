const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../report-completion-contract.js');

const sectionKey = '项目总论 / 编制依据与编制说明';
const base = () => C.createPlan([{ name: '项目总论', sections: [{ t: '编制依据与编制说明' }] }], {
  budgets: { [sectionKey]: { proseTarget: 300, proseMax: 390, reason: '固定基线合同' } },
}).sections[0];
const item = (overrides = {}) => ({
  title: '项目研究报告', documentNo: '', issuer: '', date: '', status: 'received', ownerKey: sectionKey,
  required: true, evidence: { sourceId: 'file-a', sourceHash: 'a'.repeat(64), locator: '原件第1页' },
  verification: {}, ...overrides,
});
const bound = async (items = [item()], snapshot = 'working-v9') => C.bindBasisCatalog(base(), { items }, snapshot);
const refs = c => JSON.stringify({ blocks: c.basisCatalog.items.map(x => ({ kind: 'basis-ref', id: x.id })) });
const issues = (x, code) => x.issues.some(i => i.code === code);

test('basis role inherits chapter and parent; ordinary financial slots remain unchanged', () => {
  const plan = C.createPlan([
    { name: '编制依据', sections: [{ t: '政策文件清单' }, { t: '项目专属文件' }] },
    { name: '总论', sections: [{ t: '文件目录', parentTitle: '法规依据' }, { t: '财务评价' }] },
  ]);
  assert.deepEqual(plan.sections.map(x => x.requirements.basis), [true, true, true, false]);
  assert.deepEqual(C.outputSlots(base()).map(x => x.slot), ['references']);
  const ordinary = { ...base(), requirements: { ...base().requirements, basis: false, proseTarget: 700, proseMax: 910 } };
  assert.deepEqual(C.outputSlots(ordinary).map(x => x.hardMax), [208, 234, 234, 234]);
});

test('catalog refs render exact registered metadata/status, keep provenance backend-only, never claim fact pass', async () => {
  const c = await bound([item({ documentNo: '深字〔2026〕1号', issuer: '登记机关', date: '2026-08-24' })]);
  assert.deepEqual(await C.verifyBasisCatalog(c), c);
  assert.equal(c.planId, base().planId);
  assert.deepEqual(c.requirements, base().requirements);
  const out = C.decodeStructured(refs(c), c);
  assert.deepEqual(out.issues, []);
  assert.match(out.text, /深字〔2026〕1号.*登记机关.*2026-08-24.*已接收，待核验/);
  assert.doesNotMatch(out.text, /file-a|原件第1页|aaaaaaaa/);
  const q = C.inspect(out.text, c);
  assert.equal(q.status, 'unverified'); assert.equal(q.factsVerified, false);
  assert.ok(issues(q, 'basis-coverage-unconfirmed')); assert.ok(issues(q, 'basis-catalog-unverified'));
  assert.match(C.structuredPrompt(c), /basis-ref/);
  assert.doesNotMatch(C.structuredPrompt(c), /"kind":"paragraph"/);
});

test('received/cited/unlocated/verified are not silently promoted and verified requires evidence and independent record', async () => {
  for (const bad of [
    item({ status: 'verified' }), item({ status: 'received', evidence: {} }),
    item({ status: 'cited', evidence: { sourceId: 'secondary', sourceHash: 'a'.repeat(64) } }),
    item({ status: 'verified', verification: { by: 'reviewer', at: 'not-a-date', note: '复核' } }),
    item({ status: 'verified', evidence: {}, verification: { by: 'reviewer', at: '2026-09-21', note: '复核' } }),
  ]) await assert.rejects(bound([bad]));
  const c = await bound([
    item({ title: '待定位旧稿引用', status: 'unlocated', evidence: {} }),
    item({ title: '材料中提及的依据', status: 'cited' }),
    item({ title: '登记核验资料', status: 'verified', verification: { by: 'reviewer', at: '2026-09-21', note: '核对原件元数据' } }),
  ]);
  const out = C.decodeStructured(refs(c), c);
  assert.match(out.text, /原件未定位，待补/); assert.match(out.text, /仅被材料提及，原件待核验/);
  assert.match(out.text, /已登记核验，适用性仍须审签/);
  assert.equal(C.inspect(out.text, c).factsVerified, false);
});

test('even all verified registrations cannot attest legal completeness or factual correctness', async () => {
  const c = await bound([item({ status: 'verified', verification: { by: 'auditor', at: '2026-09-21', note: '核对原件' } })]);
  const q = C.inspect(C.decodeStructured(refs(c), c).text, c);
  assert.equal(q.status, 'unverified'); assert.equal(q.factsVerified, false);
  assert.ok(issues(q, 'basis-coverage-unconfirmed')); assert.ok(!issues(q, 'basis-catalog-unverified'));
});

test('SHA binding catches changed metadata, same-length omission/replacement, snapshot and owner changes', async () => {
  const c = await bound();
  for (const mutate of [
    x => { x.basisCatalog.items[0].title = '伪造依据'; },
    x => { x.basisCatalog.sourceSnapshotId = 'another'; },
    x => { x.basisCatalog.items[0].evidence.sourceHash = 'b'.repeat(64); },
    x => { x.basisCatalog.items[0].ownerKey = '其他 / 依据'; },
    x => { x.basisCatalog.items = []; x.basisCatalog.itemCount = 0; },
  ]) { const changed = structuredClone(c); mutate(changed); await assert.rejects(C.verifyBasisCatalog(changed)); }
  await assert.rejects(C.verifyBasisCatalog(c, undefined, 'another'));
  await assert.rejects(C.verifyBasisCatalog(c, { items: [item({ title: '其他' })] }));
  assert.deepEqual(await C.verifyBasisCatalog(base()), base());
});

test('unknown, duplicated, missing, cross-snapshot refs and injected model metadata are blocked with raw retained', async () => {
  const c = await bound(), other = await bound([item()], 'another');
  const good = { kind: 'basis-ref', id: c.basisCatalog.items[0].id };
  for (const [blocks, code] of [
    [[{ kind: 'basis-ref', id: 'invented' }], 'structured-basis-ref-unknown'],
    [[good, good], 'structured-basis-ref-duplicate'], [[], 'structured-basis-ref-missing'],
    [[{ kind: 'basis-ref', id: other.basisCatalog.items[0].id }], 'structured-basis-ref-unknown'],
    [[{ ...good, title: '新法律', status: 'verified' }], 'structured-extra-fields'],
    [[{ kind: 'paragraph', slot: 'references', text: '《模型新增法规》' }], 'structured-basis-catalog-only'],
    [[{ kind: 'table', title: '依据', headers: ['文件', '情况'], rows: [['新规', '适用']] }], 'structured-basis-catalog-only'],
  ]) { const raw = JSON.stringify({ blocks }), out = C.decodeStructured(raw, c); assert.ok(issues(out, code), code); assert.equal(out.raw, raw); }
});

test('catalog order and optional omission validated in JSON and rendered text', async () => {
  const c = await bound([item(), item({ title: '可选附件', required: false }), item({ title: '项目协议' })]);
  const [a, b, d] = c.basisCatalog.items;
  const omitted = C.decodeStructured(JSON.stringify({ blocks: [a, d].map(x => ({ kind: 'basis-ref', id: x.id })) }), c);
  assert.deepEqual(omitted.issues, []); assert.equal(C.inspect(omitted.text, c).status, 'unverified');
  const reversed = C.decodeStructured(JSON.stringify({ blocks: [d, b, a].map(x => ({ kind: 'basis-ref', id: x.id })) }), c);
  assert.ok(issues(reversed, 'structured-basis-ref-order')); assert.ok(issues(C.inspect(reversed.text, c), 'basis-catalog-order'));
});

test('rendered text rewrite/duplicate/invented source cannot bypass catalogue guard', async () => {
  const c = await bound(), good = C.decodeStructured(refs(c), c).text;
  for (const text of [good.replace('待核验', '已核实'), good + '\n\n《无来源的法律》', good + '\n\n' + good]) {
    const q = C.inspect(text, c); assert.equal(q.status, 'blocked'); assert.ok(issues(q, 'basis-catalog-content'));
  }
});

test('necessary registered directory exceeding fixed budget blocks manual, no truncation or budget inflation', async () => {
  const c = await bound(Array.from({ length: 16 }, (_, i) => item({ title: '必要项目专属资料及编制文件名称第' + i + '号' })));
  const out = C.decodeStructured(refs(c), c), q = C.inspect(out.text, c);
  assert.equal(out.issues.length, 0); assert.equal(c.requirements.proseMax, 390);
  const issue = q.issues.find(x => x.code === 'basis-catalog-budget');
  assert.ok(issue); assert.equal(issue.repairable, false); assert.equal(q.status, 'blocked');
  assert.match(out.text, /第15号/); assert.equal(q.metrics.proseCharacters, C.measure(out.text).proseCharacters);
});

test('empty directory cannot pass and valid legacy lists remain readable but explicitly unverified', async () => {
  const empty = await bound([]); assert.ok(issues(C.inspect('', empty), 'basis-catalog-empty'));
  const legacy = C.decodeStructured('{"blocks":[{"kind":"paragraph","slot":"references","text":"《项目研究报告》；《委托运营协议》。"}]}', base());
  assert.deepEqual(legacy.issues, []); assert.equal(C.inspect(legacy.text, base()).status, 'unverified');
  assert.ok(issues(C.inspect(legacy.text, base()), 'basis-catalog-unverified'));
  assert.ok(issues(C.inspect('本项目具备财务可行性，建议立即投资。', base()), 'basis-duty'));
  assert.equal(C.inspect('《关于推进项目投资工作的指导意见》', base()).status, 'unverified');
});

test('catalog title display escapes active HTML/Markdown while raw manifest remains exact', async () => {
  const title = '附件<img src=x onerror=alert(1)> & [内容](javascript:alert(1)) | *原值*';
  const c = await bound([item({ title })]), out = C.decodeStructured(refs(c), c);
  assert.equal(c.basisCatalog.items[0].title, title); assert.deepEqual(out.issues, []);
  assert.doesNotMatch(out.text, /<img|\[内容\]|\|/); assert.match(out.text, /&#60;img/);
  assert.equal(C.inspect(out.text, c).status, 'unverified');
});

test('non-basis cannot bind catalog; basis cannot carry frozen tables; ordinary table schema unchanged', async () => {
  const ordinary = { ...base(), requirements: { ...base().requirements, basis: false } };
  await assert.rejects(C.bindBasisCatalog(ordinary, { items: [item()] }, 's'));
  await assert.rejects(C.bindFrozenTables(base(), '<table><tr><td>1</td></tr></table>', 's'));
  const table = C.decodeStructured('{"blocks":[{"kind":"table","title":"指标","headers":["A","B"],"rows":[["面积",5973]]}]}', ordinary);
  assert.deepEqual(table.issues, []); assert.match(table.text, /5973/);
});

test('shared materials builder is received-only, uses real upload hash or SHA of available text, never infers law/date', async () => {
  const material = { fileId: 'upload-1', contentHash: 'a'.repeat(64), fileName: '律师改-【20260824】协议.docx', content: '正文提到民法典', status: 'verified', verification: { by: 'old' } };
  const c = await C.catalogFromMaterials([material, { title: '现有文本', content: '真实文本5973㎡' }, { title: '旧稿中的法律名' }], { sectionKey, sourceSnapshotId: 's' });
  assert.equal(c.items.length, 2); assert.ok(c.items.every(x => x.status === 'received'));
  assert.equal(c.items[0].date, ''); assert.deepEqual(c.items[0].verification, { by: '', at: '', note: '' });
  assert.equal(c.items[0].evidence.sourceHash, material.contentHash);
  assert.equal(c.items[1].evidence.sourceHash, crypto.createHash('sha256').update('真实文本5973㎡').digest('hex'));
  assert.match(c.items[1].evidence.locator, /文本快照/);
  assert.ok(!c.items.some(x => x.title === '民法典')); assert.ok(c.diagnostics.some(x => x.code === 'basis-file-unlocated'));
  assert.equal(c.coverage, 'unconfirmed');
});

test('material ownership, repeated records and conflicting identities are explicit', async () => {
  const a = { fileId: 'f', fileName: '报告', contentHash: 'b'.repeat(64) };
  const c = await C.catalogFromMaterials([a, a], { sectionKey });
  assert.equal(c.items.length, 1); assert.ok(c.diagnostics.some(x => x.code === 'basis-file-duplicate'));
  const owned = await C.catalogFromMaterials([a], { sectionKey, ownerBySourceId: { f: '项目依据 / 文件' } });
  assert.equal(owned.items.length, 0); assert.ok(owned.diagnostics.some(x => x.code === 'basis-owned-elsewhere'));
  await assert.rejects(C.catalogFromMaterials([a, { ...a, contentHash: 'c'.repeat(64) }], { sectionKey }));
});

test('Node snapshot helper uses only actual kb and matches shared browser builder', async () => {
  const helper = await import('../scripts/report-basis-catalog.mjs');
  const kb = [{ fileId: 'a', contentHash: 'd'.repeat(64), fileName: '项目研究报告.pdf' }, { fileId: 'b', contentHash: 'e'.repeat(64), fileName: '20260824协议.docx' }];
  const snapshot = { state: { draft: { kb, chapters: [{ content: '旧稿16项法规' }] } } };
  const result = await helper.basisCatalogFromSnapshot(snapshot, sectionKey, { sourceSnapshotId: 's' });
  assert.deepEqual(result, await C.catalogFromMaterials(kb, { sectionKey, sourceSnapshotId: 's' }));
  assert.equal(result.items.length, 2); assert.equal(result.coverage, 'unconfirmed');
  await assert.rejects(helper.basisCatalogFromSnapshot({ draft: { text: '来源：民法典' } }, sectionKey));
});
