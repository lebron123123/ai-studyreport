CREATE TABLE IF NOT EXISTS report_table_template_versions (
  id TEXT PRIMARY KEY,
  project_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  overrides TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  created_by TEXT DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  restored_from_version INTEGER
);
CREATE INDEX IF NOT EXISTS idx_report_table_versions_type
  ON report_table_template_versions(project_type,status,version DESC);
