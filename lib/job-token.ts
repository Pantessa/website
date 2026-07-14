// Capability token for ONE job — lets the surface that created it (an embed
// visitor has no SIWE session) read and advance exactly that job. HMAC over
// the job id with SESSION_SECRET; possession of the chat turn that compiled
// the job IS the grant. Money still moves only through wallet signatures —
// this gates job STATE, and lying to /complete fails closed one step later
// (the runner re-verifies via wait predicates and build-time balance checks).

import { createHmac, timingSafeEqual } from 'node:crypto'

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (≥16 chars) to mint job tokens.')
  return s
}

export function signJobToken(jobId: string): string {
  return createHmac('sha256', secret()).update(`job:${jobId}`).digest('hex')
}

export function verifyJobToken(jobId: string, token: string | null | undefined): boolean {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false
  const expect = Buffer.from(signJobToken(jobId))
  const got = Buffer.from(token)
  return expect.length === got.length && timingSafeEqual(expect, got)
}
