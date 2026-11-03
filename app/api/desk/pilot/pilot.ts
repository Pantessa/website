// The pilot request's pure half (squad five-million, DESKPAGE lane,
// 2026-11-03): the body parser, the honeypot rule, the test-address rule,
// the mail composer and a windowed limiter. No I/O, so the pins script and
// the harness exercise every rule without a server. The route next door
// (route.ts) is the I/O: the limiter instance, the DB row, the send.

export const PILOT_TO = 'hello@pantessa.com'
export const PILOT_SOURCE = 'desk'
export const PILOT_LIMIT_MAX = 10
export const PILOT_LIMIT_WINDOW_MS = 60 * 60 * 1000

export const CUSTODY_VALUES = ['fireblocks', 'copper', 'fordefi', 'safe', 'other'] as const
export type CustodyValue = (typeof CUSTODY_VALUES)[number]

export const PILOT_LIMITS = { name: 120, firm: 160, email: 254, custody: 40, venues: 500, trades: 2000 } as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface PilotInput {
  name: string
  firm: string
  email: string
  custody: string
  venues: string
  trades: string
}

export type PilotParse = { ok: true; value: PilotInput; honeypot: boolean } | { ok: false; error: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
/** One line, trimmed, control characters out, capped. */
const clean = (v: unknown, max: number): string =>
  str(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
const cleanMulti = (v: unknown, max: number): string =>
  str(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max)

/** Parses a request body. A filled `website` field (the honeypot) parses OK
 *  with `honeypot: true` so the route can answer 200 and store nothing. */
export function parsePilotBody(body: unknown): PilotParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Send a JSON body.' }
  const b = body as Record<string, unknown>
  const honeypot = clean(b.website, 200).length > 0
  const email = clean(b.email, PILOT_LIMITS.email + 1).toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > PILOT_LIMITS.email) return { ok: false, error: 'A valid work email is required.' }
  const name = clean(b.name, PILOT_LIMITS.name)
  const firm = clean(b.firm, PILOT_LIMITS.firm)
  if (!name) return { ok: false, error: 'Your name is required.' }
  if (!firm) return { ok: false, error: 'Your firm is required.' }
  const custodyRaw = clean(b.custody, PILOT_LIMITS.custody).toLowerCase()
  const custody = (CUSTODY_VALUES as readonly string[]).includes(custodyRaw) ? custodyRaw : custodyRaw ? 'other' : ''
  if (!custody) return { ok: false, error: 'Choose a custody.' }
  const venues = clean(b.venues, PILOT_LIMITS.venues)
  const trades = cleanMulti(b.trades, PILOT_LIMITS.trades)
  return { ok: true, value: { name, firm, email, custody, venues, trades }, honeypot }
}

/** A requester at a reserved test domain never mails the desk (the pins and
 *  the harness post from one), mirroring lib/email's own undeliverable rule. */
export function isTestAddress(email: string): boolean {
  return /@(?:[^.]+\.)*(?:test|example|invalid|localhost)$/i.test(email) || /@example\.(?:com|org|net)$/i.test(email)
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function pilotSubject(firm: string): string {
  return `Desk pilot request — ${firm}`
}

/** The mail to hello@: the fields, one per line, reply-to the requester. */
export function pilotEmail(v: PilotInput, receivedAtIso: string): { subject: string; text: string; html: string } {
  const rows: [string, string][] = [
    ['Name', v.name],
    ['Firm', v.firm],
    ['Email', v.email],
    ['Custody', v.custody],
    ['Venues', v.venues || '—'],
    ['Trades', v.trades || '—'],
    ['Received', receivedAtIso],
  ]
  const text = [`Desk pilot request — ${v.firm}`, '', ...rows.map(([k, val]) => `${k}: ${val}`), '', 'Reply to this mail to answer them (reply-to is their address).'].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0b0b0c;line-height:1.55">
    <p style="font-size:13px;font-weight:600;letter-spacing:-0.02em;margin:0 0 16px">pantessa · /desk</p>
    <h2 style="margin:0 0 14px">Desk pilot request — ${esc(v.firm)}</h2>
    <table style="border-collapse:collapse;font-size:14px">${rows
      .map(([k, val]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;white-space:pre-wrap">${esc(val)}</td></tr>`)
      .join('')}</table>
    <p style="color:#888;font-size:12px;margin-top:16px">Reply to this mail to answer them.</p>
  </div>`
  return { subject: pilotSubject(v.firm), text, html }
}

/** A fixed window per key, in memory (one serverless instance = one window;
 *  good enough for a form that lands in a mailbox). Pure given `now`. */
export class WindowLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  hit(key: string, now = Date.now()): { ok: boolean; remaining: number; resetAt: number } {
    const cur = this.hits.get(key)
    if (!cur || cur.resetAt <= now) {
      const resetAt = now + this.windowMs
      this.hits.set(key, { count: 1, resetAt })
      if (this.hits.size > 5_000) this.sweep(now)
      return { ok: true, remaining: this.max - 1, resetAt }
    }
    cur.count += 1
    return { ok: cur.count <= this.max, remaining: Math.max(0, this.max - cur.count), resetAt: cur.resetAt }
  }
  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
  }
}
