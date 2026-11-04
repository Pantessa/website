-- FIVE-MILLION (2026-11-03) — tenants, scoped desk keys, approvals, the hash-
-- chained blotter, Telegram links, and tenant scoping on jobs + broker intents.
-- Additive only; mirrors the models in prisma/schema.prisma. Run with
--   DATABASE_URL=… npx tsx scripts/run-ddl.ts prisma/ddl/2026-11-03-five-million.sql
CREATE TABLE IF NOT EXISTS tenants (
  id            text PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  owner_address text NOT NULL,
  admins        jsonb NOT NULL DEFAULT '[]',
  plan          text NOT NULL DEFAULT 'free',
  fee_bps       integer,
  fee_mode      text NOT NULL DEFAULT 'calldata',
  signing_lane  text NOT NULL DEFAULT 'wallet',
  signers       jsonb NOT NULL DEFAULT '[]',
  status        text NOT NULL DEFAULT 'active',
  sandbox       boolean NOT NULL DEFAULT true,
  is_internal   boolean NOT NULL DEFAULT false,
  created_at    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamp(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS tenants_owner_address_idx ON tenants (owner_address);

CREATE TABLE IF NOT EXISTS tenant_policies (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  version      integer NOT NULL,
  state        text NOT NULL DEFAULT 'proposed',
  document     jsonb NOT NULL,
  proposed_by  text NOT NULL,
  approved_by  text,
  note         text,
  created_at   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at timestamp(3),
  CONSTRAINT tenant_policies_tenant_id_version_key UNIQUE (tenant_id, version)
);
CREATE INDEX IF NOT EXISTS tenant_policies_tenant_id_state_idx ON tenant_policies (tenant_id, state);

CREATE TABLE IF NOT EXISTS desk_keys (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  desk_id      text NOT NULL,
  label        text NOT NULL DEFAULT 'Desk key',
  hash         text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  paused       boolean NOT NULL DEFAULT false,
  ip_allow     jsonb NOT NULL DEFAULT '[]',
  last_used_at timestamp(3),
  revoked_at   timestamp(3),
  created_at   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS desk_keys_tenant_id_idx ON desk_keys (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_approvals (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id),
  intent_id  text NOT NULL,
  approver   text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_approvals_intent_id_approver_key UNIQUE (intent_id, approver)
);
CREATE INDEX IF NOT EXISTS tenant_approvals_tenant_id_intent_id_idx ON tenant_approvals (tenant_id, intent_id);

CREATE TABLE IF NOT EXISTS blotter_rows (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL,
  seq          integer NOT NULL,
  prev_hash    text NOT NULL,
  hash         text NOT NULL,
  kind         text NOT NULL,
  intent_id    text,
  job_id       text,
  desk_id      text,
  key_id       text,
  venue        text,
  chain_id     integer,
  value_usd    double precision,
  fee_usd      double precision,
  fee_bps      integer,
  tx_hash      text,
  verification text,
  payload      jsonb NOT NULL,
  created_at   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT blotter_rows_tenant_id_seq_key UNIQUE (tenant_id, seq)
);
CREATE INDEX IF NOT EXISTS blotter_rows_tenant_id_created_at_idx ON blotter_rows (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS blotter_rows_intent_id_idx ON blotter_rows (intent_id);

CREATE TABLE IF NOT EXISTS telegram_links (
  id         text PRIMARY KEY,
  owner      text NOT NULL,
  chat_id    text,
  code       text UNIQUE,
  linked_at  timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS telegram_links_owner_idx ON telegram_links (owner);
CREATE INDEX IF NOT EXISTS telegram_links_chat_id_idx ON telegram_links (chat_id);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS desk_key_id text;
ALTER TABLE broker_intents ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE broker_intents ADD COLUMN IF NOT EXISTS desk_key_id text;

CREATE TABLE IF NOT EXISTS desk_pilot_requests (
  id         text PRIMARY KEY,
  email      text NOT NULL,
  name       text,
  firm       text,
  custody    text,
  venues     text,
  notes      text,
  source     text NOT NULL DEFAULT 'desk',
  ip_hash    text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS desk_pilot_requests_created_at_idx ON desk_pilot_requests (created_at);
