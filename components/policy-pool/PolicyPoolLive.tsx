'use client'

// /policy-pool's live body: stat tiles, the two charts, the intent-walk
// funnel and the ledger, polled from /api/policy-pool/events every 10s
// (the server caches 10s too). A row opens its intent's timeline. Nothing
// here invents a row: an empty ledger says so.

import dynamic from 'next/dynamic'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { PolicyPoolEventRow, PolicyPoolStats } from '@/lib/policy-pool/ledger'
import {
  KIND_META,
  clockTime,
  duneQueryUrl,
  elide,
  explorerFor,
  fmtAtoms,
  fmtCount,
  fmtUsd,
  gap,
  relTime,
  shortIntent,
} from '@/components/policy-pool/format'

const chartSkeleton = () => <div className="pp-chart__skel" style={{ height: 200 }} />
const FillsVsRefusals = dynamic(() => import('./PolicyPoolCharts').then((m) => m.FillsVsRefusals), { ssr: false, loading: chartSkeleton })
const VolumeByDay = dynamic(() => import('./PolicyPoolCharts').then((m) => m.VolumeByDay), { ssr: false, loading: chartSkeleton })

const POLL_MS = 10_000

export interface LedgerPayload {
  events: PolicyPoolEventRow[]
  nextCursor: string | null
  stats: PolicyPoolStats
}

function useNow(stepMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs)
    return () => clearInterval(t)
  }, [stepMs])
  return now
}

export default function PolicyPoolLive({ initial, deployed }: { initial: LedgerPayload; deployed: boolean }) {
  const [data, setData] = useState(initial)
  const [updatedAt, setUpdatedAt] = useState(() => Date.parse(initial.stats.generatedAt))
  const [stale, setStale] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [older, setOlder] = useState<PolicyPoolEventRow[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null>(initial.nextCursor)
  const now = useNow()

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const r = await fetch('/api/policy-pool/events?limit=50', { cache: 'no-store' })
        const j = (await r.json()) as LedgerPayload & { ok: boolean }
        if (!alive) return
        if (j.ok) {
          setData({ events: j.events, nextCursor: j.nextCursor, stats: j.stats })
          setUpdatedAt(Date.now())
          setStale(false)
        } else setStale(true)
      } catch {
        if (alive) setStale(true)
      }
    }
    const t = setInterval(tick, POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const loadOlder = useCallback(async () => {
    if (!olderCursor) return
    const r = await fetch(`/api/policy-pool/events?limit=50&cursor=${encodeURIComponent(olderCursor)}`, { cache: 'no-store' })
    const j = (await r.json()) as LedgerPayload & { ok: boolean }
    if (j.ok) {
      setOlder((o) => [...o, ...j.events])
      setOlderCursor(j.nextCursor)
    }
  }, [olderCursor])

  const s = data.stats
  const seen = new Set(data.events.map((e) => e.id))
  const rows = [...data.events, ...older.filter((e) => !seen.has(e.id))]
  const ago = Math.max(0, Math.round((now - updatedAt) / 1000))
  const empty = s.total === 0
  const funnelMax = Math.max(1, ...s.funnel.map((f) => f.count))
  const hourlyAny = s.hourly.some((b) => b.fills + b.refusals > 0)
  const dailyAny = s.daily.some((b) => b.volumeUsd > 0)

  return (
    <>
      <div className="pp-live" data-live={stale ? 'stale' : 'live'}>
        <span className="pp-live__dot" aria-hidden />
        <span>{stale ? 'reconnecting' : 'live'}</span>
        <span className="pp-live__ago">updated {ago}s ago</span>
      </div>

      <div className="pg__tiles pp-tiles" data-tiles="">
        <Tile k="Fills" v={fmtCount(s.fills)} note="DeskFill events on-chain" />
        <Tile k="Refused by guard" v={fmtCount(s.refusedGuard)} note="never reached a signature" />
        <Tile k="Refused on-chain" v={fmtCount(s.refusedOnchain)} note="the hook reverted" />
        <Tile k="Volume" v={fmtUsd(s.volumeUsd)} note="USDC leg of every fill" />
        <Tile k="Intents" v={fmtCount(s.distinctIntents)} note="distinct desk intents" />
        <Tile k="Last fill" v={s.lastFillAt ? relTime(s.lastFillAt, now) : '—'} note={s.lastFillAt ? clockTime(s.lastFillAt) : 'none yet'} />
      </div>

      <div className="pg__grid pg__grid--2">
        <section className="pg__sec" aria-labelledby="pp-c1">
          <div className="pg__sec-head">
            <h2 className="pg__sec-title" id="pp-c1">Fills vs refusals</h2>
            <span className="pg__sec-note">per hour · last 24h</span>
          </div>
          <div className="pg__chart">
            <div className="pg__chart-legend" aria-label="Legend">
              <span><i style={{ background: 'var(--mk-series-3)' }} />Fills</span>
              <span><i style={{ background: 'var(--mk-series-2)' }} />Refusals (guard + on-chain)</span>
            </div>
            <FillsVsRefusals hourly={s.hourly} />
            {!hourlyAny && <p className="pp-chart__none">No fills or refusals in the last 24 hours.</p>}
          </div>
        </section>
        <section className="pg__sec" aria-labelledby="pp-c2">
          <div className="pg__sec-head">
            <h2 className="pg__sec-title" id="pp-c2">Volume, USD</h2>
            <span className="pg__sec-note">per day · last 14 days</span>
          </div>
          <div className="pg__chart">
            <VolumeByDay daily={s.daily} />
            {!dailyAny && <p className="pp-chart__none">No priced fills in the last 14 days.</p>}
          </div>
        </section>
      </div>
      <details className="pp-table-view">
        <summary>Show the chart numbers as a table</summary>
        <div className="pp-table-wrap">
          <table className="pg__table">
            <thead>
              <tr><th>Day</th><th className="pg__td-num">Fills</th><th className="pg__td-num">Refusals</th><th className="pg__td-num">Volume</th></tr>
            </thead>
            <tbody>
              {s.daily.map((b) => (
                <tr key={b.t}>
                  <td>{new Date(b.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td className="pg__td-num">{b.fills}</td>
                  <td className="pg__td-num">{b.refusals}</td>
                  <td className="pg__td-num">{fmtUsd(b.volumeUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <section className="pg__sec pp-sec" aria-labelledby="pp-funnel">
        <div className="pg__sec-head">
          <h2 className="pg__sec-title" id="pp-funnel">The intent walk</h2>
          <span className="pg__sec-note">distinct intents that reached each step, all time</span>
        </div>
        <ol className="pg__funnel pp-funnel">
          {s.funnel.map((f) => (
            <li className="pg__stop pp-stop" key={f.key} data-step={f.key}>
              <span className="pg__stop-k">{f.label}</span>
              <span className="pg__stop-bar"><span style={{ width: `${(f.count / funnelMax) * 100}%`, background: f.key === 'dune_seen' ? 'var(--mk-series-1)' : 'var(--mk-series-3)' }} /></span>
              <span className="pg__stop-v">{fmtCount(f.count)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="pg__sec pp-sec" aria-labelledby="pp-ledger">
        <div className="pg__sec-head">
          <h2 className="pg__sec-title" id="pp-ledger">The ledger</h2>
          <span className="pg__sec-note">every step, newest first · tap a row for its intent&rsquo;s timeline</span>
        </div>
        <div className="pg__board pp-ledger" role="table" aria-label="Policy pool ledger">
          <div className="pp-lrow pp-lrow--head" role="row">
            {['Kind', 'Intent', 'Origin', 'Swapper', 'In', 'Out', 'USD', 'Tx', 'Reason', 'When'].map((h) => (
              <span role="columnheader" key={h}>{h}</span>
            ))}
          </div>
          {empty ? (
            <p className="pg__empty" data-empty="">
              {deployed
                ? 'No rows yet. The first guard verdict, attestation or fill lands here within seconds.'
                : 'No rows yet — the pool is not deployed. Once the hook is live, every guard verdict, attestation, signature and fill lands here.'}
            </p>
          ) : (
            rows.map((e) => (
              <Fragment key={e.id}>
                <LedgerRow e={e} now={now} open={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))} />
                {open === e.id && <Timeline row={e} />}
              </Fragment>
            ))
          )}
        </div>
        {olderCursor && !empty && (
          <button type="button" className="pg__btn pp-more" onClick={loadOlder}>Load older rows</button>
        )}
      </section>
    </>
  )
}

function Tile({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="pg__tile" data-tile={k}>
      <div className="pg__tile-k">{k}</div>
      <div className="pg__tile-v">{v}</div>
      <div className="pg__tile-n"><span>{note}</span></div>
    </div>
  )
}

export function KindBadge({ kind }: { kind: PolicyPoolEventRow['kind'] }) {
  const m = KIND_META[kind] ?? { label: kind, tone: 'go' as const }
  return (
    <span className="pp-kind" data-tone={m.tone} data-kind={kind}>
      <i aria-hidden />
      {m.label}
    </span>
  )
}

function Origin({ origin }: { origin: string | null }) {
  if (!origin) return <>—</>
  const dune = duneQueryUrl(origin)
  if (dune)
    return (
      <a className="pp-origin pp-origin--dune" href={dune} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} title={origin}>
        <span className="pp-dune" aria-hidden>Dune</span>
        {origin.slice(5)}
      </a>
    )
  return <span className="pp-origin" title={origin}>{origin}</span>
}

function LedgerRow({ e, now, open, onToggle }: { e: PolicyPoolEventRow; now: number; open: boolean; onToggle: () => void }) {
  const ex = explorerFor(e.chainId)
  const stop = (ev: React.MouseEvent) => ev.stopPropagation()
  return (
    <div
      className="pp-lrow"
      role="row"
      tabIndex={0}
      aria-expanded={open}
      data-kind={e.kind}
      onClick={onToggle}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          onToggle()
        }
      }}
    >
      <span role="cell" data-label="Kind"><KindBadge kind={e.kind} /></span>
      <span role="cell" data-label="Intent" className="pp-mono" title={e.intentId ?? undefined} data-empty={e.intentId ? undefined : ""}>{shortIntent(e.intentId)}</span>
      <span role="cell" data-label="Origin" data-empty={e.origin ? undefined : ""}><Origin origin={e.origin} /></span>
      <span role="cell" data-label="Swapper" className="pp-mono" data-empty={e.swapper ? undefined : ""}>
        {e.swapper ? <a href={`${ex}/address/${e.swapper}`} target="_blank" rel="noopener noreferrer" onClick={stop}>{elide(e.swapper)}</a> : '—'}
      </span>
      <span role="cell" data-label="In" className="pp-mono" data-empty={e.amountIn ? undefined : ""}>{fmtAtoms(e.amountIn, e.meta?.currencyIn)}</span>
      <span role="cell" data-label="Out" className="pp-mono" data-empty={e.amountOut ? undefined : ""}>{fmtAtoms(e.amountOut, e.meta?.currencyOut)}</span>
      <span role="cell" data-label="USD" className="pp-mono pp-num" data-empty={e.usd === null ? "" : undefined}>{e.usd === null ? '—' : fmtUsd(e.usd)}</span>
      <span role="cell" data-label="Tx" className="pp-mono" data-empty={e.txHash ? undefined : ""}>
        {e.txHash ? <a href={`${ex}/tx/${e.txHash}`} target="_blank" rel="noopener noreferrer" onClick={stop}>{elide(e.txHash, 6, 4)}</a> : '—'}
      </span>
      <span role="cell" data-label="Reason" className="pp-reason" data-empty={e.reason ? undefined : ""}>{e.reason ?? '—'}</span>
      <span role="cell" data-label="When" className="pp-mono pp-when" title={clockTime(e.createdAt)}>{relTime(e.createdAt, now)}</span>
    </div>
  )
}

function Timeline({ row }: { row: PolicyPoolEventRow }) {
  const [steps, setSteps] = useState<PolicyPoolEventRow[] | null>(row.intentId ? null : [row])
  const [err, setErr] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!row.intentId) return
    let alive = true
    fetch(`/api/policy-pool/events?intentId=${encodeURIComponent(row.intentId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { ok: boolean; events: PolicyPoolEventRow[] }) => {
        if (!alive) return
        if (j.ok) setSteps(j.events)
        else setErr(true)
      })
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [row.intentId])
  return (
    <div className="pp-timeline" ref={ref} role="row" aria-label={`Timeline for intent ${row.intentId ?? row.id}`}>
      <div className="pp-timeline__head">
        Intent <b className="pp-mono">{row.intentId ?? '— (no intent id)'}</b>
      </div>
      {err ? (
        <p className="pg__empty">Couldn&rsquo;t read this intent&rsquo;s timeline. Try again in a moment.</p>
      ) : !steps ? (
        <p className="pg__empty">Reading the timeline…</p>
      ) : (
        <ol className="pp-steps">
          {steps.map((st, i) => {
            const prev = i > 0 ? Date.parse(steps[i - 1].createdAt) : null
            const ex = explorerFor(st.chainId)
            return (
              <li key={st.id} className="pp-step" data-tone={KIND_META[st.kind]?.tone} data-current={st.id === row.id ? 'true' : undefined}>
                <span className="pp-step__dot" aria-hidden />
                <div className="pp-step__body">
                  <div className="pp-step__top">
                    <KindBadge kind={st.kind} />
                    <span className="pp-mono pp-step__t">{clockTime(st.createdAt)}</span>
                    {prev !== null && <span className="pp-mono pp-step__gap">{gap(Date.parse(st.createdAt) - prev)}</span>}
                  </div>
                  <div className="pp-step__sub">
                    {st.usd !== null && <span>{fmtUsd(st.usd)}</span>}
                    {st.origin && <span>origin {st.origin}</span>}
                    {st.txHash && (
                      <a href={`${ex}/tx/${st.txHash}`} target="_blank" rel="noopener noreferrer">tx {elide(st.txHash, 6, 4)}</a>
                    )}
                    {st.reason && <span className="pp-step__reason">{st.reason}</span>}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
