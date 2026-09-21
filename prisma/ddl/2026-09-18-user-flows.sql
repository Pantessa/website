-- USER FLOWS — the first-party, cookie-less journey log behind
-- /dashboard/admin/flows. Additive only; mirrors the VisitorEvent /
-- VisitorSalt / TeamMark models in prisma/schema.prisma.
--
-- Nothing here stores an IP address or a full user agent. `vid` and `net` are
-- hashes over a salt that lives in visitor_salts for two days and is then
-- deleted (lib/visitor-id.ts), so a past visitor id can't be recomputed.
CREATE TABLE IF NOT EXISTS visitor_events (
  id          text PRIMARY KEY,
  vid         text NOT NULL,
  net         text,
  wallet      text,
  kind        text NOT NULL,
  path        text NOT NULL DEFAULT '',
  label       text,
  detail      jsonb,
  referrer    text,
  utm         text,
  country     text,
  device      text,
  is_team     boolean NOT NULL DEFAULT false,
  team_claimed boolean NOT NULL DEFAULT false,
  is_internal boolean NOT NULL DEFAULT false,
  is_bot      boolean NOT NULL DEFAULT false,
  created_at  timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS visitor_events_created_at_idx ON visitor_events (created_at DESC);
CREATE INDEX IF NOT EXISTS visitor_events_vid_created_at_idx ON visitor_events (vid, created_at);
CREATE INDEX IF NOT EXISTS visitor_events_wallet_created_at_idx ON visitor_events (wallet, created_at);

CREATE TABLE IF NOT EXISTS visitor_salts (
  day  text PRIMARY KEY,
  salt text NOT NULL
);

CREATE TABLE IF NOT EXISTS team_marks (
  key        text PRIMARY KEY,
  note       text,
  marked_by  text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A database created from the first cut of this file (before the security
-- review split "verified ours" from "claims to be ours").
ALTER TABLE visitor_events ADD COLUMN IF NOT EXISTS team_claimed boolean NOT NULL DEFAULT false;
