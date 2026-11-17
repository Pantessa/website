'use client'

// "Verify with X": the one button a handle's owner presses to make their own
// plots verified (lane AUTH, squad called-it). It proves a HANDLE; it is not
// an account sign-in, so it never opens the unified sign-in modal and never
// asks for a wallet.
//
// Three states, read from GET /api/x/me (one request per page however many
// buttons are mounted):
//   signed out   → the button (the server HTML is this state)
//   signed in    → "@handle, verified" · Plot my calls · a quiet Sign out
//   unavailable  → "Verify with X works on pantessa.com", linked there
// A return from X with `?xauth=denied|failed|unavailable` adds one line.
//
// This file must not import lib/called-it/x-auth (server only: node:crypto,
// the session secret). The start address is written here by hand and pinned
// against xAuthStartHref.
import { useEffect, useState } from 'react'
import { recordHref } from '@/lib/called-it/spec'
import { safeNextProp } from '@/lib/called-it/next-path'
import type { XIdentity } from '@/lib/called-it/x-auth'
import './verify-with-x.css'

export interface VerifyWithXProps {
  /** A path on this site to come back to. Defaults to the page the button is on, read on press. */
  next?: string
  /** `button` stands alone; `line` sits inside a sentence. */
  variant?: 'button' | 'line'
  className?: string
  /** The market "Plot my calls" opens once verified. Defaults to BTC. (Added by AUTH, append only.) */
  symbol?: string
}

interface Me {
  identity: XIdentity | null
  available: boolean
}

const PROD_ORIGIN = 'https://www.pantessa.com'
const startHref = (next: string) => `/api/x/auth/start?next=${encodeURIComponent(next)}`
const EVENT = 'pantessa:x-identity'

let inflight: Promise<Me | null> | null = null
function readMe(): Promise<Me | null> {
  if (!inflight) {
    inflight = fetch('/api/x/me', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .catch(() => null)
  }
  return inflight
}

const NOTES: Record<string, string> = {
  denied: 'You stopped at X. Nothing changed.',
  failed: 'X did not confirm the account. Try again.',
  unavailable: 'Verify with X is not switched on here yet.',
}

/** This page, without a previous return's `xauth` note. Read on press, never at render. */
function hereNow(): string {
  const q = new URLSearchParams(window.location.search)
  q.delete('xauth')
  const s = q.toString()
  return window.location.pathname + (s ? `?${s}` : '')
}

function XMark() {
  return (
    <svg className="xva-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.8-6.3L6.4 22H3.3l7.3-8.3L1 2h6.3l4.4 5.8L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" />
    </svg>
  )
}

export default function VerifyWithX({ next: nextProp, variant = 'button', className, symbol }: VerifyWithXProps) {
  // A `next` that is not one path on this site becomes /x (review NOTE: PROD_ORIGIN + next must stay on pantessa.com).
  const next = nextProp === undefined ? undefined : safeNextProp(nextProp)
  const [me, setMe] = useState<Me | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [origin, setOrigin] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setOrigin(window.location.origin)
    const n = new URLSearchParams(window.location.search).get('xauth')
    if (n && NOTES[n]) setNote(NOTES[n])
    readMe().then((m) => alive && setMe(m))
    const onChange = (e: Event) => alive && setMe((e as CustomEvent<Me>).detail)
    window.addEventListener(EVENT, onChange)
    return () => {
      alive = false
      window.removeEventListener(EVENT, onChange)
    }
  }, [])

  const rootClass = ['xva-root', className].filter(Boolean).join(' ')
  const isLine = variant === 'line'

  async function signOut() {
    setBusy(true)
    try {
      await fetch('/api/x/auth/signout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
    } catch {
      /* the next read says what is true */
    }
    const after: Me = { identity: null, available: me?.available ?? true }
    inflight = Promise.resolve(after)
    window.dispatchEvent(new CustomEvent<Me>(EVENT, { detail: after }))
    setBusy(false)
  }

  const noteLine = note ? (
    <span className="xva-note" role="status">
      {note}
    </span>
  ) : null

  // Signed in: the handle this browser proved.
  if (me?.identity) {
    const id = me.identity
    return (
      <span className={rootClass} data-variant={variant} data-state="verified" data-journey="called_verify_x">
        <span className="xva-who">
          {id.avatarUrl && !isLine ? <img className="xva-avatar" src={id.avatarUrl} alt="" width={24} height={24} referrerPolicy="no-referrer" /> : null}
          <span>@{id.handle}, verified</span>
        </span>
        <a className="xva-link xva-plot" href={recordHref(id.handle, symbol ?? 'BTC')} data-journey="called_verify_x_plot">
          Plot my calls
        </a>
        <button type="button" className="xva-quiet" onClick={signOut} aria-busy={busy} disabled={busy} data-journey="called_verify_x_signout">
          Sign out
        </button>
      </span>
    )
  }

  // Unavailable on this host: point at the one that can finish it.
  if (me && !me.available) {
    const onProd = origin === PROD_ORIGIN
    return (
      <span className={rootClass} data-variant={variant} data-state="unavailable" data-journey="called_verify_x">
        {onProd ? (
          <span className="xva-away">Verify with X is not switched on yet.</span>
        ) : (
          <a
            className="xva-link"
            href={`${PROD_ORIGIN}${next ?? '/x'}`}
            onClick={(e) => {
              if (next) return
              e.preventDefault()
              window.location.href = `${PROD_ORIGIN}${hereNow()}`
            }}
          >
            Verify with X works on pantessa.com
          </a>
        )}
        {noteLine}
      </span>
    )
  }

  // Signed out (and the server HTML, before /api/x/me answers).
  return (
    <span className={rootClass} data-variant={variant} data-state="signed-out">
      <a
        className={isLine ? 'xva-link' : 'xva-btn'}
        data-variant={variant}
        data-journey="called_verify_x"
        href={startHref(next ?? '/x')}
        onClick={(e) => {
          if (next) return
          e.preventDefault()
          window.location.href = startHref(hereNow())
        }}
      >
        {isLine ? null : <XMark />}
        Verify with X
      </a>
      {noteLine}
    </span>
  )
}
