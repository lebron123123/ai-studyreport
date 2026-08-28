-- Agent 企业级运行账本：Run / Step / Checkpoint / Approval / Skill Candidate
-- 全部 JSON 使用 TEXT，兼容 Cloudflare D1 与本地 PostgreSQL 适配层。
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'general',
  project_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  query_text TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT NOT NULL DEFAULT '',
  current_step INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT DEFAULT 0,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_updated ON agent_runs(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated ON agent_runs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  step_no INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tool_name TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'read',
  status TEXT NOT NULL DEFAULT 'completed',
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_run_steps(run_id, step_no);

CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  step_no INTEGER NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  resume_token TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_run ON agent_checkpoints(run_id, step_no DESC);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  request_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  decided_at BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_run ON agent_approvals(run_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_skill_candidates (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  scene TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  instruction_md TEXT NOT NULL DEFAULT '',
  source_run_id TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'candidate',
  version INTEGER NOT NULL DEFAULT 1,
  reviewed_by TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_skills_status ON agent_skill_candidates(status, updated_at DESC);
