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
