import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { emailEnabled, sendEmail } from '@/lib/email'
import { clientIpFrom, hashIp } from '@/lib/turn-limits'
import { PILOT_LIMIT_MAX, PILOT_LIMIT_WINDOW_MS, PILOT_SOURCE, PILOT_TO, WindowLimiter, isTestAddress, parsePilotBody, pilotEmail } from './pilot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/desk/pilot — the pilot-request door behind /desk (squad
// five-million, DESKPAGE lane, 2026-11-03). Validates, rate-limits per
// platform-stamped IP (the IP itself never lands anywhere: the DB keeps the
// salted hash prefix lib/turn-limits already uses), stores one
// desk_pilot_requests row, mails hello@ when mail is configured (reply-to =
// the requester, so answering is one reply), and says `{ ok: true }` — the
// page then says "We answer within a day." A filled honeypot answers the same
// 200 and stores nothing. No cookie, no wallet, nothing read from a session.

const limiter = new WindowLimiter(PILOT_LIMIT_MAX, PILOT_LIMIT_WINDOW_MS)

export async function POST(req: NextRequest) {
  // Loopback has no platform IP to key on (local drives, the harness); every
  // real request on Vercel carries one.
  const ip = clientIpFrom(req.headers)
  const ipHash = ip ? hashIp(ip) : null
  if (ipHash) {
    const gate = limiter.hit(ipHash)
    if (!gate.ok) {
      return NextResponse.json(
        { error: `Too many requests from this network. Try again in an hour, or write to ${PILOT_TO}.` },
        { status: 429, headers: { 'retry-after': String(Math.ceil((gate.resetAt - Date.now()) / 1000)) } },
      )
    }
  }

  const body = await req.json().catch(() => null)
  const parsed = parsePilotBody(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (parsed.honeypot) return NextResponse.json({ ok: true })
  const v = parsed.value

  try {
    await prisma.deskPilotRequest.create({
      data: { email: v.email, name: v.name, firm: v.firm, custody: v.custody, venues: v.venues || null, notes: v.trades || null, source: PILOT_SOURCE, ipHash },
    })
  } catch (e) {
    console.warn(`[desk pilot] store failed: ${(e as Error).message}`)
    return NextResponse.json({ error: `Could not record the request. Write to ${PILOT_TO} and we will take it from there.` }, { status: 500 })
  }

  // Best-effort, and never for a reserved test address (the pins post from one).
  if (emailEnabled() && !isTestAddress(v.email)) {
    const m = pilotEmail(v, new Date().toISOString())
    await sendEmail({ to: PILOT_TO, subject: m.subject, html: m.html, text: m.text, replyTo: v.email })
  }

  return NextResponse.json({ ok: true })
}
