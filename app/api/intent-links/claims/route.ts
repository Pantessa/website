import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { FEE_BEARING_BUILD_PATHS, creatorEarningsUsd, netFeeBpsForTurn } from '@/lib/fees'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIN_CLAIM_USD = 10

/**
 * Request a creator payout (POST) — sweeps the full claimable balance into
 * one claim row. v1 is manual settlement: the owner pays USDC on Base and
 * marks the claim paid (+txUrl). Everything is server-derived — the client
 * sends no amount, so a claim can never exceed what the ledger earned.
 */
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in to claim.' }, { status: 401 })
  const creator = addr.toLowerCase()

  const links = await prisma.intentLink.findMany({ where: { creator }, select: { id: true } })
  if (links.length === 0) return NextResponse.json({ error: 'No links, no earnings yet.' }, { status: 400 })

  const turns = await prisma.embedTurn.groupBy({
    by: ['buildPath', 'feeBps'],
    where: { intentLinkSlug: { in: links.map((l) => l.id) }, outcome: 'signed', valueUsd: { gt: 0 } },
    _sum: { valueUsd: true },
  })
  // Lifetime referral component — the SAME union as /api/intent-links
  // (referred wallets' unattributed fee-bearing turns; direct link
  // attribution wins per-turn, so the two legs never overlap).
  const referred = await prisma.referredWallet.findMany({ where: { creator }, select: { wallet: true } })
  const referredTurns = referred.length
    ? await prisma.embedTurn.groupBy({
        by: ['buildPath', 'feeBps'],
        where: { walletAddress: { in: referred.map((r) => r.wallet) }, intentLinkSlug: null, outcome: 'signed', valueUsd: { gt: 0 } },
        _sum: { valueUsd: true },
      })
    : []
  // Per-path rates — a cross-chain dollar earns half a Uniswap dollar (the
  // 1Click app-fee split). Must match /api/intent-links exactly or a creator
  // sees one number and claims another.
  const earned = [...turns, ...referredTurns].reduce(
    (s, t) =>
      s +
      (t.buildPath && FEE_BEARING_BUILD_PATHS.has(t.buildPath)
        ? creatorEarningsUsd(t._sum.valueUsd ?? 0, netFeeBpsForTurn(t.buildPath, t.feeBps))
        : 0),
    0,
  )

  const prior = await prisma.intentLinkClaim.aggregate({
    where: { creator, status: { in: ['requested', 'paid'] } },
    _sum: { amountUsd: true },
  })
  const claimable = Math.max(0, earned - (prior._sum.amountUsd ?? 0))
  if (claimable < MIN_CLAIM_USD) {
    return NextResponse.json({ error: `Claims open at $${MIN_CLAIM_USD} — you're at $${claimable.toFixed(2)}. Keep sharing.` }, { status: 400 })
  }

  const claim = await prisma.intentLinkClaim.create({ data: { creator, amountUsd: Math.round(claimable * 100) / 100 } })
  return NextResponse.json({ id: claim.id, amountUsd: claim.amountUsd, status: claim.status, note: 'Payout is settled manually in v1 — USDC on Base, usually within a day.' })
}
