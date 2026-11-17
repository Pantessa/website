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
  { lib: 'lib/hl-guardian.ts', pkg: 'guard-sdk/src/hl-guardian.ts' },
]

/** Declared forks (2026-11-17, harness-zero): the app retired its spend policy on
 *  2026-10-30 (f43a85b2 — only the kill switch refuses; the commit keeps the grant
 *  row "for the open-core SDK's own in-process policy"), so these two copies keep
 *  the policy the app dropped. Each must carry the @forked header naming its lib
 *  file; `guardForkDrift` pins that the package still enforces what the app retired. */
export const GUARD_FORKED: Array<{ lib: string; pkg: string }> = [
  { lib: 'lib/spend-grant.ts', pkg: 'guard-sdk/src/spend-grant.ts' },
  { lib: 'lib/tx-guardrails.ts', pkg: 'guard-sdk/src/tx-guardrails.ts' },
]

/** Returns what is wrong with the declared forks (empty = the fork is what it says). */
export function guardForkDrift(root = process.cwd()): string[] {
  const out: string[] = []
  const read = (p: string) => readFileSync(join(root, p), 'utf8')
  for (const { lib, pkg } of GUARD_FORKED) {
    if (!read(pkg).startsWith(`// @forked from ${lib} on 2026-10-30`)) out.push(`${pkg}: missing its @forked header`)
  }
  const sdkGrant = read('guard-sdk/src/spend-grant.ts')
  for (const v of ['EXPIRED', 'NOT_ALLOWED', 'OVER_PER_CALL', 'BUDGET_EXCEEDED', 'ACCOUNT_FROZEN', 'REVOKED', 'POLICY_ERROR']) {
    if (!new RegExp(`\\| '${v}'`).test(sdkGrant)) out.push(`guard-sdk spend-grant lost the ${v} violation`)
  }
  if (!/'VALUE_UNKNOWN'/.test(read('guard-sdk/src/tx-guardrails.ts'))) out.push('guard-sdk tx-guardrails lost the unpriceable-value refusal (VALUE_UNKNOWN)')
  return out
}

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
