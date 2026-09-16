'use client'
// The EARN board on /markets — where an asset can earn, across dapps, with a
// live rate and one chip per row. Rows come from GET /api/markets/earn (the
// venues' own readers); every chip's sentence round-trips its venue's parser
// and SENDS through the index's connect-to-act door (a stranger gets the
// connect door; a connected wallet gets the guarded card). The ladder up top
// is the glance: each asset's best rate as a bar in its venue's ink.
import { useEffect, useMemo, useState } from 'react'
import Bars, { type BarRow } from '@/components/markets/viz/Bars'
import { fmtCompact, seriesVar } from '@/lib/markets-look'
import {
  EARN_AMOUNTS,
  EARN_DEFAULT_USD,
  EARN_FOLD_AT,
  EARN_FOOTNOTE,
  earnClassOf,
  filterEarnRows,
  rankEarnRows,
  rowsFromWire,
  sortEarnRows,
  yieldLadder,
  type EarnClass,
  type EarnResponse,
  type EarnRow,
  type EarnSortKey,
  type EarnVenue,
} from '@/lib/earn'
import './earn.css'

const CLASS_LABELS: { id: EarnClass | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stable', label: 'Stables' },
  { id: 'eth', label: 'ETH' },
  { id: 'btc', label: 'BTC' },
  { id: 'other', label: 'Other' },
]
const VENUE_LABELS: { id: EarnVenue | 'all'; label: string }[] = [
  { id: 'all', label: 'Every venue' },
  { id: 'lido', label: 'Lido' },
  { id: 'aave', label: 'Aave' },
  { id: 'morpho', label: 'Morpho' },
]
const KIND_WORD: Record<EarnRow['kind'], string> = { stake: 'Stake', supply: 'Supply', lend: 'Lend' }

const fmtApy = (n: number | null) => (n == null ? '—' : `${n.toFixed(2)}%`)
const venueInk = (venue: EarnVenue) => `var(${seriesVar(venue)})`

export default function EarnBoard({ onAsk }: { onAsk?: (ask: string) => void }) {
  const [data, setData] = useState<EarnResponse | null>(null)
  const [error, setError] = useState(false)
  const [cls, setCls] = useState<EarnClass | 'all'>('all')
  const [venue, setVenue] = useState<EarnVenue | 'all'>('all')
  const [sort, setSort] = useState<{ key: EarnSortKey; dir: 'asc' | 'desc' }>({ key: 'featured', dir: 'desc' })
  const [open, setOpen] = useState(false)
  const [usd, setUsd] = useState<number>(EARN_DEFAULT_USD)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/markets/earn')
        .then((r) => r.json() as Promise<EarnResponse>)
        .then((b) => {
          if (alive) setData(b)
        })
        .catch(() => {
          if (alive) setError(true)
        })
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const all = useMemo(() => (data ? rankEarnRows(rowsFromWire(data.rows)) : []), [data])
  const filtered = useMemo(() => sortEarnRows(filterEarnRows(all, cls, venue), sort.key, sort.dir), [all, cls, venue, sort])
  const rows = open ? filtered : filtered.slice(0, EARN_FOLD_AT)
  const ladder = useMemo(() => yieldLadder(all, 8), [all])
  const bars: BarRow[] = ladder.map((r) => ({ id: r.id, name: `${r.asset} · ${r.venueLabel}`, value: r.apyPct ?? 0, text: fmtApy(r.apyPct), color: venueInk(r.venue) }))

  const toggle = (key: EarnSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'asset' ? 'asc' : 'desc' }))
  const empty = data && filtered.length === 0

  return (
    <section className="mkt-sec mk-earn" id="earn" aria-label="Earn" data-seat="EarnBoard" data-rows={rows.length}>
      <header className="mkt-sec__head">
        <div>
          <h2 className="mkt-sec__title">Earn</h2>
          <p className="mkt-sec__blurb">Where your assets earn across dapps — Lido, Aave and Morpho, live rates, one chip each. The sentence is the order; your wallet signs.</p>
        </div>
        <span className="mkt-sec__count mono">{all.length ? `${all.length} WAYS TO EARN` : data ? 'NO READ' : 'READING…'}</span>
      </header>

      {ladder.length > 0 && (
        <div className="mk-earn__ladder" aria-label="Best rate per asset">
          <div className="mk-earn__ladderhead mono">
            <span>YIELD LADDER · best rate we list per asset</span>
            <span className="mk-earn__legend">
              {VENUE_LABELS.filter((v) => v.id !== 'all').map((v) => (
                <span key={v.id} className="mk-earn__legenditem">
                  <i style={{ background: venueInk(v.id as EarnVenue) }} aria-hidden="true" /> {v.label}
                </span>
              ))}
            </span>
          </div>
          <Bars rows={bars} className="mk-earn__bars" />
        </div>
      )}

      <div className="mk-earn__board">
        <div className="mk-earn__bar">
          <div className="mk-earn__chips" role="group" aria-label="Asset class">
            {CLASS_LABELS.map((c) => (
              <button key={c.id} type="button" className={`mk-earn__chip${cls === c.id ? ' is-on' : ''}`} aria-pressed={cls === c.id} onClick={() => setCls(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="mk-earn__chips" role="group" aria-label="Venue">
            {VENUE_LABELS.map((v) => (
              <button key={v.id} type="button" className={`mk-earn__chip${venue === v.id ? ' is-on' : ''}`} aria-pressed={venue === v.id} onClick={() => setVenue(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="mk-earn__chips mk-earn__amounts" role="group" aria-label="Amount">
            <span className="mono">FOR</span>
            {EARN_AMOUNTS.map((a) => (
              <button key={a} type="button" className={`mk-earn__chip${usd === a ? ' is-on' : ''}`} aria-pressed={usd === a} onClick={() => setUsd(a)}>
                ${a}
              </button>
            ))}
          </div>
        </div>
        <div className="mk-table__sortbar" role="group" aria-label="Sort">
          {(
            [
              ['featured', 'Familiar first'],
              ['apy', 'Rate'],
              ['tvl', 'Earning there'],
              ['asset', 'Asset'],
            ] as [EarnSortKey, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" className={`mk-table__sort${sort.key === k ? ' is-on' : ''}`} onClick={() => toggle(k)} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              {label} {sort.key === k ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>
        <div className="mk-earn__rows" role="list" aria-label="Ways to earn">
          {rows.map((r) => {
            const ask = r.askFor(usd)
            return (
              <div key={r.id} className="mk-earn__row" role="listitem" data-venue={r.venue} data-best={r.best || undefined}>
                <div className="mk-earn__asset">
                  <span className="mk-table__sym">{r.asset}</span>
                  <span className="mk-earn__cls mono">{earnClassOf(r.asset).toUpperCase()}</span>
                  {r.receives && <span className="mk-earn__recv mono">→ {r.receives}</span>}
                </div>
                <div className="mk-earn__venue">
                  <i className="mk-earn__ink" style={{ background: venueInk(r.venue) }} aria-hidden="true" />
                  <span className="mk-earn__venuetext">
                    <span>
                      <b>{r.venueLabel}</b> <span className="mono mk-earn__chain">{r.chainLabel}</span>
                    </span>
                    <small>{r.detail}</small>
                  </span>
                </div>
                <div className="mk-earn__apy mono">
                  {fmtApy(r.apyPct)}
                  {r.best && <span className="mk-earn__best mono">BEST</span>}
                </div>
                <div className="mk-earn__tvl mono">{r.tvlUsd == null ? <span className="mk-table__dash">—</span> : fmtCompact(r.tvlUsd, { usd: true })}</div>
                <div className="mk-earn__act">
                  {ask ? (
                    <button type="button" className="mkt-exec__chip mk-earn__go" onClick={() => onAsk?.(ask)} title={ask} disabled={!onAsk}>
                      {KIND_WORD[r.kind]} ${usd}
                    </button>
                  ) : (
                    <span className="mk-table__dash mono" title="No live price to size this in ETH">—</span>
                  )}
                </div>
              </div>
            )
          })}
          {empty && <p className="mk-earn__empty">{error || data!.failed.length === 3 ? 'The venues did not answer just now — nothing is shown rather than a stale rate.' : 'Nothing in this filter.'}</p>}
        </div>
        {filtered.length > EARN_FOLD_AT && (
          <button type="button" className="mkt-sec__more mono mk-earn__more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'SHOW FEWER' : `SHOW ALL ${filtered.length}`}
          </button>
        )}
        <p className="mk-earn__foot mono">
          {EARN_FOOTNOTE}
          {data?.failed.length ? ` · not answering: ${data.failed.join(', ')}` : ''}
          {data?.asOf ? ` · as of ${new Date(data.asOf).toUTCString().slice(17, 25)} UTC` : ''}
        </p>
      </div>
    </section>
  )
}
