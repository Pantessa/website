import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import prisma from '@/lib/db'
import Footer from '@/components/Footer'
import { YeetfulMark } from '@/components/Logo'

// /l/<handle> — a creator's storefront: their active intent links as one
// public page (the "linktree of money"). Pure read surface over
// intent_links + the same server-truth aggregates as the leaderboard.
// Opt-in only: the page exists because the creator claimed a handle — a
// wallet address is never the key to it, and never printed on it.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ handle: string }> }

async function getStorefront(rawHandle: string) {
  const handle = rawHandle.toLowerCase()
  try {
    const row = await prisma.creatorHandle.findUnique({ where: { handle } })
    if (!row) return null
    const links = await prisma.intentLink.findMany({
      where: { creator: row.creator, revoked: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, ask: true, agent: true },
    })
    const slugs = links.map((l) => l.id)
    const [opens, moved] = slugs.length
      ? await Promise.all([
          prisma.intentLinkEvent.groupBy({
            by: ['slug'],
            where: { slug: { in: slugs }, kind: 'open' },
            _count: { _all: true },
          }),
          prisma.embedTurn.groupBy({
            by: ['intentLinkSlug'],
            where: { intentLinkSlug: { in: slugs }, outcome: 'signed', valueUsd: { gt: 0 } },
            _sum: { valueUsd: true },
          }),
        ])
      : [[], []]
    return {
      handle,
      links: links.map((l) => ({
        slug: l.id,
        ask: l.ask,
        opens: opens.find((o) => o.slug === l.id)?._count._all ?? 0,
        movedUsd: moved.find((m) => m.intentLinkSlug === l.id)?._sum.valueUsd ?? 0,
      })),
    }
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params
  const store = await getStorefront(handle)
  if (!store) return { title: 'Creator page · Yeetful', robots: { index: false, follow: false } }
  const title = `@${store.handle} — links that move money · Yeetful`
  const description = `${store.links.length} intent link${store.links.length === 1 ? '' : 's'} by @${store.handle}. Tap one, connect your own wallet, and the path builds itself — guarded, signed only by you, receipted.`
  return {
    title,
    description,
    openGraph: { title, description, siteName: 'Yeetful', type: 'profile' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function StorefrontPage({ params }: Params) {
  const { handle } = await params
  const store = await getStorefront(handle)
  if (!store) notFound()

  const totalMoved = store.links.reduce((s, l) => s + l.movedUsd, 0)

  return (
    <>
      <main className="x-main">
        <section className="max-w-2xl mx-auto px-4 py-16">
          <div className="flex items-center gap-2 mb-6">
            <YeetfulMark size={18} />
            <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
              Creator page
            </span>
          </div>
          <h1 className="text-3xl font-semibold text-[color:var(--fg)] mb-2">@{store.handle}</h1>
          <p className="text-[15px] leading-relaxed text-[color:var(--muted)] max-w-xl mb-2">
            Links that move money. Tap one, connect your own wallet, and the path builds itself —
            guarded, signed only by you, receipted.
          </p>
          {totalMoved > 0 && (
            <p className="mono text-[12px] text-[color:var(--muted-2)] mb-8">
              ${totalMoved.toFixed(2)} moved through this page&apos;s links
            </p>
          )}

          {store.links.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted-2)] mt-8">
              Nothing here yet — @{store.handle} hasn&apos;t published any links.
            </p>
          ) : (
            <ol className="divide-y divide-[var(--line)] border-y border-[var(--line)] mt-6">
              {store.links.map((l) => (
                <li key={l.slug}>
                  <Link
                    href={`/i/${l.slug}`}
                    className="flex items-center gap-4 py-3.5 group hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-[15px] text-[color:var(--fg)] truncate flex-1 group-hover:text-[color:var(--accent)] transition-colors">
                      &ldquo;{l.ask}&rdquo;
                    </span>
                    <span className="mono text-[12px] text-[color:var(--muted-2)] flex-shrink-0">
                      {l.opens} opens
                    </span>
                    {l.movedUsd > 0 && (
                      <span className="mono text-[13px] text-[color:var(--accent)] flex-shrink-0">
                        ${l.movedUsd.toFixed(2)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-10 flex items-center gap-3">
            <Link href="/dashboard/links" className="btn btn--solid text-[13px]">
              Make your own page
            </Link>
            <Link href="/links" className="btn btn--ghost text-[13px]">
              The leaderboard
            </Link>
          </div>
          <p className="mono text-[11px] text-[color:var(--muted-2)] mt-6">
            Every link opens with an explicit Connect &amp; build step — nothing runs, nothing
            signs, until the visitor says so. Dollars are guardrail-priced signed notional.
          </p>
        </section>
      </main>
      <Footer />
    </>
  )
}
