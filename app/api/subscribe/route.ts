import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import prisma from '@/lib/db'
import { emailEnabled, sendEmail, verifyEmailHtml } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Landing-page "stay up to date" signup. Double opt-in: store the address as
 * `pending` with a one-time token and email a confirm link. Idempotent by email
 * — re-subscribing a pending address just re-issues the token + resends. The
 * row only becomes `verified` when the link is clicked (that confirms the email
 * is real). Sending is best-effort; the signup is recorded regardless.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  }

  const existing = await prisma.subscriber.findUnique({ where: { email } })
  if (existing?.status === 'verified') {
    return NextResponse.json({ ok: true, status: 'verified', already: true })
  }

  const token = randomBytes(24).toString('hex')
  const row = existing
    ? await prisma.subscriber.update({ where: { email }, data: { token } })
    : await prisma.subscriber.create({ data: { email, token } })

  const { subject, html } = verifyEmailHtml(row.token)
  const sent = await sendEmail({ to: email, subject, html })

  return NextResponse.json(
    {
      ok: true,
      status: 'pending',
      // When email isn't configured the row is stored but no confirm link goes
      // out — the UI tells the user honestly.
      emailSent: sent,
      emailConfigured: emailEnabled(),
    },
    { status: 201 },
  )
}
