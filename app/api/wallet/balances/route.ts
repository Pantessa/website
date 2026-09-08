import { NextRequest, NextResponse } from 'next/server'
import { APP_CHAINS, chainByKey } from '@/lib/chains'
import { readChainBalances } from '@/lib/wallet-view'
import { usdPerToken } from '@/lib/usd-probe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/wallet/balances?address=0x…&chains=ethereum,base — the light read
// behind the funding-arrival watcher (lib/funding-arrival.ts): native ETH +
// the chain's primary stable, straight from the RPC, no index, no cache.
//
// Separate from /api/wallet on purpose. Arrival detection polls every ~10s
// for up to half an hour after a card purchase, and a poll that pays for an
// Alchemy portfolio call each time — or reads a 45s cache and reports the
// money late — is the wrong instrument. Two eth_call-class reads per chain is
// what a wallet does; a balance that just changed is visible on the next
// block.
//
// Public by address (same class as /api/wallet). Chains are named by
// registry key and capped at the registry, so nothing here can be pointed at
// an RPC we don't already run.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const MAX_CHAINS = APP_CHAINS.length

/** One ETH price per minute, shared by every poller — the watcher only needs
 *  it to put a dollar figure on the arrival banner, so a stale-by-a-minute
 *  price is fine and a quoter call per poll is not. */
let ethUsdCache: { at: number; usd: number | null } | null = null
async function ethUsd(): Promise<number | null> {
  if (ethUsdCache && Date.now() - ethUsdCache.at < 60_000) return ethUsdCache.usd
  const probe = await usdPerToken(8453, 'ETH').catch(() => null)
  ethUsdCache = { at: Date.now(), usd: probe?.usd ?? null }
  return ethUsdCache.usd
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'address must be a 0x-prefixed 40-hex wallet address.' }, { status: 400 })
  }
  const raw = (req.nextUrl.searchParams.get('chains') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const keys = raw.length ? raw : ['ethereum', 'base']
  const chains = keys.map((k) => chainByKey(k)).filter((c): c is NonNullable<typeof c> => !!c)
  if (chains.length === 0 || chains.length > MAX_CHAINS) {
    return NextResponse.json({ error: `chains must name one or more of: ${APP_CHAINS.map((c) => c.key).join(', ')}.` }, { status: 400 })
  }
  const [reads, price] = await Promise.all([
    Promise.all(chains.map((c) => readChainBalances(c.id, address as `0x${string}`))),
    ethUsd(),
  ])
  return NextResponse.json({
    address: address.toLowerCase(),
    at: new Date().toISOString(),
    ethUsd: price,
    chains: chains.map((c, i) => {
      const r = reads[i]
      return r
        ? { key: c.key, id: c.id, name: c.name, ok: true, nativeEth: r.nativeEth, stable: r.stable }
        : { key: c.key, id: c.id, name: c.name, ok: false }
    }),
  })
}
