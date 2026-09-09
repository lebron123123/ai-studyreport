-- Additive: legacy meeting candidates and generic tasks are not promoted or rewritten.
CREATE TABLE IF NOT EXISTS project_obligations (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,event_id TEXT NOT NULL,obligation_type TEXT NOT NULL,round INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,detail_json TEXT NOT NULL,status TEXT NOT NULL,assignee_id INTEGER,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,UNIQUE(project_id,event_id,obligation_type,round));
CREATE INDEX IF NOT EXISTS idx_project_obligations_project ON project_obligations(project_id,updated_at);
