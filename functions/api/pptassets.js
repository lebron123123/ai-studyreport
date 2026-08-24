// AI PPT 素材中心：个人/项目素材沉淀、部门共享审核、使用记录与来源追溯。
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

const MAX_DATA_URL = 16 * 1024 * 1024;
const MAX_THUMB_URL = 2 * 1024 * 1024;
const clean = (v, n = 1000) => String(v == null ? "" : v).trim().slice(0, n);
const parse = (v, fallback = []) => { try { return JSON.parse(v || "") || fallback; } catch (_) { return fallback; } };
const makeId = prefix => prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const isAdmin = (env, u) => (env.ADMIN_USERS || "").split(",").map(x => x.trim()).filter(Boolean).some(x => x === u.username || x === String(u.userId));
const passOk = (env, request) => !env.ADMIN_PASS || request.headers.get("x-admin-pass") === env.ADMIN_PASS;

async function ensureSchema(env) {
  const ts = env.DEPLOY_MODE === "local" ? "BIGINT" : "INTEGER";
  const sql = [
    "CREATE TABLE IF NOT EXISTS ppt_assets (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,username TEXT DEFAULT '',scope TEXT NOT NULL DEFAULT 'personal',project_id TEXT DEFAULT '',title TEXT NOT NULL,description TEXT DEFAULT '',category TEXT DEFAULT 'image',tags TEXT NOT NULL DEFAULT '[]',mime_type TEXT DEFAULT 'image/png',width INTEGER DEFAULT 0,height INTEGER DEFAULT 0,bytes INTEGER DEFAULT 0,content_hash TEXT NOT NULL,data_url TEXT NOT NULL,thumbnail_url TEXT DEFAULT '',provider TEXT DEFAULT 'upload',source_ref TEXT DEFAULT '',prompt TEXT DEFAULT '',model TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',favorite INTEGER NOT NULL DEFAULT 0,usage_count INTEGER NOT NULL DEFAULT 0,review_note TEXT DEFAULT '',created_at " + ts + " NOT NULL,updated_at " + ts + " NOT NULL,reviewed_at " + ts + ",reviewed_by TEXT DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS idx_ppt_assets_user ON ppt_assets(user_id,updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ppt_assets_status ON ppt_assets(status,updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ppt_assets_project ON ppt_assets(project_id,updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ppt_assets_hash ON ppt_assets(content_hash)",
    "CREATE TABLE IF NOT EXISTS ppt_asset_usage (id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,user_id INTEGER NOT NULL,project_id TEXT DEFAULT '',slide_id TEXT DEFAULT '',usage_type TEXT DEFAULT 'ppt-slide',created_at " + ts + " NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_ppt_asset_usage_asset ON ppt_asset_usage(asset_id,created_at DESC)"
  ];
  for (const statement of sql) await env.DB.prepare(statement).run();
}

function safeTags(value) {
  const tags = Array.isArray(value) ? value : parse(value, []);
  return [...new Set(tags.map(x => clean(x, 40)).filter(Boolean))].slice(0, 20);
}

function assetOut(row, includeData = false) {
  if (!row) return null;
  const out = {
    id: row.id, userId: Number(row.user_id), username: row.username || "", scope: row.scope,
    projectId: row.project_id || "", title: row.title, description: row.description || "",
    category: row.category || "image", tags: safeTags(row.tags), mimeType: row.mime_type || "image/png",
    width: Number(row.width || 0), height: Number(row.height || 0), bytes: Number(row.bytes || 0),
    thumbnailUrl: row.thumbnail_url || "", provider: row.provider || "upload", sourceRef: row.source_ref || "",
    prompt: row.prompt || "", model: row.model || "", status: row.status || "draft",
    favorite: !!Number(row.favorite || 0), usageCount: Number(row.usage_count || 0),
    reviewNote: row.review_note || "", createdAt: Number(row.created_at || 0), updatedAt: Number(row.updated_at || 0),
    reviewedAt: Number(row.reviewed_at || 0), reviewedBy: row.reviewed_by || ""
  };
  if (includeData) out.dataUrl = row.data_url || "";
  return out;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(x => x.toString(16).padStart(2, "0")).join("");
}

function validImageUrl(value) {
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value);
}

function approximateBytes(dataUrl) {
  const body = String(dataUrl).split(",")[1] || "";
  return Math.max(0, Math.floor(body.replace(/\s/g, "").length * 0.75));
}

async function loadVisible(env, userId, id, includeData = false) {
  const row = await env.DB.prepare("SELECT * FROM ppt_assets WHERE id=? AND (user_id=? OR (status='published' AND scope IN ('department','system'))) LIMIT 1").bind(id, userId).first();
  return assetOut(row, includeData);
}

export async function onRequestPost(context) {
  const env = adaptEnv(context.env);
  const u = await verifyAuth(context.request, env);
  if (!u) return json({ ok: false, error: "未登录" }, 401);
  try { await ensureSchema(env); } catch (e) { return json({ ok: false, error: "素材中心初始化失败：" + e.message }, 500); }
  let body;
  try { body = await context.request.json(); } catch (_) { return json({ ok: false, error: "请求格式有误" }, 400); }
  const action = clean(body.action, 30) || "list";

  if (action === "list") {
    const search = clean(body.search, 120).toLowerCase();
    const scope = ["all", "personal", "project", "department", "favorite", "pending"].includes(body.scope) ? body.scope : "all";
    const rows = await env.DB.prepare("SELECT * FROM ppt_assets WHERE user_id=? OR (status='published' AND scope IN ('department','system')) ORDER BY updated_at DESC LIMIT 300").bind(u.userId).all();
    const items = (rows.results || []).filter(r => {
      if (scope === "personal" && !(r.user_id == u.userId && r.scope === "personal")) return false;
      if (scope === "project" && !(r.user_id == u.userId && r.scope === "project")) return false;
      if (scope === "department" && !(r.status === "published" && ["department", "system"].includes(r.scope))) return false;
      if (scope === "favorite" && !(r.user_id == u.userId && Number(r.favorite))) return false;
      if (scope === "pending" && !(r.user_id == u.userId && r.status === "pending")) return false;
      if (body.projectId && r.project_id !== clean(body.projectId, 100)) return false;
      if (search) {
        const hay = [r.title, r.description, r.tags, r.provider, r.prompt].join(" ").toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return r.status !== "archived";
    }).slice(0, Math.min(200, Math.max(1, Number(body.limit) || 100))).map(r => assetOut(r, false));
    return json({ ok: true, items });
  }

  if (action === "get") {
    const item = await loadVisible(env, u.userId, clean(body.id, 100), true);
    return item ? json({ ok: true, item }) : json({ ok: false, error: "素材不存在或无权访问" }, 404);
  }

  if (action === "create") {
    const item = body.item || {}, dataUrl = clean(item.dataUrl, MAX_DATA_URL + 1), thumb = clean(item.thumbnailUrl, MAX_THUMB_URL + 1);
    if (!validImageUrl(dataUrl)) return json({ ok: false, error: "当前仅支持 PNG/JPEG/WebP/GIF 图片素材" }, 400);
    if (dataUrl.length > MAX_DATA_URL || thumb.length > MAX_THUMB_URL) return json({ ok: false, error: "图片过大，请压缩到约 12MB 以内" }, 413);
    if (thumb && !validImageUrl(thumb)) return json({ ok: false, error: "缩略图格式无效" }, 400);
    const hash = await digest(dataUrl), now = Date.now();
    const old = await env.DB.prepare("SELECT * FROM ppt_assets WHERE user_id=? AND content_hash=? AND status<>'archived' ORDER BY updated_at DESC LIMIT 1").bind(u.userId, hash).first();
    if (old) return json({ ok: true, duplicate: true, item: assetOut(old, true) });
    const id = makeId("pa"), scope = item.projectId ? "project" : "personal";
    await env.DB.prepare("INSERT INTO ppt_assets(id,user_id,username,scope,project_id,title,description,category,tags,mime_type,width,height,bytes,content_hash,data_url,thumbnail_url,provider,source_ref,prompt,model,status,favorite,usage_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft',0,0,?,?)")
      .bind(id, u.userId, u.username || "", scope, clean(item.projectId, 100), clean(item.title, 160) || "未命名图片素材", clean(item.description, 1000), "image", JSON.stringify(safeTags(item.tags)), clean(item.mimeType, 80) || (dataUrl.match(/^data:([^;]+)/i) || [])[1] || "image/png", Math.max(0, Number(item.width) || 0), Math.max(0, Number(item.height) || 0), approximateBytes(dataUrl), hash, dataUrl, thumb, clean(item.provider, 60) || "upload", clean(item.sourceRef, 300), clean(item.prompt, 4000), clean(item.model, 120), now, now).run();
    return json({ ok: true, item: assetOut(await env.DB.prepare("SELECT * FROM ppt_assets WHERE id=?").bind(id).first(), true) });
  }

  if (action === "favorite") {
    const id = clean(body.id, 100), value = body.value ? 1 : 0;
    const own = await env.DB.prepare("SELECT id FROM ppt_assets WHERE id=? AND user_id=?").bind(id, u.userId).first();
    if (!own) return json({ ok: false, error: "仅可收藏自己的素材；部门素材应用后会复制到项目" }, 403);
    await env.DB.prepare("UPDATE ppt_assets SET favorite=?,updated_at=? WHERE id=? AND user_id=?").bind(value, Date.now(), id, u.userId).run();
    return json({ ok: true, favorite: !!value });
  }

  if (action === "submit") {
    const id = clean(body.id, 100), own = await env.DB.prepare("SELECT * FROM ppt_assets WHERE id=? AND user_id=?").bind(id, u.userId).first();
    if (!own) return json({ ok: false, error: "素材不存在" }, 404);
    if (own.status === "published") return json({ ok: false, error: "已发布素材无需重复提交" }, 409);
    await env.DB.prepare("UPDATE ppt_assets SET scope='department',status='pending',review_note='',updated_at=? WHERE id=? AND user_id=?").bind(Date.now(), id, u.userId).run();
    return json({ ok: true, message: "已提交部门素材审核；通过前仍仅本人可见" });
  }

  if (action === "use") {
    const id = clean(body.id, 100), item = await loadVisible(env, u.userId, id, true);
    if (!item) return json({ ok: false, error: "素材不存在或无权使用" }, 404);
    await env.DB.prepare("UPDATE ppt_assets SET usage_count=usage_count+1,updated_at=? WHERE id=?").bind(Date.now(), id).run();
    await env.DB.prepare("INSERT INTO ppt_asset_usage(id,asset_id,user_id,project_id,slide_id,usage_type,created_at) VALUES(?,?,?,?,?,?,?)").bind(makeId("pu"), id, u.userId, clean(body.projectId, 100), clean(body.slideId, 100), clean(body.usageType, 40) || "ppt-slide", Date.now()).run();
    item.usageCount += 1;
    return json({ ok: true, item });
  }

  if (action === "delete") {
    const id = clean(body.id, 100), own = await env.DB.prepare("SELECT * FROM ppt_assets WHERE id=? AND user_id=?").bind(id, u.userId).first();
    if (!own) return json({ ok: false, error: "素材不存在" }, 404);
    if (own.status === "published") return json({ ok: false, error: "已发布部门素材需由管理员撤回或删除" }, 409);
    await env.DB.prepare("DELETE FROM ppt_asset_usage WHERE asset_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM ppt_assets WHERE id=? AND user_id=?").bind(id, u.userId).run();
    return json({ ok: true });
  }

  if (action === "adminList") {
    if (!isAdmin(env, u) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可管理部门素材" }, 403);
    const status = ["all", "pending", "published", "rejected", "archived", "draft"].includes(body.status) ? body.status : "pending";
    const rows = status === "all" ? await env.DB.prepare("SELECT * FROM ppt_assets ORDER BY updated_at DESC LIMIT 500").all() : await env.DB.prepare("SELECT * FROM ppt_assets WHERE status=? ORDER BY updated_at DESC LIMIT 500").bind(status).all();
    return json({ ok: true, items: (rows.results || []).map(r => assetOut(r, false)) });
  }

  if (action === "review") {
    if (!isAdmin(env, u) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可审核素材" }, 403);
    const decision = clean(body.decision, 20), status = decision === "publish" ? "published" : decision === "reject" ? "rejected" : decision === "archive" ? "archived" : "draft";
    const scope = status === "published" ? "department" : status === "archived" ? "department" : "personal";
    await env.DB.prepare("UPDATE ppt_assets SET status=?,scope=?,review_note=?,reviewed_at=?,reviewed_by=?,updated_at=? WHERE id=?").bind(status, scope, clean(body.note, 1000), Date.now(), u.username || String(u.userId), Date.now(), clean(body.id, 100)).run();
    return json({ ok: true, status });
  }

  if (action === "adminDelete") {
    if (!isAdmin(env, u) || !passOk(env, context.request)) return json({ ok: false, error: "仅管理员可删除部门素材" }, 403);
    const id = clean(body.id, 100);
    await env.DB.prepare("DELETE FROM ppt_asset_usage WHERE asset_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM ppt_assets WHERE id=?").bind(id).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: "未知操作" }, 400);
}
