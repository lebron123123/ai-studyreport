-- Additive: old state_json remains readable and is never bulk rewritten.
CREATE TABLE IF NOT EXISTS research_state_objects (
 research_id TEXT NOT NULL,
 run_id TEXT NOT NULL,
 digest TEXT NOT NULL,
 content TEXT NOT NULL,
 created_at BIGINT NOT NULL,
 PRIMARY KEY (research_id, run_id, digest)
);
