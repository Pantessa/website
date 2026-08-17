// lib/broker-webhook.ts — the desk's push channel (M3).
//
// The broker is fire-and-forget by default: an agent hands off a sign link and
// polls broker_status to learn whether its human signed. That poll is the
// fallback; this module is the push. When an agent opens an intent with a
// callback_url, Pantessa POSTs a signed webhook to it the moment a signed or
// settled event lands for the bound link — so the agent closes the loop
// without polling.
//
// Two properties carry the safety:
//   1. SSRF fence — the callback URL is agent-supplied, and we POST to it from
//      our own network, so it is validated exactly like a creator-supplied
//      brand URL (https, public host, no credentials, no IP literals). We
//      never return the callback's response to the agent, so the blast radius
//      is blind-SSRF at worst; a hostname that resolves to a private IP
//      (DNS rebinding) is the documented residual, matching lib/brand-scan.
//   2. HMAC signature — every delivery carries X-Pantessa-Signature over the
//      raw body with a per-intent secret handed to the agent once at open, so
//      the agent can verify the call is really from us.
//
// Delivery is best-effort and FAIL-SOFT: a few retries with backoff, a short
// per-attempt timeout, and it never throws into the caller (the event write
// must never depend on a flaky endpoint).

import { createHmac, randomBytes } from 'node:crypto'
import { validateBrandUrl } from '@/lib/brand-scan'

/** Validate an agent-supplied callback URL. Reuses the brand-URL SSRF fence
 *  (https, default port, no credentials, public hostname, no IP literals). */
export function validateCallbackUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const v = validateBrandUrl(raw)
  if (!v.ok) return { ok: false, reason: `callback_url rejected: ${v.reason}` }
  return { ok: true, url: v.url.toString() }
}

/** Mint a per-intent webhook signing secret. `whsec_`-prefixed so it can never
 *  be mistaken for transaction material (no 0x-hex run) and reads clearly. */
export function mintCallbackSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`
}

/** HMAC-SHA256 of the raw body under the intent's secret, hex. */
export function signWebhook(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export interface WebhookEvent {
  intentId: string
  event: 'signed' | 'settled'
  ask: string
  url: string | null
  valueUsd: number | null
  /** Unique per delivery attempt-set — the agent dedupes on this. */
  deliveryId: string
  /** Milliseconds since epoch, passed in (Date.now() is unavailable in some
   *  edge contexts; the caller stamps it). */
  at: number
}

/** The signed request pieces for one delivery — pure, so the harness can
 *  assert the signature without a live endpoint. */
export function buildDelivery(secret: string, ev: WebhookEvent): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(ev)
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Pantessa-Desk-Webhook/1',
      'x-pantessa-event': ev.event,
      'x-pantessa-delivery': ev.deliveryId,
      'x-pantessa-signature': `sha256=${signWebhook(secret, body)}`,
    },
  }
}

/** POST the signed event, best-effort. Up to 3 attempts with backoff and a
 *  5s per-attempt timeout. Never throws — returns whether a 2xx landed. */
export async function deliverWebhook(url: string, secret: string, ev: WebhookEvent): Promise<boolean> {
  const { body, headers } = buildDelivery(secret, ev)
  const backoffMs = [0, 750, 3000]
  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    if (backoffMs[attempt]) await sleep(backoffMs[attempt])
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal, redirect: 'error' })
      clearTimeout(timer)
      if (res.status >= 200 && res.status < 300) return true
      // 4xx that isn't 429 won't get better on retry — stop early.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return false
    } catch {
      clearTimeout(timer)
      // network error / timeout / redirect refused — fall through to retry
    }
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
