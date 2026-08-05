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

-- AI可研生成（对话式）· 会话进度存档，每人一份，覆盖式保存
CREATE TABLE IF NOT EXISTS aireport_sessions (
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

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
