// ─────────────────────────────────────────────────────────────────────────
//  POST /api/tx/refresh — rebuild ONE step of a transaction chain, fresh.
//
//  The self-advancing chain card (SendTxChain) calls this when a prior step
//  confirms: quotes go stale while approvals mine, so the swap step is
//  re-built at advance time — a fresh QuoterV2 quote AND a fresh guardrails
//  run (the policy gate re-fires; a swap that drifted past a block-level
//  check is refused here, not signed). Deterministic build, nothing signed
//  or submitted, recipient is always the payer — the same trust shape as
//  the chat fast-path that produced the chain.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { buildUniswapSwap } from '@/lib/uniswap-venue'
import { ensureBaseTokenList } from '@/lib/token-list'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  if (body.kind !== 'uniswap-swap') {
    return NextResponse.json({ error: `unknown refresh kind "${String(body.kind)}"` }, { status: 400 })
  }
  const from = typeof body.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.from) ? body.from : null
  const sellToken = typeof body.sellToken === 'string' ? body.sellToken.slice(0, 64) : ''
  const buyToken = typeof body.buyToken === 'string' ? body.buyToken.slice(0, 64) : ''
  const amountHuman = typeof body.amountHuman === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(body.amountHuman) ? body.amountHuman : ''
  if (!from || !sellToken || !buyToken || !amountHuman) {
    return NextResponse.json({ error: 'missing/invalid from, sellToken, buyToken or amountHuman' }, { status: 400 })
  }

  try {
    await ensureBaseTokenList()
    const uni = await buildUniswapSwap({ sellToken, buyToken, amountHuman, from })
    if (uni.blocked) {
      const reasons = uni.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ')
      return NextResponse.json({ blocked: true, reasons: reasons || 'a safety check failed', guardrails: uni.guardrails })
    }
    if (uni.approveTx) {
      // Allowance still short (approval not confirmed / not indexed yet) —
      // tell the card to wait and retry rather than offering a doomed swap.
      return NextResponse.json({ pending: true, note: 'allowance not visible on-chain yet' })
    }
    return NextResponse.json({ tx: uni.swapTx, summary: uni.summary, guardrails: uni.guardrails })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'rebuild failed' }, { status: 502 })
  }
}
