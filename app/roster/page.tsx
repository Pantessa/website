import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Footer from '@/components/Footer'
import RosterHero from '@/components/RosterHero'
import RosterTranscript from '@/components/RosterTranscript'
import { rosterEnabled } from '@/lib/league'
import { listManagers } from '@/lib/roster-managers'
import { MANDATE_KIND_LABELS } from '@/lib/roster-client'

// /roster — the front-door CONCEPT preview (HANDOFF-roster R6, visual half).
// The hero lives here as a standalone page behind ROSTER_ENABLED so Nate can
// see and feel it without the live landing changing by a byte. Fail-closed:
// flag off → 404.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  if (!rosterEnabled()) return { title: 'Not found' }
  return {
    title: 'The Roster — Pantessa',
    description:
      'Your wallet gets a staff. You keep the only pen. Hire AI agents into mandate slots — they can only propose; every move is a guarded, signable card in your inbox.',
  }
}

export default async function RosterPreviewPage() {
  if (!rosterEnabled()) notFound()
  const managers = await listManagers().catch(() => [])
  return (
    <>
      <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <p className="mono mb-8 inline-block rounded-full border border-dashed border-[var(--line-2)] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
          Concept preview · behind ROSTER_ENABLED · not the live landing
        </p>
        <RosterHero />

        {/* How it works — the four stops, in the order a wallet meets them. */}
        <section className="mt-16" aria-label="How the Roster works">
          <p className="mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted)]">
            How it works
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                n: '01',
                t: 'Write the mandate',
                d: 'One sentence — "keep me 60/40 ETH/USDC", capped in dollars. It round-trips the executor’s own grammar or refuses by name.',
              },
              {
                n: '02',
                t: 'Hire with a signature',
                d: 'The consent binds slot, agent hash, mandate hash, cap, and a one-use nonce. No deposit exists — there is nothing to withdraw, ever.',
              },
              {
                n: '03',
                t: 'Proposals arrive',
                d: 'The hired agent’s moves land in your inbox as guarded, signable cards wearing the mandate badge — capped at open and at build.',
              },
              {
                n: '04',
                t: 'Your signature decides',
                d: 'Sign it, or don’t — ignoring is free. Over-cap probing benches the agent by name, and firing is one instant signature.',
              },
            ].map((s) => (
              <div key={s.n} className="rounded-2xl border border-[var(--line)] p-4">
                <div className="mono text-[11px]" style={{ color: 'var(--accent)' }}>
                  {s.n}
                </div>
                <div className="mt-1.5 text-[14px] font-semibold text-[color:var(--fg)]">{s.t}</div>
                <div className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--muted)]">{s.d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* THE STOREFRONT — hireable managers, house first (FIRST HIRE
            sprint). Server-composed: the house identity is the env-key hash
            (never shipped to the client raw), founding rows are owner-set.
            Hiring happens in the Team tab — every row routes there. */}
        <section className="mt-16" aria-label="Hireable managers">
          <p className="mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted)]">
            Meet your first manager
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {managers.map((m) => (
              <div key={m.id} className={`rounded-2xl border border-[var(--line)] p-4${m.hireable ? '' : ' opacity-70'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-[color:var(--fg)] flex-1">{m.name}</span>
                  {m.house && (
                    <span className="mono text-[9px] uppercase tracking-wider rounded-full border border-[var(--line)] px-2 py-0.5" style={{ color: 'var(--accent)' }}>
                      house
                    </span>
                  )}
                  {m.founding && (
                    <span className="mono text-[9px] uppercase tracking-wider rounded-full border border-[var(--line)] px-2 py-0.5 text-[color:var(--muted)]">
                      founding
                    </span>
                  )}
                </div>
                <p className="mt-1.5 mono text-[11px] text-[color:var(--muted)]">
                  {m.kinds.length > 0 ? m.kinds.map((k) => MANDATE_KIND_LABELS[k] ?? k).join(' · ') : 'no mandates served yet'}
                </p>
                {m.note ? (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[color:var(--muted)]">{m.note}</p>
                ) : (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[color:var(--muted)]">
                    {m.recordUrl ? (
                      <>
                        <Link href={m.recordUrl} className="underline">
                          Real track record
                        </Link>{' '}
                        — signed history, harness excluded.{' '}
                      </>
                    ) : null}
                    Hire from the{' '}
                    <Link href="/chat?tab=team" className="underline">
                      Team tab
                    </Link>{' '}
                    — one signature, fire any time.
                  </p>
                )}
              </div>
            ))}
            {managers.length === 0 && (
              <p className="text-[13px] text-[color:var(--muted)]">
                No managers are listed yet — the storefront fills as the house Rebalancer arms and founding agents earn records.
              </p>
            )}
          </div>
        </section>

        {/* The proof — the QA session replayed. */}
        <section className="mt-14" aria-label="A real proof session">
          <p className="mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted)]">
            Watch one slot live and die
          </p>
          <div className="mt-4">
            <RosterTranscript />
          </div>
        </section>

        <p className="mt-12 text-[13px] text-[color:var(--muted)]">
          The standings behind the staff:{' '}
          <Link href="/agents" className="underline">
            the League
          </Link>{' '}
          — every agent ranked by real signed money, harness excluded. The full contract:{' '}
          <Link href="/docs/roster" className="underline">
            docs
          </Link>
          .
        </p>
      </main>
      <Footer />
    </>
  )
}
