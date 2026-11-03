import { NextRequest, NextResponse } from 'next/server'
import {
  buildCowSubmitBody,
  describeCowOrder,
  COW_API_BASE,
  COW_CANONICAL_APP_DATA_HASHES,
  COW_EXPLORER_CHAIN,
  type CowOrderParameters,
} from '@/lib/cow'
import { orderValueUsd, policyCheck, COW_POLICY_HOST } from '@/lib/cow-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, spentTotalUsd, toPolicy } from '@/lib/grant-store'
import { bookLinkSigned, joinTenantLeg, joinTenantLink, linkGate, relayGate } from '@/lib/tenant/gate'
import type { GateOrder } from '@/lib/tenant/order'
import { cowAppDataHash, resolveToken } from '@/lib/cow'
import { LINK_SWAP_FEE_BPS, SWAP_FEE_BPS } from '@/lib/fees'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/cow/submit — relay a USER-SIGNED CoW order to the order book (A4,
// wallet path). The server NEVER signs here: the wallet signed the exact
// EIP-712 order the guardrails approved; this route re-gates policy and
// forwards. Body: { chainId?, order, signature, from, appDataJson?, quoteId? }
// Re-gate before relaying (defense against replaying a stale/blocked build):
//   recipient must equal `from`, order must not be expired, and the wallet's
//   spend policy is re-checked at NOW's spent totals. A placed order ledgers
//   at its USD value so it counts toward the daily budget like any spend.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const chainId = typeof body.chainId === 'number' ? body.chainId : 8453
  const signature = typeof body.signature === 'string' ? body.signature : ''
  const from = typeof body.from === 'string' ? body.from : ''
  const appDataJson = typeof body.appDataJson === 'string' ? body.appDataJson : undefined
  const quoteId = typeof body.quoteId === 'number' ? body.quoteId : undefined
  const mode = body.mode === 'limit' ? 'limit' : 'swap'
  const order = (body.order ?? null) as CowOrderParameters | null

  const apiBase = COW_API_BASE[chainId]
  if (!apiBase) return NextResponse.json({ error: `CoW is not configured for chain ${chainId}.` }, { status: 400 })
  if (!/^0x[0-9a-fA-F]+$/.test(signature) || signature.length < 132) {
    return NextResponse.json({ error: 'A valid EIP-712 signature is required.' }, { status: 400 })
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(from)) {
    return NextResponse.json({ error: 'A valid `from` wallet address is required.' }, { status: 400 })
  }
  if (
    !order ||
    typeof order.sellToken !== 'string' ||
    typeof order.buyToken !== 'string' ||
    typeof order.sellAmount !== 'string' ||
    typeof order.buyAmount !== 'string' ||
    typeof order.validTo !== 'number'
  ) {
    return NextResponse.json({ error: 'A complete CoW order object is required.' }, { status: 400 })
  }

  // ── Re-gate (A3 invariants at the moment of submission) ───────────────────
  if (order.receiver.toLowerCase() !== from.toLowerCase()) {
    return NextResponse.json(
      { error: `Refused: order pays ${order.receiver}, not the signing wallet.` },
      { status: 403 },
    )
  }
  if (order.validTo <= Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: 'Refused: the order is expired — rebuild it.' }, { status: 400 })
  }
  // The relay only places orders signed over one of Pantessa's own appData
  // documents — the base tier or the link tier (C2b two-doc family). A
  // client that re-signed a fee-stripped, fatter-fee, or hook-injected doc
  // doesn't get relayed; the tier lives inside the signed hash.
  if (!COW_CANONICAL_APP_DATA_HASHES.has((order.appData ?? '').toLowerCase())) {
    return NextResponse.json(
      { error: "Refused: order appData is not a document Pantessa builds with — rebuild through the quote flow." },
      { status: 403 },
    )
  }
  const valueUsd = orderValueUsd(order, chainId)
  // FIVE-MILLION: an order a TENANT job built is re-gated with the tenant's
  // ACTIVE policy before it reaches the book — joined from the server's own
  // job rows (the offered step whose built order IS this order), never a
  // body claim. A tenant signer BLOCKS: 403 { error, reason }.
  const tenantLeg = await joinTenantLeg(from, (a) => cowArtifactIs(a, order, chainId))
  if (tenantLeg) {
    const refused = await relayGate(tenantLeg, 'cow-submit', { usd: valueUsd ?? null })
    if (refused) return NextResponse.json(refused, { status: 403 })
  }
  // The LINK lane (no job): a wallet the tenant named, a live handed-off
  // tenant link whose ask is a swap on this chain — re-gated as the CoW order
  // it actually is, and booked `signed` once the book accepts it.
  const tenantLink = tenantLeg ? null : await joinTenantLink(from, (o) => (o.op === 'swap' || o.op === 'limit') && o.chainId === chainId)
  let linkOrder: GateOrder | null = null
  if (tenantLink) {
    linkOrder = {
      ...tenantLink.base,
      venue: 'cow',
      candidates: ['cow'],
      op: mode === 'limit' ? 'limit' : 'swap',
      chainId,
      tokens: cowLegTokens(order, chainId, tenantLink.base.tokens),
      usd: valueUsd ?? tenantLink.base.usd,
    }
    const refused = await linkGate(tenantLink, 'cow-submit', linkOrder)
    if (refused) return NextResponse.json(refused, { status: 403 })
  }
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const spentTotal = grant ? await spentTotalUsd(grant.id) : 0
  const { violation } = policyCheck(valueUsd, policy, spentToday, COW_POLICY_HOST, spentTotal, { selfSigned: true })
  if (violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: COW_POLICY_HOST,
      serviceName: 'CoW Swap',
      amountUsd: 0,
      ok: false,
      note: `blocked: ${violation} (cow submit)`,
    })
    return NextResponse.json(
      { error: `Refused by your account's kill switch at submission: ${violation}.` },
      { status: 403 },
    )
  }

  // ── Relay to the order book ────────────────────────────────────────────────
  try {
    const res = await fetch(`${apiBase}/api/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildCowSubmitBody(order, signature, from, appDataJson, quoteId)),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const detail =
        (data && typeof data === 'object' && 'description' in data && String((data as { description?: unknown }).description)) ||
        `HTTP ${res.status}`
      return NextResponse.json({ error: `CoW order book rejected the order: ${detail}` }, { status: 502 })
    }
    const orderUid = typeof data === 'string' ? data : String(data)
    const explorerUrl = `https://explorer.cow.fi/${COW_EXPLORER_CHAIN[chainId] ?? chainId}/orders/${orderUid}`

    // Receipt: the placed order counts toward the daily budget at its USD
    // value — ten $40 swaps should not sail past a $50/day cap one by one.
    if (grant) {
      await recordLedger({
        grantId: grant.id,
        orgId: grant.orgId ?? undefined,
        host: COW_POLICY_HOST,
        serviceName: 'CoW Swap',
        amountUsd: valueUsd ?? 0,
        ok: true,
        note: `cow order placed: ${describeCowOrder({ chainId, from, order }, mode)}`.slice(0, 200),
      })
    }

    if (tenantLink && linkOrder) {
      const appData = (order.appData ?? '').toLowerCase()
      const feeBps = appData === cowAppDataHash(LINK_SWAP_FEE_BPS).toLowerCase() ? LINK_SWAP_FEE_BPS : appData === cowAppDataHash(SWAP_FEE_BPS).toLowerCase() ? SWAP_FEE_BPS : null
      await bookLinkSigned(tenantLink, 'cow-submit', linkOrder, { valueUsd: valueUsd ?? null, feeBps, payload: { orderUid, explorerUrl, mode } })
    }

    return NextResponse.json({ orderUid, explorerUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'submission failed'
    return NextResponse.json({ error: `Couldn't reach the CoW order book: ${msg}` }, { status: 502 })
  }
}

/** Is this job step's built artifact THIS CoW order (same chain, tokens,
 *  amounts, expiry, appData, receiver)? */
function cowArtifactIs(artifact: Record<string, unknown>, order: CowOrderParameters, chainId: number): boolean {
  const req = artifact.orderRequest as { protocol?: unknown; chainId?: unknown; typedData?: { message?: Record<string, unknown> } } | undefined
  if (!req || req.protocol !== 'cow') return false
  if (typeof req.chainId === 'number' && req.chainId !== chainId) return false
  const m = req.typedData?.message
  if (!m) return false
  const lo = (v: unknown) => String(v ?? '').toLowerCase()
  return (
    lo(m.sellToken) === lo(order.sellToken) &&
    lo(m.buyToken) === lo(order.buyToken) &&
    String(m.sellAmount) === String(order.sellAmount) &&
    String(m.buyAmount) === String(order.buyAmount) &&
    Number(m.validTo) === Number(order.validTo) &&
    lo(m.appData) === lo(order.appData) &&
    lo(m.receiver) === lo(order.receiver)
  )
}

/** The tokens a CoW leg touches, the way the policy lists them: the link's
 *  own symbols when the order's two addresses ARE those symbols on this chain,
 *  else the raw addresses (a symbol-listing rule then refuses — default-deny). */
function cowLegTokens(order: CowOrderParameters, chainId: number, symbols: string[]): string[] {
  const addrs = [order.sellToken.toLowerCase(), order.buyToken.toLowerCase()]
  const bySymbol = new Map(symbols.map((sym) => [resolveToken(sym, chainId) ?? '', sym]))
  const named = addrs.map((a) => bySymbol.get(a))
  return named.every((n): n is string => !!n) ? named : addrs
}
