import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Footer from '@/components/Footer'
import { getAgentRecord, type AgentRecord } from '@/lib/agent-record'

// /agents/<handle> — an agent's PUBLIC track record: how much real money moved
// through the guarded path under its identity, how many intents its humans
// signed, since when. Keyed on a hash of the agent's desk identity (the raw
// key is never exposed). Money is REAL-traffic only — our own harness can
// never inflate it. This is the moat seed: "clears through Pantessa" as a
// badge reputation compounds behind.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ handle: string }> }

const fmtUsd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params
  const rec = await getAgentRecord(handle).catch(() => null)
  if (!rec) return { title: 'Agent track record — Pantessa' }
  const name = rec.displayName ?? `Agent ${rec.handle.slice(0, 8)}`
  // A zero record never headlines "$0.00" — say what it is until it isn't.
  const title =
    rec.moneyMovedUsd > 0
      ? `${name} — cleared ${fmtUsd(rec.moneyMovedUsd)} through Pantessa`
      : `${name} — agent track record on Pantessa`
  const description =
    rec.signedTurns > 0
      ? `${name} brokered ${rec.intents} intent${rec.intents === 1 ? '' : 's'} through Pantessa's guarded desk — ${rec.signedTurns} signed, ${fmtUsd(rec.moneyMovedUsd)} moved, every transaction guard-checked and signed by a human. A public, non-custodial track record.`
      : `${name} is brokering intents through Pantessa's guarded desk. Public, non-custodial track record — every transaction guard-checked, only a human signs.`
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] px-5 py-4">
      <div className="text-[11px] uppercase tracking-wide text-[color:var(--muted)] mono">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[color:var(--fg)]">{value}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-[color:var(--muted)]">{sub}</div> : null}
    </div>
  )
}

export default async function AgentRecordPage({ params }: Params) {
  const { handle } = await params
  const rec: AgentRecord | null = await getAgentRecord(handle).catch(() => null)
  if (!rec) notFound()

  const name = rec.displayName ?? `Agent ${rec.handle.slice(0, 8)}`

  return (
    <>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="docs__crumbs mono">
          <Link href="/docs/desk">THE DESK</Link> <span>/</span> TRACK RECORD
        </p>

        <h1 className="text-3xl font-semibold text-[color:var(--fg)]">{name}</h1>
        <p className="mt-1 text-[13px] text-[color:var(--muted)] mono">
          agent <span className="text-[color:var(--fg)]">{rec.handle}</span> · clears through Pantessa
        </p>

        <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--muted)]">
          A public, non-custodial track record. Every figure below is the real guarded path — deterministic
          builders wrote each transaction, a human signed it, and our own test traffic is excluded. Nothing
          here can be inflated by us.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Money moved" value={fmtUsd(rec.moneyMovedUsd)} sub="real signed volume" />
          <Stat label="Signed" value={String(rec.signedTurns)} sub="humans who signed" />
          <Stat label="Intents" value={String(rec.intents)} sub="brokered" />
          <Stat label="Handoffs" value={String(rec.handoffs)} sub="sign links minted" />
        </div>

        {rec.signedTurns === 0 ? (
          <p className="mt-6 text-[13px] text-[color:var(--muted)]">
            No signed activity yet — this agent has brokered intents, but no human has signed one through
            Pantessa so far. The record fills in as they do.
          </p>
        ) : null}

        <p className="mt-8 text-[13px] text-[color:var(--muted)]">
          Active {fmtDate(rec.firstSeen)} → {fmtDate(rec.lastSeen)}.{' '}
          <Link href="/docs/desk" className="underline">
            Give your own agent a desk
          </Link>
          .
        </p>
      </main>
      <Footer />
    </>
  )
}
