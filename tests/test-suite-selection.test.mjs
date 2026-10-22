import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {selectTestFiles,testSummaryPassed} from '../scripts/run-tests.mjs';

test('suite discovery excludes archived evidence, requires private selection and includes Windows coverage',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studyreport-test-suites-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const file of ['tests/public.test.mjs','tests/nested/behavior.test.cjs','outputs/archive.test.mjs','acceptance/private/evidence.test.mjs','tests-platform/windows/wps.test.mjs']){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),'');
  }
  const list=(args,platform)=>selectTestFiles(args,{root,platform}).map(x=>x.replaceAll('\\','/'));
  assert.deepEqual(list([],'linux'),['tests/nested/behavior.test.cjs','tests/public.test.mjs']);
  assert.equal(list([],'win32').length,3);
  assert.equal(list(['--include-private'],'win32').length,4);
  assert.deepEqual(list(['--private-only'],'linux'),['acceptance/private/evidence.test.mjs']);
  assert.deepEqual(list(['--windows-only'],'win32'),['tests-platform/windows/wps.test.mjs']);
  assert.throws(()=>list(['--windows-only'],'linux'),/require a Windows runner/);
  assert.throws(()=>list(['--skip-private'],'linux'),/Unknown/);
  fs.unlinkSync(path.join(root,'acceptance/private/evidence.test.mjs'));
  assert.throws(()=>list(['--include-private'],'linux'),/empty/);
});

test('test gate requires complete zero-failure, zero-skip execution',()=>{
  const pass={tests:3,pass:3,fail:0,cancelled:0,skipped:0,todo:0};
  assert.equal(testSummaryPassed(pass),true);
  for(const key of ['fail','cancelled','skipped','todo'])assert.equal(testSummaryPassed({...pass,[key]:1}),false);
  assert.equal(testSummaryPassed({tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0}),false);
  assert.equal(testSummaryPassed({...pass,pass:2}),false);
  assert.equal(testSummaryPassed({tests:3,pass:3}),false);
});
