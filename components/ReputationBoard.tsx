'use client'

// The MCP reputation board on /benchmarks — every x402 MCP as a row, graded
// A–F from real paid calls. Shares its shape with the money-by-venue board on
// /activity (medallion · name · faint/solid bars · ratio ring · right-hand
// figure), so the two public scoreboards read as one system.
//
// Bars: faint = reliability sub-score, solid = the blended overall. Ring =
// endpoints answering the free x402 liveness probe; expand a row to see each
// endpoint green or red.

import { useState } from 'react'
import Link from 'next/link'
import { ConvRing, Medallion } from '@/components/board-ui'
import { tierColor } from '@/components/ReputationPanel'
import type { ReputationScore } from '@/lib/reputation'
import type { ServiceHealth, HealthState } from '@/lib/health'

export interface ReputationRowData {
  rank: number
  slug: string
  name: string
  category: string
  priceUsd: string | null
  iconSlug: string | null
  logoUrl: string | null
  callable: boolean
  rep: ReputationScore
  health: ServiceHealth | null
}

const stateColor = (s: HealthState): string =>
  s === 'live' ? 'var(--accent)' : s === 'needs' ? '#f4b740' : '#ff6b6b'

const stateLabel = (s: HealthState): string =>
  s === 'live' ? 'live' : s === 'needs' ? 'needs auth' : 'down'

const cleanUrl = (u: string) => u.replace(/^https?:\/\//, '')

/** The dimensions behind the one bar, in weight order — on hover, so the blend
 *  is inspectable without a second bar competing with it. */
const DIMS: { key: keyof ReputationScore['scores']; label: string }[] = [
  { key: 'reliability', label: 'reliability' },
  { key: 'liveness', label: 'liveness' },
  { key: 'adoption', label: 'adoption' },
  { key: 'speed', label: 'speed' },
  { key: 'value', label: 'value' },
  { key: 'userRating', label: 'ratings' },
]

/** "reliability 98 · liveness 100 · speed — (no data)". A null dim drops out of
 *  the blend entirely, so it reads as absent rather than zero. */
const breakdown = (rep: ReputationScore): string =>
  DIMS.map(({ key, label }) => {
    const v = rep.scores[key]
    return `${label} ${v == null ? '—' : v}`
  }).join(' · ')

/** What the row IS, under its name: category · price. Free MCPs say so. */
const subline = (row: ReputationRowData): string => {
  const price = row.priceUsd != null && Number(row.priceUsd) > 0 ? `$${Number(row.priceUsd)}/call` : 'free'
  return `${row.category.toLowerCase()} · ${price}`
}

function Row({ row }: { row: ReputationRowData }) {
  const [open, setOpen] = useState(false)
  const { rep, health } = row
  const hasHealth = !!health && health.total > 0
  const liveRatio = hasHealth ? health!.live / health!.total : null
  const color = tierColor(rep.tier)

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3 sm:gap-4 py-3 min-w-0">
        <span className="mono text-[11px] tabular-nums text-[color:var(--muted-2)] w-5 text-right flex-shrink-0 hidden sm:block">
          {rep.qualified ? row.rank : '—'}
        </span>
        <Medallion name={row.name} keys={[row.iconSlug, row.slug]} logoUrl={row.logoUrl} />
        <div className="w-36 sm:w-52 flex-shrink-0 min-w-0">
          <Link href={`/servers/${row.slug}`} className="flex items-center gap-1.5 min-w-0 group">
            <span className="text-[color:var(--fg)] text-[14px] font-medium truncate group-hover:underline">
              {row.name}
            </span>
            {row.callable && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: 'var(--accent)' }}
                title="Callable in chat"
              />
            )}
          </Link>
          <p className="mono text-[10.5px] text-[color:var(--muted-2)] truncate">{subline(row)}</p>
        </div>

        {/* One bar: the blended score out of 100, in its tier's colour so the
            bar and the number say the same thing. The dimensions behind it are
            on hover — a second bar only ever tracked this one. */}
        <div
          className="flex-1 hidden sm:block min-w-0 h-3 rounded overflow-hidden"
          style={{ background: 'color-mix(in srgb, var(--fg) 5%, transparent)' }}
          title={rep.qualified ? breakdown(rep) : 'Not enough calls or ratings to grade yet'}
        >
          <div
            className="h-full rounded transition-[width] duration-500"
            style={{ width: `${rep.qualified ? Math.max(2, rep.overall) : 0}%`, background: color }}
          />
        </div>

        {/* the ring: endpoints answering the free liveness probe */}
        <div className="flex items-center gap-2 w-24 flex-shrink-0 justify-end">
          {liveRatio != null ? (
            <>
              <ConvRing pct={liveRatio} color={stateColor(health!.live > 0 ? 'live' : health!.needs > 0 ? 'needs' : 'down')} />
              <span className="mono text-[12px] tabular-nums text-[color:var(--muted)] w-9 text-right">
                {health!.live}/{health!.total}
              </span>
            </>
          ) : (
            // Most services have never been probed — a dash keeps the column
            // quiet instead of stamping a chip down the whole board.
            <span className="mono text-[12px] text-[color:var(--muted-2)]" title="No liveness probe yet">
              —
            </span>
          )}
        </div>

        <div className="w-28 flex-shrink-0 text-right">
          <p className="mono text-[14px] tabular-nums" style={{ color: rep.qualified ? color : 'var(--muted-2)' }}>
            {rep.qualified ? `${rep.overall} · ${rep.tier}` : 'new'}
          </p>
          <p className="mono text-[10.5px] text-[color:var(--muted-2)] tabular-nums">
            {rep.calls} call{rep.calls === 1 ? '' : 's'}
            {rep.ratingCount > 0 ? ` · ${rep.ratingAvg?.toFixed(1)}★` : ''}
          </p>
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Hide ${row.name} endpoints` : `Show ${row.name} endpoints`}
          disabled={!hasHealth}
          className="mono text-[11px] leading-none w-4 flex-shrink-0 text-[color:var(--muted-2)] enabled:hover:text-[color:var(--fg)] disabled:opacity-0"
        >
          {open ? '▾' : '▸'}
        </button>
      </div>

      {open && hasHealth && (
        <div className="pb-3 -mt-1">
          <div className="rounded-xl border border-[var(--line)] overflow-hidden" style={{ background: 'color-mix(in srgb, var(--fg) 3%, transparent)' }}>
            <div className="mono text-[11.5px] px-4 pt-2.5 pb-1.5">
              <span style={{ color: 'var(--accent)' }}>{health!.live} live</span>
              {health!.needs > 0 && (
                <span className="text-[color:var(--muted-2)]">
                  {' · '}
                  <span style={{ color: '#f4b740' }}>{health!.needs} need params/auth</span>
                </span>
              )}
              {health!.down > 0 && (
                <span className="text-[color:var(--muted-2)]">
                  {' · '}
                  <span style={{ color: '#ff6b6b' }}>{health!.down} down</span>
                </span>
              )}
              <span className="text-[color:var(--muted-2)]">{` · ${health!.total} endpoints · free x402 probe`}</span>
            </div>
            <div className="flex flex-col divide-y divide-[color:var(--line)]">
              {health!.endpoints.map((e, idx) => (
                <div key={`${e.method}-${e.url}-${idx}`} className="flex flex-col gap-1.5 px-4 py-2.5 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 mono text-[12px]">
                    <span
                      className="inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                      style={{ color: stateColor(e.state) }}
                      title={e.status}
                    >
                      <span className="w-[7px] h-[7px] rounded-full inline-block" style={{ background: stateColor(e.state) }} />
                      {stateLabel(e.state)}
                    </span>
                    <span className="text-[color:var(--muted-2)] flex-shrink-0">{e.method}</span>
                    <span className="text-[color:var(--muted)] truncate">{cleanUrl(e.url)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 mono text-[10.5px] text-[color:var(--muted-2)]">
                    <span>{e.priceUsd != null ? `$${e.priceUsd.toFixed(4)} / call · x402` : 'price —'}</span>
                    {e.latencyMs != null && <span>{e.latencyMs}ms</span>}
                    <span>{e.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReputationBoard({ rows }: { rows: ReputationRowData[] }) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-[color:var(--muted-2)] py-4">No services to rank yet.</p>
  }
  return (
    <>
      <div className="flex flex-col divide-y divide-[color:var(--line)]">
        {rows.map((row) => (
          <Row key={row.slug} row={row} />
        ))}
      </div>
      <p className="mono text-[10.5px] text-[color:var(--muted-2)] mt-3">
        bar = overall score out of 100, coloured by tier (hover for the dimensions behind it) · ring = endpoints
        answering the free x402 probe
      </p>
    </>
  )
}
