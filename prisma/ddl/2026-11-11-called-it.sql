-- CALLED IT (squad called-it, 2026-11-11). Additive only: four new tables,
-- nothing existing is touched. Run on TEST and on PROD by the squad through
-- scripts/run-ddl.ts before the PR is handed over (standing rule 10).

CREATE TABLE IF NOT EXISTS x_handles (
  handle text PRIMARY KEY,
  x_user_id text,
  name text,
  avatar_url text,
  followers integer,
  is_protected boolean NOT NULL DEFAULT false,
  is_blue boolean NOT NULL DEFAULT false,
  claimed_x_user_id text,
  claimed_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS x_posts (
  post_id text PRIMARY KEY,
  handle text NOT NULL,
  x_user_id text,
  text text NOT NULL,
  posted_at timestamptz NOT NULL,
  likes integer,
  replies integer,
  reposts integer,
  is_reply boolean NOT NULL DEFAULT false,
  source text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gone_at timestamptz
);
CREATE INDEX IF NOT EXISTS x_posts_handle_posted_at_idx ON x_posts (handle, posted_at);

CREATE TABLE IF NOT EXISTS x_calls (
  post_id text NOT NULL,
  symbol text NOT NULL,
  stance text NOT NULL,
  conviction integer NOT NULL DEFAULT 0,
  quote text,
  model text,
  origin text NOT NULL DEFAULT 'scan',
  labeled_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, symbol)
);
CREATE INDEX IF NOT EXISTS x_calls_symbol_idx ON x_calls (symbol);

CREATE TABLE IF NOT EXISTS x_scans (
  id text PRIMARY KEY,
  handle text NOT NULL,
  symbol text NOT NULL,
  status text NOT NULL,
  provider text,
  window_from timestamptz,
  window_to timestamptz,
  posts_read integer NOT NULL DEFAULT 0,
  calls_found integer NOT NULL DEFAULT 0,
  cost_usd double precision NOT NULL DEFAULT 0,
  requested_by text,
  is_internal boolean NOT NULL DEFAULT false,
  note text,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS x_scans_handle_symbol_started_at_idx ON x_scans (handle, symbol, started_at);
CREATE INDEX IF NOT EXISTS x_scans_started_at_idx ON x_scans (started_at);

-- Review round (2026-11-11): the ledger columns the fixes need. Additive.
ALTER TABLE x_calls ADD COLUMN IF NOT EXISTS added_by text;
CREATE INDEX IF NOT EXISTS x_calls_added_by_labeled_at_idx ON x_calls (added_by, labeled_at);
ALTER TABLE x_scans ADD COLUMN IF NOT EXISTS truncated boolean NOT NULL DEFAULT false;
ALTER TABLE x_scans ADD COLUMN IF NOT EXISTS oldest_post_at timestamptz;
ALTER TABLE x_scans ADD COLUMN IF NOT EXISTS reserved_usd double precision NOT NULL DEFAULT 0;
ALTER TABLE x_handles ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE x_handles ADD COLUMN IF NOT EXISTS hidden_by text;
ALTER TABLE x_handles ADD COLUMN IF NOT EXISTS missing_at timestamptz;
