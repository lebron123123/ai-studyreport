CREATE TABLE IF NOT EXISTS ppt_assets (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'personal',
  project_id TEXT DEFAULT '',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'image',
  tags TEXT NOT NULL DEFAULT '[]',
  mime_type TEXT DEFAULT 'image/png',
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  bytes INTEGER DEFAULT 0,
  content_hash TEXT NOT NULL,
  data_url TEXT NOT NULL,
  thumbnail_url TEXT DEFAULT '',
  provider TEXT DEFAULT 'upload',
  source_ref TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  model TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  favorite INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  review_note TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ppt_assets_user ON ppt_assets(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppt_assets_status ON ppt_assets(status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppt_assets_project ON ppt_assets(project_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppt_assets_hash ON ppt_assets(content_hash);
CREATE TABLE IF NOT EXISTS ppt_asset_usage (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  project_id TEXT DEFAULT '',
  slide_id TEXT DEFAULT '',
  usage_type TEXT DEFAULT 'ppt-slide',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppt_asset_usage_asset ON ppt_asset_usage(asset_id,created_at DESC);
