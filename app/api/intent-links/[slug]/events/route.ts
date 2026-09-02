import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { EVENT_KINDS, INTENT_SLUG_RE, type IntentEventKind } from '@/lib/intent-links'
import { fireIntentWebhook } from '@/lib/broker-exec'
import { isInternalRun } from '@/lib/internal-run'
import { extractTxHash, verifyEventNow } from '@/lib/link-receipt-verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Best-effort funnel events from the /i runtime (POST, unauthenticated —
 * the visitor has no session yet at 'open'). kind: open|connect|built|signed|settled.
 *
 * Scope note: these power the CREATOR'S per-link funnel only. valueUsd here
 * is client-reported and never feeds the global money-moved metric — that
 * stays guardrail-priced server-side in embed_turns (#478).
 *
 * RECEIPT VERIFICATION (security 2026-09-01): a signed/settled event no
 * longer fires consequences on its own word. The beacon carries the tx
 * hash + chain; the server verifies the receipt on-chain against the
 * link's own built-artifact expectations (lib/receipt-verify — threat
 * model T-R1..T-R7). Unverifiable → stored `unverified`, NOTHING fires;
 * a lazy re-check (broker_status polls, later events) fires the deferred
 * webhook when the chain answers. Legacy rows (verification NULL) keep
 * counting — only new events enter the fail-closed regime.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!INTENT_SLUG_RE.test(slug)) return NextResponse.json({ error: 'Bad slug.' }, { status: 400 })

  let body: { kind?: string; wallet?: string; valueUsd?: number; variant?: number; txHash?: string; txUrl?: string; chainId?: number; internalRun?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const kind = body.kind as IntentEventKind
  if (!EVENT_KINDS.includes(kind)) return NextResponse.json({ error: 'Bad kind.' }, { status: 400 })

  const link = await prisma.intentLink.findUnique({ where: { id: slug }, select: { id: true, revoked: true, expiresAt: true } })
  if (!link || link.revoked) return NextResponse.json({ error: 'Unknown link.' }, { status: 404 })
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return NextResponse.json({ error: 'Link expired.' }, { status: 404 })

  const wallet = typeof body.wallet === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.wallet) ? body.wallet.toLowerCase() : null
  const valueUsd =
    (kind === 'built' || kind === 'signed' || kind === 'settled') && typeof body.valueUsd === 'number' && isFinite(body.valueUsd) && body.valueUsd >= 0 && body.valueUsd < 10_000_000
      ? body.valueUsd
      : null

  // Which A/B phrasing the visit was served (0 = base ask). Client-reported
  // like everything here — clamped to the plausible range, junk dropped.
  const variant =
    typeof body.variant === 'number' && Number.isInteger(body.variant) && body.variant >= 0 && body.variant <= 8
      ? body.variant
      : null

  const decisive = kind === 'signed' || kind === 'settled'
  const txHash = decisive ? extractTxHash(body.txHash ?? body.txUrl) : null
  const chainId =
    decisive && typeof body.chainId === 'number' && Number.isInteger(body.chainId) && body.chainId > 0 ? body.chainId : null

  const row = await prisma.intentLinkEvent.create({
    data: {
      slug,
      kind,
      wallet,
      valueUsd,
      variant,
      txHash,
      chainId,
      // Decisive events start fail-closed; verification below may promote
      // them in-line. Funnel-only kinds (open/connect/built) stay NULL —
      // they fire nothing and the arc reads them as legacy-equivalent.
      verification: decisive ? 'unverified' : null,
      // Our own harness/drill beacon — the GTM arc's arrival hygiene.
      isInternal: isInternalRun(req.headers, body),
    },
  })

  let verification: string | null = decisive ? 'unverified' : null
  if (decisive) {
    // Inline verification, timeboxed — a slow RPC leaves the row
    // 'unverified' for the lazy re-check rather than hanging the beacon.
    try {
      verification = await Promise.race([
        verifyEventNow(row.id),
        new Promise<'unverified'>((r) => setTimeout(() => r('unverified'), 4000)),
      ])
    } catch {
      verification = 'unverified'
    }
    // The agent-desk push channel (M3): fires ONLY on a counted verdict
    // (verified/attested — D3 in the second-manager contract: no more
    // provisional webhooks). An unverified event fires later, from the
    // lazy re-check, if the chain confirms it.
    if (verification === 'verified' || verification === 'attested') {
      void fireIntentWebhook(slug, kind as 'signed' | 'settled', valueUsd)
    }
  }

  return NextResponse.json({ ok: true, ...(decisive ? { verification } : {}) })
}
