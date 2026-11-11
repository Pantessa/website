// What X hands us that we did not write, cleaned at the one place it enters
// (review R16; squad called-it, lane FIX). Pure, no imports: the mappers, the
// store and the browser may all use it.

/** Control characters and the bidi overrides/isolates that reorder whatever shares a line (U+200E/F, U+202A-E, U+2066-9). */
const UNSAFE_NAME = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
export const NAME_MAX = 64

/** A display name as we show it: no control or bidi characters, trimmed, at most NAME_MAX. Empty → `fallback`. */
export function cleanName(raw: unknown, fallback: string, max = NAME_MAX): string {
  if (typeof raw !== 'string') return fallback
  const v = raw.replace(UNSAFE_NAME, '').trim().slice(0, max).trim()
  return v || fallback
}

/** Post text stays X's own words; only NUL goes (Postgres refuses it, and a whole chunk of 500 posts with it). */
export function stripNul(s: string): string {
  return s.includes('\u0000') ? s.replace(/\u0000/g, '') : s
}
