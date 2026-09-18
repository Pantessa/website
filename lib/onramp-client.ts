'use client'

// The client half of the on-ramp door: take a free signature proving the
// destination wallet, mint a Stripe session, hand the user off.
//
// Extracted 2026-09-04 with the switch to Stripe, because there are now TWO
// surfaces that fund a wallet — the clarify fund chip (an empty wallet that
// just hit a money wall) and the dashboard's Fund-your-account card — and the
// order of operations here is subtle enough that a second hand-rolled copy
// would drift. In particular: #675 rewrote ClarifyChips and deleted the whole
// funding branch, so for days the chat emitted fund chips that rendered as
// plain text. One implementation, pinned once, is the answer.

import type { ClarifyFundAction } from '@/lib/clarify'
import { onrampConsentMessage, onrampHasLane, onrampUnsellableMessage, type OnrampOffer } from '@/lib/onramp'

export type OnrampStartResult = { ok: true } | { ok: false; error: string }

/** Sign the consent, mint the session, send the user to it.
 *
 *  MUST be called synchronously from the click handler — its first statement
 *  opens the tab, and a popup opened after an `await` is no longer a user
 *  gesture and gets blocked. (Same lesson as the Coinbase-wallet
 *  popup-after-await signature bug: a browser rule, not a provider one.)
 *
 *  Never throws — every failure comes back as prose the caller can render. */
export async function startOnrampSession(input: {
  address: string
  fund: ClarifyFundAction
  /** wagmi's signMessageAsync, passed in so this stays hook-free and callable
   *  from any surface. */
  signMessage: (args: { message: string }) => Promise<string>
}): Promise<OnrampStartResult> {
  const { address, fund, signMessage } = input
  const tab = window.open('', '_blank')
  try {
    // Can this visitor's checkout price the lane? A lane it can't opens onto
    // Stripe's "An unknown error occurred" (a euro buy of USDC, 2026-09-17), so
    // ask before the wallet prompt does: no signature for a checkout that
    // can't work. If the read fails, carry on; the route refuses those lanes
    // by name too.
    const offer = await fetchOnrampOffer()
    if (offer?.enabled && !onrampHasLane(offer.lanes, fund)) {
      tab?.close()
      return { ok: false, error: onrampUnsellableMessage(fund, offer.currency) }
    }

    // Prove the wallet before minting a session (Coinbase's integration review
    // required it and the requirement outlived the provider). personal_sign
    // costs no gas, which is the only reason an EMPTY wallet can do it — and
    // the text names the destination, so the prompt doubles as a confirmation
    // of where the money lands.
    //
    // Signs the values the SERVER will use: clarifyOf has already rounded and
    // range-clamped them, so the server's clamp is a no-op here, and if it
    // ever were not, the re-derived consent would fail to match — closed.
    const issuedAt = Date.now()
    let signature: string
    try {
      signature = await signMessage({ message: onrampConsentMessage({ ...fund, address, issuedAt }) })
    } catch (e) {
      tab?.close()
      const why = e instanceof Error ? e.message : ''
      return {
        ok: false,
        error: /reject|denied|declined|cancell?ed/i.test(why)
          ? 'Funding needs that signature to confirm the destination wallet — it costs nothing and moves nothing.'
          : 'Could not confirm the destination wallet with your signature.',
      }
    }

    const res = await fetch('/api/onramp/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, ...fund, issuedAt, signature }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      url?: string
      error?: string
      stage?: string
      upstreamStatus?: number
    }
    if (!res.ok || !data.url) {
      tab?.close()
      // Surface the stage/status inline: "Could not start the funding session"
      // alone is unactionable, and this is the one screen an operator actually
      // sees while wiring the on-ramp up. A region refusal is about the USER
      // and a stale one is about the CHIP — neither is our wiring, and both
      // already read as complete sentences, so they get no operator suffix.
      const detail =
        data.stage === 'region' || data.stage === 'stale' || data.stage === 'unsellable'
          ? ''
          : data.upstreamStatus
            ? ` (Stripe ${data.upstreamStatus})`
            : data.stage
              ? ` (${data.stage})`
              : ''
      return { ok: false, error: `${data.error ?? 'Could not start the funding session.'}${detail}` }
    }

    if (tab) tab.location.href = data.url
    else window.location.href = data.url
    return { ok: true }
  } catch {
    tab?.close()
    return { ok: false, error: 'Could not start the funding session.' }
  }
}

let offerRead: Promise<OnrampOffer | null> | null = null

/** What this visitor can buy by card (GET /api/onramp/offer), read once per
 *  page load: the answer only changes with a deploy or a move to another
 *  country. Null when the read fails, and a failed read isn't kept, so the
 *  next caller asks again. */
export function fetchOnrampOffer(): Promise<OnrampOffer | null> {
  if (!offerRead) {
    offerRead = fetch('/api/onramp/offer')
      .then((r) => (r.ok ? (r.json() as Promise<Partial<OnrampOffer>>) : null))
      .then((o) =>
        o && typeof o.enabled === 'boolean' && (o.currency === 'usd' || o.currency === 'eur') && Array.isArray(o.lanes) ? (o as OnrampOffer) : null,
      )
      .catch(() => null)
      .then((o) => {
        if (!o) offerRead = null
        return o
      })
  }
  return offerRead
}
