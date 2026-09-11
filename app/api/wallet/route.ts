import { NextRequest, NextResponse } from 'next/server'
import { getWalletViewCached } from '@/lib/wallet-view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/wallet?address=0x… — the Wallet panel's read: every app chain's
// balances (priced), the gas verdict per chain, recent transfers.
//
// Public by address, like /w/<address> and /api/mosaics/read: balances of an
// address are on-chain public data and the panel is a connect-to-act
// surface (#553) — a CDP wallet that has just been created has no session
// and must still be able to see itself. No SIWE gate; no write; nothing here
// is per-account.
//
// Cached 45s per address so a panel left open (it re-reads on an interval)
// costs one Alchemy call a minute, not one a poll. `fresh=1` — the panel's
// Refresh button, and the moment funds are expected — bypasses the cache,
// bounded to one fresh read per address every 8s so the button can't be
// used as an Alchemy amplifier. The cache lives in lib/wallet-view
// (getWalletViewCached), shared with the watchlist's holdings autofill.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'address must be a 0x-prefixed 40-hex wallet address.' }, { status: 400 })
  }
  const { view, cached } = await getWalletViewCached(address as `0x${string}`, { fresh: req.nextUrl.searchParams.get('fresh') === '1' })
  return NextResponse.json(view, { headers: { 'x-wallet-cache': cached ? 'hit' : 'miss' } })
}
