// MK2/AI — the per-IP fence on the two model routes. Same bucket table and
// discipline as lib/turn-limits' broker / on-ramp / wallet-send fences
// (own key prefix `a:`, hashed IP, loopback exempt, fail-open), so a loop
// on a public page cannot burn model quota. The cap counts MODEL CALLS,
// not requests: a cached brief costs nothing and is not counted. The
// harness sets `MARKETS_AI_IP_HOURLY_CAP` low on its own server to trip it
// — the same env is how prod would tighten it.

import { clientIpFrom, hashIp, hourStartUTC } from './turn-limits'
import { isInternalRun } from './internal-run'

/** Pricing v2: 60 → 30. A person reading symbol pages makes a handful of
 *  uncached model calls an hour (the brief is shared per symbol for ten
 *  minutes); 30 is still generous and halves what one address can burn.
 *  Plus and bring-your-own-key lift it (admitMarketsAi). */
export const MARKETS_AI_IP_HOURLY_CAP_DEFAULT = 30

export function marketsAiCap(): number {
  const n = Number(process.env.MARKETS_AI_IP_HOURLY_CAP)
  return Number.isFinite(n) && n > 0 ? n : MARKETS_AI_IP_HOURLY_CAP_DEFAULT
}

/** Bump this request's window and report whether it tripped the cap.
 *  Internal runs (the harness stamps `x-yf-internal-run`) still count —
 *  the fence pin needs them to — but loopback traffic with no platform IP
 *  is exempt exactly like every other fence. */
export async function bumpAndCheckMarketsAi(headers: Headers, body?: unknown): Promise<boolean> {
  const ip = clientIpFrom(headers)
  if (!ip) return false
  void isInternalRun(headers, body)
  const key = `a:${hashIp(ip)}`
  try {
    const { default: prisma } = await import('@/lib/db')
    const windowStart = hourStartUTC()
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + 1
      RETURNING count
    `
    return Number(rows[0]?.count ?? 0) > marketsAiCap()
  } catch {
    return false
  }
}

export type MarketsSurface = 'markets-brief' | 'markets-tape' | 'markets-position' | 'markets-ask' | 'markets-explain'

export interface MarketsAdmission {
  /** Refuse with this copy (a JSON answer, never a bare 429). */
  wall: string | null
  /** The viewer's own model key, when they brought one. */
  apiKey?: string
  /** Who the meter attributes the call to. */
  owner?: string | null
}

/**
 * Admission for ONE markets model call (pricing v2). Order:
 *   1. a viewer with their own key (BYOK) runs on it — no fence, no fuse, no
 *      cost to us;
 *   2. a Plus account skips the per-IP fence (they pay for the model);
 *   3. everyone else passes the per-IP hourly fence;
 *   4. every house-paid call draws on its surface's DAILY fuse — the bound on
 *      what a proxy pool can do to the uncached surfaces (the position
 *      paragraph is keyed to any address a caller names).
 * The scripted mock (harness) never touches a fuse: a shared test DB would
 * otherwise blow them across sessions.
 */
export async function admitMarketsAi(headers: Headers, body: unknown, surface: MarketsSurface): Promise<MarketsAdmission> {
  let owner: string | null = null
  let plus = false
  try {
    const { getSessionAddress } = await import('./auth')
    owner = await getSessionAddress()
    if (owner) {
      const { resolveInferenceKey } = await import('./byok')
      const byok = await resolveInferenceKey(owner)
      if (byok) return { wall: null, apiKey: byok.apiKey, owner }
      const { getEffectivePlan } = await import('./billing')
      plus = (await getEffectivePlan(owner)).plan.id !== 'free'
    }
  } catch {
    // identity is a courtesy here — an auth hiccup falls through to the fence
  }
  if (!plus && (await bumpAndCheckMarketsAi(headers, body))) return { wall: MARKETS_AI_WALL, owner }
  if (process.env.MK2_AI_MOCK !== '1') {
    const { bumpFuse } = await import('./inference-fuse')
    if (await bumpFuse(surface)) return { wall: MARKETS_AI_FUSE_WALL, owner }
  }
  return { wall: null, owner }
}

/** The daily fuse's words — the feature is resting, the page is not broken. */
export const MARKETS_AI_FUSE_WALL = 'The model has written its share for today and is back at midnight UTC. The chart, the tape and every action still work — or add your own API key in Settings and it never rests.'

/** The polite wall, as JSON — never a bare 429 body. */
export const MARKETS_AI_WALL = 'This connection has asked the model a lot this hour. The brief and the chart still work; the model reopens within the hour.'
