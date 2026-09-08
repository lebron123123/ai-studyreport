-- Additive only. Existing profile/data stages are not rewritten or treated as approval.
CREATE TABLE IF NOT EXISTS project_work_stages (
  project_id TEXT PRIMARY KEY,
  stage_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER NOT NULL,
  updated_at BIGINT NOT NULL,
  legacy_conflict_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS project_fact_details (
  fact_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_project_fact_details_project ON project_fact_details(project_id);
