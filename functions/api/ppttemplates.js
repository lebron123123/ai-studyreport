// AI PPT template governance: user drafts/submissions + administrator approval/publishing.
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { applyTemplateReview, compactTemplateProfile } from "./_ppttemplate-profile.js";

let ready = false;
const clean = (value, max = 200000) => String(value == null ? "" : value).trim().slice(0, max);
const parse = (value, fallback = {}) => { try { return JSON.parse(value || "") || fallback; } catch { return fallback; } };
const newId = () => "pt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function isAdmin(env, user) { const list = (env.ADMIN_USERS || "").split(",").map(value => value.trim()).filter(Boolean); return list.includes(user.username) || list.includes(String(user.userId)); }
function passOk(env, request) { return !env.ADMIN_PASS || request.headers.get("x-admin-pass") === env.ADMIN_PASS; }

async function schema(env) {
  if (ready) return;
  const timestampType = env.DEPLOY_MODE === "local" ? "BIGINT" : "INTEGER";
  for (const statement of [
    "CREATE TABLE IF NOT EXISTS ppt_templates (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',category TEXT DEFAULT 'custom',storage_key TEXT DEFAULT '',fingerprint TEXT DEFAULT '',profile TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,review_note TEXT DEFAULT '',created_at " + timestampType + " NOT NULL,updated_at " + timestampType + " NOT NULL,reviewed_at " + timestampType + ",reviewed_by TEXT DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS idx_ppt_templates_status ON ppt_templates(status,updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ppt_templates_user ON ppt_templates(user_id,updated_at DESC)"
  ]) await env.DB.prepare(statement).run();
  ready = true;
}

function outputRow(row) {
  return row ? { ...row, profile: parse(row.profile, {}), created_at: Number(row.created_at || 0), updated_at: Number(row.updated_at || 0), reviewed_at: Number(row.reviewed_at || 0) } : null;
}

export async function onRequestPost(context) {
  const env = adaptEnv(context.env), user = await verifyAuth(context.request, env);
  if (!user) return json({ ok: false, error: "未登录" }, 401);
  try { await schema(env); } catch (error) { return json({ ok: false, error: "模板治理初始化失败：" + error.message }, 500); }
  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: "请求格式有误" }, 400); }
  const action = clean(body.action, 30) || "list";

  if (action === "list") {
    const rows = await env.DB.prepare("SELECT * FROM ppt_templates WHERE status='published' OR user_id=? ORDER BY CASE WHEN status='published' THEN 0 ELSE 1 END,updated_at DESC LIMIT 300").bind(user.userId).all();
    return json({ ok: true, items: (rows.results || []).map(outputRow) });
  }
  if (action === "adminList") {
    if (!isAdmin(env, user) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可查看模板审核队列" }, 403);
    const rows = await env.DB.prepare("SELECT * FROM ppt_templates ORDER BY updated_at DESC LIMIT 500").all();
    return json({ ok: true, items: (rows.results || []).map(outputRow) });
  }
  if (action === "save") {
    const item = body.item || {}, now = Date.now(), templateId = clean(item.id, 80) || newId();
    const old = await env.DB.prepare("SELECT * FROM ppt_templates WHERE id=? AND user_id=?").bind(templateId, user.userId).first();
    const name = clean(item.name, 120) || "未命名参考模板";
    const profile = JSON.stringify(compactTemplateProfile(item.profile && typeof item.profile === "object" ? item.profile : {}));
    if (profile.length > 600000) return json({ ok: false, error: "模板分析结果过大" }, 413);
    if (old) {
      await env.DB.prepare("UPDATE ppt_templates SET name=?,status='draft',category=?,storage_key=?,fingerprint=?,profile=?,version=version+1,updated_at=? WHERE id=? AND user_id=?")
        .bind(name, clean(item.category, 40) || "custom", clean(item.storage_key, 300), clean(item.fingerprint, 100), profile, now, templateId, user.userId).run();
    } else {
      await env.DB.prepare("INSERT INTO ppt_templates(id,user_id,name,status,category,storage_key,fingerprint,profile,version,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?,1,?,?)")
        .bind(templateId, user.userId, name, clean(item.category, 40) || "custom", clean(item.storage_key, 300), clean(item.fingerprint, 100), profile, now, now).run();
    }
    return json({ ok: true, item: outputRow(await env.DB.prepare("SELECT * FROM ppt_templates WHERE id=?").bind(templateId).first()) });
  }
  if (action === "profileReview") {
    if (!isAdmin(env, user) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可维护页面准入与槽位" }, 403);
    const templateId = clean(body.id, 80), row = await env.DB.prepare("SELECT * FROM ppt_templates WHERE id=?").bind(templateId).first();
    if (!row) return json({ ok: false, error: "模板不存在" }, 404);
    let profile;
    try { profile = applyTemplateReview(parse(row.profile, {}), body.review || {}, user.username); }
    catch (error) { return json({ ok: false, error: error.message || "页面准入保存失败" }, 400); }
    const payload = JSON.stringify(profile);
    if (payload.length > 600000) return json({ ok: false, error: "准入合同过大，请减少候选页" }, 413);
    await env.DB.prepare("UPDATE ppt_templates SET profile=?,version=version+1,updated_at=? WHERE id=?").bind(payload, Date.now(), templateId).run();
    return json({ ok: true, item: outputRow(await env.DB.prepare("SELECT * FROM ppt_templates WHERE id=?").bind(templateId).first()) });
  }
  if (action === "submit") {
    const row = await env.DB.prepare("SELECT * FROM ppt_templates WHERE id=? AND user_id=?").bind(clean(body.id, 80), user.userId).first();
    if (!row) return json({ ok: false, error: "模板不存在" }, 404);
    await env.DB.prepare("UPDATE ppt_templates SET status='pending',updated_at=? WHERE id=?").bind(Date.now(), row.id).run();
    return json({ ok: true, message: "已提交管理员审核；通过前仅本人可用" });
  }
  if (action === "review") {
    if (!isAdmin(env, user) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可审核模板" }, 403);
    const status = body.decision === "publish" ? "published" : body.decision === "reject" ? "rejected" : "draft";
    await env.DB.prepare("UPDATE ppt_templates SET status=?,review_note=?,reviewed_at=?,reviewed_by=?,updated_at=? WHERE id=?")
      .bind(status, clean(body.note, 1000), Date.now(), user.username, Date.now(), clean(body.id, 80)).run();
    return json({ ok: true, status });
  }
  if (action === "delete") {
    if (!isAdmin(env, user) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可永久删除模板" }, 403);
    const templateId = clean(body.id, 80), row = await env.DB.prepare("SELECT * FROM ppt_templates WHERE id=?").bind(templateId).first();
    if (!row) return json({ ok: false, error: "模板不存在或已删除" }, 404);
    await env.DB.prepare("DELETE FROM ppt_templates WHERE id=?").bind(templateId).run();
    return json({ ok: true, deleted: true, id: templateId, name: row.name, storageKey: row.storage_key || "" });
  }
  return json({ ok: false, error: "未知操作" }, 400);
}
