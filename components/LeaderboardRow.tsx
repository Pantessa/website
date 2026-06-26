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
        <tr className="border-b border-[var(--line)] bg-white/[0.01]">
          <td colSpan={10} className="px-3 py-3">
            <div className="mb-2 mono text-[11px]">
              <span style={{ color: 'var(--accent)' }}>{health!.live} live</span>
              {health!.needs > 0 ? (
                <span className="text-[color:var(--muted-2)]">
                  {' · '}
                  <span style={{ color: '#f4b740' }}>{health!.needs} need params/auth</span>
                </span>
              ) : null}
              {health!.down > 0 ? (
                <span className="text-[color:var(--muted-2)]">
                  {' · '}
                  <span style={{ color: '#ff6b6b' }}>{health!.down} down</span>
                </span>
              ) : null}
              <span className="text-[color:var(--muted-2)]">{` · ${health!.total} endpoints (free x402 probe)`}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] mono">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-[color:var(--muted-2)]">
                    <th className="py-1 pr-2 w-8 text-center">●</th>
                    <th className="py-1 pr-2 w-12">Method</th>
                    <th className="py-1 pr-2">Endpoint</th>
                    <th className="py-1 pr-2 w-20 text-right">Price</th>
                    <th className="py-1 pl-2 w-20 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {health!.endpoints.map((e, idx) => (
                    <tr key={`${e.method}-${e.url}-${idx}`} className="border-t border-[var(--line)]/40">
                      <td className="py-1 pr-2 text-center">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: stateColor(e.state) }}
                          title={e.status}
                        />
                      </td>
                      <td className="py-1 pr-2 text-[color:var(--muted-2)]">{e.method}</td>
                      <td className="py-1 pr-2 text-[color:var(--muted)] truncate max-w-[440px]" title={e.url}>
                        {cleanUrl(e.url)}
                      </td>
                      <td className="py-1 pr-2 text-right text-[color:var(--muted-2)]">
                        {e.priceUsd != null ? `$${e.priceUsd}` : '—'}
                      </td>
                      <td className="py-1 pl-2 text-right text-[color:var(--muted-2)]">
                        {e.latencyMs != null ? `${e.latencyMs}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}
