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
import { buildUniswapV4Swap } from '@/lib/uniswap-v4'
import { ensureTokenList } from '@/lib/token-list'
import { sanitizeChainId, DEFAULT_CHAIN_ID } from '@/lib/chains'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  if (body.kind !== 'uniswap-swap' && body.kind !== 'uniswap-v4-swap') {
    return NextResponse.json({ error: `unknown refresh kind "${String(body.kind)}"` }, { status: 400 })
  }
  const from = typeof body.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.from) ? body.from : null
  const sellToken = typeof body.sellToken === 'string' ? body.sellToken.slice(0, 64) : ''
  const buyToken = typeof body.buyToken === 'string' ? body.buyToken.slice(0, 64) : ''
  const amountHuman = typeof body.amountHuman === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(body.amountHuman) ? body.amountHuman : ''
  // The chain the original build targeted (refresh recipes carry it as a
  // string; pre-picker chains omitted it = Base). Only registry ids survive.
  const chainId = sanitizeChainId(Number(body.chainId)) ?? DEFAULT_CHAIN_ID
  if (!from || !sellToken || !buyToken || !amountHuman) {
    return NextResponse.json({ error: 'missing/invalid from, sellToken, buyToken or amountHuman' }, { status: 400 })
  }

  try {
    await ensureTokenList(chainId)
    if (body.kind === 'uniswap-v4-swap') {
      // v4 chains re-quote the FINAL step; the builder re-reads both Permit2
      // hops, so "approvals not visible yet" comes back as pending → retry.
      const v4 = await buildUniswapV4Swap({ sellToken, buyToken, amountHuman, from, chainId })
      if (v4.blocked) {
        const reasons = v4.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ')
        return NextResponse.json({ blocked: true, reasons: reasons || 'a safety check failed', guardrails: v4.guardrails })
      }
      if (v4.steps.length > 1) {
        return NextResponse.json({ pending: true, note: 'allowance not visible on-chain yet' })
      }
      return NextResponse.json({ tx: v4.steps[0].tx, summary: v4.summary, guardrails: v4.guardrails })
    }
    const uni = await buildUniswapSwap({ sellToken, buyToken, amountHuman, from, chainId })
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
