import { ExternalLink } from 'lucide-react'
import type { ReputationScore } from '@/lib/reputation'
import RateService from '@/components/RateService'

/** Tier → accent color. Exported for the leaderboard. */
export function tierColor(tier: string): string {
  switch (tier) {
    case 'A':
      return 'var(--accent)'
    case 'B':
      return '#6AA8FF'
    case 'C':
      return '#f4b740'
    case 'D':
      return '#f59e0b'
    case 'F':
      return '#ff6b6b'
    default: // Unrated
      return 'var(--muted)'
  }
}

export function TierBadge({ tier, overall }: { tier: string; overall?: number }) {
  const c = tierColor(tier)
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium mono"
      style={{ color: c, border: `1px solid ${c}`, background: `color-mix(in srgb, ${c} 12%, transparent)` }}
      title={overall != null ? `Reputation ${overall}/100` : undefined}
    >
      {tier}
      {overall != null && tier !== 'Unrated' ? <span className="text-[color:var(--muted-2)]">{overall}</span> : null}
    </span>
  )
}

const LABELS: { key: keyof ReputationScore['scores']; label: string }[] = [
  { key: 'reliability', label: 'Reliability' },
  { key: 'liveness', label: 'Liveness' },
  { key: 'speed', label: 'Speed' },
  { key: 'adoption', label: 'Adoption' },
  { key: 'value', label: 'Value' },
  { key: 'userRating', label: 'User rating' },
]

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-24 flex-shrink-0 text-[color:var(--muted)]">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        {value != null && (
          <div className="h-full rounded-full" style={{ width: `${value}%`, background: 'var(--accent)' }} />
        )}
      </div>
      <span className="w-8 text-right mono text-[color:var(--muted-2)]">{value != null ? value : '—'}</span>
    </div>
  )
}

interface Ping {
  id: string
  ok: boolean
  amountUsd: number
  txHash: string | null
  note: string | null
  latencyMs: number | null
  createdAt: string
}

export default function ReputationPanel({
  rep,
  pings,
  rating,
  slug,
}: {
  rep: ReputationScore
  pings: Ping[]
  rating: { average: number | null; count: number; yourRating: number | null }
  slug: string
}) {
  const c = tierColor(rep.tier)
  return (
    <section className="rounded-xl border border-[var(--line)] bg-black/30 p-4 sm:p-5">
      <div className="flex items-start gap-4">
        {/* Overall score */}
        <div className="flex flex-col items-center justify-center flex-shrink-0 w-20">
          <span className="text-3xl font-semibold" style={{ color: c }}>
            {rep.qualified ? rep.overall : '—'}
          </span>
          <TierBadge tier={rep.tier} />
          <span className="mt-1 text-[10px] text-[color:var(--muted-2)] mono">/ 100</span>
        </div>
        {/* Sub-scores */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {LABELS.map(({ key, label }) => (
            <ScoreBar key={key} label={label} value={rep.scores[key]} />
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[color:var(--muted-2)] mono">
        <span>{Math.round(rep.settleRate * 100)}% settle · {rep.settled}/{rep.calls} calls</span>
        {rep.medianLatencyMs != null ? <span>~{(rep.medianLatencyMs / 1000).toFixed(1)}s median</span> : null}
        {rep.avgPriceUsd != null ? (
          <span>{Number(rep.avgPriceUsd) === 0 ? 'free' : `$${rep.avgPriceUsd}/call`}</span>
        ) : null}
        {!rep.qualified ? <span>· unrated — no calls or ratings yet</span> : null}
      </div>

      {/* Recent pings — the success/fail timeline */}
      {pings.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wide text-[color:var(--muted)] mb-1.5 mono">Recent calls</p>
          <div className="flex flex-wrap items-center gap-1">
            {pings.map((p) =>
              p.txHash ? (
                <a
                  key={p.id}
                  href={`https://basescan.org/tx/${p.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${p.ok ? 'settled' : 'failed'}${p.note ? ` — ${p.note}` : ''}${p.latencyMs ? ` · ${p.latencyMs}ms` : ''} · ${new Date(p.createdAt).toLocaleString()}`}
                  className="w-2.5 h-2.5 rounded-sm hover:ring-2 hover:ring-white/30"
                  style={{ background: p.ok ? 'var(--accent)' : '#ff6b6b' }}
                />
              ) : (
                <span
                  key={p.id}
                  title={`${p.ok ? 'settled' : 'failed'}${p.note ? ` — ${p.note}` : ''} · ${new Date(p.createdAt).toLocaleString()}`}
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: p.ok ? 'var(--accent)' : '#ff6b6b' }}
                />
              ),
            )}
            <span className="ml-1 text-[10px] text-[color:var(--muted-2)] inline-flex items-center gap-0.5">
              newest → oldest · tx on BaseScan <ExternalLink className="w-2.5 h-2.5" />
            </span>
          </div>
        </div>
      )}

      {/* User rating */}
      <div className="mt-4 pt-3 border-t border-[var(--line)]">
        <RateService slug={slug} initial={rating} />
      </div>
    </section>
  )
}
