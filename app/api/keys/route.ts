import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { generateKey } from '@/lib/api-key'
import { agentSpentTodayByKey } from '@/lib/grant-store'
import { requireRole } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_KEYS_PER_OWNER = 20

// List API keys. Never returns secrets or hashes — just enough to recognize
// and revoke ("yf_a1b2c3d4…, last used Tuesday"). `?org=<id>` lists the org's
// shared keys instead of the wallet's personal ones (member+ may view; org
// keys are the org's connected agents, not any one member's).
export async function GET(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const orgId = req.nextUrl.searchParams.get('org')
  if (orgId) {
    const gate = await requireRole(orgId, addr, 'member')
    if (!gate.ok) return NextResponse.json({ error: 'Not found.' }, { status: gate.status })
  }

  const keys = await prisma.apiKey.findMany({
    where: orgId ? { orgId } : { ownerAddress: addr, orgId: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, prefix: true, perDayUsd: true, paused: true, orgId: true, ownerAddress: true, lastUsedAt: true, createdAt: true },
  })
  const spent = await agentSpentTodayByKey(keys.map((k) => k.id))
  return NextResponse.json(
    keys.map(({ ownerAddress, ...k }) => ({
      ...k,
      // For org keys, surface who minted it (members already see each other).
      mintedBy: orgId ? ownerAddress : undefined,
      spentTodayUsd: spent[k.id] ?? 0,
    })),
  )
}

// Mint a key. SIWE-gated: only a wallet that proved itself in the browser can
// create headless credentials. The plaintext appears in this response ONLY.
// Pass `orgId` to mint an org key (admin+): it spends under the org's grant
// and counts against the org's daily cap.
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)

  const orgId = typeof body.orgId === 'string' && body.orgId ? body.orgId : null
  if (orgId) {
    const gate = await requireRole(orgId, addr, 'admin')
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.status === 404 ? 'Not found.' : 'Requires the admin role.' },
        { status: gate.status },
      )
    }
  }

  const count = await prisma.apiKey.count({
    where: orgId ? { orgId } : { ownerAddress: addr, orgId: null },
  })
  if (count >= MAX_KEYS_PER_OWNER) {
    return NextResponse.json(
      { error: `Key limit reached (${MAX_KEYS_PER_OWNER}). Revoke one first.` },
      { status: 400 },
    )
  }

  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 80)
      : 'API key'

  const { secret, hash, prefix } = generateKey()
  const key = await prisma.apiKey.create({
    data: { ownerAddress: addr, orgId, label, hash, prefix },
    select: { id: true, label: true, prefix: true, orgId: true, createdAt: true },
  })
  return NextResponse.json({ ...key, secret }, { status: 201 })
}
