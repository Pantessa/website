'use client'

// The Technicals tab of /t/<symbol>: the three gauges (Oscillators · Summary
// · Moving Averages) drawn from OUR OWN candles by lib/technicals, the two
// indicator tables, the five pivot families — and under the summary, the
// verdict as buttons. Every chip carries a complete ask an existing parser
// claims (swap / dca / spot-guard / HL guardian / HL open) and SENDS on
// click when the host wires onAsk (the chip-send contract, the same path
// ChartOverlay's chips take); on the standalone page, where no chat is
// mounted, a chip is a /chat?prompt= prefill link — a URL never fires a
// turn. The timeframe strip lists exactly the frames the candle proxy
// serves; `?tf=` is mirrored into the URL (the #705 replaceState idiom) so
// every gauge is a link target.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CHART_TFS, type ChartPair, type ChartTf } from '@/lib/charts'
import { RATING_LABELS, type ChartAction, type Pivots, type Row, type TechnicalsApi, type TechnicalsRefusal } from '@/lib/technicals'
import RatingGauge, { ratingColor } from './RatingGauge'

type Res = TechnicalsApi | TechnicalsRefusal
const isRefusal = (r: Res): r is TechnicalsRefusal => 'error' in r

const POLL_MS = 30_000
const promptHref = (ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`

function fmtVal(v: number): string {
  const a = Math.abs(v)
  const dp = a >= 1000 ? 2 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : 6
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp })
}

function fmtLevel(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  return v.toLocaleString('en-US', { minimumFractionDigits: a >= 1 ? 2 : 4, maximumFractionDigits: a >= 1 ? 2 : 4 })
}

const SIGNAL_WORD: Record<Row['signal'], string> = { buy: 'Buy', neutral: 'Neutral', sell: 'Sell' }

function SignalCell({ signal }: { signal: Row['signal'] }) {
  const color = signal === 'buy' ? 'var(--accent)' : signal === 'sell' ? 'var(--sell)' : 'var(--muted)'
  return (
    <span className="mono text-[10.5px] font-medium uppercase tracking-wider" style={{ color }}>
      {SIGNAL_WORD[signal]}
    </span>
  )
}

function IndicatorTable({ title, rows, omitted }: { title: string; rows: Row[]; omitted: string[] }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surf-1)]">
      <div className="mono border-b border-[var(--line)] px-3 py-2 text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--muted-2)]">{title}</div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="mono text-[9px] uppercase tracking-wider text-[color:var(--muted-2)]">
            <th className="px-3 py-1.5 text-left font-normal">Name</th>
            <th className="px-3 py-1.5 text-right font-normal">Value</th>
            <th className="px-3 py-1.5 text-right font-normal">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-[var(--line)]">
              <td className="px-3 py-1.5 text-[color:var(--fg)]">{r.name}</td>
              <td className="mono px-3 py-1.5 text-right tabular-nums text-[color:var(--muted)]">{fmtVal(r.value)}</td>
              <td className="px-3 py-1.5 text-right">
                <SignalCell signal={r.signal} />
              </td>
            </tr>
          ))}
          {omitted.map((name) => (
            <tr key={name} className="border-t border-[var(--line)] opacity-60">
              <td className="px-3 py-1.5 text-[color:var(--muted)]">{name}</td>
              <td className="mono px-3 py-1.5 text-right text-[color:var(--muted-2)]">—</td>
              <td className="mono px-3 py-1.5 text-right text-[9.5px] uppercase tracking-wider text-[color:var(--muted-2)]">short tape</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const FAMILIES: { key: keyof NonNullable<TechnicalsApi['pivots']>; label: string }[] = [
  { key: 'classic', label: 'Classic' },
  { key: 'fibonacci', label: 'Fibonacci' },
  { key: 'camarilla', label: 'Camarilla' },
  { key: 'woodie', label: 'Woodie' },
  { key: 'dm', label: 'DM' },
]
const LEVELS: (keyof Pivots)[] = ['s3', 's2', 's1', 'p', 'r1', 'r2', 'r3']

function PivotTable({ pivots, period, last }: { pivots: NonNullable<TechnicalsApi['pivots']>; period: string; last: number | null }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surf-1)]">
      <div className="mono flex items-baseline justify-between border-b border-[var(--line)] px-3 py-2 text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--muted-2)]">
        <span>Pivots</span>
        <span>from the last completed {period}</span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="mono text-[9px] uppercase tracking-wider text-[color:var(--muted-2)]">
            <th className="px-3 py-1.5 text-left font-normal">Pivot</th>
            {FAMILIES.map((f) => (
              <th key={f.key} className="px-3 py-1.5 text-right font-normal">
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LEVELS.map((lv) => (
            <tr key={lv} className="border-t border-[var(--line)]">
              <td className="mono px-3 py-1.5 uppercase text-[color:var(--muted)]">{lv}</td>
              {FAMILIES.map((f) => {
                const v = pivots[f.key][lv]
                const above = v !== undefined && last != null && v > last
                const below = v !== undefined && last != null && v < last
                return (
                  <td key={f.key} className="mono px-3 py-1.5 text-right tabular-nums" style={{ color: above ? 'var(--sell)' : below ? 'var(--accent)' : 'var(--fg)' }}>
                    {fmtLevel(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function VerdictChips({ chips, onAsk, compact = false }: { chips: ChartAction[]; onAsk?: (ask: string) => void; compact?: boolean }) {
  const cls = (kind: ChartAction['kind']) =>
    `rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors [@media(hover:none)]:min-h-10 ${
      kind === 'buy' || kind === 'dca'
        ? 'border-[var(--accent)] text-[color:var(--accent)] hover:bg-[var(--accent)] hover:text-[color:var(--ink,#000)]'
        : kind === 'sell'
          ? 'border-[var(--sell)] text-[color:var(--sell)] hover:bg-[var(--sell)] hover:text-white'
          : 'border-[var(--line-2)] text-[color:var(--fg)] hover:border-[var(--fg)]'
    }`
  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 ${compact ? '' : 'mt-3'}`} data-verdict-chips="">
      {chips.map((c) =>
        onAsk ? (
          <button key={c.ask} type="button" onClick={() => onAsk(c.ask)} className={cls(c.kind)} data-ask={c.ask} title={c.ask}>
            {c.label}
          </button>
        ) : (
          <Link key={c.ask} href={promptHref(c.ask)} className={cls(c.kind)} data-ask={c.ask} title={c.ask}>
            {c.label}
          </Link>
        ),
      )}
    </div>
  )
}

export default function TechnicalsTab({
  symbol,
  pair,
  onAsk,
  initialTf,
  mirrorTf = true,
}: {
  symbol: string
  pair: ChartPair | null
  /** The chip-send path (ChartOverlay's onAsk). Absent → /chat?prompt= prefill links. */
  onAsk?: (ask: string) => void
  initialTf?: ChartTf
  /** Mirror the frame into ?tf= (replaceState) so the gauge is a link target. */
  mirrorTf?: boolean
}) {
  const tfKeys = useMemo(() => CHART_TFS.map((t) => t.key), [])
  const [tf, setTfState] = useState<ChartTf>(() => (initialTf && tfKeys.includes(initialTf) ? initialTf : '1d'))
  const [res, setRes] = useState<Res | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const setTf = useCallback(
    (next: ChartTf) => {
      setTfState(next)
      if (mirrorTf && typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.set('tab', 'technicals')
        url.searchParams.set('tf', next)
        window.history.replaceState(window.history.state, '', url.toString())
      }
    },
    [mirrorTf],
  )

  useEffect(() => {
    if (!pair) return
    let alive = true
    setLoading(true)
    fetch(`/api/charts/technicals?symbol=${encodeURIComponent(pair.symbol)}&tf=${tf}`)
      .then((r) => r.json() as Promise<Res>)
      .then((b) => {
        if (alive) setRes(b)
      })
      .catch(() => {
        if (alive) setRes({ symbol: pair.symbol, tf, tfs: tfKeys, error: 'feed unavailable', reason: 'The technicals feed did not answer. Try again in a moment.', chips: [] })
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [pair, tf, tick, tfKeys])

  // A verdict ages: re-read every 30s while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }, POLL_MS)
    return () => clearInterval(id)
  }, [])

  const data = res && !isRefusal(res) ? res : null
  const refusal = res && isRefusal(res) ? res : null
  const sym = pair?.symbol ?? symbol

  if (!pair) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-10 text-center" data-technicals="chartless">
        <p className="text-[14px] text-[color:var(--fg)]">No technicals for {sym || 'this token'} — it has no candle feed here.</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--muted)]">
          Stablecoins chart flat by design; only listed stocks, Coinbase majors and Hyperliquid perps carry a tape to rate.
        </p>
      </section>
    )
  }

  const feedNote = data?.feed === 'yahoo' ? "Yahoo Finance's tape (Robinhood's feed is down)" : data?.source === 'robinhood' ? "Robinhood's 24/7 tape" : data?.feedLabel ? `${data.feedLabel}'s tape` : 'our own tape'

  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-10 pt-4" data-technicals={sym} data-tf={tf}>
      {/* timeframe strip — exactly the frames the candle proxy serves */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="Timeframe">
          {CHART_TFS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tf === t.key}
              onClick={() => setTf(t.key)}
              className={`mono rounded-md px-2.5 py-1 text-[11px] uppercase tracking-wider transition-colors ${
                tf === t.key ? 'bg-[var(--surf-2)] text-[color:var(--fg)]' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mono text-[9.5px] uppercase tracking-[0.14em] text-[color:var(--muted-2)]">
          {data ? `${data.bars} bars · ${data.feedLabel ?? data.source}` : loading ? 'reading the tape…' : ''}
        </div>
      </div>

      {refusal && (
        <div className="mt-6 rounded-xl border border-[var(--line)] px-4 py-6 text-center" data-technicals-refusal={refusal.error}>
          <p className="text-[13px] text-[color:var(--fg)]">{refusal.reason}</p>
          {refusal.error !== 'no chart source' && (
            <button type="button" onClick={() => setTick((t) => t + 1)} className="mt-3 rounded-lg border border-[var(--line-2)] px-3 py-1.5 text-[12px] text-[color:var(--fg)]">
              Try again
            </button>
          )}
        </div>
      )}

      {/* the three gauges */}
      <div className={`mt-5 grid grid-cols-1 items-start gap-6 md:grid-cols-3 ${refusal ? 'hidden' : ''}`}>
        <div className="order-2 md:order-1">
          <RatingGauge title="Oscillators" gauge={data?.oscillators ?? null} loading={loading} />
        </div>
        <div className="order-1 md:order-2">
          <RatingGauge title="Summary" gauge={data?.summary ?? null} size="lg" loading={loading} />
          {data && <VerdictChips chips={data.chips} onAsk={onAsk} />}
          {data && (
            <p className="mono mt-2 text-center text-[9.5px] uppercase tracking-[0.14em] text-[color:var(--muted-2)]">
              {onAsk ? 'sends the ask · your wallet signs' : 'prefills chat · you send it'}
            </p>
          )}
        </div>
        <div className="order-3">
          <RatingGauge title="Moving averages" gauge={data?.movingAverages ?? null} loading={loading} />
        </div>
      </div>

      {data && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <IndicatorTable title="Oscillators" rows={data.rows.oscillators} omitted={data.omitted.filter((n) => !/Average|Ichimoku/.test(n))} />
            <IndicatorTable title="Moving averages" rows={data.rows.movingAverages} omitted={data.omitted.filter((n) => /Average|Ichimoku/.test(n))} />
          </div>
          {data.pivots && (
            <div className="mt-4">
              <PivotTable pivots={data.pivots} period={data.pivotPeriod ?? 'period'} last={data.last} />
            </div>
          )}
          <p className="mono mt-5 text-center text-[9.5px] uppercase tracking-[0.14em] text-[color:var(--muted-2)]" data-technicals-footnote="">
            Computed from {feedNote} · {sym} {tf} · {RATING_LABELS[data.summary.rating]} · not advice
          </p>
        </>
      )}
    </section>
  )
}

export { ratingColor }
