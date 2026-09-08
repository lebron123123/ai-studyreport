import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
test('CI缺少数据库必须失败，不能绿灯跳过',()=>{
  assert.throws(()=>testDatabaseUrl({CI:'true'}),/不可跳过/);
  assert.throws(()=>testDatabaseUrl({REQUIRE_DATABASE_TESTS:'1'}),/不可跳过/);
  assert.equal(testDatabaseUrl({}),undefined);
});
test('测试门禁拒绝正式库和远端库',()=>{
  assert.throws(()=>testDatabaseUrl({AGENT_TEST_DATABASE_URL:'postgresql://localhost/production'}),/隔离库/);
  assert.throws(()=>testDatabaseUrl({AGENT_TEST_DATABASE_URL:'postgresql://example.org/studyreport_restore_123'}),/隔离库/);
  assert.equal(testDatabaseUrl({AGENT_TEST_DATABASE_URL:'postgresql://localhost/studyreport_restore_123'}),'postgresql://localhost/studyreport_restore_123');
});
