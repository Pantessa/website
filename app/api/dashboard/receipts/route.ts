import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/dashboard/receipts — the per-transaction EARN feed with its on-chain
// verification check (P0). Wallet-scoped to the MCPs you operate; admins can
// pass ?all=1 to watch every receipt verify (for testing). Each row carries the
// `verified` state set by lib/receipt-verify.ts: true = a USDC transfer to the
// MCP's payTo backing the claim was found on-chain; false = the chain
// contradicts the claim; null = nothing to check (no txHash) or not checked yet.
export async function GET(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })

  const admin = isAdminAddress(addr)
  const all = admin && new URL(req.url).searchParams.get('all') === '1'

  const receipts = await prisma.mcpReceipt.findMany({
    where: all ? {} : { ownerAddress: addr },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      mcpSlug: true,
      ownerAddress: true,
      amountUsd: true,
      payer: true,
      tool: true,
      network: true,
      txHash: true,
      verified: true,
      verifiedAt: true,
      createdAt: true,
    },
  })

  const slugs = [...new Set(receipts.map((r) => r.mcpSlug))]
  const servers = slugs.length
    ? await prisma.mcpServer.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true, receiver: true } })
    : []
  const meta = new Map(servers.map((s) => [s.slug, s]))

  const rows = receipts.map((r) => ({
    ...r,
    mcpName: meta.get(r.mcpSlug)?.name ?? r.mcpSlug,
    receiver: meta.get(r.mcpSlug)?.receiver ?? null,
  }))

  const summary = {
    total: rows.length,
    verified: rows.filter((r) => r.verified === true).length,
    flagged: rows.filter((r) => r.verified === false).length,
    pending: rows.filter((r) => r.verified === null || r.verified === undefined).length,
  }

  return NextResponse.json({ rows, summary, admin, scope: all ? 'all' : 'mine' })
}
