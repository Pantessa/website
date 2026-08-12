#!/usr/bin/env tsx
// Seed the first-party HOUSE mosaics (executable allocations) — three
// canonical shapes minted as intent links with deterministic slugs
// (/i/tile-classic, /i/tile-barbell, /i/tile-steady) so the gallery and
// landing CTAs never demo an empty product. creator=null: house shapes earn
// nothing and belong to no dashboard; kind='mosaic' is what the gallery
// keys on; parentSlug stays null — house shapes are roots, forks credit THEM.
//
// ⛔ OWNER-RUN, POST-DEPLOY ONLY — never from a lane, never pre-merge. A
// live /i row whose mosaic gate isn't deployed yet falls to the PLANNER
// (the #423 lesson: ship the native gate WITH the ask, never behind it).
// Run after the mosaic lane is merged AND the deploy is live:
//   DATABASE_URL=... npx tsx scripts/seed-house-mosaics.ts
//
// Idempotent: upserts by slug and un-revokes (the house set is meant to be
// live; revoking one deliberately means removing it from this list too).
import { PrismaClient } from '@prisma/client'
import { isMosaicAsk, mosaicAskString, type MosaicSlice } from '../lib/mosaic'
import { composeMcps } from '../lib/intent-links'

const prisma = new PrismaClient()

/** The house shapes. Asks are COMPOSED via mosaicAskString so the stored
 *  string is canonical (uppercase tiles, one spelling) — hand-typed variants
 *  would fork the round-trip pin the harness holds. No cleanAsk pass: these
 *  strings are deterministic composer output, not user input. */
const HOUSE_MOSAICS: Array<{ slug: string; slices: MosaicSlice[] }> = [
  // The two-tile starter — most wallets' honest first shape.
  { slug: 'tile-classic', slices: [{ pct: 60, token: 'ETH' }, { pct: 40, token: 'USDC' }] },
  // Barbell: majors on both ends, a BTC kicker in the middle.
  {
    slug: 'tile-barbell',
    slices: [{ pct: 45, token: 'ETH' }, { pct: 45, token: 'USDC' }, { pct: 10, token: 'cbBTC' }],
  },
  // Stable-led with staked-ETH yield — the sleep-well shape.
  {
    slug: 'tile-steady',
    slices: [{ pct: 50, token: 'USDC' }, { pct: 30, token: 'ETH' }, { pct: 20, token: 'wstETH' }],
  },
]

async function main() {
  // Fail closed BEFORE any write: one house ask that doesn't survive its own
  // parser means the list is wrong — refuse the whole run, seed nothing.
  const composed = HOUSE_MOSAICS.map((m) => ({ ...m, ask: mosaicAskString(m.slices) }))
  for (const m of composed) {
    if (!isMosaicAsk(m.ask)) throw new Error(`house mosaic ${m.slug} does not round-trip parseMosaicAsk: "${m.ask}"`)
  }

  for (const m of composed) {
    const mcps = composeMcps(m.ask).join(',') || null
    await prisma.intentLink.upsert({
      where: { id: m.slug },
      create: {
        id: m.slug,
        ask: m.ask,
        mcps,
        creator: null,
        agent: 'Pantessa',
        kind: 'mosaic',
        parentSlug: null,
        revoked: false,
      },
      update: { ask: m.ask, mcps, agent: 'Pantessa', kind: 'mosaic', revoked: false },
    })
    console.log(`✓ /i/${m.slug} — "${m.ask}" [${mcps ?? '—'}]`)
  }
  console.log(`${HOUSE_MOSAICS.length} house mosaics live.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
