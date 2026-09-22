import { NextRequest, NextResponse } from 'next/server'
import { callMcpTool } from '@/lib/mcp-call'
import { NEAR_INTENTS_MCP } from '@/lib/near-fund-leg'
import { canonicalChainWord } from '@/lib/chain-lexicon'
import { bumpAndCheckXchainStatus, clientIpFrom } from '@/lib/turn-limits'
import { parseSwapStatus, type SettlementOutcome } from '@/lib/xchain-settlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Settlement watch for a lone cross-chain sign card — the read the jobs
// runner's `oneclick` wait predicate already does, exposed to the browser so
// a chat card can tell the user what the VENUE did with their deposit
// (lib/xchain-settlement.ts has the whole story).
//
// Public by deposit address, like the status itself: a one-time 1Click
// deposit address is minted per quote and its status is a public read. The
// route holds no secret, writes nothing, and only ever proxies one tool
// call. The chain words shape the explorer link and the words, never a
// balance or a build, so a client-named chain can't do anything but label
// its own card. Rate-fenced per IP, cached briefly so two tabs on the same
// swap are one call, and fail-soft: a venue outage is 'unknown' with a
// 503, which the card renders as "still settling", never as settled.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const HASH_RE = /^0x[0-9a-fA-F]{64}$/
const CACHE_TTL_MS = 5_000
const CACHE_MAX = 200

const store = globalThis as typeof globalThis & {
  __xchainStatusCache?: Map<string, { at: number; payload: unknown }>
}

async function readStatus(depositAddress: string): Promise<unknown> {
  const cache = (store.__xchainStatusCache ??= new Map())
  const key = depositAddress.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload
  const payload = await callMcpTool(NEAR_INTENTS_MCP, 'check_status', { depositAddress }, { timeoutMs: 12_000 })
  if (cache.size >= CACHE_MAX && !cache.has(key)) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), payload })
  return payload
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const depositAddress = typeof body.depositAddress === 'string' ? body.depositAddress.trim() : ''
  if (!ADDRESS_RE.test(depositAddress)) {
    return NextResponse.json({ error: 'depositAddress must be a 0x address.' }, { status: 400 })
  }
  const word = (v: unknown) => (typeof v === 'string' ? (canonicalChainWord(v) ?? v.trim().toLowerCase().slice(0, 20)) : '')
  const originChain = word(body.originChain)
  const destinationChain = word(body.destinationChain)
  if (!originChain || !destinationChain) {
    return NextResponse.json({ error: 'originChain and destinationChain are required.' }, { status: 400 })
  }
  const signedHashes = (Array.isArray(body.signedHashes) ? body.signedHashes : [])
    .filter((h): h is string => typeof h === 'string' && HASH_RE.test(h))
    .slice(0, 8)

  if (await bumpAndCheckXchainStatus(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: 'Too many settlement checks from this address.' }, { status: 429 })
  }

  try {
    const payload = await readStatus(depositAddress)
    const outcome = parseSwapStatus(payload, { originChain, destinationChain }, signedHashes)
    return NextResponse.json({ ok: true, outcome })
  } catch (e) {
    // The venue being unreachable is not an outcome. Say so and keep the
    // card watching — a swap in flight is never reported as settled.
    const outcome: SettlementOutcome = { status: 'unknown', terminal: false }
    return NextResponse.json({ ok: false, outcome, error: (e as Error).message.slice(0, 200) }, { status: 503 })
  }
}
