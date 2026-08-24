import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/ppttemplates.js";
import { signToken } from "../functions/api/_auth.js";

function dbMock() {
  const state = { templates: [{ id: "pt_demo", user_id: 2, name: "已发布模板.pptx", status: "published", storage_key: "user-2/demo.pptx", profile: "{}" }] };
  return { state, prepare(sql) {
    const query = { args: [] };
    return { bind(...args) { query.args = args; return this; }, async run() {
      if (sql.startsWith("DELETE FROM ppt_templates WHERE id=?")) state.templates = state.templates.filter(item => item.id !== query.args[0]);
      return { success: true };
    }, async first() {
      if (sql.includes("FROM ppt_templates WHERE id=?")) return state.templates.find(item => item.id === query.args[0]) || null;
      return null;
    }, async all() { return { results: [...state.templates] }; } };
  } };
}

async function call(env, userId, username, body, extra = {}) {
  const token = await signToken(env, userId, username);
  const request = new Request("http://test/api/ppttemplates", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
  const response = await onRequestPost({ request, env });
  return { status: response.status, data: await response.json() };
}

test("管理员可永久删除已发布PPT模板，普通用户不能删除", async () => {
  const DB = dbMock(), env = { DB, SESSION_SECRET: "template-delete-test", DEPLOY_MODE: "local", ADMIN_USERS: "admin", ADMIN_PASS: "admin-test" };
  const blocked = await call(env, 2, "owner", { action: "delete", id: "pt_demo" });
  assert.equal(blocked.status, 403);
  assert.equal(DB.state.templates.length, 1);

  const deleted = await call(env, 1, "admin", { action: "delete", id: "pt_demo" }, { "x-admin-pass": "admin-test" });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.deleted, true);
  assert.equal(deleted.data.storageKey, "user-2/demo.pptx");
  assert.equal(DB.state.templates.length, 0);

  const missing = await call(env, 1, "admin", { action: "delete", id: "pt_demo" }, { "x-admin-pass": "admin-test" });
  assert.equal(missing.status, 404);
});
