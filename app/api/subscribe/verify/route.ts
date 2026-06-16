import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { sendEmail, WELCOME_EMAIL } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Confirm a signup from the emailed link. Flips the row to `verified`, sends a
 * best-effort welcome email, and redirects back to the landing page with a
 * status flag the form reads. A bad/used token redirects with `?subscribed=invalid`.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const origin = req.nextUrl.origin

  const row = token ? await prisma.subscriber.findUnique({ where: { token } }) : null
  if (!row) {
    return NextResponse.redirect(`${origin}/?subscribed=invalid`)
  }

  if (row.status !== 'verified') {
    await prisma.subscriber.update({
      where: { id: row.id },
      data: { status: 'verified', verifiedAt: new Date() },
    })
    await sendEmail({ to: row.email, subject: WELCOME_EMAIL.subject, html: WELCOME_EMAIL.html })
  }

  return NextResponse.redirect(`${origin}/?subscribed=1`)
}
