import { NextRequest, NextResponse, after } from 'next/server'
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
import { cowRefusalOf, cowRefusalWords, type CowRefusal } from '@/lib/cow-refusal'
import { VENUE_REFUSED_KIND } from '@/lib/wallet-refusal'
import { isInternalRun } from '@/lib/internal-run'
import { bumpAndCheckBrokerCall, clientIpFrom } from '@/lib/turn-limits'
import prisma from '@/lib/db'

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
  // A refusal AFTER the wallet signed is the venue's answer, never the
  // wallet's: it keeps CoW's errorType, says so in plain words (lib/cow-
  // refusal), lands in the logs, and files a `venue-refused` row on
  // /dashboard/failures. Until 2026-11-11 it was one 502 with no log line,
  // which the button printed as "Signature rejected in the wallet".
  const refused = (refusal: CowRefusal, words: string) => {
    console.warn(
      '[cow/submit] order book refused a signed order',
      JSON.stringify({ chainId, from: from.toLowerCase(), mode, status: refusal.status, errorType: refusal.errorType, description: refusal.description }),
    )
    if (req.headers.get('x-yf-no-ask-log') !== '1') {
      const internal = isInternalRun(req.headers, body)
      const ip = clientIpFrom(req.headers)
      after(async () => {
        if (await bumpAndCheckBrokerCall(ip)) return
        await prisma.askFailure
          .create({
            data: {
              wallet: from.toLowerCase(),
              prompt: `[cow-order] ${describeCowOrder({ chainId, from, order }, mode)}`.slice(0, 300),
              reply: words.slice(0, 400),
              kind: VENUE_REFUSED_KIND,
              buildPath: 'native-swap-cow',
              // The guardrails read the balance at build; CoW's own answer
              // is the only thing that says otherwise.
              hadFunds: refusal.errorType === 'InsufficientBalance' ? false : null,
              fundsUsd: valueUsd != null && valueUsd > 0 ? Math.round(valueUsd * 100) / 100 : null,
              fundsDetail: `order book refused after signing · chain ${chainId}${refusal.errorType ? ` · ${refusal.errorType}` : ''} — the wallet signed; CoW's order book was the wall, nothing was placed.`,
              isInternal: internal,
            },
          })
          .catch(() => {})
      })
    }
    return NextResponse.json(
      { error: words, stage: 'order-book', venue: 'cow', errorType: refusal.errorType },
      { status: 502 },
    )
  }
  try {
    const res = await fetch(`${apiBase}/api/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildCowSubmitBody(order, signature, from, appDataJson, quoteId)),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const refusal = cowRefusalOf(res.status, data)
      return refused(refusal, cowRefusalWords(refusal))
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
    console.warn('[cow/submit] could not reach the order book', JSON.stringify({ chainId, from: from.toLowerCase(), error: msg.slice(0, 200) }))
    return NextResponse.json(
      { error: `Couldn't reach CoW's order book (${msg.slice(0, 160)}). The wallet signed; nothing was placed.`, stage: 'relay', venue: 'cow' },
      { status: 502 },
    )
  }
}
