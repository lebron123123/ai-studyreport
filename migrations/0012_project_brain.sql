CREATE TABLE IF NOT EXISTS project_facts (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,fact_type TEXT NOT NULL,fact_key TEXT NOT NULL,label TEXT DEFAULT '',value_json TEXT NOT NULL DEFAULT 'null',unit TEXT DEFAULT '',source_type TEXT DEFAULT '',source_ref TEXT DEFAULT '',confidence REAL NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'candidate',valid_from TEXT DEFAULT '',valid_to TEXT DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_facts_version ON project_facts(project_id,user_id,fact_key,version);
CREATE INDEX IF NOT EXISTS idx_project_facts_lookup ON project_facts(project_id,user_id,status,updated_at);
CREATE TABLE IF NOT EXISTS project_metrics (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,metric_key TEXT NOT NULL,label TEXT DEFAULT '',value_json TEXT NOT NULL DEFAULT 'null',unit TEXT DEFAULT '',calc_snapshot_id TEXT DEFAULT '',lineage_json TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_metrics_lookup ON project_metrics(project_id,user_id,metric_key,version);
CREATE TABLE IF NOT EXISTS project_artifacts (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,artifact_type TEXT NOT NULL,title TEXT DEFAULT '',module_ref TEXT DEFAULT '',version TEXT DEFAULT '',status TEXT DEFAULT 'draft',evidence_audit_id TEXT DEFAULT '',meta_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_artifacts_lookup ON project_artifacts(project_id,user_id,artifact_type,updated_at);
CREATE TABLE IF NOT EXISTS project_events (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,event_type TEXT NOT NULL,actor TEXT DEFAULT '',payload_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_events_lookup ON project_events(project_id,user_id,created_at);
CREATE TABLE IF NOT EXISTS project_decisions (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,stage_key TEXT DEFAULT 'feasibility',topic TEXT NOT NULL,options_json TEXT NOT NULL DEFAULT '[]',decision_text TEXT DEFAULT '',evidence_ids_json TEXT NOT NULL DEFAULT '[]',scenario_ids_json TEXT NOT NULL DEFAULT '[]',owner TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'candidate',created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_decisions_lookup ON project_decisions(project_id,user_id,status,updated_at);
CREATE TABLE IF NOT EXISTS project_change_sets (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,title TEXT DEFAULT '',before_json TEXT NOT NULL DEFAULT '{}',after_json TEXT NOT NULL DEFAULT '{}',impact_json TEXT NOT NULL DEFAULT '{}',approval_status TEXT NOT NULL DEFAULT 'preview',created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_changes_lookup ON project_change_sets(project_id,user_id,created_at);
CREATE TABLE IF NOT EXISTS project_stage_history (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,from_stage TEXT DEFAULT '',to_stage TEXT NOT NULL,reason TEXT DEFAULT '',approved_by TEXT DEFAULT '',changed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_stage_history_lookup ON project_stage_history(project_id,user_id,changed_at);
