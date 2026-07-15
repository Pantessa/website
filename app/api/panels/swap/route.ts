// ─────────────────────────────────────────────────────────────────────────
//  POST /api/panels/swap — quote + build a guarded swap for the App Mode
//  swap panel.
//
//  The panel is a structured face on the SAME native swap layer chat uses:
//  identical venue cascade (Uniswap v3 → v4 fallback when the chain pins it
//  → LiFi settlement for venue-gated pools), identical builders, identical
//  guardrails, identical txChain artifact (SendTxChain renders it in the
//  panel exactly as it would in the transcript). Deterministic build,
//  nothing signed or submitted — the wallet signature is the approval.
//  This route must NEVER grow its own quoting or calldata logic.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { buildUniswapSwap, NoV3PoolError, type UniswapBuilt } from '@/lib/uniswap-venue'
import { buildUniswapV4Swap, NoV4PoolError, GatedV4PoolError } from '@/lib/uniswap-v4'
import { buildLifiSwap, NoLifiRouteError } from '@/lib/lifi-venue'
import { ensureTokenList } from '@/lib/token-list'
import { sanitizeChainId, chainById, DEFAULT_CHAIN_ID } from '@/lib/chains'

interface PanelSwapOk {
  ok: true
  txChain: {
    summary: string
    steps: { label: string; title: string; tx: unknown; validUntil?: number }[]
    refresh: { kind: string; stepIndex: number; params: Record<string, string> }
  }
  buildPath: string
  summary: string
  /** Human "~expected out" parsed from the builder summary (display only —
   *  the binding number is minReceived, enforced by calldata). */
  expectedOut: string | null
  minReceived: string | null
  warns: string[]
  guardrails: unknown
}

/** "… → ~0.004718 NVDA via …" → "0.004718"; "min received 0.004694" → same. */
function parseSummaryNums(summary: string): { expectedOut: string | null; minReceived: string | null } {
  const exp = summary.match(/→ ~([0-9][0-9.,]*)/)
  const min = summary.match(/min received ([0-9][0-9.,]*)/)
  return { expectedOut: exp?.[1] ?? null, minReceived: min?.[1] ?? null }
}

const blockedOf = (guardrails: { checks: { ok: boolean; level: string; note: string }[] }) =>
  guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ') || 'a safety check failed'
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

  const refreshParams = { sellToken, buyToken, amountHuman, chainId: String(chainId) }
  try {
    await ensureTokenList(chainId)
    const sell = sellToken.toUpperCase()
    const buy = buyToken.toUpperCase()

    // ── Uniswap v3 (the default panel venue on every first-class chain) ────
    let uni: UniswapBuilt | null = null
    try {
      uni = await buildUniswapSwap({ sellToken, buyToken, amountHuman, from, chainId })
    } catch (err) {
      if (!(err instanceof NoV3PoolError && chain.uniswapV4)) throw err
    }
    if (uni) {
      if (uni.blocked) {
        return NextResponse.json({ blocked: true, blockKind: 'policy', reasons: blockedOf(uni.guardrails), guardrails: uni.guardrails })
      }
      const steps = uni.approveTx
        ? [
            { label: 'approve', title: `Approve ${sell} to Uniswap's SwapRouter02`, tx: uni.approveTx },
            { label: 'swap', title: `Swap ${amountHuman} ${sell} → ${buy}`, tx: uni.swapTx, validUntil: uni.validUntil },
          ]
        : [{ label: 'swap', title: `Swap ${amountHuman} ${sell} → ${buy}`, tx: uni.swapTx, validUntil: uni.validUntil }]
      const res: PanelSwapOk = {
        ok: true,
        txChain: {
          summary: uni.summary,
          steps,
          refresh: { kind: 'uniswap-swap', stepIndex: steps.length - 1, params: refreshParams },
        },
        buildPath: 'native-swap-uniswap',
        summary: uni.summary,
        ...parseSummaryNums(uni.summary),
        warns: warnsOf(uni.guardrails),
        guardrails: uni.guardrails,
      }
      return NextResponse.json(res)
    }

    // ── v4 fallback (chain pins it; tokenized-stock pools live there) ──────
    try {
      const v4 = await buildUniswapV4Swap({ sellToken, buyToken, amountHuman, from, chainId })
      if (v4.blocked) {
        return NextResponse.json({ blocked: true, blockKind: 'policy', reasons: blockedOf(v4.guardrails), guardrails: v4.guardrails })
      }
      const res: PanelSwapOk = {
        ok: true,
        txChain: {
          summary: v4.summary,
          steps: v4.steps,
          refresh: { kind: 'uniswap-v4-swap', stepIndex: v4.steps.length - 1, params: refreshParams },
        },
        buildPath: 'native-swap-uniswap-v4',
        summary: v4.summary,
        ...parseSummaryNums(v4.summary),
        warns: warnsOf(v4.guardrails),
        guardrails: v4.guardrails,
      }
      return NextResponse.json(res)
    } catch (err) {
      if (err instanceof NoV4PoolError) {
        return NextResponse.json({ blocked: true, blockKind: 'execution', reasons: `No Uniswap v3 or v4 pool on ${chain.name} can fill ${sell} → ${buy} for this amount.` })
      }
      if (!(err instanceof GatedV4PoolError)) throw err
      // Venue-gated pool (quotes but a direct call can't fill) → LiFi wraps
      // the chain's own settlement venue. Same order as chat.
      const lifi = await buildLifiSwap({ sellToken, buyToken, amountHuman, from, chainId })
      if (lifi.blocked) {
        return NextResponse.json({ blocked: true, blockKind: 'policy', reasons: blockedOf(lifi.guardrails), guardrails: lifi.guardrails })
      }
      const res: PanelSwapOk = {
        ok: true,
        txChain: {
          summary: lifi.summary,
          steps: lifi.steps,
          refresh: { kind: 'lifi-swap', stepIndex: lifi.swapStepIndex, params: refreshParams },
        },
        buildPath: 'native-swap-lifi',
        summary: lifi.summary,
        ...parseSummaryNums(lifi.summary),
        warns: warnsOf(lifi.guardrails),
        guardrails: lifi.guardrails,
      }
      return NextResponse.json(res)
    }
  } catch (err) {
    if (err instanceof NoLifiRouteError) {
      return NextResponse.json({ blocked: true, blockKind: 'execution', reasons: `This pair only settles through the chain's own venue, and LiFi couldn't route it either — nothing was built.` })
    }
    const msg = err instanceof Error ? err.message : 'quote failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
