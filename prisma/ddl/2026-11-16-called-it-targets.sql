-- Called it: a call that names a level is judged on the level (2026-11-16).
-- The post's own words naming the level; code reads the number. Additive.
ALTER TABLE x_calls ADD COLUMN IF NOT EXISTS target text;
