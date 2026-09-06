-- Additive, repeatable storage for server-owned calls, section tasks and evaluation evidence.
CREATE TABLE IF NOT EXISTS agent_call_ledger (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, root_run_id TEXT NOT NULL, user_id INTEGER NOT NULL,
 status TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
 reserved_input BIGINT NOT NULL, reserved_output BIGINT NOT NULL, reserved_cost BIGINT NOT NULL,
 actual_input BIGINT, actual_output BIGINT, actual_cost BIGINT,
 rate_json TEXT NOT NULL, response_json TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_call_root ON agent_call_ledger(root_run_id,status);
CREATE TABLE IF NOT EXISTS report_section_tasks (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id INTEGER NOT NULL, section_key TEXT NOT NULL,
 input_hash TEXT NOT NULL, rules_hash TEXT NOT NULL, input_json TEXT NOT NULL, run_id TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_trusted_cases (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scenario TEXT NOT NULL, dataset_role TEXT NOT NULL,
 sample_hash TEXT NOT NULL, sample_json TEXT NOT NULL, approved_by INTEGER NOT NULL, approved_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_trusted_runs (
 id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, candidate_hash TEXT NOT NULL, case_id TEXT NOT NULL,
 sample_hash TEXT NOT NULL, run_id TEXT NOT NULL, user_id INTEGER NOT NULL, result_json TEXT NOT NULL DEFAULT '',
 created_at BIGINT NOT NULL, UNIQUE(candidate_hash,case_id)
);
