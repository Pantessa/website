// Pure, dependency-free formatters shared by server + client components (so a
// client component can import this without pulling in server-only modules).

/**
 * USD formatter that spans memecoin ranges: tiny prices keep significant figures,
 * large caps compact to K/M. Returns an em dash for non-positive / non-finite.
 */
export function usdCompact(v: number): string {
  if (!isFinite(v) || v <= 0) return '—'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  if (v >= 1) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  return `$${v.toPrecision(3)}`
}
