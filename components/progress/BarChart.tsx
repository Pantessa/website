import { fmtUsd } from '@/lib/progress'

// A static SVG bar chart the server renders — one or two series on one axis,
// thin bars with a 2px gap, a recessive grid, a native <title> on every bar
// so a hover reads the day's number, the legend in text ink. No client JS:
// these pages are public, cached and crawled.

export interface Series {
  key: string
  label: string
  cls: 'pg__bar-money' | 'pg__bar-s1' | 'pg__bar-s2'
  values: number[]
  fmt: (v: number) => string
}

// Drawn at the width of the two-column card (~360px at 1440), so the axis
// text renders close to 1:1 instead of scaling to a third of its size.
const W = 360
const H = 150
const PAD = { t: 8, r: 6, b: 18, l: 34 }

export function BarChart({ days, series, title }: { days: string[]; series: Series[]; title: string }) {
  const n = days.length
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const slot = plotW / n
  const gap = 2
  const barW = Math.max(1, (slot - gap) / series.length - (series.length > 1 ? gap / series.length : 0))
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH
  const ticks = [0, 0.5, 1].map((f) => max * f)
  const labelEvery = n > 45 ? 15 : n > 14 ? 7 : 1
  const money = series.length === 1 && series[0].cls === 'pg__bar-money'
  const empty = series.every((s) => s.values.every((v) => !(v > 0)))
  return (
    <figure className="pg__chart" data-chart={title} data-empty={empty || undefined}>
      {series.length > 1 && (
        <figcaption className="pg__chart-legend" aria-label="Legend">
          {series.map((s) => (
            <span key={s.key}>
              <i className={s.cls} style={{ background: s.cls === 'pg__bar-s1' ? 'var(--mk-series-1)' : s.cls === 'pg__bar-s2' ? 'var(--mk-series-3)' : 'var(--accent)' }} />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="pg__grid-line" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="pg__axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
              {money ? fmtUsd(t) : Math.round(t).toLocaleString('en-US')}
            </text>
          </g>
        ))}
        {days.map((day, i) =>
          series.map((s, j) => {
            const v = s.values[i] ?? 0
            const x = PAD.l + i * slot + gap / 2 + j * (barW + (series.length > 1 ? gap : 0))
            const h = v > 0 ? Math.max(2, (v / max) * plotH) : 0
            return (
              <rect key={`${s.key}-${day}`} className={s.cls} x={x} y={PAD.t + plotH - h} width={barW} height={h} rx={Math.min(2, barW / 2)}>
                <title>{`${day} · ${s.label}: ${s.fmt(v)}`}</title>
              </rect>
            )
          }),
        )}
        {empty && (
          <text className="pg__axis" x={PAD.l + plotW / 2} y={PAD.t + plotH / 2} textAnchor="middle">
            nothing in this window yet
          </text>
        )}
        {days.map((day, i) =>
          i % labelEvery === 0 ? (
            <text key={day} className="pg__axis" x={PAD.l + i * slot + slot / 2} y={H - 6} textAnchor="middle">
              {day.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  )
}
