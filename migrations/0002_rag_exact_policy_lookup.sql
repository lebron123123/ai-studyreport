-- 政策文号/条款精确检索与引用定位
CREATE TABLE IF NOT EXISTS rag_file_meta (
  title TEXT PRIMARY KEY,
  doc_no TEXT DEFAULT '',
  issuer TEXT DEFAULT '',
  source_ref TEXT DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rag_text_chunks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  chapter TEXT DEFAULT '',
  section TEXT DEFAULT '',
  text TEXT NOT NULL,
  category TEXT DEFAULT '',
  doc_no TEXT DEFAULT '',
  issuer TEXT DEFAULT '',
  source_ref TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rag_text_chunks_title ON rag_text_chunks(title);
CREATE INDEX IF NOT EXISTS idx_rag_text_chunks_doc_no ON rag_text_chunks(doc_no);
