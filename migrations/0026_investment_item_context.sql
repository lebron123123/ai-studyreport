-- Existing completed items remain legacy/unverified until explicitly checked against evidence.
CREATE TABLE IF NOT EXISTS investment_item_context (
  item_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, item_type TEXT NOT NULL,
  stage_key TEXT NOT NULL DEFAULT '', milestone_id TEXT NOT NULL DEFAULT '',
  evidence_ids_json TEXT NOT NULL DEFAULT '[]', completion_meta_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1, updated_by INTEGER NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investment_item_context_project ON investment_item_context(project_id);
