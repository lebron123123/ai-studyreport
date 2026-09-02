-- ============================================================
-- 可研报告工坊 · PostgreSQL 建表脚本
-- 由你的 D1 备份文件(d1backup-20260725.sql)真实结构转换而来，共 14 张业务表 + 1 张向量表
--
-- 从 SQLite 转 PostgreSQL 改了三处：
--   1. INTEGER PRIMARY KEY AUTOINCREMENT  →  SERIAL PRIMARY KEY
--   2. ⚠️ 所有时间字段 INTEGER → BIGINT
--      原因：代码里存的是 Date.now() 毫秒数（约 1,785,000,000,000），
--      远超 PostgreSQL INTEGER 的上限 2,147,483,647，用 INTEGER 会直接溢出报错。
--      这是 SQLite 转 PostgreSQL 最容易踩的坑之一，因为 SQLite 的 INTEGER 是变长的。
--   3. REAL → DOUBLE PRECISION
--
-- 布尔类型刻意保持 INTEGER（0/1）而不是 BOOLEAN，
-- 因为业务代码里写的是 `enabled === 0` 这类数值比较，改成布尔会全部失效。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------- 用户与项目 ----------
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  pass_hash   TEXT NOT NULL,
  salt        TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  department  TEXT DEFAULT '',
  clearance   INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  name       TEXT NOT NULL DEFAULT '未命名项目',
  data       TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);

-- ---------- 大纲与配置 ----------
CREATE TABLE IF NOT EXISTS outlines (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  chapters   TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS configs (
  key        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS revision_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER,
  chapter     TEXT,
  section     TEXT,
  instruction TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);

-- ---------- 知识库台账 ----------
-- rag_files 是旧版表，已被 v2 取代；保留建表以防老代码路径还在读它
CREATE TABLE IF NOT EXISTS rag_files (
  title      TEXT PRIMARY KEY,
  ids        TEXT NOT NULL,
  chunks     INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS rag_files_v2 (
  title          TEXT PRIMARY KEY,
  ids            TEXT NOT NULL,
  chunks         INTEGER NOT NULL,
  category       TEXT DEFAULT '未分类',
  level          INTEGER DEFAULT 2,
  enabled        INTEGER DEFAULT 1,
  created_at     BIGINT NOT NULL,
  security       INTEGER DEFAULT 1,
  dept_scope     TEXT DEFAULT '全部门',
  effective_date TEXT DEFAULT '',
  expiry_date    TEXT DEFAULT '',
  content_hash   TEXT DEFAULT '',
  version        INTEGER DEFAULT 1,
  updated_at     BIGINT DEFAULT 0
);

-- 精确检索索引：保留文号/条款/原始定位，不再只依赖向量相似度。
CREATE TABLE IF NOT EXISTS rag_file_meta (
  title      TEXT PRIMARY KEY,
  doc_no     TEXT DEFAULT '',
  issuer     TEXT DEFAULT '',
  source_ref TEXT DEFAULT '',
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS rag_text_chunks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  chapter    TEXT DEFAULT '',
  section    TEXT DEFAULT '',
  text       TEXT NOT NULL,
  category   TEXT DEFAULT '',
  doc_no     TEXT DEFAULT '',
  issuer     TEXT DEFAULT '',
  source_ref TEXT DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rag_text_chunks_title ON rag_text_chunks(title);
CREATE INDEX IF NOT EXISTS idx_rag_text_chunks_doc_no ON rag_text_chunks(doc_no);

-- RAG原件内容寻址对象：二进制保存在local-data/rag-objects，数据库只保存哈希、对象键和版本引用。
CREATE TABLE IF NOT EXISTS rag_source_objects (
  content_hash TEXT PRIMARY KEY, storage_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size_bytes BIGINT NOT NULL DEFAULT 0,
  created_by INTEGER, created_at BIGINT NOT NULL, verified_at BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rag_source_links (
  title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, content_hash TEXT NOT NULL,
  linked_at BIGINT NOT NULL, PRIMARY KEY(title,version)
);
CREATE INDEX IF NOT EXISTS idx_rag_source_links_hash ON rag_source_links(content_hash);

-- ---------- 正式资料台账 + Excel 结构化索引 ----------
-- RAG 负责“找相关内容”；这三张表负责“数字到底来自哪张表、哪一格”。
CREATE TABLE IF NOT EXISTS source_assets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'other',
  category TEXT DEFAULT '',
  lifecycle TEXT NOT NULL DEFAULT 'active',
  effect_status TEXT NOT NULL DEFAULT 'unknown',
  doc_no TEXT DEFAULT '', issuer TEXT DEFAULT '', issue_date TEXT DEFAULT '',
  effective_date TEXT DEFAULT '', expiry_date TEXT DEFAULT '',
  project_no TEXT DEFAULT '', project_type TEXT DEFAULT '', region TEXT DEFAULT '',
  source_ref TEXT DEFAULT '', version_no TEXT DEFAULT '', content_hash TEXT DEFAULT '',
  rag_title TEXT DEFAULT '', note TEXT DEFAULT '',
  created_by INTEGER, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_assets_type ON source_assets(document_type, lifecycle, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_assets_project ON source_assets(project_no, project_type, region);
CREATE INDEX IF NOT EXISTS idx_source_assets_doc_no ON source_assets(doc_no);
CREATE TABLE IF NOT EXISTS source_asset_versions (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, version_no TEXT DEFAULT '', content_hash TEXT DEFAULT '',
  content_text TEXT DEFAULT '', effect_status TEXT DEFAULT 'unknown', created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_asset_versions_asset ON source_asset_versions(asset_id, created_at DESC);
CREATE TABLE IF NOT EXISTS source_asset_objects (
  asset_id TEXT NOT NULL, version_no TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL,
  linked_at BIGINT NOT NULL, PRIMARY KEY(asset_id,version_no)
);
CREATE INDEX IF NOT EXISTS idx_source_asset_objects_hash ON source_asset_objects(content_hash);
CREATE TABLE IF NOT EXISTS source_asset_relations (
  id TEXT PRIMARY KEY, from_asset_id TEXT NOT NULL, target_doc_no TEXT NOT NULL,
  relation_type TEXT NOT NULL, note TEXT DEFAULT '', created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_asset_relations_from ON source_asset_relations(from_asset_id);

CREATE TABLE IF NOT EXISTS excel_workbooks (
  id TEXT PRIMARY KEY, asset_id TEXT, title TEXT NOT NULL, filename TEXT DEFAULT '',
  content_hash TEXT DEFAULT '', sheet_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_excel_workbooks_title ON excel_workbooks(title, updated_at DESC);

CREATE TABLE IF NOT EXISTS excel_sheets (
  id TEXT PRIMARY KEY, workbook_id TEXT NOT NULL, name TEXT NOT NULL, sheet_index INTEGER NOT NULL DEFAULT 0,
  used_range TEXT DEFAULT '', headers TEXT DEFAULT '[]', row_count INTEGER NOT NULL DEFAULT 0,
  col_count INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL,
  UNIQUE(workbook_id, name)
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
  note TEXT DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_excel_field_mappings_lookup ON excel_field_mappings(project_type, calc_type, field_key, enabled);

-- 测算参数治理：草稿不影响测算，审核发布后才同步到正式参数配置。
CREATE TABLE IF NOT EXISTS param_governance (
  calc_type TEXT NOT NULL, param_key TEXT NOT NULL, draft_data TEXT NOT NULL DEFAULT '{}', published_data TEXT NOT NULL DEFAULT '{}',
  draft_version INTEGER NOT NULL DEFAULT 1, published_version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
  updated_by TEXT DEFAULT '', updated_at BIGINT NOT NULL, published_by TEXT DEFAULT '', published_at BIGINT DEFAULT 0,
  PRIMARY KEY(calc_type,param_key)
);
CREATE INDEX IF NOT EXISTS idx_param_governance_type_status ON param_governance(calc_type,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS param_governance_history (
  id TEXT PRIMARY KEY, calc_type TEXT NOT NULL, param_key TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
  change_summary TEXT DEFAULT '', published_by TEXT DEFAULT '', published_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_param_governance_history ON param_governance_history(calc_type,param_key,version DESC);
CREATE TABLE IF NOT EXISTS param_review_events (
  id TEXT PRIMARY KEY, calc_type TEXT NOT NULL, trigger_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium',
  source_key TEXT DEFAULT '', summary TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT DEFAULT '', created_at BIGINT NOT NULL, handled_by TEXT DEFAULT '', handled_at BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_param_review_events_status ON param_review_events(status,created_at DESC);

CREATE TABLE IF NOT EXISTS rag_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER,
  query      TEXT,
  category   TEXT,
  hit_titles TEXT,
  hit_count  INTEGER,
  top_score  DOUBLE PRECISION,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS rag_feedback (
  id         SERIAL PRIMARY KEY,
  query      TEXT,
  title      TEXT,
  useful     INTEGER,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS rag_evalset (
  id           SERIAL PRIMARY KEY,
  query        TEXT NOT NULL,
  expect_title TEXT NOT NULL,
  note         TEXT DEFAULT '',
  created_at   BIGINT NOT NULL
);

-- ---------- Wiki（审核后的知识解释层；发布后同步进 RAG） ----------
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
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  published_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_status_updated ON wiki_pages(status, updated_at DESC);

-- ---------- 前台知识协作投稿（提交后不可原地修改） ----------
CREATE TABLE IF NOT EXISTS knowledge_contributions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '', source_ref TEXT DEFAULT '', file_name TEXT DEFAULT '',
  region TEXT DEFAULT '', project_type TEXT DEFAULT '', meta TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', review_note TEXT DEFAULT '',
  target_module TEXT DEFAULT '', target_ref TEXT DEFAULT '', parent_id TEXT DEFAULT '',
  user_id INTEGER NOT NULL, username TEXT DEFAULT '', created_at BIGINT NOT NULL,
  reviewed_at BIGINT, reviewed_by TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_knowledge_contributions_status ON knowledge_contributions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_contributions_user ON knowledge_contributions(user_id, created_at DESC);

-- ---------- Agent ----------
CREATE TABLE IF NOT EXISTS agent_traces (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER,
  query        TEXT,
  rounds       INTEGER,
  tool_calls   TEXT,
  final_answer TEXT,
  duration_ms  INTEGER,
  created_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_memory (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  mkey       TEXT NOT NULL,
  mvalue     TEXT NOT NULL,
  source     TEXT DEFAULT 'auto',
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, mkey)
);

-- Agent 企业级运行账本（与 migrations/0008_agent_runtime.sql 一致）
CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,agent_type TEXT NOT NULL DEFAULT 'general',project_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'running',query_text TEXT NOT NULL DEFAULT '',idempotency_key TEXT NOT NULL DEFAULT '',input_json TEXT NOT NULL DEFAULT '{}',output_json TEXT NOT NULL DEFAULT '{}',error_text TEXT NOT NULL DEFAULT '',current_step INTEGER NOT NULL DEFAULT 0,tool_call_count INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,completed_at BIGINT DEFAULT 0,UNIQUE(user_id,idempotency_key));
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_updated ON agent_runs(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated ON agent_runs(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_run_steps (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,step_no INTEGER NOT NULL,kind TEXT NOT NULL,tool_name TEXT NOT NULL DEFAULT '',risk_level TEXT NOT NULL DEFAULT 'read',status TEXT NOT NULL DEFAULT 'completed',input_json TEXT NOT NULL DEFAULT '{}',output_json TEXT NOT NULL DEFAULT '{}',error_text TEXT NOT NULL DEFAULT '',duration_ms INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_run_steps(run_id,step_no);
CREATE TABLE IF NOT EXISTS agent_checkpoints (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,step_no INTEGER NOT NULL,state_json TEXT NOT NULL DEFAULT '{}',resume_token TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_run ON agent_checkpoints(run_id,step_no DESC);
CREATE TABLE IF NOT EXISTS agent_approvals (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,tool_name TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',request_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',decided_by TEXT NOT NULL DEFAULT '',decision_note TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL,decided_at BIGINT DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_run ON agent_approvals(run_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS agent_skill_candidates (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,scene TEXT NOT NULL DEFAULT 'general',description TEXT NOT NULL DEFAULT '',instruction_md TEXT NOT NULL DEFAULT '',source_run_id TEXT NOT NULL DEFAULT '',evidence_json TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'candidate',version INTEGER NOT NULL DEFAULT 1,reviewed_by TEXT NOT NULL DEFAULT '',review_note TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_agent_skills_status ON agent_skill_candidates(status,updated_at DESC);

-- Agent企业级治理（后台续跑、父子谱系、用量、Skill版本、ABAC）
CREATE TABLE IF NOT EXISTS agent_run_governance (run_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,parent_run_id TEXT DEFAULT '',root_run_id TEXT DEFAULT '',department TEXT DEFAULT '',security_level INTEGER NOT NULL DEFAULT 1,execution_mode TEXT NOT NULL DEFAULT 'client',budget_input_tokens INTEGER NOT NULL DEFAULT 0,budget_output_tokens INTEGER NOT NULL DEFAULT 0,budget_cost_micros BIGINT NOT NULL DEFAULT 0,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,cost_micros BIGINT NOT NULL DEFAULT 0,provider TEXT DEFAULT '',model TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_agent_governance_root ON agent_run_governance(root_run_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_jobs (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'llm_task',payload_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'queued',priority INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,next_retry_at BIGINT NOT NULL DEFAULT 0,lease_owner TEXT DEFAULT '',lease_expires_at BIGINT NOT NULL DEFAULT 0,error_text TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,completed_at BIGINT NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim ON agent_jobs(status,next_retry_at,priority,created_at);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_user ON agent_jobs(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_run_usage (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,provider TEXT DEFAULT '',model TEXT DEFAULT '',input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,cost_micros BIGINT NOT NULL DEFAULT 0,latency_ms INTEGER NOT NULL DEFAULT 0,cached INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_agent_usage_run ON agent_run_usage(run_id,created_at);
CREATE TABLE IF NOT EXISTS agent_skill_versions (id TEXT PRIMARY KEY,skill_id TEXT NOT NULL,version INTEGER NOT NULL,instruction_md TEXT NOT NULL DEFAULT '',evidence_json TEXT NOT NULL DEFAULT '[]',eval_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'draft',created_by INTEGER NOT NULL,created_at BIGINT NOT NULL,UNIQUE(skill_id,version));
CREATE TABLE IF NOT EXISTS agent_skill_evals (id TEXT PRIMARY KEY,skill_id TEXT NOT NULL,version INTEGER NOT NULL,passed INTEGER NOT NULL DEFAULT 0,score DOUBLE PRECISION NOT NULL DEFAULT 0,cases_json TEXT NOT NULL DEFAULT '[]',result_json TEXT NOT NULL DEFAULT '{}',created_by INTEGER NOT NULL,created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_skill_releases (skill_id TEXT PRIMARY KEY,active_version INTEGER NOT NULL,previous_version INTEGER NOT NULL DEFAULT 0,published_by TEXT DEFAULT '',published_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_project_access (user_id INTEGER NOT NULL,project_id TEXT NOT NULL,department TEXT DEFAULT '',permission TEXT NOT NULL DEFAULT 'read',max_security_level INTEGER NOT NULL DEFAULT 1,updated_at BIGINT NOT NULL,PRIMARY KEY(user_id,project_id));

-- ---------- 办公助手与限额 ----------
CREATE TABLE IF NOT EXISTS office_chats (
  user_id    INTEGER PRIMARY KEY,
  chat       TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_counters (
  ckey       TEXT PRIMARY KEY,
  cnt        INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

-- ---------- 历史项目测算案例库（供AI可研生成的参数推荐使用） ----------
CREATE TABLE IF NOT EXISTS calc_cases (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  calc_type  TEXT NOT NULL,
  location   TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  params     TEXT NOT NULL DEFAULT '{}',
  summary    TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'pending',
  user_id    INTEGER,
  username   TEXT DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calc_cases_type_status ON calc_cases(calc_type, status);

-- AI可研生成（对话式）· 会话进度存档，每人一份，覆盖式保存
CREATE TABLE IF NOT EXISTS aireport_sessions (
  user_id    INTEGER PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- AI可研项目级会话：不再用“每人一份”覆盖不同项目
CREATE TABLE IF NOT EXISTS aireport_project_sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_aireport_project_sessions_user ON aireport_project_sessions(user_id, updated_at DESC);

-- 人口参考表：街道/乡镇一级人口没有官方免费API，只能人工整理真实统计公报数据维护；
-- 查不到的地区就是"未收录"，绝不能拿这张表凑不出的数字去猜
CREATE TABLE IF NOT EXISTS population_ref (
  id         SERIAL PRIMARY KEY,
  city       TEXT NOT NULL,
  district   TEXT NOT NULL,
  street     TEXT DEFAULT '',
  population DOUBLE PRECISION NOT NULL,   -- 常住人口，单位：万人
  year       INTEGER NOT NULL,
  source     TEXT DEFAULT '',             -- 数据来源（如"深圳市福田区2023年国民经济和社会发展统计公报"）
  note       TEXT DEFAULT '',
  user_id    INTEGER,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_population_ref_lookup ON population_ref(city, district);

-- 项目人口、职住、需求和配套分析（结构与 migrations/0005_project_analysis.sql 一致）
CREATE TABLE IF NOT EXISTS analysis_metric_catalog (metric_key TEXT PRIMARY KEY,metric_name TEXT NOT NULL,domain TEXT NOT NULL,unit TEXT DEFAULT '',value_type TEXT NOT NULL DEFAULT 'number',definition TEXT DEFAULT '',formula TEXT DEFAULT '',direction TEXT DEFAULT 'neutral',required_level TEXT DEFAULT 'general',default_scope DOUBLE PRECISION DEFAULT 3,default_period TEXT DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS project_analysis_scopes (project_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,longitude DOUBLE PRECISION,latitude DOUBLE PRECISION,scope_type TEXT NOT NULL DEFAULT 'radius',scope_value TEXT NOT NULL DEFAULT '1,3,5',scope_geojson TEXT DEFAULT '',confirmed_by TEXT DEFAULT '',confirmed_at BIGINT DEFAULT 0,updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS analysis_observations (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,metric_key TEXT NOT NULL,scope_type TEXT NOT NULL DEFAULT 'radius',scope_value DOUBLE PRECISION DEFAULT 3,period_start TEXT DEFAULT '',period_end TEXT DEFAULT '',value_num DOUBLE PRECISION,value_text TEXT DEFAULT '',value_json TEXT DEFAULT '',unit TEXT DEFAULT '',source_asset_id TEXT DEFAULT '',source_version_id TEXT DEFAULT '',workbook_id TEXT DEFAULT '',sheet_name TEXT DEFAULT '',cell_address TEXT DEFAULT '',source_label TEXT DEFAULT '',quality_grade TEXT DEFAULT 'C',review_status TEXT NOT NULL DEFAULT 'pending',reviewed_by TEXT DEFAULT '',reviewed_at BIGINT DEFAULT 0,created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_analysis_observations_project ON analysis_observations(project_id,review_status,metric_key,scope_value);
CREATE TABLE IF NOT EXISTS project_pois (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,subcategory TEXT DEFAULT '',longitude DOUBLE PRECISION,latitude DOUBLE PRECISION,distance_m DOUBLE PRECISION,level TEXT DEFAULT '',level_weight DOUBLE PRECISION DEFAULT 1,status TEXT DEFAULT '',address TEXT DEFAULT '',source_asset_id TEXT DEFAULT '',source_version_id TEXT DEFAULT '',workbook_id TEXT DEFAULT '',sheet_name TEXT DEFAULT '',cell_address TEXT DEFAULT '',source_label TEXT DEFAULT '',review_status TEXT NOT NULL DEFAULT 'pending',observed_at TEXT DEFAULT '',reviewed_by TEXT DEFAULT '',reviewed_at BIGINT DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_pois_project ON project_pois(project_id,review_status,category);
CREATE TABLE IF NOT EXISTS project_od_flows (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,origin_id TEXT DEFAULT '',origin_name TEXT NOT NULL,destination_id TEXT DEFAULT '',destination_name TEXT NOT NULL,flow_type TEXT NOT NULL DEFAULT 'home_to_work',population DOUBLE PRECISION NOT NULL,distance_km DOUBLE PRECISION,period_start TEXT DEFAULT '',period_end TEXT DEFAULT '',source_asset_id TEXT DEFAULT '',source_version_id TEXT DEFAULT '',workbook_id TEXT DEFAULT '',sheet_name TEXT DEFAULT '',cell_address TEXT DEFAULT '',source_label TEXT DEFAULT '',review_status TEXT NOT NULL DEFAULT 'pending',reviewed_by TEXT DEFAULT '',reviewed_at BIGINT DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_od_project ON project_od_flows(project_id,review_status,flow_type);
CREATE TABLE IF NOT EXISTS analysis_rules (rule_key TEXT PRIMARY KEY,domain TEXT NOT NULL,draft_data TEXT NOT NULL DEFAULT '{}',published_data TEXT NOT NULL DEFAULT '{}',draft_version INTEGER NOT NULL DEFAULT 1,published_version INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'published',updated_by TEXT DEFAULT '',updated_at BIGINT NOT NULL,published_by TEXT DEFAULT '',published_at BIGINT DEFAULT 0);
CREATE TABLE IF NOT EXISTS project_analysis_snapshots (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,version INTEGER NOT NULL,scope_value DOUBLE PRECISION NOT NULL DEFAULT 3,input_data TEXT NOT NULL DEFAULT '{}',result_data TEXT NOT NULL DEFAULT '{}',result_hash TEXT NOT NULL,rule_versions TEXT NOT NULL DEFAULT '{}',source_summary TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'official',created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,UNIQUE(project_id,user_id,version));
CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_project ON project_analysis_snapshots(project_id,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS analysis_chapter_mappings (domain TEXT NOT NULL,chapter_keyword TEXT NOT NULL,section_keyword TEXT DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,updated_at BIGINT NOT NULL,PRIMARY KEY(domain,chapter_keyword,section_keyword));

-- ---------- 向量表（替代 Cloudflare Vectorize） ----------
-- 1024 维对应 bge-m3，必须与 Cloudflare 上用的模型一致，否则历史向量作废
CREATE TABLE IF NOT EXISTS rag_vectors (
  id        TEXT PRIMARY KEY,
  embedding vector(1024),
  metadata  JSONB
);

-- 向量索引：数据量小的时候顺序扫描反而更快，
-- 等向量超过一两万条再建 HNSW 索引即可（建索引本身要花时间和内存）。
-- 需要时执行下面这句：
-- CREATE INDEX IF NOT EXISTS idx_rag_vectors_hnsw
--   ON rag_vectors USING hnsw (embedding vector_cosine_ops);

-- ---------- 个人知识库（与部门 Wiki/RAG 隔离） ----------
CREATE TABLE IF NOT EXISTS personal_notes (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,parent_id TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'note',title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',tags TEXT NOT NULL DEFAULT '[]',favorite INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',source_name TEXT DEFAULT '',source_type TEXT DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,deleted_at BIGINT DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_personal_notes_user_status ON personal_notes(user_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_notes_parent ON personal_notes(user_id,parent_id,status,sort_order,title);
CREATE TABLE IF NOT EXISTS personal_note_versions (id TEXT PRIMARY KEY,note_id TEXT NOT NULL,user_id INTEGER NOT NULL,revision INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',tags TEXT NOT NULL DEFAULT '[]',created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_personal_versions_note ON personal_note_versions(user_id,note_id,created_at DESC);
CREATE TABLE IF NOT EXISTS personal_note_links (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,from_note_id TEXT NOT NULL,to_note_id TEXT DEFAULT '',target_title TEXT NOT NULL,link_text TEXT DEFAULT '',created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_personal_links_from ON personal_note_links(user_id,from_note_id);
CREATE INDEX IF NOT EXISTS idx_personal_links_to ON personal_note_links(user_id,to_note_id,target_title);

-- 联网研究、证据台账和检索 Provider 治理
CREATE TABLE IF NOT EXISTS web_search_runs (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,project_id TEXT DEFAULT '',section_key TEXT DEFAULT '',plan_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'running',provider TEXT DEFAULT '',query_count INTEGER NOT NULL DEFAULT 0,result_count INTEGER NOT NULL DEFAULT 0,error_text TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_web_runs_user_project ON web_search_runs(user_id,project_id,updated_at);
CREATE TABLE IF NOT EXISTS web_evidence (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,project_id TEXT DEFAULT '',logic_id TEXT DEFAULT '',chapter TEXT DEFAULT '',section TEXT DEFAULT '',query_text TEXT DEFAULT '',title TEXT NOT NULL,url TEXT NOT NULL,canonical_url TEXT NOT NULL,publisher TEXT DEFAULT '',published_at TEXT DEFAULT '',fetched_at TEXT DEFAULT '',source_type TEXT DEFAULT 'web',authority_level TEXT DEFAULT 'D',authority_score INTEGER NOT NULL DEFAULT 0,excerpt TEXT DEFAULT '',content_text TEXT DEFAULT '',content_hash TEXT DEFAULT '',data_period TEXT DEFAULT '',provider TEXT DEFAULT '',confidence INTEGER NOT NULL DEFAULT 0,verification_status TEXT DEFAULT 'single',status TEXT NOT NULL DEFAULT 'candidate',metadata_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_web_evidence_project ON web_evidence(user_id,project_id,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_web_evidence_section ON web_evidence(user_id,project_id,chapter,section);
CREATE TABLE IF NOT EXISTS web_evidence_bindings (id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL,user_id INTEGER NOT NULL,project_id TEXT DEFAULT '',logic_id TEXT NOT NULL,chapter TEXT DEFAULT '',section TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'approved',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,UNIQUE(evidence_id,logic_id));
CREATE INDEX IF NOT EXISTS idx_web_evidence_bindings_project ON web_evidence_bindings(user_id,project_id,logic_id,status);
CREATE TABLE IF NOT EXISTS data_requirement_refinements (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,project_id TEXT NOT NULL,logic_id TEXT NOT NULL,version INTEGER NOT NULL,requirement_json TEXT NOT NULL,feedback TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,UNIQUE(user_id,project_id,logic_id,version));
CREATE INDEX IF NOT EXISTS idx_requirement_refinement_latest ON data_requirement_refinements(user_id,project_id,logic_id,version DESC);
CREATE TABLE IF NOT EXISTS web_provider_health (provider TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'unknown',latency_ms INTEGER NOT NULL DEFAULT 0,last_error TEXT DEFAULT '',success_count INTEGER NOT NULL DEFAULT 0,failure_count INTEGER NOT NULL DEFAULT 0,last_checked_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS web_search_lenses (id TEXT PRIMARY KEY,name TEXT NOT NULL,dimension TEXT DEFAULT '',domains_json TEXT NOT NULL DEFAULT '[]',housing_types_json TEXT NOT NULL DEFAULT '[]',query_suffix TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'active',version INTEGER NOT NULL DEFAULT 1,updated_by TEXT DEFAULT '',updated_at BIGINT NOT NULL);

-- AI办公固定模板PPT工作台
CREATE TABLE IF NOT EXISTS ppt_projects (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',template_id TEXT NOT NULL DEFAULT 'anju-blue',data TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 1,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ppt_projects_user ON ppt_projects(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS ppt_project_versions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,revision INTEGER NOT NULL,label TEXT DEFAULT '',data TEXT NOT NULL,created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ppt_versions_project ON ppt_project_versions(user_id,project_id,created_at DESC);

-- Investment OS Phase 2.5：项目智能只读模型所需的数据边界与真实进度底座
CREATE TABLE IF NOT EXISTS project_profiles (project_id TEXT PRIMARY KEY,owner_user_id INTEGER NOT NULL,organization_id TEXT DEFAULT '',department_id TEXT DEFAULT '',visibility TEXT NOT NULL DEFAULT 'private',confidentiality_level TEXT NOT NULL DEFAULT 'internal',lifecycle_stage TEXT NOT NULL DEFAULT 'discovery',current_gate_id TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS project_memberships (project_id TEXT NOT NULL,user_id INTEGER NOT NULL,role TEXT NOT NULL DEFAULT 'VIEWER',status TEXT NOT NULL DEFAULT 'active',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,PRIMARY KEY(project_id,user_id));
CREATE INDEX IF NOT EXISTS idx_project_memberships_user ON project_memberships(user_id,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS project_gates (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,stage_key TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'not_started',planned_date TEXT DEFAULT '',actual_date TEXT DEFAULT '',owner TEXT DEFAULT '',criteria_json TEXT NOT NULL DEFAULT '[]',block_reason TEXT DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS project_milestones (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,stage_key TEXT DEFAULT '',gate_id TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'not_started',planned_date TEXT DEFAULT '',forecast_date TEXT DEFAULT '',actual_date TEXT DEFAULT '',owner TEXT DEFAULT '',progress DOUBLE PRECISION NOT NULL DEFAULT 0,weight DOUBLE PRECISION NOT NULL DEFAULT 1,risk_level TEXT DEFAULT 'normal',sort_order INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS project_deliverables (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,stage_key TEXT DEFAULT '',gate_id TEXT DEFAULT '',milestone_id TEXT DEFAULT '',artifact_id TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'not_started',required INTEGER NOT NULL DEFAULT 1,owner TEXT DEFAULT '',due_date TEXT DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS project_files (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,owner_user_id INTEGER NOT NULL,file_name TEXT NOT NULL,file_type TEXT DEFAULT '',category TEXT DEFAULT 'other',storage_ref TEXT DEFAULT '',fingerprint TEXT DEFAULT '',version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'registered',parse_status TEXT DEFAULT 'pending',is_current INTEGER NOT NULL DEFAULT 1,parent_file_id TEXT DEFAULT '',size_bytes BIGINT NOT NULL DEFAULT 0,meta_json TEXT NOT NULL DEFAULT '{}',created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id,is_current,updated_at DESC);
CREATE TABLE IF NOT EXISTS project_file_extractions (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,file_id TEXT NOT NULL,extraction_type TEXT NOT NULL DEFAULT 'fact',item_key TEXT NOT NULL,label TEXT DEFAULT '',value_json TEXT NOT NULL DEFAULT 'null',source_location TEXT DEFAULT '',confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,review_status TEXT NOT NULL DEFAULT 'candidate',target_ref TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_file_extractions_project ON project_file_extractions(project_id,file_id,review_status,updated_at DESC);
CREATE TABLE IF NOT EXISTS project_data_issues (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,item_kind TEXT NOT NULL,item_key TEXT NOT NULL,issue_type TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'medium',description TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'open',resolution TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_project_data_issues_project ON project_data_issues(project_id,status,severity,updated_at DESC);

-- 可研标准表格模板版本、发布与可审计回滚
CREATE TABLE IF NOT EXISTS report_table_template_versions (
  id TEXT PRIMARY KEY,project_type TEXT NOT NULL,version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',overrides TEXT NOT NULL,
  created_at BIGINT NOT NULL,created_by TEXT DEFAULT '',reason TEXT NOT NULL DEFAULT '',
  restored_from_version INTEGER
);
CREATE INDEX IF NOT EXISTS idx_report_table_versions_type ON report_table_template_versions(project_type,status,version DESC);
