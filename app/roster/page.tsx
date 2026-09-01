import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Footer from '@/components/Footer'
import ManagerRow from '@/components/ManagerRow'
import RosterHero from '@/components/RosterHero'
import RosterTranscript from '@/components/RosterTranscript'
import { rosterEnabled } from '@/lib/league'
import { listManagers } from '@/lib/roster-managers'

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
  // ONE house-identity env: HOUSE_MANAGER_KEY (the manager script's own key;
  // the hash is DERIVED server-side — a second hash env would drift). The
  // record trust anchor lights only when a real record exists.
  const houseHandle = managers.find((m) => m.house)?.recordUrl?.split('/').pop() ?? null
  const handleOf = (m: (typeof managers)[number]) => m.recordUrl?.split('/').pop() ?? null
  return (
    <>
      <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <p className="mono mb-8 inline-block rounded-full border border-dashed border-[var(--line-2)] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
          Concept preview · behind ROSTER_ENABLED · not the live landing
        </p>
        <RosterHero />

        {/* Meet your first manager — the FIRST HIRE strip (sprint 08-26): the
            house Rebalancer as a face, not a hash. The CTA targets the
            storefront section's #managers anchor (UI/UX's "Managers" section
            on this page; until it mounts, the link is a harmless no-scroll).
            The optional env hash lights the record trust anchor — reconcile
            the var name with UI/UX's house-identity env. */}
        <section className="mt-14" aria-label="Meet your first manager">
          <p className="mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted)]">
            Meet your first manager
          </p>
          <div className="mt-4">
            <ManagerRow
              name="The Rebalancer"
              house
              handle={houseHandle}
              kinds={['shape']}
              cta={
                <a
                  href="#managers"
                  className="mono rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--bg)]"
                  style={{ background: 'var(--accent)' }}
                >
                  Hire it
                </a>
              }
            />
          </div>
          <p className="mt-2 text-[12px] text-[color:var(--muted)]">
            The house shape-keeper: give it a target like &ldquo;keep me 60/40 ETH/USDC&rdquo; and it
            watches the drift — every fix arrives as a card only you can sign.
          </p>
        </section>

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
        <section className="mt-16" id="managers" aria-label="Hireable managers">
          <p className="mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted)]">
            The managers
          </p>
          <div className="mt-4 space-y-3">
            {managers.map((m) => (
              <div key={m.id} className={m.hireable ? undefined : 'opacity-70'}>
                <ManagerRow
                  name={m.name}
                  house={m.house}
                  founding={m.founding}
                  handle={handleOf(m)}
                  kinds={m.kinds}
                  cta={
                    m.hireable ? (
                      <Link
                        href="/chat?tab=team"
                        className="mono rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--bg)]"
                        style={{ background: 'var(--accent)' }}
                      >
                        Hire it
                      </Link>
                    ) : (
                      <span className="mono text-[10px] uppercase tracking-wide text-[color:var(--muted)]">Coming soon</span>
                    )
                  }
                />
                {m.note && <p className="mt-1 px-1 text-[12px] text-[color:var(--muted)]">{m.note}</p>}
              </div>
            ))}
            {managers.length === 0 && (
              <p className="text-[13px] text-[color:var(--muted)]">
                No managers are listed yet — the storefront fills as the house Rebalancer arms and founding agents earn records.
              </p>
            )}
          </div>
          <p className="mt-3 text-[12.5px] text-[color:var(--muted)]">
            Hiring happens in the{' '}
            <Link href="/chat?tab=team" className="underline">
              Team tab
            </Link>{' '}
            — one signature, fire any time.
          </p>
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
