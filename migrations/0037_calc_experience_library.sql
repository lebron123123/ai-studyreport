-- 财务测算经验库：明细记录、逐项指标和删除申请均独立留痕。
CREATE TABLE IF NOT EXISTS calc_experience_records (
  id TEXT PRIMARY KEY,
  project_id TEXT DEFAULT '',
  project_name TEXT NOT NULL,
  project_type TEXT NOT NULL,
  region TEXT DEFAULT '',
  base_year INTEGER,
  currency TEXT NOT NULL DEFAULT 'CNY',
  source_kind TEXT NOT NULL DEFAULT 'manual',
  source_note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  user_id INTEGER NOT NULL,
  username TEXT DEFAULT '',
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT,
  reviewed_by TEXT DEFAULT '',
  review_note TEXT DEFAULT '',
  deleted_at BIGINT,
  deleted_by TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_calc_experience_records_type_status
  ON calc_experience_records(project_type, status, created_at);
CREATE INDEX IF NOT EXISTS idx_calc_experience_records_user
  ON calc_experience_records(user_id, created_at);

CREATE TABLE IF NOT EXISTS calc_experience_metrics (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES calc_experience_records(id),
  category TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  unit TEXT DEFAULT '',
  ratio_pct DOUBLE PRECISION,
  period_label TEXT DEFAULT '',
  note TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_calc_experience_metrics_record
  ON calc_experience_metrics(record_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_calc_experience_metrics_benchmark
  ON calc_experience_metrics(metric_key, category);

CREATE TABLE IF NOT EXISTS calc_experience_delete_requests (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES calc_experience_records(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requester_user_id INTEGER NOT NULL,
  requester_username TEXT DEFAULT '',
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT,
  reviewed_by TEXT DEFAULT '',
  review_note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_calc_experience_delete_requests_status
  ON calc_experience_delete_requests(status, created_at);
