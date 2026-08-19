-- Accounts are identified by email alone; there is no password to store,
-- reset, or leak. Everything else hangs off the user id.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  last_seen_at TEXT
);

-- A magic link is one row here: single use, short lived. Deleting the row on
-- use is what makes the link one-shot, so a leaked mail cannot be replayed.
CREATE TABLE login_tokens (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_login_tokens_email ON login_tokens(email);

-- Sessions are long lived (six months) because the alternative is mailing the
-- user a link every few weeks for an app they read daily.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- The rule half of a tracker. Keywords are stored as JSON arrays rather than
-- a join table: they are read and written whole, never queried across.
CREATE TABLE trackers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kw_all       TEXT NOT NULL DEFAULT '[]',
  kw_any       TEXT NOT NULL DEFAULT '[]',
  query_kr     TEXT,
  query_en     TEXT,
  from_date    TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  per_day      INTEGER NOT NULL DEFAULT 8,
  all_sources  INTEGER NOT NULL DEFAULT 0,
  sort_order   TEXT NOT NULL DEFAULT 'desc',
  seen_at      TEXT,
  swept_from   TEXT,
  swept_to     TEXT,
  swept_at     TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_trackers_user ON trackers(user_id);
CREATE INDEX idx_trackers_active ON trackers(status) WHERE status = 'active';

-- One row per article on a timeline. UNIQUE(tracker_id, url) is the cheap half
-- of dedup; the title-similarity half runs in code before insert.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tracker_id  TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  source      TEXT,
  url         TEXT NOT NULL,
  coverage    INTEGER NOT NULL DEFAULT 0,
  is_note     INTEGER NOT NULL DEFAULT 0,
  is_manual   INTEGER NOT NULL DEFAULT 0,
  added_at    TEXT NOT NULL,
  UNIQUE(tracker_id, url)
);
CREATE INDEX idx_events_tracker_date ON events(tracker_id, date DESC);

-- Articles the user removed, and ones a sweep skipped over the daily cap.
-- Both exist to stop the next sweep re-adding what was already rejected.
CREATE TABLE excluded_urls (
  tracker_id  TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  reason      TEXT NOT NULL,
  PRIMARY KEY (tracker_id, url)
);
