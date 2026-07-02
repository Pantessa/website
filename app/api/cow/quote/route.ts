import { NextRequest, NextResponse } from 'next/server'
import { fetchCowQuote, buildCowLimitOrder, cowOrderAction, describeCowOrder } from '@/lib/cow'
import { buildSignableArtifact } from '@/lib/transaction-layer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/cow/quote — the reference "safe transaction building" step: turn a
// swap request into a real CoW quote + the EIP-712 order to sign. No signing,
// no spend here (that's A3 guardrails + A4 sign/submit). Body:
//   { sellToken, buyToken, sellAmount, from, chainId?, receiver?,
//     mode?: 'swap' | 'limit', buyAmountAtLeast? }
// sellToken/buyToken accept a symbol (USDC, WETH…) or a 0x address; amounts
// are in token atoms (base units). mode 'limit' skips the quote — the user
// names the price via buyAmountAtLeast and the order waits for a fill.
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

  try {
    const quote =
      mode === 'limit'
        ? buildCowLimitOrder({ chainId, sellToken, buyToken, sellAmount, buyAmountAtLeast, from, receiver })
        : await fetchCowQuote({ chainId, sellToken, buyToken, sellAmountBeforeFee: sellAmount, from, receiver })
    // The summary is the approval surface — human token units, never atoms.
    const summary = describeCowOrder(quote, mode)
    const action = cowOrderAction(quote, summary)
    const artifact = buildSignableArtifact(action)

    return NextResponse.json({
      mode,
      quote: quote.order,
      quoteId: quote.quoteId,
      summary,
      // The signable payload (A4 signs this; A3 will gate it first).
      artifact,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Quote failed.'
    // Unknown token / bad amounts / same-pair are user errors (400); anything else 502.
    const userError = /Unknown (sell|buy) token|must be a positive|not configured|must differ|wallet address/.test(msg)
    return NextResponse.json({ error: msg }, { status: userError ? 400 : 502 })
  }
}
