CREATE TABLE IF NOT EXISTS ppt_projects (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  template_id TEXT NOT NULL DEFAULT 'anju-blue',
  data TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppt_projects_user ON ppt_projects(user_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS ppt_project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  label TEXT DEFAULT '',
  data TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppt_versions_project ON ppt_project_versions(user_id,project_id,created_at DESC);
