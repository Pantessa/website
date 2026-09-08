import { NextRequest, NextResponse } from 'next/server'
import { composeWalletView } from '@/lib/wallet-view'

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
// used as an Alchemy amplifier.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const TTL_MS = 45_000
const FRESH_MIN_GAP_MS = 8_000
const CACHE_MAX = 500
const cache = new Map<string, { at: number; body: unknown }>()

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'address must be a 0x-prefixed 40-hex wallet address.' }, { status: 400 })
  }
  const key = address.toLowerCase()
  const wantFresh = req.nextUrl.searchParams.get('fresh') === '1'
  const hit = cache.get(key)
  const age = hit ? Date.now() - hit.at : Infinity
  if (hit && (age < FRESH_MIN_GAP_MS || (!wantFresh && age < TTL_MS))) {
    return NextResponse.json(hit.body, { headers: { 'x-wallet-cache': 'hit' } })
  }
  const view = await composeWalletView(address as `0x${string}`)
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), body: view })
  return NextResponse.json(view, { headers: { 'x-wallet-cache': 'miss' } })
}
