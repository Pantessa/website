// lib/visitor-id.ts — who is this, without a cookie.
//
// The journey log needs to say "these twelve events were one person" and must
// not plant an identifier on anyone's device to do it. So the id is derived on
// the server, per request: sha256(today's salt · IP · user agent). Same
// browser, same network, same day → same id; tomorrow it is a different one.
//
// The salt is random, lives in visitor_salts, and is deleted once it is two
// days old. After that the ids in the log can't be recomputed from an IP
// address by anyone, us included — which is the difference between this and
// hashing with a secret we keep forever (an IPv4 space is 2^32 guesses).
//
// `net` is the same hash over the IP alone. It answers one question on the
// flows screen: did this visit come from the network an admin was signed in
// on that day? That is how a founder's phone and headless drivers stop
// reading as strangers without anyone maintaining a list.

import { createHash, randomBytes } from 'node:crypto'
import { clientIpFrom } from '@/lib/turn-limits'

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10)

/** Pure: the id for one (salt, ip, ua). Exported so the harness can pin that
 *  it rotates with the salt and never contains the address. */
export function visitorIdOf(salt: string, ip: string, ua: string): string {
  return createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex').slice(0, 16)
}

/** Pure: the network-only twin. */
export function networkIdOf(salt: string, ip: string): string {
  return createHash('sha256').update(`${salt}|net|${ip}`).digest('hex').slice(0, 12)
}

let cached: { day: string; salt: string } | null = null

/** Today's salt: minted by whichever request gets there first, then read by
 *  everyone. Cached per lambda instance for the day. */
async function saltFor(day: string): Promise<string> {
  if (cached?.day === day) return cached.salt
  const { default: prisma } = await import('@/lib/db')
  const fresh = randomBytes(24).toString('hex')
  await prisma.$executeRaw`INSERT INTO visitor_salts (day, salt) VALUES (${day}, ${fresh}) ON CONFLICT (day) DO NOTHING`
  const rows = await prisma.$queryRaw<{ salt: string }[]>`SELECT salt FROM visitor_salts WHERE day = ${day}`
  const salt = rows[0]?.salt ?? fresh
  cached = { day, salt }
  // Yesterday's salt stays one more day so a visit that crosses midnight can
  // still be read; anything older goes, and takes reversibility with it.
  const keepFrom = utcDay(new Date(Date.now() - 86_400_000))
  void prisma.$executeRaw`DELETE FROM visitor_salts WHERE day < ${keepFrom}`.catch(() => {})
  return salt
}

export interface VisitorIdentity {
  vid: string
  net: string | null
  /** No platform-stamped IP: local dev or the API harness, never a visitor. */
  local: boolean
}

/**
 * The visitor behind a request. Works identically for a browser beacon and
 * for that same browser's POST to /api/chat, which is what lets the server
 * add "asked" and "got a wall" to a timeline the browser started.
 */
export async function visitorFrom(headers: Headers): Promise<VisitorIdentity> {
  const ua = (headers.get('user-agent') ?? '').slice(0, 400)
  const ip = clientIpFrom(headers)
  const salt = await saltFor(utcDay())
  if (!ip) return { vid: `local-${visitorIdOf(salt, 'loopback', ua).slice(0, 10)}`, net: null, local: true }
  return { vid: visitorIdOf(salt, ip, ua), net: networkIdOf(salt, ip), local: false }
}

/** The browser asked not to be tracked (Global Privacy Control or DNT). The
 *  log honors it on both halves: no beacon rows, no server-side ask rows. */
export function optedOut(headers: Headers): boolean {
  return headers.get('sec-gpc') === '1' || headers.get('dnt') === '1'
}
