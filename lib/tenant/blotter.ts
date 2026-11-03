// lib/tenant/blotter.ts — STUB (BLOTTER lane replaces this file). The hash-
// chained ledger write. Never throws: a ledger outage must never block a
// build. The stub logs and drops.
import type { BlotterEvent } from '@/lib/tenant/spec'

export async function recordBlotter(e: BlotterEvent): Promise<void> {
  if (process.env.NODE_ENV !== 'production') console.log('[blotter:stub]', e.tenantId, e.kind)
}

/** The desk's signed notional so far today (UTC), from the blotter. */
export async function spentTodayUsd(_tenantId: string, _deskId: string): Promise<number> {
  return 0
}
