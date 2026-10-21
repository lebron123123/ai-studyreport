import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { signToken, verifyAuth } from "../functions/api/_auth.js";
import { onRequestGet, SNAPSHOT_SQL, snapshotFromRows } from "../functions/api/reportlogicexport.js";

const SECRET = "report-logic-export-test-only";
const TABLE = "CREATE TABLE report_logic_sets (id TEXT PRIMARY KEY,project_type TEXT,name TEXT,version INTEGER,status TEXT,data TEXT,source_name TEXT,created_at INTEGER,created_by TEXT,published_at INTEGER)";
const sampleData = (type = "rent", text = "原文\n包括【待补】与 =SUM(A1:A2)") => ({ projectType: type, rules: [{ id: "rule-1", chapter: "第一章", section: "项目背景", writingLogic: text }], arbitraryOriginalField: { untouched: true } });

function fixture({ securityTable = true, logicTable = true } = {}) {
  const connection = new DatabaseSync(":memory:"), calls = [];
  if (securityTable) connection.exec("CREATE TABLE account_security(user_id INTEGER PRIMARY KEY,disabled INTEGER,revoked_before INTEGER,updated_at INTEGER)");
  if (logicTable) connection.exec(TABLE);
  const DB = {
    prepare(sql) {
      calls.push(sql);
      assert.match(sql, /^\s*(?:SELECT|WITH)\b/i, "export must never prepare DDL or mutation SQL");
      const stmt = connection.prepare(sql);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return stmt.get(...params) || null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() { assert.fail("export must not call run()"); }
      };
    }
  };
  const env = { DB, SESSION_SECRET: SECRET, ADMIN_USERS: "admin, 8", ADMIN_PASS: "publish-only-pass" };
  return { connection, calls, env, add(row = {}) {
    const r = { id: "rent-1", projectType: "rent", name: "出租逻辑", version: 1, status: "published", data: sampleData(), source: "原件.xlsx", createdAt: 1000, createdBy: "admin", publishedAt: 2000, ...row };
    connection.prepare("INSERT INTO report_logic_sets VALUES(?,?,?,?,?,?,?,?,?,?)").run(r.id, r.projectType, r.name, r.version, r.status, typeof r.data === "string" ? r.data : JSON.stringify(r.data), r.source, r.createdAt, r.createdBy, r.publishedAt);
  } };
}

async function request(env, user = "admin", userId = 1) {
  const authorization = user === null ? "" : "Bearer " + await signToken({ SESSION_SECRET: SECRET }, userId, user);
  const response = await onRequestGet({ env, request: new Request("https://example.test/api/reportlogicexport", { headers: { authorization } }) });
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, data: await response.json() };
}

test("export enforces login and admin allowlist without requiring publication password", async () => {
  const f = fixture();
  try {
    f.add();
    assert.equal((await request(f.env, null)).status, 401);
    assert.equal(f.calls.length, 0);
    assert.equal((await request(f.env, "ordinary-user")).status, 403);
    assert.equal(f.calls.filter(sql => sql.includes("report_logic_sets")).length, 0);
    assert.equal((await request(f.env)).status, 200);
    assert.equal((await request(f.env, "numeric-admin", 8)).status, 200);
    assert.ok(f.calls.every(sql => /^\s*(SELECT|WITH)\b/i.test(sql)));
  } finally { f.connection.close(); }
});

test("disabled and revoked admin tokens remain rejected by shared authentication", async () => {
  const f = fixture();
  try {
    f.add();
    f.connection.prepare("INSERT INTO account_security VALUES(?,?,?,?)").run(1, 1, 0, 0);
    assert.equal((await request(f.env)).status, 401);
    f.connection.prepare("UPDATE account_security SET disabled=0, revoked_before=? WHERE user_id=1").run(Date.now() + 60000);
    assert.equal((await request(f.env)).status, 401);
    assert.equal(f.calls.filter(sql => sql.includes("report_logic_sets")).length, 0);
  } finally { f.connection.close(); }
});

test("existing authentication callers retain lazy initialization unless explicitly read-only", async () => {
  const connection = new DatabaseSync(":memory:"), calls = [];
  const DB = { prepare(sql) {
    calls.push(sql);
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async run() { connection.prepare(sql).run(...params); return { success: true }; },
      async first() { return connection.prepare(sql).get(...params) || null; }
    };
  } };
  try {
    const token = await signToken({ SESSION_SECRET: SECRET }, 1, "admin");
    const req = new Request("https://example.test/api/legacy", { headers: { authorization: "Bearer " + token } });
    assert.deepEqual(await verifyAuth(req, { DB, SESSION_SECRET: SECRET }), { userId: 1, username: "admin" });
    assert.equal(calls.filter(sql => sql.startsWith("CREATE TABLE")).length, 2);
    calls.length = 0;
    assert.deepEqual(await verifyAuth(req, { DB, SESSION_SECRET: SECRET }, { readOnly: true }), { userId: 1, username: "admin" });
    assert.ok(calls.every(sql => sql.startsWith("SELECT")));
  } finally { connection.close(); }
});

test("empty library is an explicit empty snapshot and never seeds rules", async () => {
  const f = fixture();
  try {
    const out = await request(f.env);
    assert.equal(out.status, 200);
    assert.deepEqual(out.data.sets, []);
    assert.equal(out.data.schemaVersion, "report-logic-export-v1");
    assert.ok(Number.isFinite(Date.parse(out.data.capturedAt)));
    assert.equal(out.data.runtime.writingStandardVersion, "report-writing-standard-v1");
    assert.equal(out.data.runtime.writingRuleVersion, "direct-business-v2");
    assert.equal(f.calls.filter(sql => sql.includes("report_logic_sets")).length, 1);
  } finally { f.connection.close(); }
});

test("single real SQL snapshot selects current published and last actually published history", async () => {
  const f = fixture();
  try {
    f.add({ id: "rent-old-1", version: 1, status: "archived", publishedAt: 100 });
    f.add({ id: "rent-old-2", version: 2, status: "archived", publishedAt: 200 });
    f.add({ id: "rent-never-published", version: 3, status: "archived", publishedAt: null, data: "invalid-but-unused" });
    f.add({ id: "rent-draft-4", version: 4, status: "draft", publishedAt: 400, data: "invalid-but-unused" });
    f.add({ id: "rent-live-5", version: 5, publishedAt: 500 });
    f.add({ id: "rent-draft-6", version: 6, status: "draft", publishedAt: null });
    f.add({ id: "rent-future-archive", version: 7, status: "archived", publishedAt: 700 });
    f.add({ id: "gaibao-live", projectType: "gaibao", data: sampleData("gaibao") });
    f.add({ id: "future-type-live", projectType: "industrial_reuse", data: sampleData("industrial_reuse") });
    const out = await request(f.env);
    assert.equal(out.status, 200, JSON.stringify(out.data));
    assert.equal(out.data.sets.length, 3);
    const rent = out.data.sets.find(set => set.projectType === "rent");
    assert.equal(rent.id, "rent-live-5");
    assert.equal(rent.previous.id, "rent-old-2");
    assert.equal(rent.previous.status, "archived");
    assert.equal("previous" in rent.previous, false);
    assert.equal(out.data.sets.find(set => set.projectType === "industrial_reuse").previous, null);
    assert.equal(f.calls.filter(sql => sql === SNAPSHOT_SQL).length, 1);
  } finally { f.connection.close(); }
});

test("latest values reload on each request, remain complete, and are not limited to 100 records", async () => {
  const f = fixture();
  try {
    const original = sampleData("rent", "完整原文".repeat(20000));
    f.add({ data: original });
    for (let i = 0; i < 110; i++) f.add({ id: "other-" + i, projectType: "type-" + i, data: sampleData("type-" + i) });
    const first = await request(f.env);
    assert.equal(first.data.sets.length, 111);
    assert.deepEqual(first.data.sets.find(set => set.projectType === "rent").data, original);
    f.connection.exec("UPDATE report_logic_sets SET status='archived' WHERE id='rent-1'");
    f.add({ id: "rent-2", version: 2, data: sampleData("rent", "本次新发布") });
    const next = await request(f.env);
    assert.equal(next.data.sets.find(set => set.projectType === "rent").data.rules[0].writingLogic, "本次新发布");
    assert.deepEqual(next.data.sets.find(set => set.projectType === "rent").previous.data, original);
  } finally { f.connection.close(); }
});

test("damaged current or previous data fails the complete export without silently skipping a type", async () => {
  for (const broken of ["not JSON", "null", "[]", "{}", '{"rules":[]}', '{"rules":[null]}', '{"rules":[{}]}']) {
    for (const previous of [false, true]) {
      const f = fixture();
      try {
        if (previous) {
          f.add({ id: "rent-old", version: 1, status: "archived", data: broken });
          f.add({ id: "rent-new", version: 2 });
        } else f.add({ data: broken });
        const out = await request(f.env);
        assert.equal(out.status, 500, broken);
        assert.equal(out.data.ok, false);
        assert.equal("sets" in out.data, false);
        assert.match(out.data.error, /损坏|不完整/);
      } finally { f.connection.close(); }
    }
  }
});

test("missing schema and DB failures report errors without initialization or leaking SQL", async () => {
  for (const options of [{ securityTable: false }, { logicTable: false }]) {
    const f = fixture(options);
    try {
      const out = await request(f.env);
      assert.equal(out.status, 500);
      assert.equal(out.data.ok, false);
      assert.doesNotMatch(out.data.error, /SELECT|CREATE TABLE|no such table/);
      assert.ok(f.calls.every(sql => /^\s*(SELECT|WITH)\b/i.test(sql)));
    } finally { f.connection.close(); }
  }
  const failed = await request({ SESSION_SECRET: SECRET, ADMIN_USERS: "admin", DB: { prepare() { throw new Error("private-db-password SQL connection error"); } } });
  assert.equal(failed.status, 500);
  assert.doesNotMatch(failed.data.error, /private-db-password/);
});

test("snapshot transformation rejects invalid driver results and preserves unknown stored fields", () => {
  assert.throws(() => snapshotFromRows(undefined), /有效数据/);
  const row = { export_role: "current", id: "current", project_type: "rent", name: "原名", version: "2", status: "published", data: JSON.stringify(sampleData()), created_at: "1000", published_at: "2000" };
  assert.deepEqual(snapshotFromRows([row], "2026-10-19T00:00:00.000Z").sets[0].data, sampleData());
  assert.throws(() => snapshotFromRows([row, row]), /快照不一致/);
  assert.throws(() => snapshotFromRows([{ ...row, version: "invalid" }]), /元数据损坏/);
  assert.throws(() => snapshotFromRows([{ ...row, export_role: "previous" }]), /历史版本快照不一致/);
  assert.throws(() => snapshotFromRows([{ ...row, data: JSON.stringify(sampleData("gaibao")) }]), /结构不一致/);
  const duplicate = sampleData();
  duplicate.rules.push({ ...duplicate.rules[0] });
  assert.throws(() => snapshotFromRows([{ ...row, data: JSON.stringify(duplicate) }]), /结构不一致/);
});
