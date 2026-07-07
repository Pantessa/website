import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import Footer from '@/components/Footer'
import { loadFleetHealth, HEALTH_STATUS_META, type McpHealth, type HealthStatus } from '@/lib/mcp-health'
import { SITE } from '@/lib/docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TITLE = 'MCP Health — how well every MCP is working'
const DESCRIPTION =
  'The self-heal cockpit: every MCP in the Yeetful directory scored on real usage, routability, and unresolved failures — ranked worst-first, each with a path to fix it.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/health` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE}/health`, type: 'website' },
}

const TONE: Record<'good' | 'warn' | 'bad' | 'muted', string> = {
  good: 'var(--accent)',
  warn: '#f4b740',
  bad: '#ff6b6b',
  muted: 'var(--muted)',
}

function StatusPill({ status }: { status: HealthStatus }) {
  const meta = HEALTH_STATUS_META[status]
  const c = TONE[meta.tone]
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] mono uppercase tracking-wide whitespace-nowrap"
      style={{ color: c, border: `1px solid ${c}`, background: `color-mix(in srgb, ${c} 12%, transparent)` }}
    >
      {meta.label}
    </span>
  )
}

function HealthRow({ h }: { h: McpHealth }) {
  const color = TONE[HEALTH_STATUS_META[h.status].tone]
  return (
    <Link
      href={`/servers/${h.slug}`}
      className="group flex items-center gap-4 rounded-xl border p-3.5 min-w-0 transition-colors"
      style={{ borderColor: 'var(--line)', background: 'var(--surf-1)' }}
    >
      <span className="u-name-serif text-[26px] leading-none w-12 text-right flex-shrink-0" style={{ color }}>
        {h.health ?? '—'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] text-[color:var(--fg)] font-medium truncate group-hover:underline">{h.name}</span>
          <StatusPill status={h.status} />
        </span>
        <span className="block text-[12.5px] text-[color:var(--muted)] truncate mt-0.5">{h.headline}</span>
      </span>
      <span className="hidden sm:flex items-center gap-3 flex-shrink-0 mono text-[11px] text-[color:var(--muted-2)]">
        <span title="usage tier · settle rate">{h.reputation?.qualified ? `${h.reputation.tier} ${Math.round(h.reputation.settleRate * 100)}%` : '— '}</span>
        <span title="routability grade">{h.routability ? `R:${h.routability.grade}` : 'R:—'}</span>
        <span title="unresolved failures" style={{ color: h.incidents.open > 0 ? '#ff6b6b' : undefined }}>
          {h.incidents.open > 0 ? `${h.incidents.occurrences}✕` : '0✕'}
        </span>
      </span>
      <ArrowUpRight className="w-4 h-4 flex-shrink-0 text-[color:var(--muted-2)] group-hover:text-[color:var(--fg)]" />
    </Link>
  )
}

export default async function HealthPage() {
  const fleet = await loadFleetHealth()
  const counts = fleet.reduce(
    (a, h) => ((a[h.status] = (a[h.status] ?? 0) + 1), a),
    {} as Record<HealthStatus, number>,
  )
  const attention = fleet.filter((h) => h.status === 'attention')
  const rest = fleet.filter((h) => h.status !== 'attention')

  return (
    <>
      <main className="x-main x-main--fluid">
        <header className="hero" style={{ paddingBottom: 20 }}>
          <p className="hero__eyebrow">SELF-HEAL · LIVE</p>
          <h1 className="hero__h1 hero__h1--sm">
            MCP <span className="x-grad">health.</span>
          </h1>
          <p className="hero__sub">
            Every MCP scored on what actually matters: <strong>real usage</strong> (settle rate,
            latency, adoption), <strong>routability</strong> (can an agent find and call its tools),
            and <strong>unresolved failures</strong> from live traffic. Ranked worst-first — the
            improvement backlog, computed. Fixing an MCP starts on its{' '}
            <Link href="/servers">server page</Link>; the conventions live in{' '}
            <Link href="/docs/routable-mcp">the routable-MCP spec</Link>.
          </p>
        </header>

        {fleet.length === 0 ? (
          <p className="text-[14px] text-[color:var(--muted)]">
            No health data yet — scores appear once MCPs take live traffic and get linted.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-6">
              {(['attention', 'watch', 'healthy', 'unproven'] as HealthStatus[]).map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px]"
                  style={{ borderColor: 'var(--line)', background: 'var(--surf-1)' }}
                >
                  <span className="mono text-[15px]" style={{ color: TONE[HEALTH_STATUS_META[s].tone] }}>
                    {counts[s] ?? 0}
                  </span>
                  <span className="text-[color:var(--muted)]">{HEALTH_STATUS_META[s].label}</span>
                </span>
              ))}
            </div>

            {attention.length > 0 && (
              <section className="mb-8">
                <h2 className="mono text-[11px] uppercase tracking-wide text-[color:var(--muted-2)] mb-2">
                  Needs attention — fix these first
                </h2>
                <div className="flex flex-col gap-2">
                  {attention.map((h) => (
                    <HealthRow key={h.slug} h={h} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mono text-[11px] uppercase tracking-wide text-[color:var(--muted-2)] mb-2">
                The rest of the fleet
              </h2>
              <div className="flex flex-col gap-2">
                {rest.map((h) => (
                  <HealthRow key={h.slug} h={h} />
                ))}
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  )
}
