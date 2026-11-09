// REQUEST GUARDS for the Telegram routes (lane TELEGRAM, 2026-11-09). Pure
// over web-standard Request / Headers; pinned.

import { createHash, timingSafeEqual } from 'node:crypto'

/** Telegram updates are a few KB. Nothing bigger is parsed. */
export const WEBHOOK_BODY_MAX = 64 * 1024
/** initData or the widget's fields, as JSON. */
export const AUTH_BODY_MAX = 16 * 1024

/**
 * Does the request carry the webhook's secret (`X-Telegram-Bot-Api-Secret-Token`)?
 * Fails closed: no configured secret, or no header, is a refusal. Both sides
 * are hashed first so the comparison is constant-time AND length-blind.
 */
export function secretHeaderOk(got: string | null | undefined, want: string | null | undefined): boolean {
  if (!want || !got) return false
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(want).digest()
  return timingSafeEqual(a, b)
}

/** Read a body as text, refusing past `max` bytes without buffering the rest. null = too large or unreadable. */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null
  try {
    const v = JSON.parse(text) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Is this a request our OWN page made? The identity cookie can be
 * SameSite=None (a Mini App inside Telegram Web is an iframe), so a route
 * that reads or sets it cannot lean on the cookie's own cross-site rule.
 * Two checks a real page passes without knowing they exist:
 *   · `Sec-Fetch-Site`, when the browser sends it, is same-origin or none
 *   · `Origin`, when present, names the host the request was sent to
 */
export function sameOrigin(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = headers.get('origin')
  if (origin) {
    const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0].trim().toLowerCase()
    try {
      if (!host || new URL(origin).host.toLowerCase() !== host) return false
    } catch {
      return false
    }
  }
  return true
}

/**
 * The sign-in route SETS a cookie, so a cross-site page must not be able to
 * plant somebody else's Telegram identity in a visitor's browser (login
 * CSRF). On top of `sameOrigin`, the body must be JSON: a cross-site form or
 * a no-cors fetch cannot send that without a preflight this route never
 * answers.
 */
export function sameOriginJson(headers: Headers): boolean {
  const type = (headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  return type === 'application/json' && sameOrigin(headers)
}
