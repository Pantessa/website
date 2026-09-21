-- Pricing v2 (additive). Run on TEST and PROD before the code that reads it.
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS pool TEXT;
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS grant_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_grant_key_key ON credit_ledger (grant_key);

CREATE TABLE IF NOT EXISTS inference_calls (
  id                 TEXT PRIMARY KEY,
  surface            TEXT NOT NULL,
  model              TEXT NOT NULL,
  key_source         TEXT NOT NULL DEFAULT 'house',
  owner_address      TEXT,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           DOUBLE PRECISION NOT NULL DEFAULT 0,
  ok                 BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS inference_calls_created_at_idx ON inference_calls (created_at);
CREATE INDEX IF NOT EXISTS inference_calls_surface_created_at_idx ON inference_calls (surface, created_at);

CREATE TABLE IF NOT EXISTS inference_keys (
  owner_address  TEXT NOT NULL,
  provider       TEXT NOT NULL DEFAULT 'anthropic',
  ciphertext     TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  tag            TEXT NOT NULL,
  last4          TEXT NOT NULL,
  synth_model    TEXT,
  use_for_embeds BOOLEAN NOT NULL DEFAULT false,
  last_error     TEXT,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at   TIMESTAMP(3),
  PRIMARY KEY (owner_address, provider)
);
