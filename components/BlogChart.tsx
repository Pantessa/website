// Server-rendered charts for blog posts. The blog renders markdown with raw
// HTML escaped (XSS line), so charts can't be embedded as HTML/SVG in the
// content. Instead a fenced ```chart block carries a small JSON spec and this
// component renders it as inline SVG — no client JS, crawlable, and safe (the
// spec is parsed + rendered, never injected as HTML). Reusable across posts.
//
// Spec shapes:
//   { "type": "bar", "title": "...", "unit": "USD billions", "source": "...",
//     "note": "46% CAGR", "data": [{ "label": "2025", "value": 7.84, "display": "$7.8B" }] }
//   { "type": "stat", "value": "1 in 4", "label": "...", "source": "..." }

interface BarPoint {
  label: string
  value: number
  display?: string
}
interface ChartSpec {
  type: 'bar' | 'stat'
  title?: string
  unit?: string
  source?: string
  note?: string
  data?: BarPoint[]
  value?: string
  label?: string
}

function parse(raw: string): ChartSpec | null {
  try {
    const spec = JSON.parse(raw) as ChartSpec
    if (spec && (spec.type === 'bar' || spec.type === 'stat')) return spec
    return null
  } catch {
    return null
  }
}

function BarChart({ spec }: { spec: ChartSpec }) {
  const data = spec.data ?? []
  if (data.length === 0) return null

  // Geometry (viewBox units; scales to 100% width).
  const W = 600
  const H = 260
  const padX = 16
  const padTop = 30 // room for value labels
  const padBottom = 34 // room for category labels
  const plotH = H - padTop - padBottom
  const max = Math.max(...data.map((d) => d.value), 0) || 1
  const slot = (W - padX * 2) / data.length
  const barW = Math.min(96, slot * 0.56)

  return (
    <figure className="blog__chart">
      {spec.title && <figcaption className="blog__chart-title">{spec.title}</figcaption>}
      {(spec.unit || spec.note) && (
        <p className="blog__chart-sub mono">
          {spec.unit}
          {spec.unit && spec.note ? ' · ' : ''}
          {spec.note}
        </p>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={spec.title ?? 'chart'} className="blog__chart-svg">
        {/* baseline */}
        <line x1={padX} y1={padTop + plotH} x2={W - padX} y2={padTop + plotH} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = Math.max(2, (d.value / max) * plotH)
          const x = padX + slot * i + (slot - barW) / 2
          const y = padTop + plotH - h
          const isLast = i === data.length - 1
          // Greyscale ramp with the latest (future) bar in accent — the growth
          // lands on the accent bar.
          const fill = isLast ? '#3ECF8E' : '#ffffff'
          const op = isLast ? 1 : Math.max(0.32, 0.78 - (data.length - 1 - i) * 0.16)
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barW} height={h} rx={6} fill={fill} fillOpacity={op} />
              <text x={x + barW / 2} y={y - 9} textAnchor="middle" className="blog__chart-val" fill="#ffffff">
                {d.display ?? d.value}
              </text>
              <text x={x + barW / 2} y={H - 12} textAnchor="middle" className="blog__chart-cat" fill="rgba(255,255,255,0.55)">
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
      {spec.source && <figcaption className="blog__chart-src mono">Source: {spec.source}</figcaption>}
    </figure>
  )
}

function StatCallout({ spec }: { spec: ChartSpec }) {
  if (!spec.value) return null
  return (
    <figure className="blog__stat">
      <span className="blog__stat-num">{spec.value}</span>
      {spec.label && <span className="blog__stat-cap">{spec.label}</span>}
      {spec.source && <span className="blog__stat-src mono">Source: {spec.source}</span>}
    </figure>
  )
}

export default function BlogChart({ raw }: { raw: string }) {
  const spec = parse(raw)
  if (!spec) return null
  return spec.type === 'stat' ? <StatCallout spec={spec} /> : <BarChart spec={spec} />
}
