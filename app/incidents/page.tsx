import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import Footer from '@/components/Footer'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'
import { listIncidents } from '@/lib/incidents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Routing incidents · Pantessa', robots: { index: false } }

/** open → amber, dispatched → blue, pr_open → accent, resolved → muted. */
function statusColor(s: string): string {
  switch (s) {
    case 'open':
      return '#f4b740'
    case 'dispatched':
      return '#6AA8FF'
    case 'pr_open':
      return 'var(--accent)'
    default:
      return 'var(--muted)'
  }
}

function rel(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export default async function IncidentsPage() {
  const addr = await getSessionAddress()
  if (!isAdminAddress(addr)) notFound() // admin-only; 404 to non-admins

  const incidents = await listIncidents()
  const open = incidents.filter((i) => i.status !== 'resolved' && i.status !== 'wontfix')

  return (
    <>
      <main className="x-main x-main--fluid">
        <header className="hero" style={{ paddingBottom: 20 }}>
          <p className="hero__eyebrow">SELF-HEAL · ADMIN</p>
          <h1 className="hero__h1 hero__h1--sm">
            Routing <em className="hero__em">incidents.</em>
          </h1>
          <p className="hero__sub">
            Deduplicated routing failures — grouped by service + error class. Each links to the failing turn&apos;s
            full trace (what the user asked → how the engine routed → the error). {open.length} open.
          </p>
        </header>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full border-collapse text-[13px] min-w-[720px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--muted)] mono border-b border-[var(--line)]">
                <th className="py-2 pr-2">Incident</th>
                <th className="py-2 px-2 w-24">Status</th>
                <th className="py-2 px-2 w-16 text-right">Count</th>
                <th className="py-2 px-2 w-20 text-right">Last</th>
                <th className="py-2 pl-2">Last error</th>
                <th className="py-2 pl-2 w-16">PR</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id} className="border-b border-[var(--line)] hover:bg-white/[0.02] align-top">
                  <td className="py-2 pr-2">
                    <Link href={`/incidents/${i.id}`} className="group">
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: statusColor(i.status) }} />
                        <span className="group-hover:underline">{i.title}</span>
                      </span>
                      <span className="block mono text-[11px] text-[color:var(--muted-2)] mt-0.5">{i.signature}</span>
                    </Link>
                  </td>
                  <td className="py-2 px-2">
                    <span
                      className="inline-block rounded-md px-1.5 py-0.5 text-[11px] mono"
                      style={{ color: statusColor(i.status), border: `1px solid ${statusColor(i.status)}` }}
                    >
                      {i.status}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right mono">{i.count}</td>
                  <td className="py-2 px-2 text-right mono text-[color:var(--muted-2)]">{rel(i.lastSeenAt)}</td>
                  <td className="py-2 pl-2 text-[color:var(--muted)] [overflow-wrap:anywhere] max-w-[360px]">
                    {i.lastError ?? '—'}
                  </td>
                  <td className="py-2 pl-2">
                    {i.prUrl ? (
                      <a href={i.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[color:var(--accent)] hover:underline">
                        PR <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {incidents.length === 0 && (
            <p className="py-12 text-center text-[color:var(--muted)] text-sm">No incidents — routing is clean. 🎉</p>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
