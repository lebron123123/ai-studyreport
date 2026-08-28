-- Agent 企业级运行治理：后台任务、父子谱系、成本、Skill版本与ABAC。
CREATE TABLE IF NOT EXISTS agent_run_governance (
  run_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, parent_run_id TEXT DEFAULT '', root_run_id TEXT DEFAULT '',
  department TEXT DEFAULT '', security_level INTEGER NOT NULL DEFAULT 1, execution_mode TEXT NOT NULL DEFAULT 'client',
  budget_input_tokens INTEGER NOT NULL DEFAULT 0, budget_output_tokens INTEGER NOT NULL DEFAULT 0,
  budget_cost_micros BIGINT NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0, cost_micros BIGINT NOT NULL DEFAULT 0,
  provider TEXT DEFAULT '', model TEXT DEFAULT '', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_governance_root ON agent_run_governance(root_run_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'llm_task',
  payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, next_retry_at BIGINT NOT NULL DEFAULT 0,
  lease_owner TEXT DEFAULT '', lease_expires_at BIGINT NOT NULL DEFAULT 0, error_text TEXT DEFAULT '',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, completed_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim ON agent_jobs(status,next_retry_at,priority,created_at);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_user ON agent_jobs(user_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_run_usage (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id INTEGER NOT NULL, provider TEXT DEFAULT '', model TEXT DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_micros BIGINT NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_usage_run ON agent_run_usage(run_id,created_at);

CREATE TABLE IF NOT EXISTS agent_skill_versions (
  id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, version INTEGER NOT NULL, instruction_md TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]', eval_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER NOT NULL, created_at BIGINT NOT NULL, UNIQUE(skill_id,version)
);
CREATE TABLE IF NOT EXISTS agent_skill_evals (
  id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, version INTEGER NOT NULL, passed INTEGER NOT NULL DEFAULT 0,
  score DOUBLE PRECISION NOT NULL DEFAULT 0, cases_json TEXT NOT NULL DEFAULT '[]', result_json TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_skill_releases (
  skill_id TEXT PRIMARY KEY, active_version INTEGER NOT NULL, previous_version INTEGER NOT NULL DEFAULT 0,
  published_by TEXT DEFAULT '', published_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_project_access (
  user_id INTEGER NOT NULL, project_id TEXT NOT NULL, department TEXT DEFAULT '', permission TEXT NOT NULL DEFAULT 'read',
  max_security_level INTEGER NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL, PRIMARY KEY(user_id,project_id)
);

