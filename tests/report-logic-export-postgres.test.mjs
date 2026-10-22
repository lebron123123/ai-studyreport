import test from "node:test";
import assert from "node:assert/strict";
import pg from "../local-server/node_modules/pg/lib/index.js";
import { createD1Shim } from "../local-server/d1-shim.js";
import { testDatabaseUrl } from "../scripts/require-test-database.mjs";
import { signToken } from "../functions/api/_auth.js";
import { onRequestGet } from "../functions/api/reportlogicexport.js";

const target = testDatabaseUrl();
test("logic export PostgreSQL: real read-only transaction, published history and complete snapshot", { skip: !target }, async () => {
  const client = new pg.Client({ connectionString: target });
  await client.connect();
  try {
    // Connection-local tables cannot alter or collide with another test's library.
    await client.query("CREATE TEMP TABLE account_security (user_id INTEGER PRIMARY KEY,disabled INTEGER,revoked_before BIGINT,updated_at BIGINT)");
    await client.query("CREATE TEMP TABLE report_logic_sets (id TEXT PRIMARY KEY,project_type TEXT,name TEXT,version INTEGER,status TEXT,data TEXT,source_name TEXT,created_at BIGINT,created_by TEXT,published_at BIGINT)");
    const data = JSON.stringify({ rules: [{ id: "r1", chapter: "第一章", section: "原节", writingLogic: "[系统测试]保留原文" }] });
    for (const [id, type, version, status, publishedAt] of [["old", "gaibao", 1, "archived", 100], ["draft", "gaibao", 2, "draft", null], ["current", "gaibao", 3, "published", 300], ["newtype", "future_type", 1, "published", 100]]) {
      await client.query("INSERT INTO report_logic_sets VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, type, "[系统测试]导出逻辑", version, status, data, "test", 100, "admin", publishedAt]);
    }
    const env = { DB: createD1Shim(null, client), DEPLOY_MODE: "local", SESSION_SECRET: "isolated-logic-export", ADMIN_USERS: "admin", ADMIN_PASS: "not-needed-for-read" };
    const token = await signToken({ SESSION_SECRET: env.SESSION_SECRET }, 42, "admin");
    await client.query("BEGIN READ ONLY");
    const response = await onRequestGet({ env, request: new Request("http://test/api/reportlogicexport", { headers: { authorization: "Bearer " + token } }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(result.sets.length, 2);
    assert.equal(result.sets.find(set => set.projectType === "gaibao").previous.id, "old");
    assert.deepEqual(result.sets.find(set => set.projectType === "gaibao").data, JSON.parse(data));
    assert.equal(result.sets.find(set => set.projectType === "future_type").previous, null);
    await client.query("ROLLBACK");
    assert.equal((await client.query("SELECT count(*)::integer AS count FROM report_logic_sets")).rows[0].count, 4);
  } finally { await client.end(); }
});
