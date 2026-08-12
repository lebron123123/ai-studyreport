-- 正式资料台账 + Excel Sheet/单元格级溯源索引
-- 本地 PostgreSQL 请用 BIGINT 替换下方时间字段的 INTEGER。
CREATE TABLE IF NOT EXISTS source_assets (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, document_type TEXT NOT NULL DEFAULT 'other', category TEXT DEFAULT '',
  lifecycle TEXT NOT NULL DEFAULT 'active', effect_status TEXT NOT NULL DEFAULT 'unknown', doc_no TEXT DEFAULT '', issuer TEXT DEFAULT '',
  issue_date TEXT DEFAULT '', effective_date TEXT DEFAULT '', expiry_date TEXT DEFAULT '', project_no TEXT DEFAULT '', project_type TEXT DEFAULT '',
  region TEXT DEFAULT '', source_ref TEXT DEFAULT '', version_no TEXT DEFAULT '', content_hash TEXT DEFAULT '', rag_title TEXT DEFAULT '', note TEXT DEFAULT '',
  created_by INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_assets_type ON source_assets(document_type, lifecycle, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_assets_project ON source_assets(project_no, project_type, region);
CREATE INDEX IF NOT EXISTS idx_source_assets_doc_no ON source_assets(doc_no);
CREATE TABLE IF NOT EXISTS source_asset_versions (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, version_no TEXT DEFAULT '', content_hash TEXT DEFAULT '',
  content_text TEXT DEFAULT '', effect_status TEXT DEFAULT 'unknown', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_asset_versions_asset ON source_asset_versions(asset_id, created_at DESC);
CREATE TABLE IF NOT EXISTS source_asset_relations (
  id TEXT PRIMARY KEY, from_asset_id TEXT NOT NULL, target_doc_no TEXT NOT NULL,
  relation_type TEXT NOT NULL, note TEXT DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_asset_relations_from ON source_asset_relations(from_asset_id);
CREATE TABLE IF NOT EXISTS excel_workbooks (
  id TEXT PRIMARY KEY, asset_id TEXT, title TEXT NOT NULL, filename TEXT DEFAULT '', content_hash TEXT DEFAULT '',
  sheet_count INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_excel_workbooks_title ON excel_workbooks(title, updated_at DESC);
CREATE TABLE IF NOT EXISTS excel_sheets (
  id TEXT PRIMARY KEY, workbook_id TEXT NOT NULL, name TEXT NOT NULL, sheet_index INTEGER NOT NULL DEFAULT 0,
  used_range TEXT DEFAULT '', headers TEXT DEFAULT '[]', row_count INTEGER NOT NULL DEFAULT 0, col_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, UNIQUE(workbook_id, name)
);
CREATE INDEX IF NOT EXISTS idx_excel_sheets_workbook ON excel_sheets(workbook_id, sheet_index);
CREATE TABLE IF NOT EXISTS excel_cells (
  sheet_id TEXT NOT NULL, address TEXT NOT NULL, row_idx INTEGER NOT NULL, col_idx INTEGER NOT NULL,
  raw_value TEXT DEFAULT '', display_value TEXT DEFAULT '', formula TEXT DEFAULT '', data_type TEXT DEFAULT '',
  PRIMARY KEY(sheet_id, address)
);
CREATE INDEX IF NOT EXISTS idx_excel_cells_sheet_pos ON excel_cells(sheet_id, row_idx, col_idx);
CREATE TABLE IF NOT EXISTS excel_field_mappings (
  id TEXT PRIMARY KEY, project_type TEXT DEFAULT '', calc_type TEXT DEFAULT '', field_key TEXT NOT NULL,
  field_label TEXT DEFAULT '', workbook_id TEXT NOT NULL, sheet_name TEXT NOT NULL, cell_address TEXT NOT NULL,
  note TEXT DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_excel_field_mappings_lookup ON excel_field_mappings(project_type, calc_type, field_key, enabled);
