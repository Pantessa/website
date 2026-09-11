-- MARKETS/COMM — chart posts (annotated-chart ideas + pinned links) and their
-- comments. Additive only. Prisma DateTime => timestamp(3), matching the rest
-- of the schema (no timestamptz anywhere in schema.prisma).
CREATE TABLE IF NOT EXISTS chart_posts (
  id          text PRIMARY KEY,
  symbol      text NOT NULL,
  author      text NOT NULL,
  kind        text NOT NULL DEFAULT 'idea',
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  chart_state jsonb,
  link_slug   text,
  link_url    text,
  fork_of     text,
  is_internal boolean NOT NULL DEFAULT false,
  created_at  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS chart_posts_symbol_internal_created_idx ON chart_posts (symbol, is_internal, created_at DESC);
CREATE INDEX IF NOT EXISTS chart_posts_author_created_idx ON chart_posts (author, created_at DESC);
CREATE INDEX IF NOT EXISTS chart_posts_fork_of_idx ON chart_posts (fork_of);

CREATE TABLE IF NOT EXISTS chart_post_comments (
  id          text PRIMARY KEY,
  post_id     text NOT NULL REFERENCES chart_posts(id) ON DELETE CASCADE,
  author      text NOT NULL,
  body        text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS chart_post_comments_post_created_idx ON chart_post_comments (post_id, created_at);
