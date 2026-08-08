CREATE TABLE moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'moment' CHECK (kind IN ('archive', 'quote', 'moment')),
  member TEXT NOT NULL DEFAULT 'ほうとう組。',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  timestamp_seconds INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  author_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX moments_status_created_at ON moments (status, created_at DESC);
