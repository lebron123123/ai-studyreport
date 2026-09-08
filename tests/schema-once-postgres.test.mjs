import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createSchemaInitializer} from '../functions/api/_schema-once.js';
import {ensureAgentRuntime, createAgentRun} from '../functions/api/_agent-runtime.js';
import {ensureAgentEnterprise, upsertRunGovernance, enqueueAgentJob} from '../functions/api/_agent-enterprise.js';
import {ensureAgentBudget} from '../functions/api/_agent-budget.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';

const target = testDatabaseUrl();
test('PostgreSQL schema 初始化：并发合并、事务免 DDL、回滚不污染父缓存', {skip:!target}, async t => {
  const DB = createD1Shim(target), env = {DB};
  try {
    await t.test('同 DB 八次并发初始化只执行一套 DDL', async () => {
      const original = DB.prepare; const calls = [];
      DB.prepare = sql => { calls.push(sql); return original(sql); };
      try {
        for (const ensure of [ensureAgentRuntime, ensureAgentEnterprise, ensureAgentBudget]) {
          await Promise.all(Array.from({length:8}, () => ensure(env)));
        }
        assert.ok(calls.length > 10);
        assert.equal(calls.length, new Set(calls).size);
      } finally { DB.prepare = original; }
    });
    await t.test('预热后八个并行事务创建任务、治理、队列均不重复 DDL', async () => {
      const user = await DB.prepare('SELECT id FROM users ORDER BY id LIMIT 1').first();
      const runIds = await Promise.all(Array.from({length:8}, () => DB._transaction(async scoped => {
        assert.equal(scoped._schemaParent, DB);
        assert.equal(Object.getOwnPropertyDescriptor(scoped, '_schemaParent').writable, false);
        const original = scoped.prepare;
        scoped.prepare = sql => {
          assert.doesNotMatch(sql, /^\s*(CREATE|ALTER|DROP)\s/i, '业务事务不得重复已预热 DDL');
          return original(sql);
        };
        const nested = {DB:scoped};
        await ensureAgentBudget(nested);
        const {run} = await createAgentRun(nested, user.id, {query:'[系统测试]并发 schema', idempotencyKey:crypto.randomUUID()});
        await upsertRunGovernance(nested, user.id, run.id, {});
        await enqueueAgentJob(nested, user.id, run.id, {kind:'llm_task', payload:{}});
        return run.id;
      })));
      assert.equal(new Set(runIds).size, 8);
      for (const id of runIds) assert.ok(await DB.prepare('SELECT id FROM agent_jobs WHERE run_id=?').bind(id).first());
    });
    await t.test('真实回滚删除事务结构后，父连接仍会重新初始化', async () => {
      const table = 'schema_rollback_' + crypto.randomUUID().replaceAll('-', '');
      const ensure = createSchemaInitializer([`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY)`]);
      await assert.rejects(() => DB._transaction(async scoped => {
        await ensure({DB:scoped});
        assert.ok((await scoped.prepare('SELECT to_regclass(?) AS name').bind(table).first()).name);
        throw new Error('intentional rollback');
      }), /intentional rollback/);
      assert.equal((await DB.prepare('SELECT to_regclass(?) AS name').bind(table).first()).name, null);
      await ensure(env);
      assert.equal((await DB.prepare('SELECT to_regclass(?) AS name').bind(table).first()).name, table);
    });
  } finally { await DB._close(); }
});
