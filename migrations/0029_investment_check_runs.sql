CREATE TABLE IF NOT EXISTS investment_check_runs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_id TEXT NOT NULL,
 checked_at BIGINT NOT NULL, actor_id INTEGER NOT NULL, result_json TEXT NOT NULL,
 UNIQUE(project_id, request_id)
);
