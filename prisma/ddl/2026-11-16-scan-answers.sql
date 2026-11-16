-- Called it: a scan past the free one is paid for with house answers (2026-11-16).
-- Additive only. Old code ignores both columns; every existing row reads as a free scan.
ALTER TABLE x_scans ADD COLUMN IF NOT EXISTS answers_charged integer NOT NULL DEFAULT 0;
ALTER TABLE x_scans ADD COLUMN IF NOT EXISTS paid_by text;
