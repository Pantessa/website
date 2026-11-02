-- THE POLICY POOL — the ledger behind /policy-pool and the indexer's
-- per-chain cursor (squad policy-pool, 2026-11-02). Additive only; mirrors
-- the PolicyPoolEvent / PolicyPoolCursor models in prisma/schema.prisma.
CREATE TABLE IF NOT EXISTS policy_pool_events (
  id           text PRIMARY KEY,
  kind         text NOT NULL,
  chain_id     integer NOT NULL,
  intent_id    text,
  origin       text,
  swapper      text,
  amount_in    text,
  amount_out   text,
  usd          double precision,
  tx_hash      text,
  block_number integer,
  log_index    integer,
  reason       text,
  meta         jsonb,
  created_at   timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_pool_events_tx_hash_log_index_key ON policy_pool_events (tx_hash, log_index);
CREATE INDEX IF NOT EXISTS policy_pool_events_kind_created_at_idx ON policy_pool_events (kind, created_at);
CREATE INDEX IF NOT EXISTS policy_pool_events_intent_id_idx ON policy_pool_events (intent_id);
CREATE INDEX IF NOT EXISTS policy_pool_events_tx_hash_idx ON policy_pool_events (tx_hash);

CREATE TABLE IF NOT EXISTS policy_pool_cursors (
  chain_id   integer PRIMARY KEY,
  last_block integer NOT NULL,
  updated_at timestamptz(6) NOT NULL
);
