-- 本地项目数据分析底座：结构化数值与RAG分离，所有正式结论绑定审核数据快照。
CREATE TABLE IF NOT EXISTS analysis_metric_catalog (
  metric_key TEXT PRIMARY KEY, metric_name TEXT NOT NULL, domain TEXT NOT NULL, unit TEXT DEFAULT '',
  value_type TEXT NOT NULL DEFAULT 'number', definition TEXT DEFAULT '', formula TEXT DEFAULT '',
  direction TEXT DEFAULT 'neutral', required_level TEXT DEFAULT 'general', default_scope REAL DEFAULT 3,
  default_period TEXT DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_analysis_scopes (
  project_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, longitude REAL, latitude REAL,
  scope_type TEXT NOT NULL DEFAULT 'radius', scope_value TEXT NOT NULL DEFAULT '1,3,5', scope_geojson TEXT DEFAULT '',
  confirmed_by TEXT DEFAULT '', confirmed_at BIGINT DEFAULT 0, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS analysis_observations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL, metric_key TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'radius', scope_value REAL DEFAULT 3, period_start TEXT DEFAULT '', period_end TEXT DEFAULT '',
  value_num REAL, value_text TEXT DEFAULT '', value_json TEXT DEFAULT '', unit TEXT DEFAULT '',
  source_asset_id TEXT DEFAULT '', source_version_id TEXT DEFAULT '', workbook_id TEXT DEFAULT '', sheet_name TEXT DEFAULT '', cell_address TEXT DEFAULT '',
  source_label TEXT DEFAULT '', quality_grade TEXT DEFAULT 'C', review_status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT DEFAULT '', reviewed_at BIGINT DEFAULT 0, created_by TEXT DEFAULT '', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_observations_project ON analysis_observations(project_id,review_status,metric_key,scope_value);
CREATE TABLE IF NOT EXISTS project_pois (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, subcategory TEXT DEFAULT '',
  longitude REAL, latitude REAL, distance_m REAL, level TEXT DEFAULT '', level_weight REAL DEFAULT 1, status TEXT DEFAULT '', address TEXT DEFAULT '',
  source_asset_id TEXT DEFAULT '', source_version_id TEXT DEFAULT '', workbook_id TEXT DEFAULT '', sheet_name TEXT DEFAULT '', cell_address TEXT DEFAULT '', source_label TEXT DEFAULT '', review_status TEXT NOT NULL DEFAULT 'pending', observed_at TEXT DEFAULT '',
  reviewed_by TEXT DEFAULT '', reviewed_at BIGINT DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_pois_project ON project_pois(project_id,review_status,category);
CREATE TABLE IF NOT EXISTS project_od_flows (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL, origin_id TEXT DEFAULT '', origin_name TEXT NOT NULL,
  destination_id TEXT DEFAULT '', destination_name TEXT NOT NULL, flow_type TEXT NOT NULL DEFAULT 'home_to_work', population REAL NOT NULL,
  distance_km REAL, period_start TEXT DEFAULT '', period_end TEXT DEFAULT '', source_asset_id TEXT DEFAULT '', source_version_id TEXT DEFAULT '', workbook_id TEXT DEFAULT '', sheet_name TEXT DEFAULT '', cell_address TEXT DEFAULT '', source_label TEXT DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT DEFAULT '', reviewed_at BIGINT DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_od_project ON project_od_flows(project_id,review_status,flow_type);
CREATE TABLE IF NOT EXISTS analysis_rules (
  rule_key TEXT PRIMARY KEY, domain TEXT NOT NULL, draft_data TEXT NOT NULL DEFAULT '{}', published_data TEXT NOT NULL DEFAULT '{}',
  draft_version INTEGER NOT NULL DEFAULT 1, published_version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'published',
  updated_by TEXT DEFAULT '', updated_at BIGINT NOT NULL, published_by TEXT DEFAULT '', published_at BIGINT DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project_analysis_snapshots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL, version INTEGER NOT NULL, scope_value REAL NOT NULL DEFAULT 3,
  input_data TEXT NOT NULL DEFAULT '{}', result_data TEXT NOT NULL DEFAULT '{}', result_hash TEXT NOT NULL, rule_versions TEXT NOT NULL DEFAULT '{}',
  source_summary TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'official', created_by TEXT DEFAULT '', created_at BIGINT NOT NULL,
  UNIQUE(project_id,user_id,version)
);
CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_project ON project_analysis_snapshots(project_id,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS analysis_chapter_mappings (
  domain TEXT NOT NULL, chapter_keyword TEXT NOT NULL, section_keyword TEXT DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL, PRIMARY KEY(domain,chapter_keyword,section_keyword)
);
