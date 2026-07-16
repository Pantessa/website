// ─────────────────────────────────────────────────────────────────────────
//  POST /api/panels/swap — quote + build a guarded swap for the App Mode
//  swap panel.
//
//  The panel is a structured face on the SAME native swap layer chat uses:
//  identical venue cascade (Uniswap v3 → v4 fallback when the chain pins it
//  → LiFi settlement for venue-gated pools), identical builders, identical
//  guardrails, identical txChain artifact (SendTxChain renders it in the
//  panel exactly as it would in the transcript). The cascade itself lives
//  in lib/swap-exec.ts (shared with the jobs runner) — this route must
//  NEVER grow its own quoting or calldata logic.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { buildGuardedSwap } from '@/lib/swap-exec'
import { sanitizeChainId, chainById, DEFAULT_CHAIN_ID } from '@/lib/chains'

/** "… → ~0.004718 NVDA via …" → "0.004718"; "min received 0.004694" → same. */
function parseSummaryNums(summary: string): { expectedOut: string | null; minReceived: string | null } {
  const exp = summary.match(/→ ~([0-9][0-9.,]*)/)
  const min = summary.match(/min received ([0-9][0-9.,]*)/)
  return { expectedOut: exp?.[1] ?? null, minReceived: min?.[1] ?? null }
}

const warnsOf = (guardrails: { checks: { ok: boolean; level: string; note: string }[] }) =>
  guardrails.checks.filter((c) => !c.ok && c.level === 'warn').map((c) => c.note)

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const from = typeof body.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.from) ? body.from : null
  const sellToken = typeof body.sellToken === 'string' ? body.sellToken.trim().slice(0, 64) : ''
  const buyToken = typeof body.buyToken === 'string' ? body.buyToken.trim().slice(0, 64) : ''
  const amountHuman =
    typeof body.amountHuman === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(body.amountHuman.trim())
      ? body.amountHuman.trim()
      : ''
  const chainId = sanitizeChainId(Number(body.chainId)) ?? DEFAULT_CHAIN_ID
  const chain = chainById(chainId)
  if (!from || !sellToken || !buyToken || !amountHuman || !chain) {
    return NextResponse.json({ error: 'missing/invalid from, sellToken, buyToken, amountHuman or chainId' }, { status: 400 })
  }

  try {
    const built = await buildGuardedSwap({ sellToken, buyToken, amountHuman, from, chainId })
    if (!built.ok) {
      return NextResponse.json({ blocked: true, blockKind: built.blockKind, reasons: built.reasons, ...(built.guardrails ? { guardrails: built.guardrails } : {}) })
    }
    return NextResponse.json({
      ok: true,
      txChain: built.txChain,
      buildPath: built.buildPath,
      summary: built.summary,
      ...parseSummaryNums(built.summary),
      warns: warnsOf(built.guardrails),
      guardrails: built.guardrails,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'quote failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
