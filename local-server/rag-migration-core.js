import crypto from "node:crypto";

export const RAG_MIGRATION_FORMAT = "ai-studyreport-rag-bundle";
export const RAG_MIGRATION_VERSION = 1;

export const RAG_TABLE_GROUPS = Object.freeze({
  core: [
    { table: "rag_files", required: false },
    { table: "rag_files_v2", required: true },
    { table: "rag_file_meta", required: true },
    { table: "rag_text_chunks", required: true },
    { table: "rag_vectors", required: true, vectorColumns: ["embedding"] },
    { table: "rag_source_objects", required: false, userColumns: ["created_by"] },
    { table: "rag_source_links", required: false },
    { table: "wiki_pages", required: false, userColumns: ["created_by"] },
    { table: "source_assets", required: false, userColumns: ["created_by"] },
    { table: "source_asset_versions", required: false },
    { table: "source_asset_objects", required: false },
    { table: "source_asset_relations", required: false },
    { table: "excel_workbooks", required: false, userColumns: ["created_by"] },
    { table: "excel_sheets", required: false },
    { table: "excel_cells", required: false },
    { table: "excel_field_mappings", required: false },
    { table: "rag_evalset", required: false },
    { table: "configs", required: false, where: "key = 'rag_weights'" },
  ],
  personal: [
    { table: "personal_notes", required: false, userColumns: ["user_id"] },
    { table: "personal_note_versions", required: false, userColumns: ["user_id"] },
    { table: "personal_note_links", required: false, userColumns: ["user_id"] },
  ],
  evidence: [
    { table: "web_evidence", required: false, userColumns: ["user_id"] },
    { table: "web_evidence_bindings", required: false, userColumns: ["user_id"] },
    { table: "data_requirement_refinements", required: false, userColumns: ["user_id"] },
    { table: "web_search_lenses", required: false },
    { table: "knowledge_contributions", required: false, userColumns: ["user_id"] },
  ],
  history: [
    { table: "rag_feedback", required: false },
    { table: "rag_logs", required: false, userColumns: ["user_id"] },
    { table: "web_search_runs", required: false, userColumns: ["user_id"] },
  ],
});

export function selectRagTables(options = {}) {
  const names = ["core"];
  if (options.includePersonal) names.push("personal");
  if (options.includeEvidence) names.push("evidence");
  if (options.includeHistory) names.push("history");
  const seen = new Set();
  return names.flatMap((name) => RAG_TABLE_GROUPS[name]).filter((spec) => {
    if (seen.has(spec.table)) return false;
    seen.add(spec.table);
    return true;
  });
}

export function canonicalRecordLine(record) {
  return JSON.stringify(record) + "\n";
}

export function createRecordHasher() {
  const hash = crypto.createHash("sha256");
  return {
    update(record) { hash.update(canonicalRecordLine(record)); },
    digest() { return hash.digest("hex"); },
  };
}

export function assertSafeIdentifier(value) {
  const text = String(value || "");
  if (!/^[a-z_][a-z0-9_]*$/i.test(text)) throw new Error("不安全的数据库标识符：" + text);
  return text;
}

export function quoteIdentifier(value) {
  return '"' + assertSafeIdentifier(value).replaceAll('"', '""') + '"';
}

export function buildUpsertSql(table, columns, primaryKey, vectorColumns = []) {
  return buildBulkUpsertSql(table, columns, primaryKey, vectorColumns, 1);
}

export function buildBulkUpsertSql(table, columns, primaryKey, vectorColumns = [], rowCount = 1) {
  if (!columns.length) throw new Error(table + " 没有可导入列");
  if (!primaryKey.length) throw new Error(table + " 缺少主键，无法安全幂等导入");
  const count = Number(rowCount);
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error("批量导入行数必须为1至500");
  const vectorSet = new Set(vectorColumns || []);
  const names = columns.map(quoteIdentifier).join(",");
  const values = Array.from({ length: count }, (_, rowIndex) => "(" + columns.map((column, columnIndex) => {
    const parameter = rowIndex * columns.length + columnIndex + 1;
    return "$" + parameter + (vectorSet.has(column) ? "::vector" : "");
  }).join(",") + ")").join(",");
  const conflict = primaryKey.map(quoteIdentifier).join(",");
  const mutable = columns.filter((column) => !primaryKey.includes(column));
  const action = mutable.length
    ? "DO UPDATE SET " + mutable.map((column) => `${quoteIdentifier(column)}=EXCLUDED.${quoteIdentifier(column)}`).join(",")
    : "DO NOTHING";
  return `INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES ${values} ON CONFLICT (${conflict}) ${action}`;
}

export function normalizeDbValue(value) {
  if (value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { __type: "buffer", base64: value.toString("base64") };
  return value;
}

export function restoreDbValue(value) {
  if (value && typeof value === "object" && value.__type === "buffer") return Buffer.from(value.base64 || "", "base64");
  return value;
}

export function validateHeader(header) {
  if (!header || header.type !== "header") throw new Error("迁移包缺少头部清单");
  if (header.format !== RAG_MIGRATION_FORMAT) throw new Error("不是本项目的 RAG 迁移包");
  if (Number(header.version) !== RAG_MIGRATION_VERSION) throw new Error("不支持的迁移包版本：" + header.version);
  if (!Array.isArray(header.tables)) throw new Error("迁移包表清单无效");
  return header;
}

export function validateTrailer(trailer, counts, digest) {
  if (!trailer || trailer.type !== "trailer") throw new Error("迁移包未完整写入：缺少结尾校验信息");
  if (trailer.recordsSha256 !== digest) throw new Error("迁移包内容哈希不一致，文件可能损坏或被修改");
  for (const [table, count] of Object.entries(counts)) {
    if (Number(trailer.counts?.[table] || 0) !== Number(count)) throw new Error(`${table} 行数校验失败`);
  }
  return true;
}
