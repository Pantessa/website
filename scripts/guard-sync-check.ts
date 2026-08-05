#!/usr/bin/env tsx
// guard-sdk drift check — the extraction's honesty mechanism. The app's lib/
// stays the source of truth; guard-sdk/src carries FULL COPIES of the pure
// modules (import lines rewritten, one provenance header added). This check
// fails the moment a copy and its canonical source diverge on anything else,
// so "the package is the same code that guards production" stays a true
// sentence. Adapted excerpts (cross-chain-guard, token-identity) are
// deliberately NOT byte-comparable and are not listed here.
//
//   npx tsx scripts/guard-sync-check.ts        # standalone
//   (also runs inside test:api as one check)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** canonical lib file → its full copy in the package */
export const GUARD_SYNC_PAIRS: Array<{ lib: string; pkg: string }> = [
  { lib: 'lib/spend-grant.ts', pkg: 'guard-sdk/src/spend-grant.ts' },
  { lib: 'lib/tx-guardrails.ts', pkg: 'guard-sdk/src/tx-guardrails.ts' },
  { lib: 'lib/hl-guardian.ts', pkg: 'guard-sdk/src/hl-guardian.ts' },
]

const normalize = (src: string): string =>
  src
    .split('\n')
    .filter((l) => !l.startsWith('import ') && !l.startsWith('// @canonical'))
    .join('\n')
    .trim()

/** Returns the list of drifted pairs (empty = in sync). */
export function guardSyncDrift(root = process.cwd()): string[] {
  const drifted: string[] = []
  for (const { lib, pkg } of GUARD_SYNC_PAIRS) {
    const a = normalize(readFileSync(join(root, lib), 'utf8'))
    const b = normalize(readFileSync(join(root, pkg), 'utf8'))
    if (a !== b) drifted.push(`${pkg} ≠ ${lib}`)
  }
  return drifted
}

// Standalone mode
if (process.argv[1]?.endsWith('guard-sync-check.ts')) {
  const drift = guardSyncDrift()
  if (drift.length === 0) {
    console.log(`✅ guard-sdk in sync with lib/ (${GUARD_SYNC_PAIRS.length} full copies)`)
  } else {
    console.error(`❌ guard-sdk drifted from lib/:\n  ${drift.join('\n  ')}\n  Re-copy the canonical file (keep the header, rewrite only import lines).`)
    process.exit(1)
  }
}
