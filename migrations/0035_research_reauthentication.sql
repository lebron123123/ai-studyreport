-- Persistent rate limiting; counts survive failed authorization and process restarts.
CREATE TABLE IF NOT EXISTS research_auth_attempts (
 user_id INTEGER PRIMARY KEY,
 window_start BIGINT NOT NULL,
 attempts INTEGER NOT NULL
);
