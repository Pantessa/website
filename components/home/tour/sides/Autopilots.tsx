'use client'

// THE TOUR · AUTOPILOTS (squad landing, 2026-11-10; lane SIDES-B).
//
// "What runs while you are away, honestly." Three standing orders, each a
// REAL sentence with what it does and when, worked out by the product's own
// rules (./b/rules.ts, pinned against lib/hl-guardian and lib/watchlists):
//
//   1. a stop on a perp — the level is drawn from the live ether quote: a
//                         percent stop sits that far under the ENTRY and the
//                         guardian's sweep reads it once a minute
//                         (lib/hl-guardian evaluatePolicy, vercel.json's
//                         `* * * * *` cron, /docs/guardian). It needs an open
//                         Hyperliquid position, so it is WORDS here, never a
//                         button (README rule 4).
//   2. an alert         — fires at a percent move either way from the price
//                         it was armed at (lib/watchlists alertFires); firing
//                         is a notification with the order attached and
//                         NEVER sends it (lib/alerts-exec header). Alerts are
//                         set from a chart's bell: the row is a door to /t/ETH.
//   3. a job            — two steps from one sentence: your wallet signs the
//                         long, the runner arms the stop once it fills
//                         (lib/jobs compileJobAsk: kinds `sign` then `auto`).
//                         A fresh wallet can run it today (scripts/audit-asks,
//                         `action`), so it is the panel's one button, gated
//                         by canAct and sent through act(), never fill().
//
// NOT here, on purpose: a recurring buy. Nate retired it as a suggestion on
// 2026-09-16 (in confirm mode it only reminds the wallet to sign), and the
// harness fences every chip-composing surface, the landing included
// (scripts/test-api.ts "Retired as a suggestion"). Typing one still works.
//
// Each row carries its one control in its head (the stop's distance, the
// alert's door, the job's button), so the panel stays short. Nothing moves
// on its own and the panel reads no clock.

import { useState } from 'react'
import LandingLink from '@/components/home/LandingLink'
import { tourJourney } from '@/lib/home-tour'
import { meta } from '@/lib/home-tour/autopilots'
import { fmtReadValueFull, readInstrument } from '@/lib/read'
import { STOPS } from '@/lib/trade-asks'
import { TourPanel } from '../Panel'
import { useTour } from '../context'
import { alertBand, levelChart, stopLevel } from './b/rules'
import { ALERT_PCT, JOB_STEPS, alertSentence, stopSentence } from './b/standing'
import './b/shared.css'
import './autopilots.css'

const ETH = readInstrument('eth')
const usd = (v: number) => fmtReadValueFull(ETH, v)

export default function AutopilotsSide() {
  const { read, act, canAct } = useTour()
  const [pct, setPct] = useState<number>(STOPS[0])
  const eth = read.quotes.eth
  const [job] = meta.asks

  // ── 1 · the stop's level, from the live ether quote ──────────────────────
  const entry = eth?.last ?? null
  const stop = entry == null ? null : stopLevel(entry, pct, 'long')
  const chart = eth && entry != null && stop != null ? levelChart(eth.points, [entry, stop]) : null

  // ── 2 · the alert's two prices ───────────────────────────────────────────
  const band = entry == null ? null : alertBand(entry, ALERT_PCT)

  return (
    <TourPanel side={{ ...meta, asks: [] }} demoLabel="Three standing orders, and when each one acts">
      <div className="sb-ap" data-ap>
        {/* ── 1 · a stop on a perp ── */}
        <section className="sb-ap__row" data-ap-row="stop" aria-label="A stop on a perp">
          <div className="sb-ap__head">
            <span className="sb-tag mono">Stop on a perp</span>
            <span className="sb-ap__stops" role="group" aria-label="Stop distance">
              {STOPS.map((p) => (
                <button key={p} type="button" className={`sb-seg mono${p === pct ? ' is-on' : ''}`} aria-pressed={p === pct} onClick={() => setPct(p)} data-journey={tourJourney(meta.id, `stop ${p}%`)}>
                  {p}%
                </button>
              ))}
            </span>
          </div>
          <p className="sb-sentence">{stopSentence('ETH', pct)}</p>
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
                A long opened at ether’s price now, <b>{usd(entry)}</b>, closes if ETH trades at <b>{usd(stop)}</b>{' '}
                or lower.{' '}
              </>
            ) : (
              <>A percent stop sits that far under your entry price. </>
            )}
            A stop needs an open position, so it is not a button here.
          </p>
        </section>

        <div className="sb-ap__pair">
          {/* ── 2 · an alert ── */}
          <section className="sb-ap__row" data-ap-row="alert" aria-label="An alert">
            <div className="sb-ap__head">
              <span className="sb-tag mono">Alert</span>
              <LandingLink href="/t/ETH" prefetch={false} className="sb-ap__go" data-journey={tourJourney(meta.id, 'Set an alert on ETH')}>
                Set one on ETH <span aria-hidden>→</span>
              </LandingLink>
            </div>
            <p className="sb-sentence">{entry != null ? alertSentence('ETH', ALERT_PCT, usd(entry)) : alertSentence('ETH', ALERT_PCT, null)}</p>
            <p className="sb-note">
              {band ? (
                <>
                  Fires at <b>{usd(band.up)}</b>{' '}
                  or <b>{usd(band.down)}</b>.{' '}
                </>
              ) : null}
              It comes back to the bell with the order attached. You send it.
            </p>
          </section>

          {/* ── 3 · a job ── */}
          <section className="sb-ap__row" data-ap-row="job" aria-label="A job of several steps">
            <div className="sb-ap__head">
              <span className="sb-tag mono">Job</span>
              {canAct(job.ask) && (
                <button type="button" className="sb-run" onClick={() => act(job.ask)} data-ask={job.ask} data-journey={tourJourney(meta.id, job.label)}>
                  Run it <span aria-hidden>→</span>
                </button>
              )}
            </div>
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
          </section>
        </div>
      </div>
    </TourPanel>
  )
}
