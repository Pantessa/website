import { NextRequest, NextResponse } from 'next/server'
import { buildGuardrailedOrder } from '@/lib/cow-build'
import { MAX_SLIPPAGE_BPS } from '@/lib/cow-guardrails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/cow/quote — safe transaction building: turn a swap request into a
// real CoW quote + the EIP-712 order to sign, GUARDRAILED (A3). Body:
//   { sellToken, buyToken, sellAmount, from, chainId?, receiver?,
//     mode?: 'swap' | 'limit', buyAmountAtLeast?, slippageBps? }
// Amounts in token atoms. mode 'limit' skips the quote (user names the price
// via buyAmountAtLeast). slippageBps (swap only, default 50, max 500) lowers
// the signed minimum buy so the order still fills on small moves.
// The artifact is WITHHELD when a block-level guardrail fails — recipient
// mismatch, bad validity, absurd fee, or the wallet's spend policy. Policy
// denials are ledgered like any other refusal. Signing/submitting is A4.
// Build + guardrail logic lives in lib/cow-build (shared with the chat
// swap fast-path — one code path, no drift).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const sellToken = typeof body.sellToken === 'string' ? body.sellToken : ''
  const buyToken = typeof body.buyToken === 'string' ? body.buyToken : ''
  const sellAmount = typeof body.sellAmount === 'string' ? body.sellAmount : String(body.sellAmount ?? '')
  const from = typeof body.from === 'string' ? body.from : ''
  const chainId = typeof body.chainId === 'number' ? body.chainId : 8453
  const receiver = typeof body.receiver === 'string' ? body.receiver : undefined
  const mode = body.mode === 'limit' ? 'limit' : 'swap'
  const buyAmountAtLeast =
    typeof body.buyAmountAtLeast === 'string' ? body.buyAmountAtLeast : String(body.buyAmountAtLeast ?? '')
  const slippageBps = typeof body.slippageBps === 'number' ? body.slippageBps : 50

  if (!sellToken || !buyToken || !sellAmount) {
    return NextResponse.json(
      { error: 'sellToken, buyToken and sellAmount are required.' },
      { status: 400 },
    )
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(from)) {
    return NextResponse.json({ error: 'A valid `from` wallet address is required.' }, { status: 400 })
  }
  if (mode === 'limit' && !buyAmountAtLeast) {
    return NextResponse.json(
      { error: 'A limit order needs buyAmountAtLeast (minimum buy amount, in token atoms).' },
      { status: 400 },
    )
  }
  if (mode === 'swap' && (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS)) {
    return NextResponse.json(
      { error: `slippageBps must be an integer between 0 and ${MAX_SLIPPAGE_BPS}.` },
      { status: 400 },
    )
  }

  try {
    const built = await buildGuardrailedOrder({
      mode,
      chainId,
      sellToken,
      buyToken,
      sellAmount,
      buyAmountAtLeast: mode === 'limit' ? buyAmountAtLeast : undefined,
      from,
      receiver,
      slippageBps,
    })
    return NextResponse.json({
      mode,
      quote: built.quote.order,
      quoteId: built.quote.quoteId,
      summary: built.summary,
      guardrails: built.guardrails,
      blocked: built.blocked,
      // The signable payload — withheld when a block-level guardrail failed.
      artifact: built.artifact,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Quote failed.'
    // Unknown token / bad amounts / same-pair are user errors (400); anything else 502.
    const userError = /Unknown (sell|buy) token|must be a positive|not configured|must differ|wallet address|slippageBps/.test(msg)
    return NextResponse.json({ error: msg }, { status: userError ? 400 : 502 })
  }
}
