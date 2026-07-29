'use client'

// THE SHAPE OF THE MONEY — every signed dollar drawn as what it actually is:
// something that came in through a surface and went out through a venue. Left
// column = where the ask came from (chat, an intent link, an embedded site, a
// standing intent, the guardian, a paying agent). Right column = the venue the
// transaction layer built against. Ribbon thickness is dollars.
//
// This replaces reading two unrelated tables and doing the join in your head.
// The four turn sources are a clean partition server-side (standing wins over
// link), and the two non-turn rails — guardian closes and x402 call fees — are
// appended as their own edges, so the ribbons sum to the hero figure exactly.
// A diagram that doesn't add up is worse than no diagram.
//
// Hand-rolled SVG: hovering a node dims every ribbon that doesn't touch it.
// No layout reads per frame, nothing animates on a clock.

import { useMemo, useState } from 'react'

/** What the ribbons measure. Dollars is the page's currency, but one $7.4k
 *  listing can be 79% of all-time notional — by dollars the diagram is a
 *  single slab and you learn nothing about the other five lanes. Counting
 *  transactions instead is equally true and completely re-shapes it, so the
 *  view is a toggle rather than a judgement call baked in. */
type Measure = 'usd' | 'n'

export interface FlowEdge {
  source: string
  venue: string
  usd: number
  n: number
}

const SOURCE_META: Record<string, { label: string; sub: string; tone: string }> = {
  chat: { label: 'Chat', sub: 'someone typed it here', tone: 'var(--accent)' },
  link: { label: 'Intent links', sub: 'opened a /i link', tone: '#8b9df8' },
  embed: { label: 'Embedded sites', sub: 'the agent on someone else’s page', tone: '#62c8f0' },
  standing: { label: 'Standing intent', sub: 'a job or schedule fired it', tone: '#e8c468' },
  guardian: { label: 'Guardian', sub: 'closed a position on its own', tone: '#f0876f' },
  agents: { label: 'Paying agents', sub: 'x402 call fees', tone: '#b487f0' },
}

const VENUE_LABEL: Record<string, string> = {
  uniswap: 'Uniswap',
  cow: 'CoW Protocol',
  aave: 'Aave',
  'near-intents': 'NEAR Intents',
  hyperliquid: 'Hyperliquid',
  lido: 'Lido',
  lifi: 'LiFi · stocks',
  jobs: 'Jobs API',
  snapshot: 'Snapshot',
  transfer: 'Transfers',
  opensea: 'OpenSea',
  planner: 'Planner-routed',
  manual: 'Direct tools',
  x402: 'MCP call fees',
  unattributed: 'Pre-tagging',
}

const fmtUsd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4).replace(/0+$/, '')}`

const W = 900
const COL_L = 214
const COL_R = 686
const GAP = 7
const SPAN = 372
/** Enough room for a two-line label; below it the node labels itself on one. */
const TWO_LINE = 30

interface Node {
  key: string
  label: string
  sub?: string
  usd: number
  n: number
  tone: string
  y: number
  h: number
}

export default function ActivityFlow({ edges, total }: { edges: FlowEdge[]; total: number }) {
  const [hot, setHot] = useState<string | null>(null)
  const [measure, setMeasure] = useState<Measure>('usd')
  const val = (e: { usd: number; n: number }) => (measure === 'usd' ? e.usd : e.n)

  const model = useMemo(() => {
    const live = edges.filter((e) => e.usd > 0)
    if (!live.length) return null

    const roll = (pick: (e: FlowEdge) => string) => {
      const m = new Map<string, { usd: number; n: number }>()
      for (const e of live) {
        const k = pick(e)
        const cur = m.get(k) ?? { usd: 0, n: 0 }
        cur.usd += e.usd
        cur.n += e.n
        m.set(k, cur)
      }
      return [...m.entries()].sort((a, b) => val(b[1]) - val(a[1]))
    }

    const sum = live.reduce((a, e) => a + val(e), 0)
    // Height stays strictly proportional to the measure — no sqrt, no log, or
    // "thickness is dollars" would be a lie. Every node keeps a floor instead:
    // a $2 lane rendered as a hairline reads as "broken", not "small", and the
    // floor is borrowed back from the lanes that have height to spare.
    const layout = (rows: [string, { usd: number; n: number }][], meta: (k: string) => { label: string; sub?: string; tone: string }): { nodes: Node[]; height: number } => {
      const MIN = 18
      const span = SPAN - GAP * (rows.length - 1)
      const raw = rows.map(([, v]) => (val(v) / sum) * span)
      const short = raw.reduce((a, h) => a + Math.max(0, MIN - h), 0)
      const spare = raw.reduce((a, h) => a + Math.max(0, h - MIN), 0)
      let y = 0
      const nodes = rows.map(([key, v], i) => {
        const h = raw[i] < MIN ? MIN : raw[i] - (spare > 0 ? (short * (raw[i] - MIN)) / spare : 0)
        const m = meta(key)
        const node: Node = { key, label: m.label, sub: m.sub, usd: v.usd, n: v.n, tone: m.tone, y, h }
        y += h + GAP
        return node
      })
      return { nodes, height: y - GAP }
    }

    const src = layout(
      roll((e) => e.source),
      (k) => SOURCE_META[k] ?? { label: k, sub: '', tone: 'var(--muted)' },
    )
    const ven = layout(
      roll((e) => e.venue),
      (k) => ({ label: VENUE_LABEL[k] ?? k, tone: 'var(--accent)' }),
    )

    // Ribbons stack inside each node in the same order on both ends, so the
    // bands nest instead of crossing themselves.
    const srcAt = new Map(src.nodes.map((n) => [n.key, { ...n, cursor: n.y }]))
    const venAt = new Map(ven.nodes.map((n) => [n.key, { ...n, cursor: n.y }]))
    const ribbons = live
      .slice()
      .sort((a, b) => val(b) - val(a))
      .map((e) => {
        const s = srcAt.get(e.source)!
        const v = venAt.get(e.venue)!
        const sh = (val(e) / (val(src.nodes.find((n) => n.key === e.source)!) || val(e))) * s.h
        const vh = (val(e) / (val(ven.nodes.find((n) => n.key === e.venue)!) || val(e))) * v.h
        const y0 = s.cursor
        const y1 = v.cursor
        s.cursor += sh
        v.cursor += vh
        return { ...e, y0, sh, y1, vh, tone: SOURCE_META[e.source]?.tone ?? 'var(--accent)' }
      })

    return { src, ven, ribbons, height: Math.max(src.height, ven.height), sum }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, measure])

  if (!model) return null

  const dim = (k: string, v: string) => (hot && hot !== k && hot !== v ? 0.08 : 1)

  return (
    <div className="flowmap">
      {/* By dollars one big listing can be 79% of all time; by transactions
          the same data tells you which surfaces people actually use. Both are
          true, so the reader picks. */}
      <div className="flowmap__toggle" role="radiogroup" aria-label="Measure">
        {([
          ['usd', '$ moved'],
          ['n', 'transactions'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            role="radio"
            aria-checked={measure === k}
            className={`flowmap__opt mono${measure === k ? ' is-on' : ''}`}
            onClick={() => setMeasure(k)}
          >
            {label}
          </button>
        ))}
      </div>
      <svg className="flowmap__svg" viewBox={`0 0 ${W} ${model.height + 8}`} role="img" aria-label="Money moved, by source and venue">
        <g className="flowmap__ribbons">
          {model.ribbons.map((r, i) => {
            const x0 = COL_L
            const x1 = COL_R
            const c = (x0 + x1) / 2
            return (
              <path
                key={i}
                d={`M ${x0} ${r.y0} C ${c} ${r.y0}, ${c} ${r.y1}, ${x1} ${r.y1} L ${x1} ${r.y1 + r.vh} C ${c} ${r.y1 + r.vh}, ${c} ${r.y0 + r.sh}, ${x0} ${r.y0 + r.sh} Z`}
                fill={r.tone}
                opacity={dim(r.source, r.venue) * 0.26}
                className="flowmap__ribbon"
              />
            )
          })}
        </g>

        {model.src.nodes.map((n) => (
          <g
            key={n.key}
            className="flowmap__node"
            onMouseEnter={() => setHot(n.key)}
            onMouseLeave={() => setHot(null)}
            opacity={hot && hot !== n.key && !model.ribbons.some((r) => r.source === n.key && r.venue === hot) ? 0.35 : 1}
          >
            <rect x={COL_L - 7} y={n.y} width="7" height={n.h} rx="2" fill={n.tone} />
            {n.h >= TWO_LINE ? (
              <>
                <text className="flowmap__lab" x={COL_L - 16} y={n.y + 14} textAnchor="end">
                  {n.label}
                </text>
                <text className="flowmap__val mono" x={COL_L - 16} y={n.y + 28} textAnchor="end">
                  {fmtUsd(n.usd)} · {n.n} tx
                </text>
                {n.sub && n.h > 52 && (
                  <text className="flowmap__sub mono" x={COL_L - 16} y={n.y + 41} textAnchor="end">
                    {n.sub}
                  </text>
                )}
              </>
            ) : (
              /* A floored lane has no room for two lines — one line, or the
                 value collides with the next node's label. */
              <text className="flowmap__lab" x={COL_L - 16} y={n.y + n.h / 2 + 4} textAnchor="end">
                {n.label}{' '}
                <tspan className="flowmap__val mono">
                  {fmtUsd(n.usd)} · {n.n} tx
                </tspan>
              </text>
            )}
          </g>
        ))}

        {model.ven.nodes.map((n) => (
          <g
            key={n.key}
            className="flowmap__node"
            onMouseEnter={() => setHot(n.key)}
            onMouseLeave={() => setHot(null)}
            opacity={hot && hot !== n.key && !model.ribbons.some((r) => r.venue === n.key && r.source === hot) ? 0.35 : 1}
          >
            <rect x={COL_R} y={n.y} width="7" height={n.h} rx="2" fill="var(--accent)" />
            {n.h >= TWO_LINE ? (
              <>
                <text className="flowmap__lab" x={COL_R + 16} y={n.y + 14}>
                  {n.label}
                </text>
                <text className="flowmap__val mono" x={COL_R + 16} y={n.y + 28}>
                  {fmtUsd(n.usd)} · {n.n} tx
                </text>
              </>
            ) : (
              <text className="flowmap__lab" x={COL_R + 16} y={n.y + n.h / 2 + 4}>
                {n.label}{' '}
                <tspan className="flowmap__val mono">
                  {fmtUsd(n.usd)} · {n.n} tx
                </tspan>
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className="flowmap__foot mono">
        <span>
          {measure === 'usd'
            ? `${fmtUsd(model.sum)} of ${fmtUsd(total)} traced end to end`
            : `${model.sum} transactions traced end to end`}
        </span>
        <span className="flowmap__hint">hover a lane to follow it</span>
      </div>
    </div>
  )
}
