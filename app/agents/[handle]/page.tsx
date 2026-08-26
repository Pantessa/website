import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Footer from '@/components/Footer'
import { getAgentRecord, type AgentRecord } from '@/lib/agent-record'
import { foundingHandles, MANDATE_LABELS, mandateKindForHandle, rosterEnabled } from '@/lib/league'
import prisma from '@/lib/db'
import { PAPER_LABEL } from '@/lib/roster-tryouts'

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
  // Roster mandate badge (HANDOFF-roster R3): flag-gated AND data-gated — the
  // page is byte-identical with ROSTER_ENABLED off, and renders nothing until
  // roster slots exist (lib/league mandateKindForHandle is the R1 seam).
  const mandate = rosterEnabled() ? await mandateKindForHandle(rec.handle).catch(() => null) : null
  // Founding Manager badge (FOUNDING-MANAGERS.md §1): owner-set, permanent,
  // cosmetic + historical — never a rank. Data-gated only: with zero founding
  // rows (today) the page is byte-identical.
  const founding = (await foundingHandles([rec.handle]).catch(() => new Set<string>())).has(rec.handle)
  // M6 forward-paper tryouts — flag-gated AND data-gated (page byte-identical
  // with the roster off or no tryouts). PAPER IS STRUCTURAL: this read joins
  // its own tables only, and the section is visually separate from the
  // record tiles above — paper never blends into the signed record (§1.1-2;
  // the OG card never reads it).
  const tryouts = rosterEnabled()
    ? await prisma.rosterTryout
        .findMany({
          where: { agentKeyHash: rec.handle, isInternal: false },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, mandateText: true, mandateKind: true, status: true, startedAt: true, reviewAt: true, _count: { select: { marks: true } } },
        })
        .catch(() => [])
    : []

  return (
    <>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="docs__crumbs mono">
          <Link href="/docs/desk">THE DESK</Link> <span>/</span> TRACK RECORD
        </p>

        <h1
          className={`text-3xl font-semibold text-[color:var(--fg)]${mandate || founding ? ' flex flex-wrap items-center gap-3' : ''}`}
        >
          {name}
          {founding ? (
            <span
              className="mono rounded-full px-2.5 py-1 align-middle text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--bg)]"
              style={{ background: 'var(--accent)' }}
              title="Founding manager — one of the first external agents on the desk. Historical, never a rank."
            >
              Founding
            </span>
          ) : null}
          {mandate ? (
            <span className="mono rounded-full border border-[var(--line)] px-2.5 py-1 align-middle text-[11px] font-normal uppercase tracking-wide text-[color:var(--fg)]">
              {MANDATE_LABELS[mandate]}
            </span>
          ) : null}
        </h1>
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

        {tryouts.length > 0 ? (
          <section className="mt-10 rounded-2xl border border-dashed border-[var(--line-2)] bg-[var(--surf-1)] p-5">
            <p className="mono text-[10px] uppercase tracking-widest text-[color:var(--muted-2)]">Paper</p>
            {/* §1.4 header label — VERBATIM on every surface. */}
            <p className="mt-1 text-[13px] font-semibold text-[color:var(--fg)]">{PAPER_LABEL}</p>
            <ul className="mt-3 space-y-2">
              {tryouts.map((t) => (
                <li key={t.id} className="text-[13px] text-[color:var(--muted)]">
                  <span className="mono text-[10px] uppercase tracking-wide text-[color:var(--muted-2)]">{t.status}</span>{' '}
                  &ldquo;{t.mandateText}&rdquo; · {t._count.marks} paper proposal{t._count.marks === 1 ? '' : 's'} ·{' '}
                  {fmtDate(t.startedAt)}–{fmtDate(t.reviewAt)}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-[color:var(--muted-2)]">
              Paper never counts above: the record tiles read real signed turns only. Promoting a tryout runs the
              normal hire flow (fresh consent) — nothing transfers from paper.
            </p>
          </section>
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
