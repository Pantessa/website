// The public progress surfaces — /leaderboard and /analytics (2026-10-15,
// Nate: "on the sidebar, can you create a leaderboard, and analytics tab for
// the public pages. would like to start showing progress and encourage link
// sharing and money moved by users and the overall system").
//
// This file is the PURE half: path rules the spine, the nav and the entry
// gate share, the window grammar, the rank/fold rules the pages render and
// the harness pins without a database. The readers live in
// lib/progress-read.ts (server only, every figure fenced to real traffic).
//
// Honesty rules the pages inherit:
//  - money = guardrail-priced signed notional on receipt-counted turns only
//    (lib/value-origin REAL_TRAFFIC_*), never a mint-time amount, never a
//    built-but-unsigned artifact, never our own harness/drill rows;
//  - a wallet shows as its short form only (0x1234…abcd) — the wallet IS the
//    user's public identity on-chain, but a public page never prints one in
//    full, and the team's test wallets never rank (lib/admin TEST_WALLETS);
//  - creators are their claimed @handle, never a wallet.

export const LEADERBOARD_HREF = '/leaderboard'
export const ANALYTICS_HREF = '/analytics'

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

export function isLeaderboardPath(pathname: string): boolean {
  return trim(pathname.split(/[?#]/)[0]) === LEADERBOARD_HREF
}

export function isAnalyticsPath(pathname: string): boolean {
  return trim(pathname.split(/[?#]/)[0]) === ANALYTICS_HREF
}

/** Both public progress pages: the spine is their navigation, the brochure
 *  nav hides, a signed-out visitor is never sent home (lib/app-entry). */
export function isProgressPath(pathname: string): boolean {
  return isLeaderboardPath(pathname) || isAnalyticsPath(pathname)
}

// ── Windows ────────────────────────────────────────────────────────────────
// `?w=7` · `?w=30` (the default, no param) · `?w=all`. 0 = all time.

export const PROGRESS_WINDOWS = [7, 30, 0] as const
export type ProgressWindow = (typeof PROGRESS_WINDOWS)[number]
export const DEFAULT_WINDOW: ProgressWindow = 30

export function parseWindow(raw: string | string[] | undefined): ProgressWindow {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (v === '7') return 7
  if (v === 'all' || v === '0') return 0
  return DEFAULT_WINDOW
}

export function windowLabel(w: ProgressWindow): string {
  return w === 0 ? 'All time' : `${w} days`
}

/** The page URL for a window — the default carries no query so the shared
 *  link stays clean; a non-default window names itself. */
export function windowHref(base: string, w: ProgressWindow): string {
  if (w === DEFAULT_WINDOW) return base
  return `${base}?w=${w === 0 ? 'all' : w}`
}

/** The day span a window's daily chart draws: the window itself, 90 days for
 *  all time (the chart is a pulse, not an archive). */
export function chartDays(w: ProgressWindow): number {
  return w === 0 ? 90 : w
}

/** The window the GTM funnel reads: first-touch wallets whose first signal
 *  landed inside it. All time = a year (the arc's query bounds by days). */
export function funnelDays(w: ProgressWindow): number {
  return w === 0 ? 365 : w
}

// ── Identity on a public page ──────────────────────────────────────────────

export function shortAddress(addr: string): string {
  const a = addr.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

// ── Ranks ──────────────────────────────────────────────────────────────────

export interface WalletMoneyRow {
  wallet: string
  usd: number
  signed: number
  /** ISO of the wallet's first signed turn in the window. */
  firstAt?: string
}

export interface WalletRank extends WalletMoneyRow {
  rank: number
  short: string
}

/** The wallet board: one row per wallet (case-folded), the team's test
 *  wallets and empty rows out, money first then count, ranks 1..n. */
export function rankWallets(rows: WalletMoneyRow[], exclude: Iterable<string>, limit = 10): WalletRank[] {
  const out = new Set(Array.from(exclude, (w) => w.toLowerCase()))
  const byWallet = new Map<string, WalletMoneyRow>()
  for (const r of rows) {
    const w = (r.wallet ?? '').toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(w) || out.has(w)) continue
    if (!(r.usd > 0)) continue
    const prev = byWallet.get(w)
    if (prev) {
      prev.usd += r.usd
      prev.signed += r.signed
      if (r.firstAt && (!prev.firstAt || r.firstAt < prev.firstAt)) prev.firstAt = r.firstAt
    } else byWallet.set(w, { wallet: w, usd: r.usd, signed: r.signed, firstAt: r.firstAt })
  }
  return [...byWallet.values()]
    .sort((a, b) => b.usd - a.usd || b.signed - a.signed || (a.wallet < b.wallet ? -1 : 1))
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1, short: shortAddress(r.wallet) }))
}

// ── Milestones: progress, not just a number ────────────────────────────────

export const MILESTONES_USD = [1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000] as const

export interface Milestone {
  /** The last milestone passed (0 before the first). */
  reached: number
  /** The next one, or null past the ladder's top. */
  target: number | null
  /** 0–100, how far along the leg from `reached` to `target`. */
  pct: number
}

export function milestoneOf(usd: number): Milestone {
  const n = Math.max(0, usd)
  let reached = 0
  let target: number | null = null
  for (const m of MILESTONES_USD) {
    if (n >= m) reached = m
    else {
      target = m
      break
    }
  }
  if (target === null) return { reached, target: null, pct: 100 }
  const pct = Math.max(0, Math.min(100, ((n - reached) / (target - reached)) * 100))
  return { reached, target, pct }
}

// ── Series folds ───────────────────────────────────────────────────────────

export interface DayPoint {
  day: string
  usd: number
  n: number
}

/** A dense day series ending today (UTC), zero-filled, oldest first. */
export function fillDays<T extends { day: string }>(points: T[], days: number, now: number, empty: (day: string) => T): T[] {
  const byDay = new Map(points.map((p) => [p.day, p]))
  const out: T[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
    out.push(byDay.get(day) ?? empty(day))
  }
  return out
}

export function deltaPct(current: number, previous: number): number | null {
  if (!(previous > 0)) return current > 0 ? null : 0
  return Math.round(((current - previous) / previous) * 1000) / 10
}

// ── The GTM funnel, folded for a public page ───────────────────────────────

export interface FunnelRow {
  source: string
  arrived: number
  asked: number
  built: number
  signed: number
  returned: number
}

export const FUNNEL_STOPS = ['arrived', 'asked', 'built', 'signed', 'returned'] as const
export type FunnelStop = (typeof FUNNEL_STOPS)[number]

export function foldFunnel(rows: FunnelRow[]): FunnelRow {
  const total: FunnelRow = { source: 'all', arrived: 0, asked: 0, built: 0, signed: 0, returned: 0 }
  for (const r of rows) for (const k of FUNNEL_STOPS) total[k] += r[k]
  return total
}

/** The public funnel is monotone by construction upstream; this makes it so
 *  even if a row isn't (a stop can never read above the one before it). */
export function monotoneFunnel(r: FunnelRow): FunnelRow {
  const out = { ...r }
  out.asked = Math.min(out.asked, out.arrived)
  out.built = Math.min(out.built, out.asked)
  out.signed = Math.min(out.signed, out.built)
  out.returned = Math.min(out.returned, out.arrived)
  return out
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 10_000) return `$${Math.round(n / 1000)}k`
  if (n >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`
  if (n >= 100) return `$${Math.round(n)}`
  return `$${n.toFixed(2)}`
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  return Math.round(n).toLocaleString('en-US')
}

/** The pre-written share line: the number IS the pitch. */
export function shareLine(totalUsd: number, w: ProgressWindow): string {
  const span = w === 0 ? 'so far' : `in the last ${w} days`
  return `${fmtUsd(totalUsd)} moved through Pantessa ${span} — every dollar signed by its owner's wallet, verified on-chain. Mint a link, share it, earn on what it moves.`
}
