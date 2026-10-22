'use strict';
require('../../scripts/windows-browser-lockout-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

// Explicit private acceptance. Missing originals fail; never silently skip them.
test('private original documents pass the same complete UI, export and backup contracts', {timeout: 180000}, () => {
  const root = path.resolve(__dirname, '../..');
  const env = {...process.env, REPORT_IMPORT_ORIGINALS_DIR: process.env.REPORT_IMPORT_ORIGINALS_DIR || path.join(root, 'outputs/report-import/1014-real-originals/originals')};
  // The child is a new runner, not a worker of this test runner.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--require', './scripts/windows-browser-lockout-guard.cjs', '--test', '--test-reporter=tap', 'tests/report-import-complete-ui.test.cjs', 'tests/report-import-delivery-backup.test.cjs'], {
    cwd: root, encoding: 'utf8', timeout: 170000, maxBuffer: 8 * 1024 * 1024,
    env
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /# fail 0/);
  assert.match(result.stdout, /# skipped 0/);
});
