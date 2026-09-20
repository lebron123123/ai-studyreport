-- Additive; no legacy Wiki content or audience is rewritten.
CREATE TABLE IF NOT EXISTS wiki_source_bindings (
  wiki_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  locator TEXT NOT NULL,
  PRIMARY KEY(wiki_id,project_id,evidence_id)
);
