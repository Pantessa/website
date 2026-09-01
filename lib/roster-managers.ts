// lib/roster-managers.ts — THE STOREFRONT (FIRST HIRE sprint, 2026-08-26).
//
// Hiring an agent should never mean pasting a 16-hex hash. The storefront
// lists HIREABLE managers — the house Rebalancer first, then founding/
// recorded agents — and the hire flow takes a SERVER-VALIDATED manager id.
// The security contract, by construction:
//
//   · the client never supplies a hash on this path. A manager id resolves
//     ONLY against the server's own list: 'house-rebalancer' → the hash of
//     the HOUSE_MANAGER_KEY env (computed server-side, key never leaves),
//     'founding-<hash>' → only when that exact hash is an owner-set
//     founding_agents row. Anything else — including a bare hash pasted
//     into the param — resolves to null and refuses by name upstream.
//   · a listed agent cannot spoof the house identity: 'house-rebalancer'
//     ignores the DB entirely and reads only the env.
//   · env absent = an honest, NOT-hireable "coming soon" row — the
//     storefront never invents an identity to sell.
//
// houseManagerRow/resolveHouseManager are pure (env string in) so the
// harness pins the env-absent behavior without flipping server env.

import prisma from '@/lib/db'
import { agentHandleFor } from '@/lib/agent-record'
import { MANDATE_KIND_LABELS, type MandateKind } from '@/lib/roster-client'

export const HOUSE_MANAGER_ID = 'house-rebalancer'

export interface StorefrontManager {
  /** The SERVER-VALIDATED id the hire flow accepts — never a hash. */
  id: string
  name: string
  house: boolean
  hireable: boolean
  /** Mandate kinds this manager serves (labels are client-rendered). */
  kinds: MandateKind[]
  /** /agents/<hash> when a public track record exists, else null. */
  recordUrl: string | null
  founding: boolean
  note?: string
}

/** The house row, PURE off the env value (null = unset). */
export function houseManagerRow(houseKey: string | null): StorefrontManager {
  if (!houseKey) {
    return {
      id: HOUSE_MANAGER_ID,
      name: 'Pantessa Rebalancer',
      house: true,
      hireable: false,
      kinds: ['shape'],
      recordUrl: null,
      founding: false,
      note: 'Coming soon — the house Rebalancer arms when its manager key is configured.',
    }
  }
  return {
    id: HOUSE_MANAGER_ID,
    name: 'Pantessa Rebalancer',
    house: true,
    hireable: true,
    kinds: ['shape'],
    recordUrl: null, // filled from the record check in listManagers
    founding: false,
  }
}

/** Pure resolve for the house id: null env = not hireable, by construction. */
export function resolveHouseManager(houseKey: string | null): { agentKeyHash: string; name: string } | null {
  if (!houseKey) return null
  return { agentKeyHash: agentHandleFor(houseKey), name: 'Pantessa Rebalancer' }
}

const FOUNDING_ID_RE = /^founding-([0-9a-f]{16})$/

const isKind = (k: string): k is MandateKind => k in MANDATE_KIND_LABELS

/** Kinds an agent has actually served — its hired/benched mandate slots. */
async function kindsServed(hashes: string[]): Promise<Map<string, MandateKind[]>> {
  if (hashes.length === 0) return new Map()
  const rows = await prisma.rosterSlot
    .findMany({
      where: { agentKeyHash: { in: hashes }, status: { in: ['hired', 'benched'] }, isInternal: false },
      select: { agentKeyHash: true, mandateKind: true },
    })
    .catch(() => [])
  const out = new Map<string, MandateKind[]>()
  for (const r of rows) {
    if (!r.agentKeyHash || !isKind(r.mandateKind)) continue
    const list = out.get(r.agentKeyHash) ?? []
    if (!list.includes(r.mandateKind)) list.push(r.mandateKind)
    out.set(r.agentKeyHash, list)
  }
  return out
}

/** Which of these hashes have a public track record (any brokered intent —
 *  the same existence rule /agents/<hash> 404s on). Harness traffic never
 *  mints one, so a drill can't put itself on the storefront. */
async function recordedOf(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set()
  const rows = await prisma.brokerIntent
    .groupBy({ by: ['agentKeyHash'], where: { agentKeyHash: { in: hashes }, isInternal: false } })
    .catch(() => [] as { agentKeyHash: string | null }[])
  return new Set(rows.map((r) => r.agentKeyHash).filter((h): h is string => !!h))
}

/** The storefront list: house first, then founding agents (owner-set rows —
 *  never self-serve), newest last so the order is stable. */
export async function listManagers(): Promise<StorefrontManager[]> {
  const houseKey = process.env.HOUSE_MANAGER_KEY ?? null
  const house = houseManagerRow(houseKey)
  const houseHash = houseKey ? agentHandleFor(houseKey) : null

  const founding = await prisma.foundingAgent.findMany({ orderBy: { createdAt: 'asc' }, select: { agentKeyHash: true } }).catch(() => [])
  const foundingHashes = founding.map((f) => f.agentKeyHash).filter((h) => h !== houseHash)
  const [served, recorded] = await Promise.all([
    kindsServed([...foundingHashes, ...(houseHash ? [houseHash] : [])]),
    recordedOf([...foundingHashes, ...(houseHash ? [houseHash] : [])]),
  ])

  if (houseHash && recorded.has(houseHash)) house.recordUrl = `/agents/${houseHash}`

  const rows: StorefrontManager[] = [house]
  for (const hash of foundingHashes) {
    rows.push({
      id: `founding-${hash}`,
      name: `Agent ${hash.slice(0, 8)}`,
      house: false,
      hireable: true,
      kinds: served.get(hash) ?? [],
      recordUrl: recorded.has(hash) ? `/agents/${hash}` : null,
      founding: true,
    })
  }
  return rows
}

/** Resolve a manager id to its identity — the ONLY translation from the
 *  storefront to a hash, and it happens server-side against the server's
 *  own list. Null = refuse by name upstream (a bare hash is not an id). */
export async function resolveManagerId(id: unknown): Promise<{ agentKeyHash: string; name: string } | null> {
  if (typeof id !== 'string') return null
  if (id === HOUSE_MANAGER_ID) return resolveHouseManager(process.env.HOUSE_MANAGER_KEY ?? null)
  const m = id.match(FOUNDING_ID_RE)
  if (!m) return null
  const row = await prisma.foundingAgent.findUnique({ where: { agentKeyHash: m[1] }, select: { agentKeyHash: true } }).catch(() => null)
  return row ? { agentKeyHash: row.agentKeyHash, name: `Agent ${row.agentKeyHash.slice(0, 8)}` } : null
}
