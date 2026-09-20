-- Sidecar metadata keeps legacy shared records unchanged. Private records never enter shared benchmarks.
CREATE TABLE IF NOT EXISTS calc_experience_workspaces (
  record_id TEXT PRIMARY KEY REFERENCES calc_experience_records(id),
  scope TEXT NOT NULL DEFAULT 'group' CHECK(scope IN ('group','private')),
  revision INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL DEFAULT '{}',
  updated_at BIGINT NOT NULL,
  updated_by INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calc_experience_history (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES calc_experience_records(id),
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(record_id,revision)
);
