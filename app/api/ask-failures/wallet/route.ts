import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { bumpAndCheckBrokerCall, clientIpFrom } from '@/lib/turn-limits'
import { WALLET_REFUSAL_KIND, isReportableWalletError } from '@/lib/wallet-refusal'
import { isInternalRun } from '@/lib/internal-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The wallet-refusal beacon (lib/wallet-refusal.ts): a built + guarded
// artifact the WALLET refused to sign becomes an ask_failures row — kind
// `wallet-refused`, had_funds TRUE (the money was there; the wallet was the
// wall), reply = the wallet's own words, prompt = what we asked it to sign.
// Public + self-reported by design (it runs in every browser), so inputs are
// clamped, human rejections are dropped, the harness opts out with
// x-yf-no-ask-log, and a bad beacon is a 202, never an error.

const cap = (v: unknown, n: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
const ARTIFACTS = new Set(['hl-order', 'hl-leverage', 'hl-agent', 'cow-order', 'tx', 'tx-chain', 'vote', 'opensea-listing'])

export async function POST(req: NextRequest) {
  if (req.headers.get('x-yf-no-ask-log') === '1') {
    return NextResponse.json({ ok: true, skipped: 'internal' }, { status: 202 })
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  // Internal-run drills (lib/internal-run.ts) still write — STAMPED, so the
  // matrix drill's refusals are visible under the dashboard's internal
  // toggle but never read as a stranger's wall.
  const internalRun = isInternalRun(req.headers, body)
  const artifact = typeof body.artifact === 'string' && ARTIFACTS.has(body.artifact) ? body.artifact : null
  const detail = cap(body.detail, 400)
  const ask = cap(body.ask, 300)
  const wallet = typeof body.wallet === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.wallet) ? body.wallet.toLowerCase() : null
  if (!artifact || !detail || !ask) return NextResponse.json({ ok: false, dropped: 'shape' }, { status: 202 })
  if (!isReportableWalletError(detail)) return NextResponse.json({ ok: true, skipped: 'rejection' }, { status: 202 })
  if (await bumpAndCheckBrokerCall(clientIpFrom(req.headers))) return NextResponse.json({ ok: false, dropped: 'rate' }, { status: 202 })

  const connector = cap(body.connector, 40)
  const chainId = typeof body.chainId === 'number' && Number.isFinite(body.chainId) ? Math.floor(body.chainId) : null
  const valueUsd = typeof body.valueUsd === 'number' && Number.isFinite(body.valueUsd) && body.valueUsd > 0 ? Math.round(body.valueUsd * 100) / 100 : null
  const buildPath = cap(body.buildPath, 60)
  try {
    const row = await prisma.askFailure.create({
      data: {
        wallet,
        prompt: `[${artifact}] ${ask}`,
        reply: detail,
        kind: WALLET_REFUSAL_KIND,
        buildPath,
        hadFunds: true,
        fundsUsd: valueUsd,
        fundsDetail: `wallet refused at signing${connector ? ` · ${connector}` : ''}${chainId ? ` · wallet on chain ${chainId}` : ''} — the artifact was built and guarded; the wallet was the wall.`,
        isInternal: internalRun,
      },
      select: { id: true },
    })
    return NextResponse.json({ ok: true, id: row.id, ...(internalRun ? { internal: true } : {}) }, { status: 202 })
  } catch {
    return NextResponse.json({ ok: false, dropped: 'store' }, { status: 202 })
  }
}
