const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ProjectContextContract = require('../project-context-contract.js');

function sample(overrides = {}) {
  return Object.assign({
    createdAt: '2026-09-03T12:00:00.000Z',
    createdBy: 'user-1',
    identity: {
      projectId: 'tax-office-renovation',
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'analyst'
    },
    scenario: {
      projectType: 'renovation',
      businessScenario: 'government-office'
    },
    versions: {
      projectFacts: 'facts-v3',
      financialParameters: 'params-v2',
      financialResults: 'finance-v5',
      evidence: 'evidence-v4',
      rules: 'rules-v7',
      tableTemplate: 'table-v2',
      reportTemplate: 'report-template-v3',
      report: 'report-v8'
    },
    focus: { chapterId: 'chapter-4', tableId: 'table-4-2', metricId: '' },
    governance: {
      pendingConfirmations: ['floor-area', 'investment-cap'],
      approvalStatus: 'draft',
      permissions: ['report:edit', 'evidence:read']
    }
  }, overrides);
}

test('sha256 matches the standard known vector', () => {
  assert.equal(
    ProjectContextContract.sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(
    ProjectContextContract.sha256('税务局可研项目'),
    crypto.createHash('sha256').update('税务局可研项目', 'utf8').digest('hex')
  );
});

test('build creates a deterministic immutable context snapshot', () => {
  const first = ProjectContextContract.build(sample());
  const reordered = ProjectContextContract.build(sample({
    governance: {
      permissions: ['evidence:read', 'report:edit', 'evidence:read'],
      approvalStatus: 'draft',
      pendingConfirmations: ['investment-cap', 'floor-area']
    }
  }));

  assert.equal(first.schemaVersion, 1);
  assert.match(first.contextId, /^ctx-[a-f0-9]{24}$/);
  assert.match(first.contextHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.contextHash, reordered.contextHash);
  assert.equal(first.contextId, reordered.contextId);
  assert.deepEqual(first.governance.permissions, ['evidence:read', 'report:edit']);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.versions));
  assert.ok(ProjectContextContract.verify(first).ok);
});

test('version changes produce a new context and an explainable diff', () => {
  const before = ProjectContextContract.build(sample());
  const after = ProjectContextContract.build(sample({
    versions: Object.assign({}, sample().versions, { evidence: 'evidence-v5' })
  }));
  const difference = ProjectContextContract.compare(before, after);

  assert.notEqual(before.contextHash, after.contextHash);
  assert.deepEqual(difference, {
    same: false,
    changedPaths: ['versions.evidence']
  });
});

test('verify detects payload tampering after persistence', () => {
  const context = ProjectContextContract.build(sample());
  const persisted = JSON.parse(JSON.stringify(context));
  persisted.versions.rules = 'rules-v999';

  const result = ProjectContextContract.verify(persisted);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['contextHash does not match context payload']);
});

test('build rejects a context without minimum identity and audit fields', () => {
  assert.throws(
    () => ProjectContextContract.build({}),
    /identity\.projectId is required; createdAt is required; createdBy is required/
  );
});

test('validate keeps missing version pins visible without blocking legacy capture', () => {
  const result = ProjectContextContract.validate({
    projectId: 'legacy-project',
    createdAt: '2026-09-03T12:00:00.000Z',
    createdBy: 'migration'
  });

  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, ProjectContextContract.VERSION_KEYS.length);
});

test('plain script loading exposes one namespaced browser global', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'project-context-contract.js'), 'utf8');
  const browser = { TextEncoder };
  vm.createContext(browser);
  vm.runInContext(source, browser);

  assert.equal(typeof browser.ProjectContextContract.build, 'function');
  assert.equal(browser.ProjectContextContract.SCHEMA_VERSION, 1);
});
