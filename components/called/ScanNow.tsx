'use client'

// The scan, started from the share landing (squad called-it, 2026-11-12).
//
// The landing used to answer a handle nobody had scanned with a LINK to the
// live chart, where a second control started the scan: type a handle, press
// Plot, read "Nobody has plotted…", follow a link, press again. Nate, on
// /x/brian_armstrong/BTC: "does it scan through their tweets or do people
// need to plot it going forward? It should just scan."
//
// It scans here now. The button reads the account's posts and reloads the
// page onto the record. And when the visitor arrived by pressing Plot in the
// door a moment ago, the press already was the ask, so the scan starts by
// itself (lib/called-it/use-record plotIntent*: a mark in this tab's session,
// two minutes long, read once). A page opened from a link carries no such
// mark and never scans on load.
import { useCallback, useEffect, useRef, useState } from 'react'
import { asRecordResponse, plotIntentMatches, PLOT_INTENT_KEY, safeNextHref } from '@/lib/called-it/use-record'

export interface ScanNowProps {
  handle: string
  symbol: string
  /** The button's words ("Scan @handle on BTC", "Finish"). */
  label: string
  /** `lead` is the page's main button; `link` sits inside a sentence. */
  variant?: 'lead' | 'link'
  /** Start by itself when the door's press brought the visitor here. */
  auto?: boolean
}

type Phase = { kind: 'idle' } | { kind: 'scanning'; note: string } | { kind: 'refused'; reason: string; next: { label: string; href: string }[] }

export default function ScanNow({ handle, symbol, label, variant = 'lead', auto = false }: ScanNowProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const busy = useRef(false)

  const start = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setPhase({ kind: 'scanning', note: '' })
    // The scan runs inside its own request; its progress note is read beside it.
    const poll = setInterval(() => {
      fetch(`/api/x/record?handle=${encodeURIComponent(handle)}&sym=${encodeURIComponent(symbol)}`, { cache: 'no-store', credentials: 'same-origin' })
        .then((r) => r.json())
        .then((body) => {
          const a = asRecordResponse(body)
          if (a?.status === 'scanning' && busy.current) setPhase({ kind: 'scanning', note: a.progress })
        })
        .catch(() => undefined)
    }, 2500)
    try {
      const res = await fetch('/api/x/scan', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, sym: symbol }) })
      const answer = asRecordResponse(await res.json().catch(() => null))
      if (answer?.status === 'refused') {
        setPhase({ kind: 'refused', reason: answer.reason, next: answer.next.map((n) => ({ label: n.label, href: safeNextHref(n.href) ?? '' })).filter((n) => n.href) })
        return
      }
      if (!answer) {
        setPhase({ kind: 'refused', reason: 'The scan did not finish. Nothing was plotted. Try again in a moment.', next: [] })
        return
      }
      // Ready, or still running for somebody else: the page itself draws either one.
      window.location.reload()
    } catch {
      setPhase({ kind: 'refused', reason: 'The scan did not answer in time. If it is still running, the record will be here when you reload.', next: [] })
    } finally {
      clearInterval(poll)
      busy.current = false
    }
  }, [handle, symbol])

  useEffect(() => {
    if (!auto) return
    let raw: string | null = null
    try {
      raw = window.sessionStorage.getItem(PLOT_INTENT_KEY)
      if (raw) window.sessionStorage.removeItem(PLOT_INTENT_KEY)
    } catch {
      /* no session storage: the button is still there */
    }
    if (plotIntentMatches(raw, handle, symbol, Date.now())) void start()
  }, [auto, handle, symbol, start])

  if (phase.kind === 'scanning') {
    const note = phase.note.trim().replace(/[.\s]+$/, '')
    return (
      <span className="xrc-scan" role="status" data-scan="running">
        Reading @{handle}&apos;s posts about {symbol}. {note && !/^(reading|starting)\b/i.test(note) ? `${note}. ` : ''}It takes up to a minute.
      </span>
    )
  }
  return (
    <span className="xrc-scan" data-scan={phase.kind}>
      <button type="button" className={variant === 'lead' ? 'xrc-btn xrc-btn--lead' : 'xrc-scan__link'} onClick={() => void start()} data-journey="called_scan_here">
        {label}
      </button>
      {phase.kind === 'refused' && (
        <span className="xrc-scan__why" role="alert">
          {phase.reason}{' '}
          {phase.next.map((n) => (
            <a key={n.href} href={n.href}>
              {n.label}
            </a>
          ))}
        </span>
      )}
    </span>
  )
}
