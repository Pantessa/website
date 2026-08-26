// lib/league.ts — THE LEAGUE (HANDOFF-roster R3, visual half): the /agents
// credit bureau turned into standings normal people can read like sports.
//
// Honesty rules are inherited, not re-invented:
//   - identities are agent_key HASHES (agentHandleFor) — the raw key never
//     appears; a row links to the existing /agents/<handle> record page.
//   - money is REAL signed volume only: broker_intents.is_internal excluded
//     AND the embed_turns join composes REAL_TRAFFIC_WHERE, the same
//     predicate every public scoreboard uses. Our harness can't make the
//     playoffs.
//   - the whole surface sits behind ROSTER_ENABLED, fail-closed — prod is
//     byte-unchanged until Nate flips the flag.
//
// Season 0 is the preseason: all-time window, no cut date. Season windows,
// mandate categories (R1/R2) and the drawdown line (R4 marks) get columns
// designed here NOW so the table doesn't reflow when the data arrives.

import prisma from '@/lib/db'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'
import type { MandateKind as MandateKindT } from '@/lib/roster-client'

/** The Roster kill switch — ONE definition (integration reconcile
 *  2026-08-25: this lane's local copy deferred to security's, as the
 *  original comment promised). Re-exported so league consumers keep their
 *  import path. */
export { rosterEnabled } from '@/lib/roster-policy'

/** Mandate categories — reconciled to R1's canonical kind set
 *  (lib/roster-client: 'shape' | 'dca' | 'protect' | 'yield'; the league's
 *  earlier local 'rebalance' kind is R1's 'shape'). */
export type { MandateKind } from '@/lib/roster-client'

/** Reader-facing category labels — sports-section short (deliberately
 *  punchier than roster-client's MANDATE_KIND_LABELS, which label the hire
 *  form; these label the standings). */
export const MANDATE_LABELS: Record<MandateKindT, string> = {
  shape: 'Rebalancer',
  dca: 'DCA',
  protect: 'Protector',
  yield: 'Yield',
}

export interface LeagueRow {
  rank: number
  /** agentHandleFor hash prefix — links to /agents/<handle>. */
  handle: string
  displayName: string | null
  /** Mandate category once slots exist (R1/R2); null = open play today. */
  mandateKind: MandateKindT | null
  /** Real signed USD through this agent's links (REAL_TRAFFIC_WHERE).
   *  Displayed on record pages/OG totals — NEVER a rank key (§2.4:
   *  volume ranking is whale-wash bait). */
  moneyMovedUsd: number
  signedTurns: number
  /** Distinct signing wallets served (real traffic; legacy null-wallet rows
   *  can't be attributed to a wallet and don't count). §2.4 rank key 1. */
  walletsServed: number
  intents: number
  /** Tenure — the agent's FIRST real signed turn (§2.3: un-gameable by
   *  spending money). Null can only occur for unqualified rows. */
  firstSignedAt: Date | null
  /** Lifetime cap breaches across the agent's slots (benchSlot's counter,
   *  non-internal slots only). 0 is the badge (§2.3). */
  capBreaches: number
  /** Founding Manager badge (FOUNDING-MANAGERS.md) — cosmetic + historical,
   *  owner-set only, never a rank input. */
  founding: boolean
  /** Drawdown honesty line — needs the R4 tryout/mark machinery. Null until
   *  marks exist; the column renders as a slot, never a fake zero. */
  maxDrawdownPct: number | null
  lastSeen: Date
}

/** The season banner — THE single source (page, OG card, docs). §2.5:
 *  preseason has no scheduled end; Season 1 begins on the first UTC Monday
 *  after ≥5 qualified agents AND ≥1 external agent with a real non-house
 *  hire — an OWNER flip of this constant (seasons are windowed reads;
 *  boundaries delete nothing, the lifetime record is permanent). */
export const SEASON_LABEL = 'Season 0 — preseason'

/** Mandate category for a record page's badge. R1's roster_slots are the
 *  data source — until UI/UX's lib/roster.ts lands there are no slots, so
 *  this returns null and the badge renders nothing. RECONCILE: point this at
 *  roster_slots (hired slots for this agent_key_hash) at integration. */
export async function mandateKindForHandle(_handle: string): Promise<MandateKindT | null> {
  return null
}

export interface LeagueStandings {
  season: string
  rows: LeagueRow[]
  /** Agents brokering but not yet qualified (no real signed turn yet) — the
   *  empty state names them honestly without ranking them. */
  prospectCount: number
  /** Real signed USD across the whole board (the OG card's headline). */
  totalMovedUsd: number
}

type UnrankedRow = Omit<LeagueRow, 'rank'>

/** QUALIFICATION: an agent makes the board only once a real human has signed
 *  one of its proposals. Editorially it's the sport (the standings ARE
 *  signatures); defensively it's a belt on top of is_internal — legacy
 *  harness residue in broker_intents (rows minted before the stamp, e.g.
 *  "Harness Agent"/"qa-adversary", found live 2026-08-25) can never reach a
 *  leaderboard through a $0.00 row, because a fake row's one missing thing
 *  is a REAL_TRAFFIC signed turn. */
export const qualifiesForBoard = (r: Pick<UnrankedRow, 'signedTurns'>) => r.signedTurns > 0

/** Season 0 board mechanics (ROSTER-TRYOUTS-SPEC §2.3): rank ORDINALS are
 *  suppressed below this many qualified agents — with two agents a volume
 *  rank is a coin-flip advertisement at peak sybil pressure. Below the bar
 *  the board is "The opening roster", tenure-ordered. */
export const ORDINALS_MIN_QUALIFIED = 5
export const showOrdinals = (qualified: number) => qualified >= ORDINALS_MIN_QUALIFIED

/** Standings order, pure and pinned — the §2.4 tie-break sequence:
 *  (1) distinct real employer wallets desc; (2) signed proposals desc;
 *  (3) zero cap breaches before any breach; (4) tenure asc (earlier first
 *  signature = longer proven); (5) handle-hash lexicographic as the final
 *  total order. NEVER by volume USD (whale-wash resistant), never by
 *  returns (killed). */
export function rankLeagueRows(rows: UnrankedRow[]): LeagueRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.walletsServed - a.walletsServed ||
        b.signedTurns - a.signedTurns ||
        (a.capBreaches === 0 ? 0 : 1) - (b.capBreaches === 0 ? 0 : 1) ||
        (a.firstSignedAt?.getTime() ?? Infinity) - (b.firstSignedAt?.getTime() ?? Infinity) ||
        a.handle.localeCompare(b.handle),
    )
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/** The <5-qualified board (§2.3): "a roster, not a race" — tenure order
 *  (first real signature ascending), handle as the deterministic tail. */
export function orderOpeningRoster(rows: LeagueRow[]): LeagueRow[] {
  return [...rows].sort(
    (a, b) =>
      (a.firstSignedAt?.getTime() ?? Infinity) - (b.firstSignedAt?.getTime() ?? Infinity) ||
      a.handle.localeCompare(b.handle),
  )
}

/** The Founding Manager set for a batch of handles (FOUNDING-MANAGERS.md):
 *  owner-set rows only (scripts/set-founding-agent.ts) — the product never
 *  writes here. Fail-soft to empty. */
export async function foundingHandles(handles: string[]): Promise<Set<string>> {
  if (handles.length === 0) return new Set()
  const rows = await prisma.foundingAgent
    .findMany({ where: { agentKeyHash: { in: handles } }, select: { agentKeyHash: true } })
    .catch(() => [] as { agentKeyHash: string }[])
  return new Set(rows.map((r) => r.agentKeyHash))
}

/** Build the public standings. Reads only server truth; every figure is the
 *  same aggregation getAgentRecord serves per-handle, fanned across the
 *  board. Organic intents only; money is REAL traffic only. */
export async function getLeagueStandings(): Promise<LeagueStandings> {
  const intents = await prisma.brokerIntent.findMany({
    where: { isInternal: false, agentKeyHash: { not: null } },
    select: { agentKeyHash: true, agent: true, linkSlug: true, updatedAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const byHandle = new Map<
    string,
    { displayName: string | null; slugs: Set<string>; intents: number; lastSeen: Date }
  >()
  const slugOwner = new Map<string, string>()
  for (const i of intents) {
    const handle = i.agentKeyHash as string
    const cur =
      byHandle.get(handle) ??
      ({ displayName: null, slugs: new Set<string>(), intents: 0, lastSeen: i.updatedAt } as const as {
        displayName: string | null
        slugs: Set<string>
        intents: number
        lastSeen: Date
      })
    cur.intents += 1
    if (i.agent && i.agent.trim()) cur.displayName = i.agent.trim() // createdAt asc → latest wins
    if (i.updatedAt > cur.lastSeen) cur.lastSeen = i.updatedAt
    if (i.linkSlug) {
      cur.slugs.add(i.linkSlug)
      if (!slugOwner.has(i.linkSlug)) slugOwner.set(i.linkSlug, handle)
    }
    byHandle.set(handle, cur)
  }

  const allSlugs = [...slugOwner.keys()]
  const handles = [...byHandle.keys()]
  const [turns, breachRows, founding] = await Promise.all([
    allSlugs.length
      ? prisma.embedTurn.findMany({
          where: { intentLinkSlug: { in: allSlugs }, outcome: 'signed', ...REAL_TRAFFIC_WHERE },
          select: { intentLinkSlug: true, valueUsd: true, walletAddress: true, createdAt: true },
        })
      : Promise.resolve([]),
    // Lifetime cap breaches per agent — the benchSlot counter summed over the
    // agent's NON-INTERNAL slots (status is current-state only; the counter
    // survives a re-hire).
    handles.length
      ? prisma.rosterSlot
          .groupBy({
            by: ['agentKeyHash'],
            where: { agentKeyHash: { in: handles }, isInternal: false },
            _sum: { capBreaches: true },
          })
          .catch(() => [] as { agentKeyHash: string | null; _sum: { capBreaches: number | null } }[])
      : Promise.resolve([]),
    foundingHandles(handles),
  ])

  const money = new Map<string, { usd: number; signed: number; wallets: Set<string>; first: Date | null }>()
  for (const t of turns) {
    const handle = slugOwner.get(t.intentLinkSlug as string)
    if (!handle) continue
    const cur = money.get(handle) ?? { usd: 0, signed: 0, wallets: new Set<string>(), first: null }
    cur.usd += t.valueUsd ?? 0
    cur.signed += 1
    if (t.walletAddress) cur.wallets.add(t.walletAddress.toLowerCase())
    if (!cur.first || t.createdAt < cur.first) cur.first = t.createdAt
    money.set(handle, cur)
  }
  const breaches = new Map<string, number>()
  for (const b of breachRows) if (b.agentKeyHash) breaches.set(b.agentKeyHash, b._sum.capBreaches ?? 0)

  const unranked = [...byHandle.entries()].map(([handle, a]) => {
    const m = money.get(handle)
    return {
      handle,
      displayName: a.displayName,
      mandateKind: null, // R1/R2 fill this in — the column is ready
      moneyMovedUsd: Math.round((m?.usd ?? 0) * 100) / 100,
      signedTurns: m?.signed ?? 0,
      walletsServed: m?.wallets.size ?? 0,
      intents: a.intents,
      firstSignedAt: m?.first ?? null,
      capBreaches: breaches.get(handle) ?? 0,
      founding: founding.has(handle),
      maxDrawdownPct: null, // R4 marks fill this in
      lastSeen: a.lastSeen,
    }
  })

  const rows = rankLeagueRows(unranked.filter(qualifiesForBoard))
  return {
    season: SEASON_LABEL,
    rows,
    prospectCount: unranked.length - rows.length,
    totalMovedUsd: Math.round(rows.reduce((s, r) => s + r.moneyMovedUsd, 0) * 100) / 100,
  }
}
