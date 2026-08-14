CREATE TABLE IF NOT EXISTS personal_notes (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,parent_id TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'note',title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',tags TEXT NOT NULL DEFAULT '[]',favorite INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',source_name TEXT DEFAULT '',source_type TEXT DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,deleted_at BIGINT DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_personal_notes_user_status ON personal_notes(user_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_notes_parent ON personal_notes(user_id,parent_id,status,sort_order,title);
CREATE TABLE IF NOT EXISTS personal_note_versions (id TEXT PRIMARY KEY,note_id TEXT NOT NULL,user_id INTEGER NOT NULL,revision INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',tags TEXT NOT NULL DEFAULT '[]',created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_personal_versions_note ON personal_note_versions(user_id,note_id,created_at DESC);
CREATE TABLE IF NOT EXISTS personal_note_links (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,from_note_id TEXT NOT NULL,to_note_id TEXT DEFAULT '',target_title TEXT NOT NULL,link_text TEXT DEFAULT '',created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_personal_links_from ON personal_note_links(user_id,from_note_id);
CREATE INDEX IF NOT EXISTS idx_personal_links_to ON personal_note_links(user_id,to_note_id,target_title);
