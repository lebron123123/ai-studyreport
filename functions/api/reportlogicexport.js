// Read-only snapshot for the administrator's logic workbook. Never seeds or publishes rules.
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import "../../report-writing-standard.js";

const SCHEMA_VERSION = "report-logic-export-v1";
const SNAPSHOT_SQL = `WITH current_ranked AS (
  SELECT s.*, ROW_NUMBER() OVER (
    PARTITION BY project_type ORDER BY version DESC, published_at DESC, id DESC
  ) AS export_rank
  FROM report_logic_sets s WHERE status = 'published'
), current_sets AS (
  SELECT * FROM current_ranked WHERE export_rank = 1
), previous_ranked AS (
  SELECT h.*, ROW_NUMBER() OVER (
    PARTITION BY h.project_type ORDER BY h.version DESC, h.published_at DESC, h.id DESC
  ) AS export_rank
  FROM report_logic_sets h JOIN current_sets c ON c.project_type = h.project_type
  WHERE h.status IN ('published', 'archived') AND h.published_at > 0 AND h.version < c.version
)
SELECT 'current' AS export_role, id, project_type, name, version, status, data,
  source_name, created_at, created_by, published_at FROM current_sets
UNION ALL
SELECT 'previous' AS export_role, id, project_type, name, version, status, data,
  source_name, created_at, created_by, published_at FROM previous_ranked WHERE export_rank = 1
ORDER BY project_type, export_role`;

function response(body, status = 200) {
  const result = json(body, status);
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("Pragma", "no-cache");
  result.headers.set("Vary", "Authorization");
  return result;
}

function rowToSet(row) {
  let data;
  try { data = JSON.parse(row.data); }
  catch { throw new Error("逻辑版本数据损坏，请管理员核查原始记录后重试"); }
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.rules) || !data.rules.length ||
      data.rules.some(rule => !rule || typeof rule !== "object" || Array.isArray(rule) ||
        ["id", "chapter", "section"].some(key => typeof rule[key] !== "string" || !rule[key].trim()))) {
    throw new Error("逻辑版本结构不完整，请管理员核查原始记录后重试");
  }
  if (new Set(data.rules.map(rule => rule.id)).size !== data.rules.length ||
      (data.projectType !== undefined && data.projectType !== row.project_type)) {
    throw new Error("逻辑版本结构不一致，请管理员核查原始记录后重试");
  }
  const version = Number(row.version), createdAt = Number(row.created_at || 0), publishedAt = Number(row.published_at || 0);
  if (!row.id || !row.project_type || !Number.isSafeInteger(version) || version < 1 ||
      !Number.isSafeInteger(createdAt) || !Number.isSafeInteger(publishedAt)) {
    throw new Error("逻辑版本元数据损坏，请管理员核查原始记录后重试");
  }
  return {
    id: row.id, projectType: row.project_type, name: row.name, version, status: row.status,
    sourceName: row.source_name || "", createdAt, createdBy: row.created_by || "", publishedAt, data
  };
}

function snapshotFromRows(rows, capturedAt = new Date().toISOString()) {
  if (!Array.isArray(rows)) throw new Error("逻辑库未返回有效数据，请稍后重试");
  const current = new Map(), previous = new Map();
  for (const row of rows) {
    const set = rowToSet(row);
    const target = row.export_role === "current" ? current : row.export_role === "previous" ? previous : null;
    if (!target || target.has(set.projectType)) throw new Error("逻辑版本快照不一致，请稍后重试");
    target.set(set.projectType, set);
  }
  for (const [projectType, old] of previous) {
    const latest = current.get(projectType);
    if (!latest || old.version >= latest.version || !old.publishedAt || !["archived", "published"].includes(old.status)) {
      throw new Error("逻辑历史版本快照不一致，请稍后重试");
    }
  }
  const sets = Array.from(current.values(), set => {
    if (set.status !== "published") throw new Error("逻辑当前版本未发布，不能作为已发布版导出");
    return { ...set, previous: previous.get(set.projectType) || null };
  });
  return {
    ok: true, schemaVersion: SCHEMA_VERSION, capturedAt, sets,
    runtime: {
      writingStandardVersion: globalThis.ReportWritingStandard.VERSION,
      writingRuleVersion: globalThis.ReportWritingStandard.RULE_VERSION
    }
  };
}

export async function onRequestGet(context) {
  let env, user;
  try {
    env = adaptEnv(context.env);
    if (!env.DB) throw new Error("数据库未配置");
    user = await verifyAuth(context.request, env, { readOnly: true });
  } catch {
    return response({ ok: false, error: "无法核验导出权限，请管理员检查账号安全数据与数据库连接" }, 500);
  }
  if (!user) return response({ ok: false, error: "请先登录后再下载逻辑" }, 401);
  const admins = String(env.ADMIN_USERS || "").split(",").map(value => value.trim()).filter(Boolean);
  if (!admins.some(value => value === user.username || value === String(user.userId))) {
    return response({ ok: false, error: "仅管理员可下载生成逻辑" }, 403);
  }
  try {
    const rows = await env.DB.prepare(SNAPSHOT_SQL).all();
    return response(snapshotFromRows(rows.results));
  } catch (error) {
    const known = /^逻辑/.test(error.message || "");
    return response({ ok: false, error: known ? error.message : "读取逻辑版本失败，请管理员检查逻辑库是否已初始化及数据库连接" }, 500);
  }
}

export { SNAPSHOT_SQL, snapshotFromRows };
