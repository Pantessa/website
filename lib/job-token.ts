// Capability token for ONE job — lets the surface that created it (an embed
// visitor has no SIWE session) read and advance exactly that job. HMAC over
// the job id + the job's WALLET + an expiry, with SESSION_SECRET; possession
// of the chat turn that compiled the job IS the grant. Money still moves only
// through wallet signatures — this gates job STATE, and lying to /complete
// fails closed one step later (the runner re-verifies via wait predicates and
// build-time balance checks).
//
// v2 (SECURITY-AUDIT 2026-09-08 §E6): `v2.<expiresAtSec>.<hmac>` — a leaked
// token stops working after JOB_TOKEN_TTL_MS (jobs age out at 7 days, #690),
// and it verifies only against the job row's own wallet, so a token can never
// be replayed onto a job that was re-keyed or onto another wallet's job. v1
// (bare 64-hex over the id alone, no expiry) stays accepted until
// JOB_TOKEN_V1_SUNSET so cards already open when this ships keep working.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const JOB_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** v1 tokens (minted before the v2 rollout) verify until this instant. */
export const JOB_TOKEN_V1_SUNSET = Date.parse('2026-09-16T00:00:00Z')

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (≥16 chars) to mint job tokens.')
  return s
}

const hmac = (input: string) => createHmac('sha256', secret()).update(input).digest('hex')
const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function signJobToken(jobId: string, wallet: string, now: number = Date.now()): string {
  const exp = Math.floor((now + JOB_TOKEN_TTL_MS) / 1000)
  return `v2.${exp}.${hmac(`job:${jobId}:${wallet.toLowerCase()}:${exp}`)}`
}

/** Shape-only read (no secret, no wallet): a v2 token that has not expired,
 *  or a v1 token before its sunset. Lets a route answer 404 for a missing
 *  job to a bearer of a plausible token without leaking anything a garbage
 *  token wouldn't get. */
export function jobTokenLooksValid(token: string | null | undefined, now: number = Date.now()): boolean {
  if (!token) return false
  const m = token.match(/^v2\.(\d{1,12})\.([0-9a-f]{64})$/)
  if (m) return Number(m[1]) * 1000 > now
  return /^[0-9a-f]{64}$/.test(token) && now < JOB_TOKEN_V1_SUNSET
}

export function verifyJobToken(jobId: string, token: string | null | undefined, wallet: string | null | undefined, now: number = Date.now()): boolean {
  if (!token || !wallet) return false
  const m = token.match(/^v2\.(\d{1,12})\.([0-9a-f]{64})$/)
  if (m) {
    const exp = Number(m[1])
    if (!Number.isFinite(exp) || exp * 1000 <= now) return false
    return same(hmac(`job:${jobId}:${wallet.toLowerCase()}:${exp}`), m[2])
  }
  // v1 grace: the pre-rollout shape, id-only, until the sunset.
  if (/^[0-9a-f]{64}$/.test(token) && now < JOB_TOKEN_V1_SUNSET) return same(hmac(`job:${jobId}`), token)
  return false
}
