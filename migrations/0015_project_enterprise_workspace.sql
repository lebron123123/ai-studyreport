CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,owner_user_id INTEGER NOT NULL,file_name TEXT NOT NULL,file_type TEXT DEFAULT '',category TEXT DEFAULT 'other',storage_ref TEXT DEFAULT '',fingerprint TEXT DEFAULT '',version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'registered',parse_status TEXT DEFAULT 'pending',is_current INTEGER NOT NULL DEFAULT 1,parent_file_id TEXT DEFAULT '',size_bytes BIGINT NOT NULL DEFAULT 0,meta_json TEXT NOT NULL DEFAULT '{}',created_by TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id,is_current,updated_at DESC);
CREATE TABLE IF NOT EXISTS project_file_extractions (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,file_id TEXT NOT NULL,extraction_type TEXT NOT NULL DEFAULT 'fact',item_key TEXT NOT NULL,label TEXT DEFAULT '',value_json TEXT NOT NULL DEFAULT 'null',source_location TEXT DEFAULT '',confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,review_status TEXT NOT NULL DEFAULT 'candidate',target_ref TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_file_extractions_project ON project_file_extractions(project_id,file_id,review_status,updated_at DESC);
CREATE TABLE IF NOT EXISTS project_data_issues (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL,item_kind TEXT NOT NULL,item_key TEXT NOT NULL,issue_type TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'medium',description TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'open',resolution TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_data_issues_project ON project_data_issues(project_id,status,severity,updated_at DESC);
