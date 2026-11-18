-- The news index (2026-11-18, lib/news-index.ts + lib/news-x.ts). Additive only.
--
-- news_items         one row per story URL, from every feed we read
-- news_symbol_items  which symbol pages a story is on
-- news_feed_state    when each feed was last read, and who is reading it now
-- news_x_posts       posts about a cashtag, read from X's paid search
-- news_x_pulls       every paid X read: what was reserved, what it cost

CREATE TABLE IF NOT EXISTS news_items (
  id text PRIMARY KEY,
  url text NOT NULL,
  title text NOT NULL,
  title_key text NOT NULL,
  source text NOT NULL,
  feed text NOT NULL,
  summary text,
  image_url text,
  published_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS news_items_published_idx ON news_items (published_at);

CREATE TABLE IF NOT EXISTS news_symbol_items (
  symbol text NOT NULL,
  item_id text NOT NULL,
  published_at timestamptz NOT NULL,
  PRIMARY KEY (symbol, item_id)
);

CREATE INDEX IF NOT EXISTS news_symbol_items_recent_idx ON news_symbol_items (symbol, published_at);

CREATE TABLE IF NOT EXISTS news_feed_state (
  feed_key text PRIMARY KEY,
  claimed_at timestamptz,
  fetched_at timestamptz,
  ok boolean NOT NULL DEFAULT false,
  item_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS news_x_posts (
  symbol text NOT NULL,
  post_id text NOT NULL,
  body text NOT NULL,
  author_handle text,
  author_name text,
  author_avatar text,
  likes integer NOT NULL DEFAULT 0,
  reposts integer NOT NULL DEFAULT 0,
  replies integer NOT NULL DEFAULT 0,
  posted_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_internal boolean NOT NULL DEFAULT false,
  PRIMARY KEY (symbol, post_id)
);

CREATE INDEX IF NOT EXISTS news_x_posts_recent_idx ON news_x_posts (symbol, posted_at);

CREATE TABLE IF NOT EXISTS news_x_pulls (
  id text PRIMARY KEY,
  symbol text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reserved_usd double precision NOT NULL DEFAULT 0,
  cost_usd double precision,
  read_count integer NOT NULL DEFAULT 0,
  kept_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  is_internal boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS news_x_pulls_started_idx ON news_x_pulls (started_at);
