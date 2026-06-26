'use client'

import { useState } from 'react'
import Link from 'next/link'
import BrandIcon from '@/components/BrandIcon'
import { TierBadge, tierColor } from '@/components/ReputationPanel'
import type { ReputationScore } from '@/lib/reputation'
import type { ServiceHealth, HealthState } from '@/lib/health'

export interface LeaderboardRowData {
  rank: number
  slug: string
  name: string
  description: string
  category: string
  websiteUrl: string | null
  color: string | null
  iconSlug: string | null
  callable: boolean
  rep: ReputationScore
  health: ServiceHealth | null
}

const stateColor = (s: HealthState): string =>
  s === 'live' ? 'var(--accent)' : s === 'needs' ? '#f4b740' : '#ff6b6b'

const stateLabel = (s: HealthState): string =>
  s === 'live' ? 'live' : s === 'needs' ? 'needs auth' : 'down'

const cleanUrl = (u: string) => u.replace(/^https?:\/\//, '')

export default function LeaderboardRow({ row }: { row: LeaderboardRowData }) {
  const [open, setOpen] = useState(false)
  const { rep, health } = row
  const hasHealth = !!health && health.total > 0
  const summaryState: HealthState | null = hasHealth
    ? health!.live > 0
      ? 'live'
      : health!.needs > 0
        ? 'needs'
        : 'down'
    : null

  return (
    <>
      <tr className="border-b border-[var(--line)] hover:bg-white/[0.02]">
        <td className="py-2 pr-1 w-6 align-middle">
          {hasHealth ? (
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? 'Hide endpoints' : 'Show endpoints'}
              className="mono text-[11px] leading-none text-[color:var(--muted-2)] hover:text-[color:var(--fg)]"
            >
              {open ? '▾' : '▸'}
            </button>
          ) : null}
        </td>
        <td className="py-2 pr-2 mono text-[color:var(--muted-2)]">{rep.qualified ? row.rank : '—'}</td>
        <td className="py-2 pr-2">
          <Link href={`/servers/${row.slug}`} className="flex items-center gap-2 group min-w-0">
            <BrandIcon
              server={{
                id: row.slug,
                slug: row.slug,
                name: row.name,
                description: row.description,
                category: row.category,
                websiteUrl: row.websiteUrl,
                color: row.color,
                iconSlug: row.iconSlug,
              }}
              size={20}
            />
            <span className="truncate group-hover:underline">{row.name}</span>
            {row.callable ? (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: 'var(--accent)' }}
                title="Callable in chat"
              />
            ) : null}
          </Link>
        </td>
        <td className="py-2 px-2 text-center whitespace-nowrap">
          {hasHealth ? (
            <span className="inline-flex items-center gap-1.5" title={`${health!.live}/${health!.total} endpoints live`}>
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: stateColor(summaryState!) }}
              />
              <span className="mono text-[11px] text-[color:var(--muted)]">
                {health!.live}/{health!.total}
              </span>
            </span>
          ) : (
            <span className="text-[color:var(--muted-2)]">—</span>
          )}
        </td>
        <td className="py-2 px-2 text-center">
          <TierBadge tier={rep.tier} />
        </td>
        <td className="py-2 px-2 text-right mono font-medium" style={{ color: tierColor(rep.tier) }}>
          {rep.qualified ? rep.overall : '—'}
        </td>
        <td className="py-2 px-2 text-right mono text-[color:var(--muted)] hidden sm:table-cell">
          {rep.scores.reliability}
        </td>
        <td className="py-2 px-2 text-right mono text-[color:var(--muted)] hidden md:table-cell">
          {Math.round(rep.settleRate * 100)}%
        </td>
        <td className="py-2 px-2 text-right mono text-[color:var(--muted)] hidden md:table-cell">{rep.calls}</td>
        <td className="py-2 pl-2 text-right mono text-[color:var(--muted-2)] hidden lg:table-cell">
          {rep.ratingCount > 0 ? `${rep.ratingAvg?.toFixed(1)}★ (${rep.ratingCount})` : '—'}
        </td>
      </tr>

      {open && hasHealth ? (
        <tr className="bg-white/[0.01]">
          <td colSpan={10} className="p-0">
            <div className="swtry__rows mono" style={{ borderTop: '1px solid var(--line)' }}>
              <div style={{ padding: '10px 18px 6px', fontSize: 11.5 }}>
                <span style={{ color: 'var(--accent)' }}>{health!.live} live</span>
                {health!.needs > 0 ? (
                  <span style={{ color: 'var(--muted-2)' }}>
                    {' · '}
                    <span style={{ color: '#f4b740' }}>{health!.needs} need params/auth</span>
                  </span>
                ) : null}
                {health!.down > 0 ? (
                  <span style={{ color: 'var(--muted-2)' }}>
                    {' · '}
                    <span style={{ color: '#ff6b6b' }}>{health!.down} down</span>
                  </span>
                ) : null}
                <span style={{ color: 'var(--muted-2)' }}>{` · ${health!.total} endpoints · free x402 probe`}</span>
              </div>
              {health!.endpoints.map((e, idx) => (
                <div className="swtry__item" key={`${e.method}-${e.url}-${idx}`}>
                  <div style={{ padding: '11px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="swtry__call">
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          color: stateColor(e.state),
                          whiteSpace: 'nowrap',
                        }}
                        title={e.status}
                      >
                        <span
                          style={{ width: 7, height: 7, borderRadius: 999, background: stateColor(e.state), display: 'inline-block' }}
                        />
                        {stateLabel(e.state)}
                      </span>
                      <span className="swtry__method">{e.method}</span>
                      <span className="swtry__url">{cleanUrl(e.url)}</span>
                    </div>
                    <div className="swtry__meta">
                      <span>{e.priceUsd != null ? `$${e.priceUsd.toFixed(4)} / call · x402` : 'price —'}</span>
                      {e.latencyMs != null ? <span>{e.latencyMs}ms</span> : null}
                      <span>{e.status}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}
