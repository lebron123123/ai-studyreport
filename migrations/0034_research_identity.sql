-- Additive foundation only. No conversion/deletion of legacy projects or sessions.
CREATE TABLE IF NOT EXISTS research_studies (
 id TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, title TEXT NOT NULL,
 visibility TEXT NOT NULL CHECK(visibility IN ('private','shared')),
 formal_project_id TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','abandoned')),
 version INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL,
 create_request TEXT NOT NULL, create_hash TEXT NOT NULL,
 UNIQUE(owner_user_id,create_request)
);
CREATE TABLE IF NOT EXISTS research_runs (
 id TEXT PRIMARY KEY, research_id TEXT NOT NULL REFERENCES research_studies(id),
 ordinal INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, epoch INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','history','abandoned')),
 state_json TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL,
 UNIQUE(research_id,ordinal), UNIQUE(research_id,id)
);
CREATE TABLE IF NOT EXISTS research_members (
 research_id TEXT NOT NULL REFERENCES research_studies(id), user_id INTEGER NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('viewer','editor','manager')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(research_id,user_id)
);
CREATE TABLE IF NOT EXISTS research_selections (
 research_id TEXT NOT NULL, user_id INTEGER NOT NULL, run_id TEXT NOT NULL,
 PRIMARY KEY(research_id,user_id), FOREIGN KEY(research_id,run_id) REFERENCES research_runs(research_id,id)
);
CREATE TABLE IF NOT EXISTS research_shared_active (
 research_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(research_id,run_id) REFERENCES research_runs(research_id,id)
);
CREATE TABLE IF NOT EXISTS research_requests (
 research_id TEXT NOT NULL, run_id TEXT NOT NULL, actor_id INTEGER NOT NULL,
 request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(research_id,run_id,actor_id,request_id),
 FOREIGN KEY(research_id,run_id) REFERENCES research_runs(research_id,id)
);
CREATE TABLE IF NOT EXISTS research_legacy_links (
 user_id INTEGER NOT NULL, legacy_project_id TEXT NOT NULL, research_id TEXT NOT NULL,
 run_id TEXT NOT NULL, source_hash TEXT NOT NULL, created_at BIGINT NOT NULL,
 PRIMARY KEY(user_id,legacy_project_id),
 FOREIGN KEY(research_id,run_id) REFERENCES research_runs(research_id,id)
);
CREATE INDEX IF NOT EXISTS idx_research_owner ON research_studies(owner_user_id,status);
CREATE INDEX IF NOT EXISTS idx_research_formal ON research_studies(formal_project_id);
