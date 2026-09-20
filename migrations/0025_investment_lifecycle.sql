-- Additive, idempotent. No existing decision or selected scenario becomes approved.
CREATE TABLE IF NOT EXISTS investment_versions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'forecast' CHECK(kind='forecast'),
  name TEXT NOT NULL, scenario_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL, request_key TEXT NOT NULL, created_by INTEGER NOT NULL, created_at BIGINT NOT NULL,
  UNIQUE(project_id,version_number), UNIQUE(project_id,request_key)
);
CREATE TABLE IF NOT EXISTS investment_change_requests (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL,
  version_id TEXT NOT NULL, baseline_version_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status='requested'), request_type TEXT NOT NULL,
  reason TEXT NOT NULL, content_hash TEXT NOT NULL, request_key TEXT NOT NULL,
  created_by INTEGER NOT NULL, created_at BIGINT NOT NULL, UNIQUE(project_id,request_key)
);
CREATE TABLE IF NOT EXISTS investment_actual_values (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL,
  metric_key TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  unit TEXT NOT NULL, currency TEXT NOT NULL, basis TEXT NOT NULL, value DOUBLE PRECISION NOT NULL,
  source_ref TEXT NOT NULL, source_evidence_id TEXT NOT NULL, source_hash TEXT NOT NULL,
  version INTEGER NOT NULL, supersedes_id TEXT NOT NULL DEFAULT '', request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL, confirmed_by INTEGER NOT NULL, created_at BIGINT NOT NULL,
  UNIQUE(project_id,metric_key,period_start,period_end,unit,currency,basis,version), UNIQUE(project_id,request_key)
);
CREATE INDEX IF NOT EXISTS idx_investment_versions_project ON investment_versions(project_id,version_number);
CREATE INDEX IF NOT EXISTS idx_investment_requests_project ON investment_change_requests(project_id,created_at);
CREATE INDEX IF NOT EXISTS idx_investment_actuals_project ON investment_actual_values(project_id,created_at);
