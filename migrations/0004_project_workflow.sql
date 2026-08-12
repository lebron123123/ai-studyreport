-- 项目级AI可研会话。测算快照与报告版本保存在projects.data.workflow中，兼容旧项目JSON。
CREATE TABLE IF NOT EXISTS aireport_project_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_aireport_project_sessions_user ON aireport_project_sessions(user_id, updated_at DESC);
