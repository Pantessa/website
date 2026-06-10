import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { generateKey } from '@/lib/api-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_KEYS_PER_OWNER = 20

// List the signed-in wallet's API keys. Never returns secrets or hashes —
// just enough to recognize and revoke ("yf_a1b2c3d4…, last used Tuesday").
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const keys = await prisma.apiKey.findMany({
    where: { ownerAddress: addr },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, prefix: true, lastUsedAt: true, createdAt: true },
  })
  return NextResponse.json(keys)
}

// Mint a key. SIWE-gated: only a wallet that proved itself in the browser can
// create headless credentials. The plaintext appears in this response ONLY.
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const count = await prisma.apiKey.count({ where: { ownerAddress: addr } })
  if (count >= MAX_KEYS_PER_OWNER) {
    return NextResponse.json(
      { error: `Key limit reached (${MAX_KEYS_PER_OWNER}). Revoke one first.` },
      { status: 400 },
    )
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 80)
      : 'API key'

  const { secret, hash, prefix } = generateKey()
  const key = await prisma.apiKey.create({
    data: { ownerAddress: addr, label, hash, prefix },
    select: { id: true, label: true, prefix: true, createdAt: true },
  })
  return NextResponse.json({ ...key, secret }, { status: 201 })
}
