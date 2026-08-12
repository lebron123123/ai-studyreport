import assert from "node:assert/strict";
import { createD1Shim } from "../local-server/d1-shim.js";
import { createVectorStore } from "../local-server/vector-pg.js";
import { onRequestPost as materialsPost } from "../functions/api/materials.js";
import { signToken } from "../functions/api/_auth.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = createD1Shim(databaseUrl);
const vectorize = createVectorStore(db, 1024);
const runId = "E2E-" + Date.now();
const env = {
  DEPLOY_MODE: "local",
  DB: db,
  VECTORIZE: vectorize,
  SESSION_SECRET: "materials-e2e-session-only",
  ADMIN_USERS: "e2e",
  ADMIN_PASS: "",
};
const token = await signToken(env, 999999, "e2e");
const createdAssetIds = new Set();

async function post(action, payload = {}) {
  const request = new Request("http://local.test/api/materials", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const response = await materialsPost({ request, env });
  const body = await response.json();
  assert.equal(response.ok, true, `${action} failed: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, `${action} returned ok=false: ${JSON.stringify(body)}`);
  return body;
}

async function cleanupOrphanRagTest() {
  const title = "materials-excel-test";
  const row = await db.prepare("SELECT ids FROM rag_files_v2 WHERE title=?").bind(title).first();
  let ids = [];
  try { ids = row ? JSON.parse(row.ids || "[]") : []; } catch { ids = []; }
  await vectorize.deleteByIds(ids);
  await db.prepare("DELETE FROM rag_text_chunks WHERE title=?").bind(title).run();
  await db.prepare("DELETE FROM rag_file_meta WHERE title=?").bind(title).run();
  await db.prepare("DELETE FROM rag_files_v2 WHERE title=?").bind(title).run();
  const assets = await db.prepare("SELECT id FROM source_assets WHERE title=?").bind(title).all();
  for (const asset of assets.results || []) await post("deleteAsset", { assetId: asset.id });
  return ids.length;
}

const result = {
  versionSnapshots: 0,
  versionDiffAdded: 0,
  versionDiffRemoved: 0,
  replacementGovernance: false,
  bulkAccepted: 0,
  excelCell: "",
  excelValue: "",
  mappingsResolved: 0,
  orphanRagVectorsRemoved: 0,
  cleanupRemaining: -1,
};

try {
  const versionDocNo = runId + "-VERSION";
  const v1 = await post("saveAsset", { asset: {
    title: runId + " 版本差异测试",
    document_type: "policy",
    category: "政策文件",
    effect_status: "current",
    doc_no: versionDocNo,
    version_no: "v1",
    content_hash: runId + "-hash-v1",
    content_text: "第一条：原标准为10万元。\n第二条：保持不变。",
  } });
  createdAssetIds.add(v1.asset.id);
  const v2 = await post("saveAsset", { asset: {
    title: runId + " 版本差异测试",
    document_type: "policy",
    category: "政策文件",
    effect_status: "current",
    doc_no: versionDocNo,
    version_no: "v2",
    content_hash: runId + "-hash-v2",
    content_text: "第一条：新标准为12万元。\n第二条：保持不变。\n第三条：新增复核要求。",
  } });
  assert.equal(v2.asset.id, v1.asset.id, "same doc_no must update one asset");
  const versions = await post("assetVersions", { assetId: v1.asset.id });
  assert.equal(versions.versions.length, 2, "expected two version snapshots");
  result.versionSnapshots = versions.versions.length;
  const ordered = [...versions.versions].sort((a, b) => a.version_no.localeCompare(b.version_no));
  const compared = await post("compareVersions", {
    fromVersionId: ordered[0].id,
    toVersionId: ordered[1].id,
  });
  assert.ok(compared.added.some((x) => x.includes("12万元")), "new line missing from diff");
  assert.ok(compared.removed.some((x) => x.includes("10万元")), "old line missing from diff");
  result.versionDiffAdded = compared.added.length;
  result.versionDiffRemoved = compared.removed.length;

  const oldDocNo = runId + "-OLD";
  const oldDoc = await post("saveAsset", { asset: {
    title: runId + " 被替代制度",
    document_type: "policy",
    effect_status: "current",
    doc_no: oldDocNo,
    version_no: "2025",
    content_hash: runId + "-old",
    content_text: "旧制度正文",
  } });
  createdAssetIds.add(oldDoc.asset.id);
  const newDoc = await post("saveAsset", { asset: {
    title: runId + " 新制度",
    document_type: "policy",
    effect_status: "current",
    doc_no: runId + "-NEW",
    version_no: "2026",
    content_hash: runId + "-new",
    content_text: "新制度正文",
    replaces_doc_no: oldDocNo,
    relation_type: "replaces",
  } });
  createdAssetIds.add(newDoc.asset.id);
  const oldAfter = await db.prepare("SELECT lifecycle,effect_status FROM source_assets WHERE id=?").bind(oldDoc.asset.id).first();
  assert.deepEqual(oldAfter, { lifecycle: "superseded", effect_status: "revised" });
  result.replacementGovernance = true;

  const bulk = await post("bulkSaveAssets", { assets: [
    { title: runId + " 批量资料A", document_type: "internal_rule", doc_no: runId + "-BULK-A", effect_status: "current", version_no: "1.0" },
    { title: runId + " 批量资料B", document_type: "market_report", doc_no: runId + "-BULK-B", effect_status: "unknown", version_no: "2026Q3" },
  ] });
  assert.equal(bulk.accepted, 2);
  assert.equal(bulk.rejected, 0);
  for (const item of bulk.results) if (item.ok) createdAssetIds.add(item.id);
  result.bulkAccepted = bulk.accepted;

  const excelAsset = await post("saveAsset", { asset: {
    title: runId + " Excel数字溯源",
    document_type: "excel",
    category: "成本标准",
    effect_status: "current",
    project_no: runId,
    project_type: "保租房",
    region: "深圳市",
    source_ref: "测试工作簿/投资估算表",
    version_no: "v1",
    content_hash: runId + "-xlsx",
  } });
  createdAssetIds.add(excelAsset.asset.id);
  const wb = await post("createWorkbook", {
    assetId: excelAsset.asset.id,
    title: runId + " 测算工作簿",
    filename: "materials-excel-test.csv",
    contentHash: runId + "-xlsx",
  });
  const sheet = await post("saveSheet", { workbookId: wb.workbookId, sheet: {
    name: "Sheet1", sheet_index: 0, used_range: "A1:B15", headers: ["项目", "金额（万元）"], row_count: 15, col_count: 2,
  } });
  await post("saveCells", { sheetId: sheet.sheetId, cells: [
    { address: "A15", row_idx: 15, col_idx: 1, raw_value: "总投资", display_value: "总投资", data_type: "s" },
    { address: "B15", row_idx: 15, col_idx: 2, raw_value: "23500", display_value: "23500", formula: "=SUM(B2:B14)", data_type: "n" },
  ] });
  const cell = await post("readExcelCell", { workbookId: wb.workbookId, sheetName: "Sheet1", address: "B15" });
  assert.equal(cell.cell.display_value, "23500");
  assert.equal(cell.cell.formula, "=SUM(B2:B14)");
  result.excelCell = "Sheet1!B15";
  result.excelValue = cell.cell.display_value;
  await post("saveMapping", { mapping: {
    project_type: "保租房",
    calc_type: "rent",
    field_key: "totalInvestment",
    field_label: "总投资",
    workbook_id: wb.workbookId,
    sheet_name: "Sheet1",
    cell_address: "B15",
    note: "端到端验证",
  } });
  const resolved = await post("resolveMappings", { projectType: "保租房", calcType: "rent" });
  const mapped = resolved.values.find((x) => x.workbook_id === wb.workbookId && x.field_key === "totalInvestment");
  assert.ok(mapped, "mapping was not resolved");
  assert.equal(mapped.display_value, "23500");
  result.mappingsResolved = 1;

  result.orphanRagVectorsRemoved = await cleanupOrphanRagTest();
} finally {
  for (const id of createdAssetIds) {
    try { await post("deleteAsset", { assetId: id }); } catch (error) { console.error("cleanup failed", id, error.message); }
  }
  const remaining = await db.prepare("SELECT COUNT(*)::int AS n FROM source_assets WHERE title LIKE ?").bind(runId + "%").first();
  result.cleanupRemaining = remaining ? Number(remaining.n) : -1;
  await db._close();
}

assert.equal(result.cleanupRemaining, 0, "temporary source assets were not fully cleaned");
console.log(JSON.stringify({ ok: true, runId, ...result }, null, 2));
