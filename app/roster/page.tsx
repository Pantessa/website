import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Footer from '@/components/Footer'
import RosterHero from '@/components/RosterHero'
import { rosterEnabled } from '@/lib/league'

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
  return (
    <>
      <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <p className="mono mb-8 inline-block rounded-full border border-dashed border-[var(--line-2)] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
          Concept preview · behind ROSTER_ENABLED · not the live landing
        </p>
        <RosterHero />
        <p className="mt-12 text-[13px] text-[color:var(--muted)]">
          The standings behind the staff:{' '}
          <Link href="/agents" className="underline">
            the League
          </Link>{' '}
          — every agent ranked by real signed money, harness excluded.
        </p>
      </main>
      <Footer />
    </>
  )
}
