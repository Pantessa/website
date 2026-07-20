import { NextRequest, NextResponse } from 'next/server'
import {
  buildCowSubmitBody,
  describeCowOrder,
  COW_API_BASE,
  COW_APP_DATA_HASH,
  COW_EXPLORER_CHAIN,
  type CowOrderParameters,
} from '@/lib/cow'
import { orderValueUsd, policyCheck, COW_POLICY_HOST } from '@/lib/cow-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'

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
  // The relay only places orders signed over Yeetful's own appData document
  // (which carries the partner fee when the protocol fee is on) — a client
  // that re-signed a fee-stripped or hook-injected doc doesn't get relayed.
  if ((order.appData ?? '').toLowerCase() !== COW_APP_DATA_HASH.toLowerCase()) {
    return NextResponse.json(
      { error: "Refused: order appData is not the document Yeetful builds with — rebuild through the quote flow." },
      { status: 403 },
    )
  }
  const valueUsd = orderValueUsd(order, chainId)
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const { violation } = policyCheck(valueUsd, policy, spentToday, COW_POLICY_HOST, 0, { selfSigned: true })
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
      { error: `Refused by your spend policy at submission: ${violation}.` },
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

    return NextResponse.json({ orderUid, explorerUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'submission failed'
    return NextResponse.json({ error: `Couldn't reach the CoW order book: ${msg}` }, { status: 502 })
  }
}
