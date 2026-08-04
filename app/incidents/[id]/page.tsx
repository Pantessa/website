import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import Footer from '@/components/Footer'
import RouteTraceTerminal from '@/components/RouteTraceTerminal'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'
import { getIncident } from '@/lib/incidents'
import { getTurnTrace } from '@/lib/route-trace'
import type { RouterTraceEvent } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Incident · Pantessa', robots: { index: false } }

type Params = { params: Promise<{ id: string }> }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-[color:var(--muted-2)] mono">{label}</span>
      <span className="text-[13px] text-white [overflow-wrap:anywhere]">{children}</span>
    </div>
  )
}

export default async function IncidentDetailPage({ params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!isAdminAddress(addr)) notFound()

  const incident = await getIncident(id)
  if (!incident) notFound()

  const trace = (incident.exampleTurnId ? await getTurnTrace(incident.exampleTurnId) : []) as RouterTraceEvent[]

  return (
    <>
      <main className="x-main">
        <div className="svc">
          <Link href="/incidents" className="svc__back mono">
            <ArrowLeft width={14} height={14} />
            Incidents
          </Link>

          <h1 className="text-2xl font-semibold text-white mt-2">{incident.title}</h1>
          <p className="mono text-[12px] text-[color:var(--muted-2)] mt-1">{incident.signature}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 rounded-xl border border-[var(--line)] bg-black/30 p-4">
            <Field label="Status">{incident.status}</Field>
            <Field label="Occurrences">{incident.count}</Field>
            <Field label="First seen">{new Date(incident.firstSeenAt).toLocaleString()}</Field>
            <Field label="Last seen">{new Date(incident.lastSeenAt).toLocaleString()}</Field>
            <Field label="Service">{incident.service ?? '—'}</Field>
            <Field label="Error class">{incident.errorClass ?? '—'}</Field>
            <Field label="Fix PR">
              {incident.prUrl ? (
                <a href={incident.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[color:var(--accent)] hover:underline">
                  {incident.prUrl.replace(/^https?:\/\/github\.com\//, '')} <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                'none yet'
              )}
            </Field>
            <Field label="Turn id">{incident.exampleTurnId ?? '—'}</Field>
          </div>

          <div className="mt-4 rounded-xl border border-[var(--line)] bg-black/30 p-4">
            <p className="text-[10px] uppercase tracking-wide text-[color:var(--muted-2)] mono mb-1">Last error</p>
            <p className="mono text-[12px] text-[#ff6b6b] [overflow-wrap:anywhere]">{incident.lastError ?? '—'}</p>
          </div>

          {/* The failing turn's full trace — what the user asked → how the engine
              routed → the error. This is the link a fix PR cites. */}
          <div className="mt-4 rounded-xl border border-[var(--line)] bg-black/60 overflow-hidden">
            <div className="flex items-center gap-2 px-3 h-10 border-b border-[var(--line)] bg-black/40">
              <span className="text-[11px] font-medium text-white mono uppercase tracking-wide">Failing turn — routing trace</span>
            </div>
            <RouteTraceTerminal
              trace={trace}
              autoscroll={false}
              className="max-h-[520px]"
              emptyHint={<>No trace captured for this turn (it predates trace logging, or USE_DB was off).</>}
            />
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
