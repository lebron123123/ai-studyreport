const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workflowSource = fs.readFileSync(path.join(root, 'project-workflow.js'), 'utf8');
const airSource = fs.readFileSync(path.join(root, 'aireport.js'), 'utf8');
const reportSource = fs.readFileSync(path.join(root, 'report.js'), 'utf8');
const restoreDraftSource = reportSource.slice(reportSource.indexOf('function restoreDraft('), reportSource.indexOf('function draftBarHtml('));
const calcSource = fs.readFileSync(path.join(root, 'calc.js'), 'utf8');
const financialTables = require('../report-financial-tables.js');
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Full production scripts are evaluated. Only rendering, storage and external
// services are replaced; hydration, state selection and identity guards run real code.
function harness(overrides = {}) {
  const calls = { render: 0, save: 0, draftSave: 0, fetch: 0, cache: 0, retry: 0, warnings: [] };
  const status = { style: {}, textContent: '', appendChild() {} };
  const context = {
    console: { ...console, warn: (...args) => calls.warnings.push(args) },
    setTimeout, clearTimeout, structuredClone,
    currentProjectId: 'project-a', currentProjectRole: 'OWNER',
    project: { name: '[系统测试]项目 A', location: '测试地址 A', owner: '测试业主 A' },
    domainKey: 'baozhang_gaibao', calcType: 'gaibao', rptCtype: 'gaibao',
    calcParams: { area: 100, rent: 50 },
    calcResult: { __ctype: 'gaibao', summary: { irr: 0.11 } },
    scParams: null, scResult: null, kbEntries: [],
    chapters: [{ cn: '一', name: '项目总论', sections: [{ t: '项目概况', content: '保存的项目正文。' }] }],
    projectWorkflow: {
      calcSnapshots: [{ id: 'calc-current', calcType: 'gaibao' }, { id: 'calc-old', calcType: 'sale' }],
      currentCalcSnapshotId: 'calc-current', reportVersions: [],
    },
    document: {
      getElementById: id => id === 'airRestoreStatus' ? status : null,
      querySelectorAll: () => [], createElement: () => ({ style: {}, appendChild() {} }),
    },
    authHeaders: () => ({}),
    reportHasVisibleBody: section => !!(section?.content || section?.editedHtml),
    runCalcEngine: (type, params) => ({ __ctype: type, params, summary: { irr: 0.11 } }),
    saveDraft: () => { calls.draftSave++; },
    fetch: async () => { calls.fetch++; return { ok: true, json: async () => ({ ok: true, state: null }) }; },
    ...overrides,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(workflowSource, context, { filename: 'project-workflow.js' });
  vm.runInContext(airSource, context, { filename: 'aireport.js' });
  context.renderAiReportMsgs = () => { calls.render++; };
  context.airRestoreDocPaneIfNeeded = async () => {};
  context.airMaybeAutoRetryMaterialExtraction = () => { calls.retry++; };
  context.airSaveState = () => { calls.save++; return Promise.resolve(true); };
  context.airLoadDurableLocalState = async () => { calls.cache++; return null; };
  return {
    context, calls, status,
    evaluate: source => vm.runInContext(source, context),
    state: () => copy(vm.runInContext('({chat:aiReportChat,extracted:aiReportExtracted,suggested:aiReportSuggested,confirmed:aiReportParamsConfirmed,hasDoc:aiReportHasDoc,error:aiReportRestoreError,loading:aiReportRestoreLoading,loaded:aiReportChatLoaded})', context)),
  };
}

function research(state) {
  const identity = { id: 'research-a', runId: 'run-1', revision: 1, active: true };
  const captures = [];
  const api = {
    active: () => identity.active,
    state: () => state,
    capture: chain => { const token = { ...identity, chain }; captures.push(token); return token; },
    accepts: token => token.id === identity.id && token.runId === identity.runId && token.revision === identity.revision,
  };
  return { identity, captures, api };
}

test('restore predicate distinguishes empty placeholders from meaningful legacy state', () => {
  const { context: c } = harness();
  for (const state of [null, undefined, {}, { chat: [] }, { savedAt: 999, stage: 'empty' }]) {
    assert.equal(c.airHasRestorableState(state), false);
  }
  for (const state of [{ hasDoc: true }, { extracted: { projectName: 'A' } },
    { suggested: { params: { rent: 50 } } }, { calcParams: { rent: 50 } },
    { chat: [{ kind: 'text', content: '已有会话' }] }]) {
    assert.equal(c.airHasRestorableState(state), true);
  }
});

test('current calculation snapshot is selected by exact ID, never array position', () => {
  const { context: c } = harness();
  const workflow = { currentCalcSnapshotId: 'selected', calcSnapshots: [
    { id: 'selected', calcType: 'rent' }, { id: 'later', calcType: 'sale' },
  ] };
  assert.equal(c.airWorkspaceCalcType(workflow, 'gaibao'), 'rent');
  assert.equal(c.airWorkspaceCalcType({ ...workflow, currentCalcSnapshotId: 'missing' }, 'gaibao'), 'gaibao');
  assert.equal(c.airWorkspaceCalcType(null, 'sale'), 'sale');
});

test('draft-only workspace restores unique tools without fabricating AI recommendation or consent', () => {
  const h = harness();
  const before = copy({ project: h.context.project, params: h.context.calcParams, chapters: h.context.chapters });
  assert.equal(h.context.airHydrateCurrentWorkspace(), true);
  const state = h.state();
  assert.equal(state.extracted.projectName, '[系统测试]项目 A');
  assert.equal(state.extracted.calcType, 'gaibao');
  assert.equal(state.suggested, null);
  assert.equal(state.confirmed, false);
  assert.equal(state.hasDoc, true);
  assert.deepEqual(state.chat.map(x => x.kind), ['infoCard', 'calcResult']);
  assert.equal(h.context.airHydrateCurrentWorkspace(), false);
  assert.deepEqual(h.state().chat, state.chat);
  assert.deepEqual(copy({ project: h.context.project, params: h.context.calcParams, chapters: h.context.chapters }), before);
  assert.equal(h.calls.save + h.calls.draftSave, 0);
});

test('hydration preserves existing edited information and explicit unconfirmed parameters', () => {
  const h = harness();
  h.evaluate(`aiReportExtracted={projectName:'用户新名称',location:'用户新地址',calcType:'gaibao'};
    aiReportSuggested={calcType:'gaibao',params:{rent:61},sources:{rent:'用户填写'}};
    aiReportParamsConfirmed=false;`);
  const before = h.state();
  h.context.airHydrateCurrentWorkspace();
  assert.equal(h.state().extracted.projectName, before.extracted.projectName);
  assert.equal(h.state().extracted.location, before.extracted.location);
  assert.deepEqual(h.state().suggested, before.suggested);
  assert.equal(h.state().confirmed, false);
});

test('legacy extracted data missing calcType receives the selected snapshot type, not the last one', async () => {
  const h = harness({ fetch: async () => ({ ok: true, json: async () => ({ ok: true,
    state: { extracted: { projectName: '旧信息卡' }, hasDoc: true, paramsConfirmed: false },
  }) }) });
  await h.context.airLoadState();
  assert.equal(h.state().extracted.projectName, '旧信息卡');
  assert.equal(h.state().extracted.calcType, 'gaibao');
  assert.equal(h.state().confirmed, false);
});

test('empty new research stays empty and is not converted into a previous project', () => {
  const r = research({});
  const h = harness({ currentProjectId: null, project: {}, chapters: [], calcParams: null, calcResult: null, ResearchUI: r.api });
  assert.equal(h.context.airHydrateCurrentWorkspace(), false);
  assert.deepEqual(h.state().chat, []);
  assert.equal(h.state().extracted, null);
});

test('hasDoc-only historical session recovers draft tools without falsely confirming the calculation', async () => {
  const h = harness({ fetch: async () => ({ ok: true, json: async () => ({ ok: true, state: { hasDoc: true, paramsConfirmed: false } }) }) });
  await h.context.airLoadState();
  const state = h.state();
  assert.equal(state.extracted.projectName, '[系统测试]项目 A');
  assert.equal(state.extracted.calcType, 'gaibao');
  assert.ok(state.chat.some(x => x.kind === 'infoCard'));
  assert.ok(state.chat.some(x => x.kind === 'calcResult'));
  assert.equal(state.confirmed, false);
  assert.equal(state.suggested, null);
  assert.equal(state.error, '');
  assert.equal(h.calls.save + h.calls.draftSave, 0);
});

test('existing report locks the old generation wizard but keeps saved project and parameter sources visible', async () => {
  const h = harness({ escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') });
  await h.context.airLoadState();
  assert.equal(h.context.airGenerationFlowLocked(), true);
  const kinds = h.state().chat.map(message => message.kind);
  assert.ok(kinds.includes('infoCard'));
  assert.ok(kinds.includes('confirmCard'));
  assert.ok(kinds.includes('materialCheck') === false); // No logic service in this isolated unit fixture.
  const info = h.context.airInfoCardHtml();
  const params = h.context.airConfirmCardHtml();
  assert.match(info, /生成时资料回顾/);
  assert.doesNotMatch(info, /airConfirmInfo|air_name/);
  assert.match(params, /原始来源未随旧会话保存/);
  assert.doesNotMatch(params, /airConfirmParams/);
  h.evaluate('aiReportSuggested={params:{area:100,rent:50},keyFields:[{key:"rent",label:"起始租金"}]}');
  const legacySources = h.context.airConfirmCardHtml();
  assert.match(legacySources, /历史来源未保存/);
  assert.doesNotMatch(legacySources, /id="airConfirmParams"/);
  const before = h.state();
  h.context.alert = () => {};
  h.context.airBackStep();
  assert.deepEqual(h.state(), before);
});

test('empty aiReport does not hide valid research legacySnapshot; ordinary cache/API are forbidden', async () => {
  const r = research({ aiReport: {}, legacySnapshot: { extracted: { projectName: '研究旧稿', calcType: 'gaibao' }, paramsConfirmed: false } });
  const h = harness({ currentProjectId: null, ResearchUI: r.api });
  h.context.airLoadDurableLocalState = async () => { h.calls.cache++; throw new Error('研究禁止读取普通项目缓存'); };
  h.context.fetch = async () => { h.calls.fetch++; throw new Error('研究禁止读取普通会话 API'); };
  await h.context.airLoadState();
  assert.equal(h.state().extracted.projectName, '研究旧稿');
  assert.equal(h.state().confirmed, false);
  assert.equal(h.calls.cache + h.calls.fetch, 0);
  assert.ok(r.captures.every(x => x.chain === 'export'));
});

test('research draft without AI session restores its already-loaded project tools', async () => {
  const r = research({ draft: { project: { name: '[系统测试]项目 A' } } });
  const h = harness({ currentProjectId: null, ResearchUI: r.api });
  await h.context.airLoadState();
  assert.equal(h.state().extracted.projectName, '[系统测试]项目 A');
  assert.ok(h.state().chat.some(x => x.kind === 'calcResult'));
  assert.equal(h.state().confirmed, false);
  assert.equal(h.calls.cache + h.calls.fetch + h.calls.save, 0);
});

test('context rejects project switches and A-B-A cycles, but accepts unchanged identity', () => {
  const h = harness();
  const context = h.context.airCaptureRestoreContext();
  assert.equal(context.accepts(), true);
  h.context.currentProjectId = 'project-b';
  assert.equal(context.accepts(), false);
  h.context.airSwitchProjectSession();
  h.context.currentProjectId = 'project-a';
  assert.equal(context.accepts(), false);
  assert.equal(h.context.airCaptureRestoreContext().accepts(), true);
});

test('null project IDs cannot collapse distinct research IDs or rounds', () => {
  const r = research({});
  const h = harness({ currentProjectId: null, ResearchUI: r.api });
  const sameRound = h.context.airCaptureRestoreContext();
  assert.equal(sameRound.accepts(), true);
  r.identity.runId = 'run-2';
  assert.equal(sameRound.accepts(), false);
  const secondRound = h.context.airCaptureRestoreContext();
  r.identity.id = 'research-b';
  assert.equal(secondRound.accepts(), false);
  const researchB = h.context.airCaptureRestoreContext();
  r.identity.active = false;
  assert.equal(researchB.accepts(), false);
});

test('late local read from project A cannot replace newly opened project B', async () => {
  const wait = deferred();
  const h = harness();
  h.context.airLoadDurableLocalState = () => wait.promise;
  const loading = h.context.airLoadState();
  h.context.currentProjectId = 'project-b';
  h.context.airSwitchProjectSession();
  h.evaluate(`aiReportExtracted={projectName:'项目 B'};aiReportChat=[{kind:'infoCard',content:'B'}];`);
  wait.resolve({ extracted: { projectName: '项目 A 晚到数据' }, savedAt: 100 });
  await loading;
  assert.equal(h.state().extracted.projectName, '项目 B');
  assert.equal(h.state().chat[0].content, 'B');
  assert.equal(h.calls.fetch, 0);
});

test('late API response from project A cannot replace newly opened project B', async () => {
  const wait = deferred(), started = deferred();
  const h = harness({ fetch: async () => { started.resolve(); return wait.promise; } });
  const loading = h.context.airLoadState();
  await started.promise;
  h.context.currentProjectId = 'project-b';
  h.context.airSwitchProjectSession();
  h.evaluate(`aiReportExtracted={projectName:'项目 B'};`);
  wait.resolve({ ok: true, json: async () => ({ ok: true, state: { extracted: { projectName: '项目 A 晚到数据' } } }) });
  await loading;
  assert.equal(h.state().extracted.projectName, '项目 B');
  assert.equal(h.calls.save + h.calls.draftSave, 0);
});

test('material rules loaded after switching research round cannot inject an old material card', async () => {
  const wait = deferred();
  const r = research({ hasDoc: true });
  let inventories = 0;
  const h = harness({ currentProjectId: null, ResearchUI: r.api, ReportLogicCore: {
    load: () => wait.promise,
    materialInventory: () => { inventories++; return { items: [] }; },
  } });
  const loading = h.context.airRestoreMaterialCheck({ hasDoc: true, calcType: 'gaibao' });
  r.identity.runId = 'run-2';
  wait.resolve();
  await loading;
  assert.equal(inventories, 0);
  assert.equal(h.state().chat.some(x => x.kind === 'materialCheck'), false);
});

test('API failure keeps draft tools, reports failure and does not save incomplete session; retry succeeds', async () => {
  let attempts = 0;
  const h = harness({ fetch: async () => {
    attempts++;
    if (attempts === 1) throw new Error('网络中断');
    return { ok: true, json: async () => ({ ok: true, state: { extracted: { projectName: '服务器会话', calcType: 'gaibao' }, paramsConfirmed: false } }) };
  } });
  await h.context.airLoadState();
  assert.match(h.state().error, /网络中断/);
  assert.equal(h.state().loading, false);
  assert.equal(h.state().extracted.projectName, '[系统测试]项目 A');
  assert.ok(h.state().chat.some(x => x.kind === 'calcResult'));
  assert.equal(h.calls.save + h.calls.draftSave, 0);
  h.evaluate('aiReportChatLoaded=false;');
  await h.context.airLoadState();
  assert.equal(h.state().error, '');
  assert.equal(h.state().extracted.projectName, '服务器会话');
  assert.equal(attempts, 2);
  assert.equal(h.calls.cache, 2, 'each attempt reads cache once; failure must not read again');
});

test('research read failure never falls back to ordinary project or unsaved cache', async () => {
  const r = research({});
  r.api.state = () => { throw new Error('研究状态不可读取'); };
  const h = harness({ currentProjectId: null, ResearchUI: r.api });
  h.context.airLoadDurableLocalState = async () => { h.calls.cache++; return { extracted: { projectName: '禁止读取的其他项目' } }; };
  await h.context.airLoadState();
  assert.equal(h.calls.cache + h.calls.fetch, 0);
  assert.equal(h.state().extracted.projectName, '[系统测试]项目 A');
  assert.match(h.state().error, /恢复工具失败/);
  assert.equal(h.calls.save + h.calls.draftSave, 0);
});

function withDraftRestore(h) {
  Object.assign(h.context, {
    appMode: 'aireport', signed: true, docNo: 'OLD-DOC',
    reportDocumentRevision: 0, reportLocalPersistedRevision: 0, reportCloudPersistedRevision: 0,
    currentStep: 0, STEPS: ['project', 'calc', 'report'],
    loadDomain: () => {}, renderTOC: () => {}, renderSheet: () => {},
    computeSensitivity: () => [],
  });
  vm.runInContext(restoreDraftSource, h.context, { filename: 'report.js:restoreDraft' });
  return h;
}

test('gaibao workspace reopening preserves real sensitivity results and the draft financial identity', async () => {
  const params = copy(require('./fixtures/nrcalc-reference.json').cases[0].params);
  const saved = { calcType: 'gaibao', calcParams: params, paramsConfirmed: true, hasDoc: true };
  const h = withDraftRestore(harness({ fetch: async () => ({ ok: true, json: async () => ({ ok: true, state: saved }) }) }));
  h.context.CALC_CFG = { gaibao: {}, rent: {}, sale: {} };
  vm.runInContext(fs.readFileSync(path.join(root, 'nrcalc.js'), 'utf8'), h.context, { filename: 'nrcalc.js' });
  vm.runInContext(calcSource.slice(calcSource.indexOf('function runCalcEngine('), calcSource.indexOf('function pgParamDefs(')), h.context);
  vm.runInContext(calcSource.slice(calcSource.indexOf('function assembleCalcInput('), calcSource.indexOf('function modeCompareHtml(')), h.context);
  const draft = { domainKey: 'baozhang_gaibao', project: { name: '[系统测试]敏感性恢复' }, calcType: 'gaibao', calcParams: params,
    chapters: [{ name: '总论', sections: [{ t: '概况', content: '原有正文保持不变' }] }] };
  h.context.restoreDraft(draft, { deferRender: true });
  const expected = copy(h.context.calcResult), pristine = JSON.stringify({ draft, saved });
  const signature = result => financialTables.signature({ projectId: 'project-a', params, result });
  assert.equal(expected.sens.length, 6);
  assert.ok(expected.sens.every(row => Number.isFinite(row.npv)));
  await h.context.airLoadState();
  assert.equal(h.state().confirmed, true);
  assert.deepEqual(copy(h.context.calcResult), expected);
  assert.equal(signature(h.context.calcResult), signature(expected));
  assert.equal(h.context.scResult, h.context.calcResult);
  assert.equal(h.context.scParams, h.context.calcParams);
  assert.equal(JSON.stringify({ draft, saved }), pristine);
  assert.equal(h.calls.save + h.calls.draftSave, 0);
});

test('rent and sale workspace reopening does not run gaibao sensitivity or alter engine output', async () => {
  for (const type of ['rent', 'sale']) {
    const params = { rent: 88, custom: type }, expected = { __ctype: type, income: { 2027: { rent: 123.456 } }, summary: { irr: .07 } };
    let sensitivityCalls = 0, engineCalls = 0;
    const h = harness({ calcType: type, fetch: async () => ({ ok: true, json: async () => ({ ok: true,
      state: { calcType: type, calcParams: params, paramsConfirmed: true, hasDoc: true } }) }),
      runCalcEngine: (actualType, actualParams) => { engineCalls++; assert.equal(actualType, type); assert.deepEqual(actualParams, params); return copy(expected); },
      computeSensitivity: () => { sensitivityCalls++; throw new Error('不应调用非居改保分析'); } });
    await h.context.airLoadState();
    assert.equal(h.state().confirmed, true);
    assert.deepEqual(copy(h.context.calcResult), expected);
    assert.equal(engineCalls, 1);
    assert.equal(sensitivityCalls, 0);
    assert.equal(h.calls.save + h.calls.draftSave, 0);
  }
});

test('missing saved parameters skip recalculation; engine or sensitivity failure never confirms or saves restored parameters', async () => {
  const noParams = harness({ fetch: async () => ({ ok: true, json: async () => ({ ok: true, state: { calcType: 'gaibao', paramsConfirmed: true, hasDoc: true } }) }),
    runCalcEngine: () => { throw new Error('缺参数不应执行'); }, computeSensitivity: () => { throw new Error('缺参数不应执行'); } });
  const previous = copy(noParams.context.calcResult);
  await noParams.context.airLoadState();
  assert.deepEqual(copy(noParams.context.calcResult), previous);
  for (const failing of ['engine', 'sensitivity']) {
    const saved = { calcType: 'gaibao', calcParams: { rent: -1 }, paramsConfirmed: true, hasDoc: true };
    const h = harness({ fetch: async () => ({ ok: true, json: async () => ({ ok: true, state: saved }) }),
      runCalcEngine: () => { if (failing === 'engine') throw new Error('参数错误'); return { summary: { irr: null } }; },
      computeSensitivity: () => { throw new Error('分析错误'); } });
    await h.context.airLoadState();
    assert.equal(h.state().confirmed, false, failing);
    assert.equal(h.state().loading, false);
    assert.deepEqual(copy(h.context.calcParams), saved.calcParams);
    assert.equal(h.calls.save + h.calls.draftSave, 0);
  }
});

test('restoring another draft removes old custom fields, map sites, knowledge and all cached calculation results', () => {
  const h = withDraftRestore(harness());
  const originalProjectObject = h.context.project;
  Object.assign(h.context.project, {
    analysisSites: [{ id: 'old-site', name: '旧项目点位' }],
    poiLoc: '114,22', poiLocLabel: '旧地址', customOldValue: '不能串入新项目',
  });
  h.context.scParams = { rent: 999 };
  h.context.scResult = { summary: { irr: 9.99 } };
  h.context.kbEntries = [{ title: '旧项目专属材料' }];
  const draft = {
    domainKey: 'baozhang_gaibao', project: { name: '新项目', owner: '新业主' },
    chapters: [{ cn: '一', name: '新项目总论', sections: [{ t: '概况', content: '新项目原文' }] }],
  };
  const pristine = copy(draft);
  h.context.restoreDraft(draft, { deferRender: true });
  assert.equal(h.context.project, originalProjectObject, 'preserve references to the current project object');
  assert.equal(h.context.project.name, '新项目');
  for (const key of ['analysisSites', 'poiLoc', 'poiLocLabel', 'customOldValue']) {
    assert.equal(Object.hasOwn(h.context.project, key), false, `${key} must not survive from the old project`);
  }
  assert.equal(h.context.project.location, '');
  assert.equal(h.context.calcParams, null);
  assert.equal(h.context.calcResult, null);
  assert.equal(h.context.scParams, null);
  assert.equal(h.context.scResult, null);
  assert.deepEqual(copy(h.context.kbEntries), []);
  assert.deepEqual(copy(h.context.chapters), pristine.chapters);
  assert.deepEqual(draft, pristine, 'restoring must not mutate the saved draft');
  assert.equal(h.context.signed, false, 'legacy approval must not be restored onto a draft');
});

test('draft restore recomputes only the current snapshot and keeps new map data, not old cached results', () => {
  const h = withDraftRestore(harness());
  const engines = [];
  h.context.runCalcEngine = (type, params) => { engines.push([type, copy(params)]); return { summary: { irr: 0.07 } }; };
  const newSites = [{ id: 'new-site', name: '新项目点位', location: '115,23' }];
  h.context.restoreDraft({
    domainKey: 'baozhang_xinjian', project: { name: '新出租项目', analysisSites: newSites },
    calcParams: { rent: 88 },
    workflow: { currentCalcSnapshotId: 'selected-rent', calcSnapshots: [
      { id: 'selected-rent', calcType: 'rent' }, { id: 'later-sale', calcType: 'sale' },
    ] },
    chapters: [{ name: '总论', sections: [{ t: '概况', content: '原文' }] }],
  }, { deferRender: true });
  assert.deepEqual(engines, [['rent', { rent: 88 }]]);
  assert.equal(h.context.calcType, 'rent');
  assert.equal(h.context.calcResult.__ctype, 'rent');
  assert.equal(h.context.calcResult.summary.irr, 0.07);
  assert.equal(h.context.scResult, h.context.calcResult);
  assert.equal(h.context.scParams, h.context.calcParams);
  assert.deepEqual(copy(h.context.project.analysisSites), newSites);
});

test('failed recalculation while restoring a draft cannot expose the previous project calculation', () => {
  const h = withDraftRestore(harness());
  h.context.scParams = h.context.calcParams;
  h.context.scResult = h.context.calcResult;
  h.context.runCalcEngine = () => { throw new Error('该草稿参数需修正'); };
  h.context.restoreDraft({ domainKey: 'baozhang_gaibao', project: { name: '参数待修正项目' }, calcParams: { rent: -1 } }, { deferRender: true });
  assert.deepEqual(copy(h.context.calcParams), { rent: -1 }, 'retain the original invalid values for correction');
  assert.equal(h.context.calcResult, null);
  assert.equal(h.context.scParams, null);
  assert.equal(h.context.scResult, null);
});

test('blank draft clears inherited body and calculation type instead of exposing the previous conversion project', () => {
  const h = withDraftRestore(harness());
  h.context.restoreDraft({ project: { name: '新建研究' } }, { deferRender: true });
  assert.deepEqual(copy(h.context.chapters), []);
  assert.equal(h.context.calcType, 'rent');
  assert.equal(h.context.rptCtype, 'rent');
  assert.equal(h.context.calcResult, null);
  h.context.currentProjectId = null;
  assert.equal(h.context.airHydrateCurrentWorkspace(), false);
  assert.equal(h.state().hasDoc, false);
});

test('draft type fallback uses its own saved fields and domain, never old globals or trailing snapshots', () => {
  const cases = [
    { draft: { domainKey: 'baozhang_xinjian' }, expected: 'rent' },
    { draft: { domainKey: 'baozhang_gaibao' }, expected: 'gaibao' },
    { draft: { calcType: 'sale' }, expected: 'sale' },
    { draft: { rptCtype: 'sale' }, expected: 'sale' },
    { draft: { project: { calcType: 'sale' } }, expected: 'sale' },
    { draft: { calcType: 'sale', workflow: { currentCalcSnapshotId: 'selected', calcSnapshots: [
      { id: 'selected', calcType: 'rent' }, { id: 'last', calcType: 'gaibao' },
    ] } }, expected: 'rent' },
    { draft: { domainKey: 'baozhang_xinjian', workflow: { currentCalcSnapshotId: 'missing', calcSnapshots: [
      { id: 'last', calcType: 'sale' },
    ] } }, expected: 'rent' },
  ];
  for (const { draft, expected } of cases) {
    const h = withDraftRestore(harness({ calcType: 'gaibao', rptCtype: 'sale' }));
    h.context.restoreDraft(draft, { deferRender: true });
    assert.equal(h.context.calcType, expected, JSON.stringify(draft));
    assert.equal(h.context.rptCtype, expected === 'sale' ? 'sale' : 'rent');
  }
});

test('send while workspace restoration is in flight leaves the user input untouched and calls no AI', async () => {
  const h = harness();
  const input = { value: '  我刚输入的新要求  ' };
  let consumed = 0;
  h.context.document.getElementById = id => id === 'airInput' ? input : null;
  h.context.airRunAgent = async () => { consumed++; };
  h.context.airRunExtract = async () => { consumed++; };
  h.context.airAutosize = () => {};
  h.evaluate('aiReportRestoreLoading=true;');
  await h.context.aiReportSend();
  assert.equal(input.value, '  我刚输入的新要求  ');
  assert.deepEqual(h.state().chat, []);
  assert.equal(consumed, 0);
  h.evaluate('aiReportRestoreLoading=false;');
  await h.context.aiReportSend();
  assert.equal(input.value, '');
  assert.equal(h.state().chat[0].content, '我刚输入的新要求');
  assert.equal(consumed, 1);
});
