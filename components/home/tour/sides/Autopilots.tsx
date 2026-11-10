'use client'

// THE TOUR · AUTOPILOTS (squad landing, 2026-11-10; lane SIDES-B).
//
// "What runs while you are away, honestly." Four standing orders, each a
// REAL sentence with what it does and when — worked out by the product's own
// rules (components/home/tour/sides/b/rules.ts, pinned against lib/dca,
// lib/hl-guardian and lib/watchlists):
//
//   1. a recurring buy   — CONFIRM MODE: a schedule never signs anything;
//                          each UTC period comes back as one buy to sign and
//                          a missed period lapses (lib/dca, lib/dca-exec,
//                          /docs/jobs "a schedule, not an authorization").
//                          The next opening is the next UTC week (ISO, Monday).
//   2. a stop on a perp  — the level is drawn from the live ether quote:
//                          a percent stop sits that far under the ENTRY and
//                          the guardian's sweep reads it every minute
//                          (lib/hl-guardian evaluatePolicy, vercel.json's
//                          `* * * * *` cron, /docs/guardian). It needs an open
//                          Hyperliquid position, so it is WORDS here, never a
//                          chip (README rule 4).
//   3. an alert          — fires at a percent move either way from the price
//                          it was armed at (lib/watchlists alertFires); firing
//                          is a notification with the order attached and
//                          NEVER sends it (lib/alerts-exec header). Alerts are
//                          set from a chart's bell, signed in: the row is a
//                          door to /t/ETH.
//   4. a job             — two steps from one sentence: your wallet signs the
//                          long, the runner arms the stop once it fills
//                          (lib/jobs compileJobAsk: kinds `sign` then `auto`).
//
// Rows 1 and 4 are sentences a fresh wallet can run today (scripts/audit-asks
// lines 160 and 67, both `action`), so they are buttons, gated by canAct.
// Nothing here moves on its own: the clock only re-reads the minute.

import { useEffect, useState } from 'react'
import LandingLink from '@/components/home/LandingLink'
import { cadenceLabel, periodKeyFor } from '@/lib/dca'
import { tourJourney } from '@/lib/home-tour'
import { meta } from '@/lib/home-tour/autopilots'
import { fmtReadValueFull, readInstrument } from '@/lib/read'
import { STOPS } from '@/lib/trade-asks'
import { TourPanel } from '../Panel'
import { useTour } from '../context'
import { alertBand, fmtCountdown, fmtUtcDay, levelChart, nextPeriodStarts, stopLevel } from './b/rules'
import { ALERT_PCT, DCA_CADENCE, JOB_STEPS, alertSentence, stopSentence } from './b/standing'
import './b/shared.css'
import './autopilots.css'

const ETH = readInstrument('eth')
const usd = (v: number) => fmtReadValueFull(ETH, v)

/** The minute, after mount. Null on the server and on the first client
 *  render, so the static page and its hydration print the same words. */
function useMinute(): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setNow(Date.now())
    }
    setNow(Date.now())
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return now
}

export default function AutopilotsSide() {
  const { read, act, canAct } = useTour()
  const now = useMinute()
  const [pct, setPct] = useState<number>(STOPS[0])
  const eth = read.quotes.eth
  const [buy, job] = meta.asks

  // ── 1 · the recurring buy's calendar ─────────────────────────────────────
  const at = now == null ? null : new Date(now)
  const opens = at ? nextPeriodStarts(DCA_CADENCE, at, 2) : []

  // ── 2 · the stop's level, from the live ether quote ──────────────────────
  const entry = eth?.last ?? null
  const stop = entry == null ? null : stopLevel(entry, pct, 'long')
  const chart = eth && entry != null && stop != null ? levelChart(eth.points, [entry, stop]) : null

  // ── 3 · the alert's two prices ───────────────────────────────────────────
  const band = entry == null ? null : alertBand(entry, ALERT_PCT)

  return (
    <TourPanel side={{ ...meta, asks: [] }} demoLabel="Four standing orders, and when each one acts">
      <ol className="sb-ap" data-ap>
        {/* ── 1 · a recurring buy ── */}
        <li className="sb-ap__row" data-ap-row="dca">
          <p className="sb-ap__head">
            <span className="sb-tag mono">Recurring buy</span>
            <span className="sb-pill mono">you sign each one</span>
          </p>
          <p className="sb-sentence">{buy.ask}</p>
          <ol className="sb-ap__periods mono" aria-label={`The next ${cadenceLabel(DCA_CADENCE)} buys`}>
            <li className="sb-ap__period is-now">
              <b>{at ? periodKeyFor(DCA_CADENCE, at).replace(/^\d+-/, '') : 'This week'}</b>
              <span>at set-up</span>
            </li>
            {opens.map((d) => (
              <li key={d.getTime()} className="sb-ap__period">
                <b>{periodKeyFor(DCA_CADENCE, d).replace(/^\d+-/, '')}</b>
                <span>{fmtUtcDay(d)}</span>
              </li>
            ))}
          </ol>
          <p className="sb-note">
            {at && opens[0] ? (
              <>
                The next buy unlocks <b>{fmtUtcDay(opens[0])}, 00:00 UTC</b>{' '}
                ({fmtCountdown(opens[0].getTime() - at.getTime())}).{' '}
              </>
            ) : (
              <>A new buy unlocks at the start of each UTC week. </>
            )}
            It comes back built at a live quote, as one tap to sign. Nothing buys without you, and a week you skip lapses.
          </p>
          {canAct(buy.ask) && (
            <button type="button" className="sb-run" onClick={() => act(buy.ask)} data-ask={buy.ask} data-journey={tourJourney(meta.id, buy.label)}>
              Set it up <span aria-hidden>→</span>
            </button>
          )}
        </li>

        {/* ── 2 · a stop on a perp ── */}
        <li className="sb-ap__row" data-ap-row="stop">
          <p className="sb-ap__head">
            <span className="sb-tag mono">Stop on a perp</span>
            <span className="sb-pill mono">checked every minute</span>
          </p>
          <p className="sb-sentence">{stopSentence('ETH', pct)}</p>
          <div className="sb-ap__stops" role="group" aria-label="Stop distance">
            {STOPS.map((p) => (
              <button key={p} type="button" className={`sb-seg mono${p === pct ? ' is-on' : ''}`} aria-pressed={p === pct} onClick={() => setPct(p)} data-journey={tourJourney(meta.id, `stop ${p}%`)}>
                {p}%
              </button>
            ))}
          </div>
          {chart && entry != null && stop != null && (
            <figure className="sb-ap__chart">
              <svg viewBox="0 0 320 96" preserveAspectRatio="none" role="img" aria-label={`Ether today, an entry at ${usd(entry)} and a ${pct}% stop at ${usd(stop)}`}>
                <rect className="sb-ap__zone" x="0" width="320" y={chart.y(stop)} height={Math.max(0, 96 - chart.y(stop))} />
                <line className="sb-ap__entry" x1="0" x2="320" y1={chart.y(entry)} y2={chart.y(entry)} />
                <line className="sb-ap__stop" x1="0" x2="320" y1={chart.y(stop)} y2={chart.y(stop)} />
                <path className="sb-ap__line" d={chart.d} />
              </svg>
              <figcaption className="sb-ap__levels mono">
                <span>
                  entry <b>{usd(entry)}</b>
                </span>
                <span className="is-stop">
                  stop <b>{usd(stop)}</b>
                </span>
              </figcaption>
            </figure>
          )}
          <p className="sb-note">
            {entry != null && stop != null ? (
              <>
                A long opened at ether’s price now, <b>{usd(entry)}</b>{' '}
                is closed if ETH trades at <b>{usd(stop)}</b>{' '}
                or lower.{' '}
              </>
            ) : (
              <>A percent stop sits that far under your entry price. </>
            )}
            Its key can only reduce that one position: it cannot withdraw and it cannot open anything. A stop needs an open Hyperliquid position, so it is not a button here.
          </p>
        </li>

        {/* ── 3 · an alert ── */}
        <li className="sb-ap__row" data-ap-row="alert">
          <p className="sb-ap__head">
            <span className="sb-tag mono">Alert</span>
            <span className="sb-pill mono">free</span>
          </p>
          <p className="sb-sentence">{entry != null ? alertSentence('ETH', ALERT_PCT, usd(entry)) : alertSentence('ETH', ALERT_PCT, null)}</p>
          <p className="sb-note">
            {band ? (
              <>
                Fires at <b>{usd(band.up)}</b>{' '}
                or <b>{usd(band.down)}</b>.{' '}
              </>
            ) : null}
            It comes back to the bell with the order attached and never sends it: you do.
          </p>
          <LandingLink href="/t/ETH" prefetch={false} className="sb-run sb-run--quiet" data-journey={tourJourney(meta.id, 'Set an alert on ETH')}>
            Set one from ETH’s chart <span aria-hidden>→</span>
          </LandingLink>
        </li>

        {/* ── 4 · a job ── */}
        <li className="sb-ap__row" data-ap-row="job">
          <p className="sb-ap__head">
            <span className="sb-tag mono">Job</span>
            <span className="sb-pill mono">{JOB_STEPS.length} steps, one sentence</span>
          </p>
          <p className="sb-sentence">{job.ask}</p>
          <ol className="sb-ap__steps">
            {JOB_STEPS.map((s, i) => (
              <li key={s.kind} className="sb-ap__step" data-step={s.kind}>
                <span className="sb-ap__stepn mono">{i + 1}</span>
                <span className="sb-ap__stepwhat">{s.what}</span>
                <span className="sb-ap__stepwho mono">{s.who}</span>
              </li>
            ))}
          </ol>
          {canAct(job.ask) && (
            <button type="button" className="sb-run" onClick={() => act(job.ask)} data-ask={job.ask} data-journey={tourJourney(meta.id, job.label)}>
              Run it <span aria-hidden>→</span>
            </button>
          )}
        </li>
      </ol>
    </TourPanel>
  )
}
