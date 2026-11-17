// The plan ticket: phase 2 of a wallet-paid chat turn runs only the plan
// phase 1 produced.
//
// A wallet-paid turn is two requests. Phase 1 (`POST /api/chat`) passes the
// turn fence and the answer gate, plans the calls and returns them for the
// wallet to sign. Phase 2 (`phase: 'execute'`) carries the plan BACK from the
// browser with the signatures and runs it: it fetches each data call's URL
// and asks the synthesizer. Until 2026-11-17 phase 2 trusted that echoed plan
// outright - it ran before the fence and the gate, so the URLs it fetched and
// the house answer it produced were whatever the request body said.
//
// Now phase 1 signs what it planned (HMAC under SESSION_SECRET over the
// message, the history, the capabilities text and the plan, with an expiry)
// and phase 2 refuses a body whose ticket does not verify. The server only
// ever executes a plan it wrote itself, for the turn it admitted.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** Long enough to read the payment heads-up and sign; short enough that a
 *  ticket is not a standing pass. */
export const PLAN_TICKET_TTL_MS = 10 * 60 * 1000

export interface PlanTicketInput {
  message: string
  history: unknown
  capabilities: string
  plan: unknown
}

function secret(): string | null {
  const s = process.env.SESSION_SECRET
  return s && s.length >= 16 ? s : null
}

/** What the ticket binds. JSON round-trips the values first so the digest of
 *  what the server planned equals the digest of the same values after the
 *  browser parsed and re-sent them (undefined fields drop on both sides). */
export function planDigest(i: PlanTicketInput): string {
  const canon = JSON.stringify(JSON.parse(JSON.stringify([i.message, i.history ?? [], i.capabilities, i.plan ?? []])))
  return createHash('sha256').update(canon).digest('hex')
}

const mac = (key: string, digest: string, exp: number) => createHmac('sha256', key).update(`plan-ticket:v1:${exp}:${digest}`).digest('hex')

/** Sign a plan. Null when no secret is configured: phase 2 then refuses,
 *  which is the safe side. */
export function signPlanTicket(i: PlanTicketInput, now: number = Date.now(), key: string | null = secret()): string | null {
  if (!key) return null
  const exp = Math.floor((now + PLAN_TICKET_TTL_MS) / 1000)
  return `v1.${exp}.${mac(key, planDigest(i), exp)}`
}

/** Does `ticket` vouch for exactly this message, history, capabilities and
 *  plan, unexpired? Any doubt is a no. */
export function verifyPlanTicket(ticket: unknown, i: PlanTicketInput, now: number = Date.now(), key: string | null = secret()): boolean {
  if (!key || typeof ticket !== 'string') return false
  const m = /^v1\.(\d{1,12})\.([0-9a-f]{64})$/.exec(ticket)
  if (!m) return false
  const exp = Number(m[1])
  if (!(exp * 1000 > now) || exp * 1000 > now + PLAN_TICKET_TTL_MS + 60_000) return false
  let want: string
  try {
    want = mac(key, planDigest(i), exp)
  } catch {
    return false
  }
  const a = Buffer.from(want)
  const b = Buffer.from(m[2])
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The reply a refused phase 2 carries (a stale tab, an expired heads-up, or
 *  a body nobody planned). Pure ASCII. */
export const PLAN_TICKET_REFUSAL = 'That payment request is no longer valid, so nothing was paid and nothing ran. Send the message again to get a fresh one.'
