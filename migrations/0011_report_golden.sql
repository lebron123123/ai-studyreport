CREATE TABLE IF NOT EXISTS report_golden_samples (
  id TEXT PRIMARY KEY,name TEXT NOT NULL,calc_type TEXT NOT NULL DEFAULT '',region TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',
  source_project_id TEXT NOT NULL DEFAULT '',sample_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'candidate',user_id INTEGER NOT NULL,created_by TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_golden_samples_status ON report_golden_samples(status,calc_type,updated_at);
CREATE TABLE IF NOT EXISTS report_golden_runs (
  id TEXT PRIMARY KEY,sample_id TEXT NOT NULL,user_id INTEGER NOT NULL,score INTEGER NOT NULL DEFAULT 0,passed INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL DEFAULT '{}',result_json TEXT NOT NULL DEFAULT '{}',candidate_hash TEXT NOT NULL DEFAULT '',created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_golden_runs_sample ON report_golden_runs(sample_id,created_at);
