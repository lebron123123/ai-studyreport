-- 已部署环境的增量迁移：Wiki 知识层
CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'report',
  status TEXT NOT NULL DEFAULT 'draft',
  content TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  region TEXT DEFAULT '',
  project_type TEXT DEFAULT '',
  doc_no TEXT DEFAULT '',
  issuer TEXT DEFAULT '',
  source_ref TEXT DEFAULT '',
  security INTEGER NOT NULL DEFAULT 1,
  dept_scope TEXT DEFAULT '全部门',
  effective_date TEXT DEFAULT '',
  expiry_date TEXT DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  vector_ids TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER,
  created_name TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_status_updated ON wiki_pages(status, updated_at DESC);
