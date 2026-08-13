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
