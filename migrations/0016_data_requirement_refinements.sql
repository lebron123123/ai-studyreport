CREATE TABLE IF NOT EXISTS data_requirement_refinements (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  logic_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  requirement_json TEXT NOT NULL,
  feedback TEXT DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id,project_id,logic_id,version)
);
CREATE INDEX IF NOT EXISTS idx_requirement_refinement_latest ON data_requirement_refinements(user_id,project_id,logic_id,version DESC);
