// MiniGauge — a half-ring for a bounded value (0..1 by default): a technical
// score, a utilization, a health factor mapped to a band. The fill wears
// `color` (default accent); the track is the grid ink. Text stays in text
// tokens (never the series color) — the ring beside it carries the tone.

export interface MiniGaugeProps {
  /** 0..1 fraction of the arc to fill. */
  value: number
  size?: number
  stroke?: number
  color?: string
  /** Center label (pre-formatted). */
  label?: string
  /** Small caption under the label. */
  caption?: string
  className?: string
  title?: string
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export default function MiniGauge({ value, size = 64, stroke = 6, color = 'var(--accent)', label, caption, className, title }: MiniGaugeProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const r = size / 2 - stroke / 2 - 1
  const cx = size / 2
  const cy = size / 2 + r * 0.18
  const a0 = Math.PI
  const a1 = 2 * Math.PI
  const h = cy + stroke / 2 + 2
  return (
    <svg className={`mk-gauge ${className ?? ''}`.trim()} width={size} height={h} viewBox={`0 0 ${size} ${h}`} role="img" aria-label={title ?? `${label ?? ''} ${Math.round(v * 100)}%`.trim()}>
      <path className="mk-gauge__track" d={arc(cx, cy, r, a0, a1)} fill="none" strokeWidth={stroke} strokeLinecap="round" />
      {v > 0 ? <path d={arc(cx, cy, r, a0, a0 + (a1 - a0) * v)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" /> : null}
      {label ? (
        <text className="mk-gauge__label" x={cx} y={cy - 2} textAnchor="middle" fontWeight={600}>
          {label}
        </text>
      ) : null}
      {caption ? (
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize={8} fontFamily="var(--mk-font-mono)" fill="var(--muted-2)" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {caption}
        </text>
      ) : null}
    </svg>
  )
}
