// The Growth page's math — pure, so the harness pins it without a database.
//
// /api/admin/growth reads signed turns grouped by (day, source, build path,
// stamped fee tier, owed creator, tester) and everything money-shaped on the
// page is a fold over those rows: the window tiles, the daily source mix, the
// fee split by venue, and what each creator is owed.
//
// One rulebook with the public surfaces: a dollar earns a fee only on a
// FEE_BEARING build path, at netFeeBpsForTurn's rate, and a creator's half is
// owed only where a creator exists (their link, or a wallet they referred).
// lib/links-board feeSummary credits house links to "creators" too; this view
// is the books, so it doesn't.

import { CREATOR_FEE_SPLIT, FEE_BEARING_BUILD_PATHS, netFeeBpsForTurn } from './fees'
import { UNATTRIBUTED_VENUE, venueOfBuildPath } from './build-path'

export const GROWTH_SOURCES = ['link', 'chat', 'embed', 'standing'] as const
export type GrowthSource = (typeof GROWTH_SOURCES)[number]

export const GROWTH_WINDOWS = [7, 30, 90] as const

/** One grouped row of real, receipt-counted signed turns. */
export interface GrowthTurnRow {
  /** UTC day, `YYYY-MM-DD`. */
  day: string
  source: GrowthSource
  buildPath: string | null
  feeBps: number | null
  /** The creator owed a share of this row's fee: the link's creator, or the
   *  creator who first referred the signing wallet. Null = nobody (organic,
   *  or a house link). */
  creator: string | null
  tester: boolean
  usd: number
  n: number
}

export interface FeeSplit {
  volumeUsd: number
  trades: number
  feeBearingUsd: number
  /** Net fee that reaches Pantessa's side of the venue split, before creators. */
  feeUsd: number
  creatorUsd: number
  pantessaUsd: number
}

const ZERO: FeeSplit = { volumeUsd: 0, trades: 0, feeBearingUsd: 0, feeUsd: 0, creatorUsd: 0, pantessaUsd: 0 }

const feeBearing = (path: string | null): path is string => !!path && FEE_BEARING_BUILD_PATHS.has(path)

/** What one row contributes. Fee-free paths move volume and nothing else. */
export function splitOfRow(r: GrowthTurnRow): FeeSplit {
  if (!feeBearing(r.buildPath)) return { ...ZERO, volumeUsd: r.usd, trades: r.n }
  const feeUsd = r.usd * (netFeeBpsForTurn(r.buildPath, r.feeBps) / 10_000)
  const creatorUsd = r.creator ? feeUsd * CREATOR_FEE_SPLIT : 0
  return { volumeUsd: r.usd, trades: r.n, feeBearingUsd: r.usd, feeUsd, creatorUsd, pantessaUsd: feeUsd - creatorUsd }
}

function add(a: FeeSplit, b: FeeSplit): FeeSplit {
  return {
    volumeUsd: a.volumeUsd + b.volumeUsd,
    trades: a.trades + b.trades,
    feeBearingUsd: a.feeBearingUsd + b.feeBearingUsd,
    feeUsd: a.feeUsd + b.feeUsd,
    creatorUsd: a.creatorUsd + b.creatorUsd,
    pantessaUsd: a.pantessaUsd + b.pantessaUsd,
  }
}

export function sumSplit(rows: GrowthTurnRow[]): FeeSplit {
  return rows.reduce((s, r) => add(s, splitOfRow(r)), ZERO)
}

/** `YYYY-MM-DD` for `offset` days before `now` (UTC). */
export function dayKey(now: number, offset = 0): string {
  return new Date(now - offset * 86_400_000).toISOString().slice(0, 10)
}

/** Rows inside the last `days` days, and the `days` before that. A window of
 *  N days is today plus the N−1 before it. */
export function windowRows(rows: GrowthTurnRow[], days: number, now: number) {
  const start = dayKey(now, days - 1)
  const prevStart = dayKey(now, 2 * days - 1)
  return {
    current: rows.filter((r) => r.day >= start),
    previous: rows.filter((r) => r.day >= prevStart && r.day < start),
  }
}

/** Change vs the previous window. Null when there's no base to compare to —
 *  "+∞%" off a zero week is noise, not growth. */
export function deltaPct(current: number, previous: number): number | null {
  if (!(previous > 0)) return null
  return (current - previous) / previous
}

export interface VenueFeeRow extends FeeSplit {
  venue: string
  /** Blended net rate on the fee-bearing dollars, in bps. */
  effectiveBps: number | null
}

/** The fee table: one row per venue, biggest volume first. Volume on a path
 *  with no venue (legacy rows, job steps stamped without a path) lands on
 *  `unattributed` so the table always sums to the headline. */
export function feesByVenue(rows: GrowthTurnRow[]): VenueFeeRow[] {
  const by = new Map<string, FeeSplit>()
  for (const r of rows) {
    const venue = venueOfBuildPath(r.buildPath) ?? UNATTRIBUTED_VENUE
    by.set(venue, add(by.get(venue) ?? ZERO, splitOfRow(r)))
  }
  return [...by.entries()]
    .map(([venue, s]) => ({
      venue,
      ...s,
      effectiveBps: s.feeBearingUsd > 0 ? (s.feeUsd / s.feeBearingUsd) * 10_000 : null,
    }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
}

export interface GrowthDayPoint {
  day: string
  link: number
  chat: number
  embed: number
  standing: number
  totalUsd: number
  cumulativeUsd: number
  pantessaUsd: number
  creatorUsd: number
  cumulativeFeeUsd: number
  trades: number
}

/** A dense daily series over the window (every day present, zeros included),
 *  with cumulative lines that carry everything before the window so "total so
 *  far" reads true when the window clips history. */
export function dailySeries(rows: GrowthTurnRow[], days: number, now: number): GrowthDayPoint[] {
  const start = dayKey(now, days - 1)
  const base = sumSplit(rows.filter((r) => r.day < start))
  let cumulativeUsd = base.volumeUsd
  let cumulativeFeeUsd = base.feeUsd
  const out: GrowthDayPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(now, i)
    const p: GrowthDayPoint = {
      day, link: 0, chat: 0, embed: 0, standing: 0,
      totalUsd: 0, cumulativeUsd: 0, pantessaUsd: 0, creatorUsd: 0, cumulativeFeeUsd: 0, trades: 0,
    }
    for (const r of rows) {
      if (r.day !== day) continue
      const s = splitOfRow(r)
      p[r.source] += r.usd
      p.totalUsd += s.volumeUsd
      p.pantessaUsd += s.pantessaUsd
      p.creatorUsd += s.creatorUsd
      p.trades += s.trades
      cumulativeFeeUsd += s.feeUsd
    }
    cumulativeUsd += p.totalUsd
    p.cumulativeUsd = cumulativeUsd
    p.cumulativeFeeUsd = cumulativeFeeUsd
    out.push(p)
  }
  return out
}

/** Volume by source, in GROWTH_SOURCES order. */
export function sourceMix(rows: GrowthTurnRow[]): { source: GrowthSource; usd: number; trades: number }[] {
  return GROWTH_SOURCES.map((source) => {
    const mine = rows.filter((r) => r.source === source)
    return { source, usd: mine.reduce((s, r) => s + r.usd, 0), trades: mine.reduce((s, r) => s + r.n, 0) }
  })
}

/** Lifetime volume + earnings owed per creator (their links and the wallets
 *  they referred, both already folded into `creator` by the query). */
export function earningsByCreator(rows: GrowthTurnRow[]): Map<string, { volumeUsd: number; trades: number; earnedUsd: number }> {
  const by = new Map<string, { volumeUsd: number; trades: number; earnedUsd: number }>()
  for (const r of rows) {
    if (!r.creator) continue
    const cur = by.get(r.creator) ?? { volumeUsd: 0, trades: 0, earnedUsd: 0 }
    const s = splitOfRow(r)
    by.set(r.creator, { volumeUsd: cur.volumeUsd + s.volumeUsd, trades: cur.trades + s.trades, earnedUsd: cur.earnedUsd + s.creatorUsd })
  }
  return by
}

/** How far an account got. Ordered: each stage implies the ones before it. */
export const ACCOUNT_STAGES = ['signed-up', 'asked', 'built', 'traded'] as const
export type AccountStage = (typeof ACCOUNT_STAGES)[number]

export function accountStage(a: { turns: number; built: number; signed: number }): AccountStage {
  if (a.signed > 0) return 'traded'
  if (a.built > 0) return 'built'
  if (a.turns > 0) return 'asked'
  return 'signed-up'
}

// ── People: everyone who showed up, however they arrived ────────────────────
//
// An account is one lane in, not the only one. Coinbase holds the email +
// Google accounts (and their embedded wallets); a native wallet — MetaMask,
// Phantom, Coinbase Wallet, WalletConnect — never signs up at all, it just
// starts acting, and our own arrival tables are the only record it exists.
// Both are people, so both belong in one list, and the only honest difference
// between them is whether we have an email to reach out on.
//
// The merge is pure so the harness pins it without a database: the route does
// the reading (CDP + the arrival union + one activity query), this does the
// joining, and the page only filters and draws.

/** How someone arrived. 'wallet' = no account; we met them mid-action. */
export const PERSON_METHODS = ['email', 'google', 'wallet'] as const

/** The Accounts table's filter. `email` = reachable (an account with an
 *  address on file); `wallet` = native connections, nobody to email. */
export const PEOPLE_FILTERS = ['all', 'email', 'wallet'] as const
export type PeopleFilter = (typeof PEOPLE_FILTERS)[number]

export function matchesPeopleFilter(p: { email: string | null }, f: PeopleFilter): boolean {
  if (f === 'email') return !!p.email
  if (f === 'wallet') return !p.email
  return true
}

export function filterPeople<T extends { email: string | null }>(people: T[], f: PeopleFilter): T[] {
  return people.filter((p) => matchesPeopleFilter(p, f))
}

/** What one wallet did here. Summed across a person's wallets. */
export interface PersonActivity {
  turns: number
  built: number
  signed: number
  usd: number
  chats: number
  links: number
  watching: number
  lastTurnAt: string | null
  /** The last thing they asked for, in their words — a walled ask or a plain
   *  one, whichever came last. The path they tried. */
  lastAsk: string | null
  lastAskAt: string | null
  /** True when that last ask is the one that walled. */
  lastAskWalled: boolean
}

export const NO_ACTIVITY: PersonActivity = {
  turns: 0, built: 0, signed: 0, usd: 0, chats: 0, links: 0, watching: 0,
  lastTurnAt: null, lastAsk: null, lastAskAt: null, lastAskWalled: false,
}

/** A Coinbase embedded-wallet account: the only place an email and a wallet meet. */
export interface AccountSource {
  email: string | null
  name: string | null
  method: string
  wallets: string[]
  createdAt: string
  lastAuthenticatedAt: string | null
}

/** A wallet our own tables have seen — first and last sighting. */
export interface WalletArrival {
  wallet: string
  firstAt: string
  lastAt: string
}

export interface Person extends PersonActivity {
  /** Stable row key: the account's email, else the wallet. */
  key: string
  email: string | null
  name: string | null
  method: string
  wallet: string | null
  wallets: string[]
  test: boolean
  /** Account sign-up for an account; first sighting for a native wallet. */
  createdAt: string
  /** Only an account can sign in; a wallet just reappears. */
  lastSignInAt: string | null
  /** The last time we saw them at all, whichever lane it came through. */
  lastSeenAt: string | null
  stage: AccountStage
}

const maxIso = (...xs: (string | null | undefined)[]): string | null => {
  let best: string | null = null
  for (const x of xs) {
    if (!x) continue
    const t = Date.parse(x)
    if (!Number.isFinite(t)) continue
    if (best === null || t > Date.parse(best)) best = x
  }
  return best
}

function sumActivity(acts: PersonActivity[]): PersonActivity {
  const out: PersonActivity = { ...NO_ACTIVITY }
  for (const a of acts) {
    out.turns += a.turns
    out.built += a.built
    out.signed += a.signed
    out.usd += a.usd
    out.chats += a.chats
    out.links += a.links
    out.watching += a.watching
    out.lastTurnAt = maxIso(out.lastTurnAt, a.lastTurnAt)
    // The newest ask wins, and it brings its own walled/not with it.
    if (a.lastAsk && (!out.lastAskAt || (a.lastAskAt && Date.parse(a.lastAskAt) > Date.parse(out.lastAskAt)))) {
      out.lastAsk = a.lastAsk
      out.lastAskAt = a.lastAskAt
      out.lastAskWalled = a.lastAskWalled
    }
  }
  return out
}

/**
 * One list of people from the two lanes.
 *
 * A wallet an account already owns is that account's, never a second person —
 * so an embedded wallet that also shows up in our arrival tables is counted
 * once, under the email. Everything left over is a native connection.
 */
export function mergePeople(
  accounts: AccountSource[],
  arrivals: WalletArrival[],
  activityOf: (wallet: string) => PersonActivity | undefined,
  isTester: (wallet: string) => boolean,
): Person[] {
  const claimed = new Set<string>()
  for (const a of accounts) for (const w of a.wallets) claimed.add(w.toLowerCase())

  const arrivalOf = new Map<string, WalletArrival>()
  for (const a of arrivals) arrivalOf.set(a.wallet.toLowerCase(), a)

  const act = (w: string) => activityOf(w.toLowerCase()) ?? NO_ACTIVITY

  const fromAccounts: Person[] = accounts.map((u) => {
    const wallets = u.wallets.map((w) => w.toLowerCase())
    const a = sumActivity(wallets.map(act))
    const seen = maxIso(u.lastAuthenticatedAt, a.lastTurnAt, a.lastAskAt, ...wallets.map((w) => arrivalOf.get(w)?.lastAt))
    return {
      key: u.email ?? wallets[0] ?? u.createdAt,
      email: u.email,
      name: u.name,
      method: u.method,
      wallet: wallets[0] ?? null,
      wallets,
      test: wallets.some(isTester),
      createdAt: u.createdAt,
      lastSignInAt: u.lastAuthenticatedAt,
      lastSeenAt: seen,
      ...a,
      stage: accountStage(a),
    }
  })

  const fromWallets: Person[] = arrivals
    .filter((w) => !claimed.has(w.wallet.toLowerCase()))
    .map((w) => {
      const wallet = w.wallet.toLowerCase()
      const a = act(wallet)
      return {
        key: wallet,
        email: null,
        name: null,
        method: 'wallet',
        wallet,
        wallets: [wallet],
        test: isTester(wallet),
        createdAt: w.firstAt,
        lastSignInAt: null,
        lastSeenAt: maxIso(w.lastAt, a.lastTurnAt, a.lastAskAt),
        ...a,
        stage: accountStage(a),
      }
    })

  // Newest first, the way the account list already read.
  return [...fromAccounts, ...fromWallets].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/** How many people each filter would show — the chip counts. */
export function peopleCounts(people: { email: string | null }[]): Record<PeopleFilter, number> {
  return {
    all: people.length,
    email: people.filter((p) => !!p.email).length,
    wallet: people.filter((p) => !p.email).length,
  }
}
