-- RAG原件对象存储元数据与知识版本关联。可重复执行，不改动已有RAG记录。
CREATE TABLE IF NOT EXISTS rag_source_objects (
  content_hash TEXT PRIMARY KEY, storage_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size_bytes BIGINT NOT NULL DEFAULT 0,
  created_by INTEGER, created_at BIGINT NOT NULL, verified_at BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rag_source_links (
  title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, content_hash TEXT NOT NULL,
  linked_at BIGINT NOT NULL, PRIMARY KEY(title,version)
);
CREATE INDEX IF NOT EXISTS idx_rag_source_links_hash ON rag_source_links(content_hash);
CREATE TABLE IF NOT EXISTS source_asset_objects (
  asset_id TEXT NOT NULL, version_no TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL,
  linked_at BIGINT NOT NULL, PRIMARY KEY(asset_id,version_no)
);
CREATE INDEX IF NOT EXISTS idx_source_asset_objects_hash ON source_asset_objects(content_hash);
