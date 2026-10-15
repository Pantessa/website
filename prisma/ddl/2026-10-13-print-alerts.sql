-- PRINT ALERTS — the /live trigger rules armed on the server, and the
-- per-venue cursor the cron (/api/cron/prints) resumes Dune's feed from.
-- Additive only; mirrors the PrintAlert / FeedCursor models in
-- prisma/schema.prisma. Fired rules write alert_notifications rows (the
-- price alerts' own table) — no new notification table.
CREATE TABLE IF NOT EXISTS print_alerts (
  id            text PRIMARY KEY,
  owner         text NOT NULL,
  rule          text NOT NULL,
  market        text,
  venues        jsonb NOT NULL,
  thresholds    jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  email         text,
  recent        jsonb,
  last_fired_at timestamptz(6),
  fired_count   integer NOT NULL DEFAULT 0,
  is_internal   boolean NOT NULL DEFAULT false,
  created_at    timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamptz(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS print_alerts_owner_status_idx ON print_alerts (owner, status);
CREATE INDEX IF NOT EXISTS print_alerts_status_idx ON print_alerts (status);

CREATE TABLE IF NOT EXISTS feed_cursors (
  venue        text PRIMARY KEY,
  cursor       text,
  tip_at       timestamptz(6),
  frames       integer NOT NULL DEFAULT 0,
  fills        integer NOT NULL DEFAULT 0,
  last_outcome text,
  last_pass_at timestamptz(6),
  lease_until  timestamptz(6),
  gap_from     text,
  gap_at       timestamptz(6),
  gap_note     text,
  updated_at   timestamptz(6) NOT NULL
);
