CREATE TABLE IF NOT EXISTS submissions (
  week_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  team TEXT,
  marked_mask TEXT NOT NULL,
  marked_count INTEGER NOT NULL,
  bingo_count INTEGER NOT NULL,
  full_card INTEGER NOT NULL,
  tickets_total INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (week_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_week_score
ON submissions (week_id, tickets_total DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS ratelimits (
  k TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS card_definitions (
  week_id TEXT PRIMARY KEY,
  cells_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
