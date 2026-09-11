import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { isInternalRun } from '@/lib/internal-run'
import { readHeldSymbols } from '@/lib/watchlist-holdings'
import { syncHeldSymbols } from '@/lib/watchlists-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/watchlists/holdings — the watchlist fills itself with what the
// connected wallet holds (Nate, 2026-09-11; lib/watchlists planHeldAutofill).
//
// GET ?address=0x… → { held } — the wallet's watchable holdings. Public by
//   address, like GET /api/wallet: balances are on-chain public data, and a
//   connect-only guest's rail autofills from it (connect to act, #553). It
//   rides the Wallet panel's cache (lib/wallet-view getWalletViewCached), so
//   it adds no new read amplifier.
// POST { symbols } → { list, added, dismissed } — the ACCOUNT sync (SIWE
//   cookie or Bearer yf_). The owner's primary list gains the held symbols
//   its ledger has never seen. The symbols are the client's own GET result;
//   trusting them is safe because they only ever touch the caller's own list
//   and ledger — exactly what adding a ticker by hand does.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'address must be a 0x-prefixed 40-hex wallet address.' }, { status: 400 })
  }
  try {
    const { held, failedChains, cached } = await readHeldSymbols(address as `0x${string}`)
    return NextResponse.json(
      { address: address.toLowerCase(), held, failedChains },
      { headers: { 'cache-control': 'no-store', 'x-wallet-cache': cached ? 'hit' : 'miss' } },
    )
  } catch (e) {
    return NextResponse.json({ error: `Could not read the wallet right now (${(e as Error).message}).` }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  let body: Record<string, unknown> | null = null
  try {
    const b = (await req.json()) as unknown
    body = b && typeof b === 'object' ? (b as Record<string, unknown>) : null
  } catch {
    body = null
  }
  if (!body || !Array.isArray(body.symbols)) return NextResponse.json({ error: 'Name the held symbols: { symbols: string[] }.' }, { status: 400 })
  const r = await syncHeldSymbols(addr, body.symbols, isInternalRun(req.headers, body))
  return NextResponse.json(r, { headers: { 'cache-control': 'no-store' } })
}
