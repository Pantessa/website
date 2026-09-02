import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress, isTestWallet } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Kinds the feed can filter on (lib/ask-failure.ts + lib/wallet-refusal.ts). */
// 'roster' joined in the doors run (lib/roster-observe writes it; the
// failures page offers the filter — QA integration fix: the allowlist had
// lagged, so ?kind=roster silently nulled).
const KINDS = new Set(['planner-answer', 'native-wall', 'blocked', 'error', 'wallet-refused', 'roster'])

/**
 * The ask-failure feed — money-shaped asks that ended in a wall, newest
 * first, with the funds snapshot taken at failure time (lib/ask-failure.ts).
 * Admin-gated. `?funded=1` keeps only rows where the wallet demonstrably
 * held movable money (the product-gap queue); `?external=1` drops Pantessa's
 * own test wallets; `?kind=wallet-refused` keeps one kind; `?internal=1`
 * INCLUDES rows stamped is_internal (hidden by default, tagged when shown);
 * `?days=N` bounds the window (default 14, max 90).
 */
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(addr)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const q = req.nextUrl.searchParams
  const daysRaw = Number(q.get('days'))
  const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 90 ? Math.floor(daysRaw) : 14
  const fundedOnly = q.get('funded') === '1'
  const external = q.get('external') === '1'
  // Internal-run rows (is_internal — our own drills) are HIDDEN by default;
  // ?internal=1 shows them (labelled `internal: true` per row).
  const showInternal = q.get('internal') === '1'
  const kindRaw = q.get('kind')
  const kind = kindRaw && KINDS.has(kindRaw) ? kindRaw : null

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  // Integration note (squad 2026-08-18): #650 gives ask_failures.is_internal a
  // real Prisma column and #653 read it by NAME through raw SQL while the
  // column was pending. With both merged the typed column is the source and
  // the raw-SQL reader is retired here (retired).
  const [rows, internalHidden] = await Promise.all([
    prisma.askFailure.findMany({
      where: {
        createdAt: { gte: since },
        ...(fundedOnly ? { hadFunds: true } : {}),
        ...(kind ? { kind } : {}),
        ...(showInternal ? {} : { isInternal: false }),
      },
      orderBy: { createdAt: 'desc' },
      take: 400,
    }),
    showInternal
      ? Promise.resolve(0)
      : prisma.askFailure.count({ where: { createdAt: { gte: since }, isInternal: true, ...(fundedOnly ? { hadFunds: true } : {}), ...(kind ? { kind } : {}) } }).catch(() => 0),
  ])
  const tagged = rows.map((r) => ({ ...r, internal: r.isInternal }))
  const filtered = tagged.filter((r) => !external || !r.wallet || !isTestWallet(r.wallet))
  const counts = {
    total: filtered.length,
    funded: filtered.filter((r) => r.hadFunds === true).length,
    broke: filtered.filter((r) => r.hadFunds === false).length,
    unknown: filtered.filter((r) => r.hadFunds == null).length,
    internalHidden,
  }
  return NextResponse.json({ days, kind, counts, internal: showInternal, failures: filtered.slice(0, 200) })
}
