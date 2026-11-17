-- RECEIPT BINDING (2026-11-04): a link / first-party receipt verifies only
-- against the EXACT calldata Pantessa built for that wallet, mined after the
-- build (lib/link-receipt-verify). Additive only; mirrors the
-- IntentLinkExpectation model in prisma/schema.prisma. Rows that predate this
-- keep calldata_hash NULL: they can attest a {to, selector} match and never
-- verify one, and the 7-day hygiene retires them.
ALTER TABLE intent_link_expectations ADD COLUMN IF NOT EXISTS calldata_hash text;
ALTER TABLE intent_link_expectations ADD COLUMN IF NOT EXISTS recorded_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE intent_link_expectations ADD COLUMN IF NOT EXISTS recorded_block integer;
ALTER TABLE intent_link_expectations ADD COLUMN IF NOT EXISTS used_tx_hash text;
