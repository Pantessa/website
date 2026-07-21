import { NextRequest, NextResponse } from 'next/server'
import {
  parseSiweMessage,
  verifySiweMessage,
  publicClient,
  readNonce,
  clearNonce,
  setSessionCookie,
} from '@/lib/auth'
import prisma from '@/lib/db'
import { VIA_RE } from '@/lib/share-receipts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Verify a signed SIWE message and mint a session.
 * Body: { message: string, signature: 0x... }
 */
export async function POST(req: NextRequest) {
  let body: { message?: string; signature?: `0x${string}` }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const { message, signature } = body
  if (!message || !signature) {
    return NextResponse.json({ error: 'message and signature are required.' }, { status: 400 })
  }

  const parsed = parseSiweMessage(message)
  if (!parsed.address) {
    return NextResponse.json({ error: 'Could not parse SIWE message.' }, { status: 400 })
  }

  // Replay protection: the message nonce must match the one we issued.
  const expectedNonce = await readNonce()
  if (!expectedNonce || parsed.nonce !== expectedNonce) {
    return NextResponse.json({ error: 'Invalid or expired nonce.' }, { status: 422 })
  }

  // Domain binding (anti-phishing): message domain must match this host.
  const host = req.headers.get('host') ?? undefined

  const valid = await verifySiweMessage(publicClient, {
    message,
    signature,
    nonce: expectedNonce,
    domain: host,
  })
  if (!valid) {
    return NextResponse.json({ error: 'Signature verification failed.' }, { status: 401 })
  }

  await setSessionCookie(parsed.address)
  await clearNonce()

  // Share-loop attribution: if this browser landed via a ?via= share link
  // (ViaTracker cookied it), stamp the wallet's arrival — insert-only, first
  // writer wins, so only the FIRST sign-in that carried a via ever records.
  // Fail-soft: attribution must never block a login.
  let stampedVia: string | null = null
  const via = req.cookies.get('yf_via')?.value
  if (via && VIA_RE.test(via)) {
    const landingRaw = req.cookies.get('yf_via_landing')?.value ?? null
    const landing = landingRaw && /^\/[\w\-/.]{0,80}$/.test(landingRaw) ? landingRaw : null
    try {
      const { count } = await prisma.walletArrival.createMany({
        data: [{ address: parsed.address.toLowerCase(), via, landing }],
        skipDuplicates: true,
      })
      if (count === 1) stampedVia = via
    } catch {
      /* attribution is best-effort */
    }
  }

  return NextResponse.json({ address: parsed.address.toLowerCase(), ...(stampedVia ? { via: stampedVia } : {}) })
}
