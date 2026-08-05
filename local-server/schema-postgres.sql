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
