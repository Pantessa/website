// MOVERS — pure ranking for the MoversTape (VIZ lane). Gainers descending,
// losers ascending (worst first); unquoted rows never rank.
export function rankMovers<T extends { symbol: string; chgPct: number | null | undefined }>(rows: readonly T[], count: number): { gainers: T[]; losers: T[] } {
  const quoted = rows.filter((r) => r.chgPct != null && Number.isFinite(r.chgPct))
  const sorted = [...quoted].sort((a, b) => (b.chgPct as number) - (a.chgPct as number))
  const gainers = sorted.filter((r) => (r.chgPct as number) > 0).slice(0, count)
  const losers = sorted
    .filter((r) => (r.chgPct as number) < 0)
    .slice(-count)
    .reverse()
  return { gainers, losers }
}
