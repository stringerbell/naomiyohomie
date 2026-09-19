CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  page       TEXT NOT NULL,
  name       TEXT NOT NULL,
  message    TEXT NOT NULL,
  -- Only 'approved' rows are ever returned by the public API.
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reply      TEXT NOT NULL DEFAULT '',
  ip_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX comments_page_status ON comments (page, status, created_at);
CREATE INDEX comments_recent ON comments (created_at, ip_hash);
