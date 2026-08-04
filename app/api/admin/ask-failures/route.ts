import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress, isTestWallet } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The ask-failure feed — money-shaped asks that ended in a wall, newest
 * first, with the funds snapshot taken at failure time (lib/ask-failure.ts).
 * Admin-gated. `?funded=1` keeps only rows where the wallet demonstrably
 * held movable money (the product-gap queue); `?external=1` drops Pantessa's
 * own test wallets; `?days=N` bounds the window (default 14, max 90).
 */
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(addr)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const daysRaw = Number(req.nextUrl.searchParams.get('days'))
  const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 90 ? Math.floor(daysRaw) : 14
  const fundedOnly = req.nextUrl.searchParams.get('funded') === '1'
  const external = req.nextUrl.searchParams.get('external') === '1'

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await prisma.askFailure.findMany({
    where: {
      createdAt: { gte: since },
      ...(fundedOnly ? { hadFunds: true } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 400,
  })
  const filtered = external ? rows.filter((r) => !r.wallet || !isTestWallet(r.wallet)) : rows
  const counts = {
    total: filtered.length,
    funded: filtered.filter((r) => r.hadFunds === true).length,
    broke: filtered.filter((r) => r.hadFunds === false).length,
    unknown: filtered.filter((r) => r.hadFunds == null).length,
  }
  return NextResponse.json({ days, counts, failures: filtered.slice(0, 200) })
}
