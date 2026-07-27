import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { normalizeHandle } from '@/lib/intent-links'

// The creator's public page name (/l/<handle>) — opt-in by claiming here.
// One handle per wallet; renames release the old name atomically. The
// storefront page is keyed by handle only, never by wallet.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const row = await prisma.creatorHandle.findUnique({ where: { creator: addr.toLowerCase() } })
  const brand =
    row && (row.brandDomain || row.brandLogo || row.brandAccent)
      ? { domain: row.brandDomain, name: row.brandName, logo: row.brandLogo, accent: row.brandAccent }
      : null
  return NextResponse.json({ handle: row?.handle ?? null, brand })
}

export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in to claim your page name.' }, { status: 401 })
  const creator = addr.toLowerCase()

  let body: { handle?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const handle = normalizeHandle(String(body.handle ?? ''))
  if (!handle) {
    return NextResponse.json(
      { error: 'Handles are 3–20 characters of a–z, 0–9, and hyphens (no edge hyphens), and can’t shadow a Yeetful page.' },
      { status: 400 },
    )
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.creatorHandle.deleteMany({ where: { creator } })
      await tx.creatorHandle.create({ data: { handle, creator } })
    })
  } catch (e) {
    const taken = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
    // Point at the live page: if the "someone" is the claimer's other wallet
    // (a real support case), the link is exactly how they rediscover it.
    if (taken)
      return NextResponse.json(
        { error: `@${handle} is taken — its page is live — try another name.`, url: `/l/${handle}` },
        { status: 409 },
      )
    throw e
  }
  return NextResponse.json({ handle, url: `/l/${handle}` })
}

export async function DELETE(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  await prisma.creatorHandle.deleteMany({ where: { creator: addr.toLowerCase() } })
  return NextResponse.json({ ok: true })
}
