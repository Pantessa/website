// OUR OWN PAGE MADE THIS REQUEST — the check every cookie-authed community
// WRITE runs first (QA-SECURITY S7).
//
// Why it exists: the identity cookie (`pt_ident`) is SameSite=None when it is
// set inside Telegram (a Mini App in Telegram Web is an iframe), so the
// cookie's own cross-site rule cannot be leaned on. Two checks a real page
// passes without knowing they exist:
//   · `Sec-Fetch-Site`, when the browser sends it, is same-origin or none
//   · `Origin`, when present, names the host the request was sent to
// and, for a write with a body, the content type is JSON — a cross-site form
// or a no-cors fetch cannot send that without a preflight we never answer.
//
// Server-to-server callers (the harness, a script) send neither header and
// pass: they hold no victim's cookie. Pure over web-standard Headers; pinned.

import { SITE_URL } from '@/lib/site-url'

const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).host.toLowerCase()
  } catch {
    return ''
  }
})()

export function sameOrigin(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = headers.get('origin')
  if (origin) {
    // The host the request was SENT to (`Host`), or this deployment's own
    // canonical host. Never `X-Forwarded-Host`: it is a header a caller can
    // write (QA-SECURITY-2 T15), and the platform already rewrites `Host`.
    const host = (headers.get('host') ?? '').trim().toLowerCase()
    let got: string
    try {
      got = new URL(origin).host.toLowerCase()
    } catch {
      return false
    }
    if (!got || (got !== host && got !== SITE_HOST)) return false
  }
  return true
}

/** A write that carries a body: same origin AND `application/json`. */
export function sameOriginJson(headers: Headers): boolean {
  const type = (headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  return type === 'application/json' && sameOrigin(headers)
}

/** The one refusal every route answers with (403, in plain words). */
export const CROSS_SITE_REFUSAL = { error: 'This request did not come from Pantessa.' } as const
