// components/desk/vocab.server.ts — the desk console's vocabulary, read from
// the contract on the SERVER (squad five-million, CONSOLE lane, 2026-11-03).
//
// lib/tenant/spec imports node:crypto (the blotter hash), so no client file
// may import a value from it. The console's two page files call
// deskVocab() and pass the plain object down; every word the console prints
// about venues, ops, sides, chains and blotter kinds comes from here, never
// retyped.

import {
  BLOTTER_KINDS,
  DESK_ID_RE,
  DESK_KEY_PREFIX,
  SIGNING_LANES,
  TENANT_OPS,
  TENANT_SIDES,
  TENANT_SLUG_RE,
  TENANT_VENUES,
  VENUE_CHAINS,
} from '@/lib/tenant/spec'
import { SAMPLE_POLICY, TESTNET_CHAIN_IDS, chainName } from '@/lib/tenant/policy'
import { DESK_PLAN_ORDER } from '@/lib/tenant/entitlements'
import { BLOTTER_KIND_WORDS } from '@/components/desk-page/sample'
import { baseSepoliaAppChain, chainById } from '@/lib/chains'
import type { DeskVocab } from './types'

/** "Base (8453)" → "Base"; an unnamed id stays "chain 123". */
const bareName = (id: number) => chainName(id).replace(/ \(\d+\)$/, '')

export function deskVocab(): DeskVocab {
  const ids = new Set<number>(TESTNET_CHAIN_IDS)
  for (const v of TENANT_VENUES) for (const id of VENUE_CHAINS[v] ?? []) ids.add(id)
  const chainNames: Record<string, string> = {}
  const explorers: Record<string, string> = {}
  for (const id of [...ids].sort((a, b) => a - b)) {
    chainNames[String(id)] = bareName(id)
    const c = chainById(id) ?? (id === baseSepoliaAppChain.id ? baseSepoliaAppChain : null)
    if (c?.explorerTx) explorers[String(id)] = c.explorerTx
  }
  const venueChains: Record<string, number[] | null> = {}
  for (const v of TENANT_VENUES) venueChains[v] = VENUE_CHAINS[v] ? [...(VENUE_CHAINS[v] as readonly number[])] : null
  return {
    venues: [...TENANT_VENUES],
    ops: [...TENANT_OPS],
    sides: [...TENANT_SIDES],
    lanes: [...SIGNING_LANES],
    venueChains,
    chainNames,
    explorers,
    testnets: [...TESTNET_CHAIN_IDS].sort((a, b) => a - b),
    kinds: [...BLOTTER_KINDS],
    kindWords: { ...BLOTTER_KIND_WORDS },
    sample: JSON.parse(JSON.stringify(SAMPLE_POLICY)),
    slugRe: TENANT_SLUG_RE.source,
    deskIdRe: DESK_ID_RE.source,
    planOrder: [...DESK_PLAN_ORDER],
    deskKeyPrefix: DESK_KEY_PREFIX,
  }
}
