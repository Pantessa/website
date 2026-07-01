import { NextRequest, NextResponse } from 'next/server'
import { fetchCowQuote, cowOrderAction, resolveToken } from '@/lib/cow'
import { buildSignableArtifact } from '@/lib/transaction-layer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/cow/quote — the reference "safe transaction building" step: turn a
// swap request into a real CoW quote + the EIP-712 order to sign. No signing,
// no spend here (that's A3 guardrails + A4 sign/submit). Body:
//   { sellToken, buyToken, sellAmount, from, chainId?, receiver? }
// sellToken/buyToken accept a symbol (USDC, WETH…) or a 0x address; sellAmount
// is in token atoms (base units).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const sellToken = typeof body.sellToken === 'string' ? body.sellToken : ''
  const buyToken = typeof body.buyToken === 'string' ? body.buyToken : ''
  const sellAmount = typeof body.sellAmount === 'string' ? body.sellAmount : String(body.sellAmount ?? '')
  const from = typeof body.from === 'string' ? body.from : ''
  const chainId = typeof body.chainId === 'number' ? body.chainId : 8453
  const receiver = typeof body.receiver === 'string' ? body.receiver : undefined

  if (!sellToken || !buyToken || !sellAmount) {
    return NextResponse.json(
      { error: 'sellToken, buyToken and sellAmount are required.' },
      { status: 400 },
    )
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(from)) {
    return NextResponse.json({ error: 'A valid `from` wallet address is required.' }, { status: 400 })
  }

  try {
    const quote = await fetchCowQuote({
      chainId,
      sellToken,
      buyToken,
      sellAmountBeforeFee: sellAmount,
      from,
      receiver,
    })
    const sellSym = symbolFor(sellToken)
    const buySym = symbolFor(buyToken)
    const summary = `Swap ${quote.order.sellAmount} ${sellSym} → ~${quote.order.buyAmount} ${buySym} via CoW on chain ${chainId}`
    const action = cowOrderAction(quote, summary)
    const artifact = buildSignableArtifact(action)

    return NextResponse.json({
      quote: quote.order,
      quoteId: quote.quoteId,
      summary,
      // The signable payload (A4 signs this; A3 will gate it first).
      artifact,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Quote failed.'
    // Unknown token / unroutable pair are user errors (400); anything else 502.
    const userError = /Unknown (sell|buy) token|must be a positive|not configured/.test(msg)
    return NextResponse.json({ error: msg }, { status: userError ? 400 : 502 })
  }
}

/** Best-effort human symbol for the summary — the input if it's already a
 *  symbol, else a shortened address. */
function symbolFor(input: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) {
    const addr = resolveToken(input)
    return addr ? `${input.slice(0, 6)}…` : input
  }
  return input.toUpperCase()
}
