import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { generateEmbedKey } from '@/lib/embed-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_EMBED_KEYS_PER_OWNER = 10

// List the wallet's embed keys WITH their sighted sites. Embed keys are
// public identifiers, so unlike /api/keys the full key is always returned —
// the dashboard needs it for the copy-paste snippet.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const keys = await prisma.embedKey.findMany({
    where: { ownerAddress: addr, revoked: false },
    orderBy: { createdAt: 'desc' },
    select: { id: true, key: true, label: true, createdAt: true },
  })
  const sites = await prisma.embedSite.findMany({
    where: { embedKeyId: { in: keys.map((k) => k.id) } },
    orderBy: { lastSeen: 'desc' },
    select: { embedKeyId: true, origin: true, pageUrl: true, turns: true, firstSeen: true, lastSeen: true },
  })
  return NextResponse.json({
    keys: keys.map((k) => ({
      ...k,
      sites: sites.filter((s) => s.embedKeyId === k.id).map(({ embedKeyId, ...s }) => s),
    })),
  })
}

// Mint an embed key. SIWE-gated; the key is public by design so it comes
// back on every GET too (no show-once dance).
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const count = await prisma.embedKey.count({ where: { ownerAddress: addr, revoked: false } })
  if (count >= MAX_EMBED_KEYS_PER_OWNER) {
    return NextResponse.json(
      { error: `Embed key limit reached (${MAX_EMBED_KEYS_PER_OWNER}). Revoke one first.` },
      { status: 400 },
    )
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const label =
    typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : 'Embed key'

  const row = await prisma.embedKey.create({
    data: { ownerAddress: addr, key: generateEmbedKey(), label },
    select: { id: true, key: true, label: true, createdAt: true },
  })
  return NextResponse.json({ ...row, sites: [] }, { status: 201 })
}
