import test from 'node:test';
import assert from 'node:assert/strict';
import {createSchemaInitializer} from '../functions/api/_schema-once.js';

test('schema 初始化合并同一 DB 并发；完整成功后才缓存，失败可重试', async () => {
  const calls = []; let fail = true;
  const DB = {prepare(sql) { return {async run() {
    calls.push(sql); await Promise.resolve();
    if (sql === 'second' && fail) throw new Error('schema failed');
  }}; }};
  const ensure = createSchemaInitializer(['first', 'second']);
  const failed = await Promise.allSettled(Array.from({length:8}, () => ensure({DB})));
  assert.ok(failed.every(x => x.status === 'rejected'));
  assert.deepEqual(calls, ['first', 'second']);
  fail = false;
  await Promise.all(Array.from({length:8}, () => ensure({DB})));
  await ensure({DB});
  assert.deepEqual(calls, ['first', 'second', 'first', 'second']);
});

test('事务仅继承父 DB 已完成初始化，不继承在途任务，也不向父 DB 泄漏完成状态', async () => {
  let release; let parentCalls = 0, childCalls = 0;
  const DB = {prepare() { return {async run() {
    parentCalls++; await new Promise(resolve => { release = resolve; });
  }}; }};
  const child = {_schemaParent:DB, prepare() { return {async run() { childCalls++; }}; }};
  const ensure = createSchemaInitializer(['schema']);
  const pending = ensure({DB});
  await ensure({DB:child});
  assert.equal(childCalls, 1, '父初始化尚未完成，不可把它当作已提交结构');
  release(); await pending;
  await ensure({DB:{_schemaParent:DB, prepare() { throw new Error('should inherit'); }}});
  assert.equal(parentCalls, 1);

  let rootCalls = 0;
  const root = {prepare() { return {async run() { rootCalls++; }}; }};
  const isolated = {_schemaParent:root, prepare() { return {async run() {}}; }};
  await ensure({DB:isolated});
  await ensure({DB:root});
  assert.equal(rootCalls, 1, '事务内初始化不能宣称父连接已经完成');
});
