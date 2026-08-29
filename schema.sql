-- 可研报告工坊 数据库结构（Cloudflare D1）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '未命名项目',
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);


CREATE TABLE IF NOT EXISTS outlines (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  chapters TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 历史项目测算案例库（供AI可研生成的参数推荐使用）
CREATE TABLE IF NOT EXISTS calc_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  calc_type TEXT NOT NULL,
  location TEXT DEFAULT '',
  note TEXT DEFAULT '',
  params TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  user_id INTEGER,
  username TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calc_cases_type_status ON calc_cases(calc_type, status);

-- AI可研黄金项目样本与重复评测
CREATE TABLE IF NOT EXISTS report_golden_samples (
  id TEXT PRIMARY KEY,name TEXT NOT NULL,calc_type TEXT NOT NULL DEFAULT '',region TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',
  source_project_id TEXT NOT NULL DEFAULT '',sample_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'candidate',user_id INTEGER NOT NULL,created_by TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_golden_samples_status ON report_golden_samples(status,calc_type,updated_at);
CREATE TABLE IF NOT EXISTS report_golden_runs (
  id TEXT PRIMARY KEY,sample_id TEXT NOT NULL,user_id INTEGER NOT NULL,score INTEGER NOT NULL DEFAULT 0,passed INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL DEFAULT '{}',result_json TEXT NOT NULL DEFAULT '{}',candidate_hash TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_golden_runs_sample ON report_golden_runs(sample_id,created_at);

-- AI可研生成（对话式）· 会话进度存档，每人一份，覆盖式保存
CREATE TABLE IF NOT EXISTS aireport_sessions (
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- AI可研项目级会话：同一用户可同时维护多个项目，刷新后恢复待确认动作和生成进度
CREATE TABLE IF NOT EXISTS aireport_project_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_aireport_project_sessions_user ON aireport_project_sessions(user_id, updated_at DESC);

-- AI办公固定模板PPT工作台
CREATE TABLE IF NOT EXISTS ppt_projects (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  template_id TEXT NOT NULL DEFAULT 'anju-blue',
  data TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppt_projects_user ON ppt_projects(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS ppt_project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  label TEXT DEFAULT '',
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppt_versions_project ON ppt_project_versions(user_id,project_id,created_at DESC);

-- 人口参考表：街道/乡镇一级人口没有官方免费API，人工整理真实统计公报数据维护
CREATE TABLE IF NOT EXISTS population_ref (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  street TEXT DEFAULT '',
  population REAL NOT NULL,
  year INTEGER NOT NULL,
  source TEXT DEFAULT '',
  note TEXT DEFAULT '',
  user_id INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_population_ref_lookup ON population_ref(city, district);

-- RAG 精确检索索引：文号、条款和原始定位独立保存，避免只靠语义向量猜测。
CREATE TABLE IF NOT EXISTS rag_file_meta (
  title TEXT PRIMARY KEY,
  doc_no TEXT DEFAULT '',
  issuer TEXT DEFAULT '',
  source_ref TEXT DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rag_text_chunks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  chapter TEXT DEFAULT '',
  section TEXT DEFAULT '',
  text TEXT NOT NULL,
  category TEXT DEFAULT '',
  doc_no TEXT DEFAULT '',
  issuer TEXT DEFAULT '',
  source_ref TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rag_text_chunks_title ON rag_text_chunks(title);
CREATE INDEX IF NOT EXISTS idx_rag_text_chunks_doc_no ON rag_text_chunks(doc_no);

-- 正式资料台账 + Excel 结构化索引（RAG 只存摘要，精确数值单独保存）
CREATE TABLE IF NOT EXISTS source_assets (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, document_type TEXT NOT NULL DEFAULT 'other', category TEXT DEFAULT '',
  lifecycle TEXT NOT NULL DEFAULT 'active', effect_status TEXT NOT NULL DEFAULT 'unknown',
  doc_no TEXT DEFAULT '', issuer TEXT DEFAULT '', issue_date TEXT DEFAULT '', effective_date TEXT DEFAULT '', expiry_date TEXT DEFAULT '',
  project_no TEXT DEFAULT '', project_type TEXT DEFAULT '', region TEXT DEFAULT '', source_ref TEXT DEFAULT '',
  version_no TEXT DEFAULT '', content_hash TEXT DEFAULT '', rag_title TEXT DEFAULT '', note TEXT DEFAULT '',
  created_by INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_assets_type ON source_assets(document_type, lifecycle, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_assets_project ON source_assets(project_no, project_type, region);
CREATE INDEX IF NOT EXISTS idx_source_assets_doc_no ON source_assets(doc_no);
CREATE TABLE IF NOT EXISTS source_asset_versions (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, version_no TEXT DEFAULT '', content_hash TEXT DEFAULT '', content_text TEXT DEFAULT '',
  effect_status TEXT DEFAULT 'unknown', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_asset_versions_asset ON source_asset_versions(asset_id, created_at DESC);
CREATE TABLE IF NOT EXISTS source_asset_relations (
  id TEXT PRIMARY KEY, from_asset_id TEXT NOT NULL, target_doc_no TEXT NOT NULL, relation_type TEXT NOT NULL,
  note TEXT DEFAULT '', created_at INTEGER NOT NULL
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

-- 测算参数治理：草稿与已发布版本严格分离；知识依据保存在 data JSON 中。
CREATE TABLE IF NOT EXISTS param_governance (
  calc_type TEXT NOT NULL, param_key TEXT NOT NULL, draft_data TEXT NOT NULL DEFAULT '{}', published_data TEXT NOT NULL DEFAULT '{}',
  draft_version INTEGER NOT NULL DEFAULT 1, published_version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
  updated_by TEXT DEFAULT '', updated_at INTEGER NOT NULL, published_by TEXT DEFAULT '', published_at INTEGER DEFAULT 0,
  PRIMARY KEY(calc_type,param_key)
);
CREATE INDEX IF NOT EXISTS idx_param_governance_type_status ON param_governance(calc_type,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS param_governance_history (
  id TEXT PRIMARY KEY, calc_type TEXT NOT NULL, param_key TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
  change_summary TEXT DEFAULT '', published_by TEXT DEFAULT '', published_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_param_governance_history ON param_governance_history(calc_type,param_key,version DESC);
CREATE TABLE IF NOT EXISTS param_review_events (
  id TEXT PRIMARY KEY, calc_type TEXT NOT NULL, trigger_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium',
  source_key TEXT DEFAULT '', summary TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT DEFAULT '', created_at INTEGER NOT NULL, handled_by TEXT DEFAULT '', handled_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_param_review_events_status ON param_review_events(status,created_at DESC);

-- Wiki：人工确认后的知识解释层。原始资料仍由 RAG 文件库保存；只有已发布 Wiki 才同步进检索库。
CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'report',
  status TEXT NOT NULL DEFAULT 'draft',
  content TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  region TEXT DEFAULT '',
  project_type TEXT DEFAULT '',
  doc_no TEXT DEFAULT '',
  issuer TEXT DEFAULT '',
  source_ref TEXT DEFAULT '',
  security INTEGER NOT NULL DEFAULT 1,
  dept_scope TEXT DEFAULT '全部门',
  effective_date TEXT DEFAULT '',
  expiry_date TEXT DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  vector_ids TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER,
  created_name TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_status_updated ON wiki_pages(status, updated_at DESC);

-- Investment OS Project Brain：在旧 projects JSON 之上增加统一索引、决策与阶段历史，不复制大附件。
CREATE TABLE IF NOT EXISTS project_facts (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,fact_type TEXT NOT NULL,fact_key TEXT NOT NULL,label TEXT DEFAULT '',value_json TEXT NOT NULL DEFAULT 'null',unit TEXT DEFAULT '',source_type TEXT DEFAULT '',source_ref TEXT DEFAULT '',confidence REAL NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'candidate',valid_from TEXT DEFAULT '',valid_to TEXT DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_by TEXT DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_facts_version ON project_facts(project_id,user_id,fact_key,version);
CREATE INDEX IF NOT EXISTS idx_project_facts_lookup ON project_facts(project_id,user_id,status,updated_at);
CREATE TABLE IF NOT EXISTS project_metrics (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,metric_key TEXT NOT NULL,label TEXT DEFAULT '',value_json TEXT NOT NULL DEFAULT 'null',unit TEXT DEFAULT '',calc_snapshot_id TEXT DEFAULT '',lineage_json TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_metrics_lookup ON project_metrics(project_id,user_id,metric_key,version);
CREATE TABLE IF NOT EXISTS project_artifacts (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,artifact_type TEXT NOT NULL,title TEXT DEFAULT '',module_ref TEXT DEFAULT '',version TEXT DEFAULT '',status TEXT DEFAULT 'draft',evidence_audit_id TEXT DEFAULT '',meta_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_artifacts_lookup ON project_artifacts(project_id,user_id,artifact_type,updated_at);
CREATE TABLE IF NOT EXISTS project_events (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,event_type TEXT NOT NULL,actor TEXT DEFAULT '',payload_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_events_lookup ON project_events(project_id,user_id,created_at);
CREATE TABLE IF NOT EXISTS project_decisions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,stage_key TEXT DEFAULT 'feasibility',topic TEXT NOT NULL,options_json TEXT NOT NULL DEFAULT '[]',decision_text TEXT DEFAULT '',evidence_ids_json TEXT NOT NULL DEFAULT '[]',scenario_ids_json TEXT NOT NULL DEFAULT '[]',owner TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'candidate',created_by TEXT DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);

-- Investment OS阶段4—6：会议行动化、情景决策包与生产验收台账。
CREATE TABLE IF NOT EXISTS project_meetings (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,extraction_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'candidate',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_tasks (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT NOT NULL,owner TEXT DEFAULT '',due_date TEXT DEFAULT '',source_ref TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'candidate',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_risks (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT NOT NULL,risk_level TEXT DEFAULT 'normal',owner TEXT DEFAULT '',source_ref TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'candidate',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_scenarios (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,calc_type TEXT DEFAULT '',calc_snapshot_id TEXT NOT NULL,engine TEXT NOT NULL DEFAULT 'whitebox',params_json TEXT NOT NULL DEFAULT '{}',metrics_json TEXT NOT NULL DEFAULT '{}',risks_json TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'draft',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_decision_packages (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT NOT NULL,scenario_id TEXT NOT NULL,decision_id TEXT DEFAULT '',package_json TEXT NOT NULL DEFAULT '{}',audit_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'blocked',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_evaluations (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,evaluation_type TEXT NOT NULL,result_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'draft',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS optimization_ledger (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT NOT NULL,evidence TEXT DEFAULT '',before_value TEXT DEFAULT '',after_value TEXT DEFAULT '',actual_benefit TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'candidate',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_decisions_lookup ON project_decisions(project_id,user_id,status,updated_at);
CREATE TABLE IF NOT EXISTS project_change_sets (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT DEFAULT '',before_json TEXT NOT NULL DEFAULT '{}',after_json TEXT NOT NULL DEFAULT '{}',impact_json TEXT NOT NULL DEFAULT '{}',approval_status TEXT NOT NULL DEFAULT 'preview',created_by TEXT DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_changes_lookup ON project_change_sets(project_id,user_id,created_at);
CREATE TABLE IF NOT EXISTS project_stage_history (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,from_stage TEXT DEFAULT '',to_stage TEXT NOT NULL,reason TEXT DEFAULT '',approved_by TEXT DEFAULT '',changed_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_stage_history_lookup ON project_stage_history(project_id,user_id,changed_at);
