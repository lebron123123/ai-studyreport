CREATE TABLE IF NOT EXISTS project_context_snapshots (
  id TEXT PRIMARY KEY, context_hash TEXT NOT NULL, project_id TEXT NOT NULL, user_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL,
  UNIQUE(user_id, project_id, context_hash)
);
CREATE INDEX IF NOT EXISTS idx_project_context_project ON project_context_snapshots(user_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_workflows (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, project_id TEXT NOT NULL, context_id TEXT NOT NULL,
  user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running', graph_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  UNIQUE(user_id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_report_workflows_project ON report_workflows(user_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS report_query_plans (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, project_id TEXT NOT NULL, user_id INTEGER NOT NULL,
  risk TEXT NOT NULL, decision TEXT NOT NULL, status TEXT NOT NULL, plan_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_query_workflow ON report_query_plans(user_id, workflow_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS report_feedback_candidates (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL, scope TEXT NOT NULL DEFAULT 'project_only',
  status TEXT NOT NULL DEFAULT 'candidate', scenario TEXT NOT NULL DEFAULT '', organization_id TEXT NOT NULL DEFAULT '',
  candidate_json TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, previous_version_id TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_feedback_status ON report_feedback_candidates(status, scope, updated_at DESC);

CREATE TABLE IF NOT EXISTS report_feedback_evaluations (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, user_id INTEGER NOT NULL, dataset_role TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT '', scenario TEXT NOT NULL DEFAULT '', metrics_json TEXT NOT NULL DEFAULT '{}',
  passed INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_feedback_eval ON report_feedback_evaluations(candidate_id, dataset_role, created_at);

CREATE TABLE IF NOT EXISTS report_rule_publications (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, scope TEXT NOT NULL, scope_key TEXT NOT NULL,
  version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'published', payload_json TEXT NOT NULL DEFAULT '{}',
  published_by TEXT NOT NULL, published_at BIGINT NOT NULL, rolled_back_by TEXT NOT NULL DEFAULT '',
  rollback_reason TEXT NOT NULL DEFAULT '', rolled_back_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_report_rule_scope ON report_rule_publications(scope, scope_key, status, published_at DESC);
