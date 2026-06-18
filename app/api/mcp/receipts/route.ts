import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getBearerKey } from '@/lib/api-key'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_AMOUNT_USD = 1_000 // a reported receipt is a record, not a payment — cap nonsense

// POST /api/mcp/receipts — the EARN-side ingestion target, mirroring the payer
// side's grant ledger sync. An MCP reports each paid call it served so its
// operator sees usage + revenue in the dashboard. Auth: `Authorization: Bearer
// yf_…` (the MCP's key) — or a SIWE session, for the owner to backfill/test. The
// reporting wallet MUST own the reported `mcp` slug (it claimed it), so an MCP
// can only report its own earnings. Self-reported telemetry; on-chain receiver
// activity is the trust layer.
export async function POST(req: NextRequest) {
  const session = await getSessionAddress()
  const key = session ? null : await getBearerKey(req)
  const addr = session ?? key?.ownerAddress ?? null
  if (!addr) return NextResponse.json({ error: 'Sign in or pass a Bearer API key.' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const mcp = typeof body.mcp === 'string' ? body.mcp.trim() : ''
  if (!mcp) return NextResponse.json({ error: 'mcp (your server slug) is required.' }, { status: 400 })

  // Ownership: the reporting wallet must have claimed this MCP.
  const owner = await prisma.mcpOwner.findUnique({ where: { mcpSlug: mcp } })
  if (!owner) {
    return NextResponse.json(
      { error: `MCP "${mcp}" isn't claimed yet — claim it in your dashboard first.` },
      { status: 404 },
    )
  }
  if (owner.ownerAddress !== addr) {
    return NextResponse.json({ error: 'This MCP is claimed by another wallet.' }, { status: 403 })
  }

  const amountUsd = Number(body.amountUsd)
  if (!(amountUsd >= 0) || amountUsd > MAX_AMOUNT_USD) {
    return NextResponse.json({ error: `amountUsd must be 0–${MAX_AMOUNT_USD}.` }, { status: 400 })
  }

  const str = (v: unknown, max = 200): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t ? t.slice(0, max) : null
  }

  const receipt = await prisma.mcpReceipt.create({
    data: {
      mcpSlug: mcp,
      ownerAddress: addr,
      payer: str(body.payer)?.toLowerCase() ?? null,
      amountUsd,
      tool: str(body.tool),
      network: str(body.network, 40),
      txHash: str(body.txHash, 80),
      apiKeyId: key?.id ?? null,
    },
    select: { id: true, createdAt: true },
  })

  return NextResponse.json({ ok: true, id: receipt.id, recordedAt: receipt.createdAt }, { status: 201 })
}
