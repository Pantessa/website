'use client'

// THE BELL beside Ask (2026-10-13, Nate: "remove the alerts bar, maybe just
// put the alert icon that pops up if clicked near the ASK button"). The
// watchlist rail used to spend two bands on alerts — the "needs you" strip
// over the add box (every fired alert, its chip and a ✓) and an "Alerts"
// section under the rows — and on a docked rail that was a third of the
// column before the first ticker. Both live here now, behind one 34px bell
// in the top strip: it wears the fired count when something needs you, and
// a tap opens ONE popover — fired alerts first (headline · hit $x 6d ago ·
// the chip · ✓), then the armed rules (pause / resume / delete). Nothing is
// rendered in the rail. The rule set from a row's ⋯ menu (AlertForm) shows
// here at once: both read the one alerts instance MarketsSide provides
// (watchlist/alerts-context).
//
// A fired alert's chip is the one /markets sender whose text is not provably
// page-composed (createAlert stores what its owner posted — the harness's
// FOUND). It used to PREFILL /chat for that reason: the app ran arrivals
// unseen. Here it goes through the Ask door on the SAME page — the dock
// under the chart on /t, the ⌘K sheet elsewhere — where the sentence is the
// visible first message and the wallet signs or nothing moves; a clarify or
// a planner answer is the door's reply, not a page the reader was sent to.
// A guest gets the sign-in door: alerts are an account's.
//
// ON A PHONE THE POPOVER IS A SHEET (squad polish 2026-10-13, MARKETS-MOBILE;
// THE RULEBOOK §B4): the same body rises from the bottom edge in
// components/mobile/Sheet — grabber, scrim, Esc, swipe-down and the back
// gesture all close it — instead of a fixed box hanging under the strip. The
// desktop keeps the popover (#973). The posture is usePhoneSheet's one
// matchMedia; the server renders the bell alone either way.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellRing, Check, Trash2, X } from 'lucide-react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { useSession } from '@/lib/session'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { alertLabel, firedAlertLines } from '@/lib/watchlists'
import { useQuotes } from '@/components/markets/watchlist/useWatchlists'
import { useSharedAlerts } from '@/components/markets/watchlist/alerts-context'
import Sheet from '@/components/mobile/Sheet'
import { usePhoneSheet } from '@/components/markets/shell/usePhoneSheet'

const promptHref = (ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`
const FIRED_SHOWN = 5

export default function RailAlerts() {
  const alerts = useSharedAlerts()
  const { status, address } = useSession()
  const authed = status === 'authed' && !!address
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const phone = usePhoneSheet()

  const fired = alerts?.notifications ?? []
  const armed = (alerts?.alerts ?? []).filter((a) => a.status !== 'fired')
  // The fired rows quote the live price beside the one they hit.
  const { quotes } = useQuotes(open ? Array.from(new Set(fired.map((n) => n.symbol))) : [])

  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })

  // Outside click / Esc closes the popover (the rail's own menus do the same).
  // The phone's sheet owns its own scrim and Escape (and lives in a portal
  // outside rootRef, so a tap inside it must never read as "outside").
  useEffect(() => {
    if (!open || phone) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, phone])

  const count = fired.length
  const label = count ? `Alerts — ${count} need${count === 1 ? 's' : ''} you` : armed.length ? `Alerts — ${armed.length} armed` : 'Alerts'
  const meta = authed ? (
    <span className="mkt-alertpop__meta mono">
      {count ? `${count} fired · ` : ''}
      {armed.length} armed
    </span>
  ) : null
  // The one body both seats render (the popover under the strip, the phone's sheet).
  const body = (
    <div className="mkt-alertpop__body">
          {!authed ? (
        <div className="mkt-alertpop__empty">
          Price alerts that act: a rule on any watched ticker, a chip when it fires, your wallet signs.{' '}
          <CreateAccountButton className="wl__link" label={status === 'loading' ? 'Loading…' : 'Sign in to set alerts'} />
        </div>
      ) : (
        <>
          {/* ── Needs you: fired alerts hand you their chip ───────── */}
          {count > 0 && (
        <section className="mkt-alertpop__sec mkt-alertpop__sec--fired" aria-label="Fired alerts">
          <h3 className="mkt-alertpop__label mono">Needs you</h3>
          {fired.slice(0, FIRED_SHOWN).map((n) => {
            const line = firedAlertLines(n, quotes[n.symbol]?.last)
            return (
              <div key={n.id} className="mkt-alertpop__fired" role="status">
                <BellRing className="mkt-alertpop__firedIcon" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="mkt-alertpop__firedTitle">{line.headline}</div>
                  <div className="mkt-alertpop__firedMeta mono">{line.meta}</div>
                  {n.actionAsk && (
                    <button
                      type="button"
                      className="wl__chip wl__chip--accent"
                      title="sends through Ask — your wallet signs"
                      onClick={() => {
                        setOpen(false)
                        act(n.actionAsk!)
                      }}
                    >
                      {n.actionAsk}
                    </button>
                  )}
                </div>
                <button type="button" className="wl__icon" aria-label="Dismiss" onClick={() => alerts?.dismiss([n.id])}>
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
          {count > FIRED_SHOWN && (
            <div className="mkt-alertpop__more">
              <button type="button" className="wl__link mono" onClick={() => alerts?.dismiss('all')}>
                +{count - FIRED_SHOWN} more · clear all
              </button>
            </div>
          )}
        </section>
          )}

          {/* ── Armed rules ─────────────────────────────────────── */}
          {armed.length > 0 && (
        <section className="mkt-alertpop__sec" aria-label="Armed alerts">
          <h3 className="mkt-alertpop__label mono">Armed</h3>
          {armed.map((a) => (
            <div key={a.id} className="mkt-alertpop__row">
              <span className="mkt-alertpop__rowLabel">
                {alertLabel(a)}
                {a.actionAsk ? <span className="wl__muted"> · hands you a chip</span> : null}
                {a.status === 'paused' ? <span className="wl__muted"> · paused</span> : null}
              </span>
              <button type="button" className="wl__link mono" onClick={() => alerts?.setStatus(a.id, a.status === 'paused' ? 'resume' : 'pause')}>
                {a.status === 'paused' ? 'resume' : 'pause'}
              </button>
              <button type="button" className="wl__icon" aria-label="Delete alert" onClick={() => alerts?.remove(a.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </section>
          )}

          {count === 0 && armed.length === 0 && (
        <p className="mkt-alertpop__empty">
          {alerts && !alerts.ready ? 'Reading your alerts…' : <>No alerts yet. Set one from a watchlist row&rsquo;s ⋯ menu, or ask: &ldquo;Tell me when ETH moves 5%&rdquo;.</>}
        </p>
          )}
          {alerts?.error && <p className="mkt-alertpop__err">{alerts.error}</p>}
        </>
      )}
    </div>
  )

  return (
    <div ref={rootRef} className="mkt-frame__alerts" data-slot="alerts">
      <button
        type="button"
        className="mkt-frame__bell"
        aria-label="Alerts"
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-fired={count || undefined}
        data-journey="Open alerts"
        {...(phone ? { 'data-sheet-open': 'alerts' } : {})}
        onClick={() => setOpen((o) => !o)}
      >
        {count ? <BellRing className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
        {count > 0 && (
          <span className="mkt-frame__bellCount mono" aria-hidden>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && !phone && (
        <div className="mkt-alertpop" role="dialog" aria-label="Alerts">
          <div className="mkt-alertpop__head">
            <span className="mkt-alertpop__title">Alerts</span>
            {meta}
            <button type="button" className="wl__icon" aria-label="Close alerts" data-journey="Close alerts" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {body}
        </div>
      )}
      {phone && (
        <Sheet open={open} onClose={() => setOpen(false)} title="Alerts" id="alerts" className="mkt-alertsheet">
          {meta && <div className="mkt-alertsheet__meta">{meta}</div>}
          {body}
        </Sheet>
      )}
      {door}
    </div>
  )
}
