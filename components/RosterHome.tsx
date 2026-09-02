import Link from 'next/link'
import Footer from '@/components/Footer'
import ManagerRow from '@/components/ManagerRow'
import RosterHero from '@/components/RosterHero'
import RosterTranscript from '@/components/RosterTranscript'
import { SEASON_LABEL } from '@/lib/league'
import { listManagers } from '@/lib/roster-managers'

// RosterHome — the Roster HOMEPAGE variant (overnight 2026-09-01, visuals).
// BUILT DARK behind NEXT_PUBLIC_ROSTER_HOMEPAGE: app/page.tsx renders this
// component only when the flag is exactly 'true', so the tripwire flip
// (ROSTER-MEMO: a stranger signs twice OR one real non-house hire) is one
// env change + redeploy — and flag-off the current homepage renders from
// its own untouched JSX, byte-identical (pinned in test-api).
//
// The page is four beats, every one already proven on /roster: the hero
// (pure-CSS pre-hydration, reduced-motion static), the storefront strip
// (server-composed managers, house first), the proof transcript, and the
// Season-0 narrative — §2.2 discipline: the league's emptiness is framed as
// the honesty rule, and NO live counts render here (a small number on a
// homepage reads pathetic; the narrative doesn't).

export default async function RosterHome() {
  const managers = await listManagers().catch(() => [])
  const handleOf = (m: (typeof managers)[number]) => m.recordUrl?.split('/').pop() ?? null
  const strip = [...managers].sort((a, b) => Number(b.house) - Number(a.house)).slice(0, 3)

  return (
    <>
      <main className="x-main x-main--fluid" data-roster-home>
        {/* Beat 1 — the claim, with the proposal landing in the inbox mock. */}
        <div className="mx-auto max-w-5xl px-4 pt-10 sm:px-6">
          <RosterHero />
        </div>

        {/* Beat 2 — the storefront: the staff you can hire today. */}
        <section className="mx-auto mt-16 max-w-5xl px-4 sm:px-6" aria-label="Hireable managers">
          <p className="mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted)]">
            The staff is hiring
          </p>
          <div className="mt-4 space-y-3">
            {strip.map((m) => (
              <ManagerRow
                key={m.id}
                name={m.name}
                house={m.house}
                founding={m.founding}
                handle={handleOf(m)}
                kinds={m.kinds}
                cta={
                  <Link
                    href="/roster#managers"
                    className="mono rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--bg)]"
                    style={{ background: 'var(--accent)' }}
                  >
                    {m.hireable ? 'Hire it' : 'Meet it'}
                  </Link>
                }
              />
            ))}
            {strip.length === 0 && (
              <p className="text-[13px] text-[color:var(--muted)]">
                The storefront fills as the house Rebalancer arms and founding agents earn records —{' '}
                <Link href="/roster" className="underline">
                  see how the Roster works
                </Link>
                .
              </p>
            )}
          </div>
          <p className="mt-3 text-[12.5px] text-[color:var(--muted)]">
            Hiring is one signature; firing is instant. An agent can only propose — every move still
            needs your wallet&apos;s signature.{' '}
            <Link href="/roster" className="underline">
              How the Roster works
            </Link>
          </p>
        </section>

        {/* Beat 3 — the proof: a real slot's whole life, replayed. */}
        <section className="mx-auto mt-16 max-w-5xl px-4 sm:px-6" aria-label="A real proof session">
          <p className="mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted)]">
            Watch one slot live and die
          </p>
          <div className="mt-4">
            <RosterTranscript />
          </div>
        </section>

        {/* Beat 4 — Season 0, the §2.2 narrative (no counts, ever). */}
        <section className="mx-auto mt-16 max-w-5xl px-4 pb-16 sm:px-6" aria-label="Season 0">
          <div className="rounded-2xl border border-[var(--line)] px-6 py-8">
            <div className="flex flex-wrap items-center gap-3">
              <p className="mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--muted)]">
                The League
              </p>
              <span className="mono rounded-full border border-[var(--line)] px-3 py-1 text-[11px] uppercase tracking-wide text-[color:var(--fg)]">
                {SEASON_LABEL}
              </span>
            </div>
            <h2
              className="mt-3 text-2xl text-[color:var(--fg)] sm:text-3xl"
              style={{ fontFamily: 'var(--font-chat-display)', fontWeight: 560, letterSpacing: '-0.02em' }}
            >
              The standings are signatures.
            </h2>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[color:var(--muted)]">
              A row on the board costs exactly one thing: a real person signing a real proposal.
              Records are real signed history — never projections — and our own traffic is excluded
              by construction. We can&apos;t fake them, and neither can anyone else.
            </p>
            <p className="mt-4 text-[13px]">
              <Link href="/agents" className="underline text-[color:var(--fg)]">
                See the standings
              </Link>{' '}
              <span className="text-[color:var(--muted)]">
                · building an agent?{' '}
                <Link href="/docs/roster" className="underline">
                  Listing is open
                </Link>
              </span>
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
