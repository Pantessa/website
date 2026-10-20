import { deltaPct, fmtCount, fmtUsd, milestoneOf, MILESTONES_USD } from '@/lib/progress'

export interface Tile {
  k: string
  v: string
  note?: string
  /** current vs previous window, when a previous window exists. */
  delta?: { current: number; previous: number } | null
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const d = deltaPct(current, previous)
  if (d === null) return <span className="pg__delta pg__delta--up">new</span>
  if (d === 0) return <span className="pg__delta">flat</span>
  return <span className={`pg__delta ${d > 0 ? 'pg__delta--up' : 'pg__delta--down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)}%</span>
}

export function StatTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="pg__tiles" data-tiles="">
      {tiles.map((t) => (
        <div className="pg__tile" key={t.k} data-tile={t.k}>
          <div className="pg__tile-k">{t.k}</div>
          <div className="pg__tile-v">{t.v}</div>
          {(t.note || t.delta) && (
            <div className="pg__tile-n">
              {t.delta && <Delta current={t.delta.current} previous={t.delta.previous} />}
              {t.note && <span>{t.note}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** The ladder: how far the whole system is from the next round number. The
 *  rungs are fixed (lib/progress MILESTONES_USD); the figure is all-time
 *  signed notional, so a window switch never moves the goalpost. */
export function MilestoneLadder({ allTimeUsd }: { allTimeUsd: number }) {
  const m = milestoneOf(allTimeUsd)
  const top = MILESTONES_USD[MILESTONES_USD.length - 1]
  return (
    <section className="pg__milestone" aria-label="Milestone" data-milestone={m.target ?? 'top'}>
      <div className="pg__milestone-row">
        <span className="pg__milestone-k">Money moved, all time</span>
        <span className="pg__milestone-v">
          <strong>{fmtUsd(allTimeUsd)}</strong>
          {m.target ? <> · {fmtUsd(m.target - allTimeUsd)} to go · next stop {fmtUsd(m.target)}</> : <> · past {fmtUsd(top)}</>}
        </span>
      </div>
      <div className="pg__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.pct)} aria-label={m.target ? `Progress to ${fmtUsd(m.target)}` : 'Past the ladder'}>
        <span style={{ width: `${Math.max(1, m.pct)}%` }} />
      </div>
      <div className="pg__milestone-ends">
        <span>{fmtUsd(m.reached)}</span>
        <span>{m.target ? fmtUsd(m.target) : '∞'}</span>
      </div>
    </section>
  )
}

export const n = fmtCount
