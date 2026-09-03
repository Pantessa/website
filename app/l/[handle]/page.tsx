import type { Metadata } from 'next'
import Link from 'next/link'
import { LINKS_STUDIO_HREF, linksStudioHref } from '@/lib/links-href'
import { notFound } from 'next/navigation'
import prisma from '@/lib/db'
import { brandFromRow } from '@/lib/brand-denylist'
import { getSessionAddress } from '@/lib/auth'
import { brandCtaStyle, brandThemeStyle } from '@/lib/brand-theme'
import Footer from '@/components/Footer'
import { YeetfulMark } from '@/components/Logo'
import { absoluteUrl } from '@/lib/site-url'

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
    // White-label brand — scanned from the creator's own site (one paste on
    // the dashboard). Logo is a stored data URI: no foreign fetch at render.
    // (rule 7: a denied third-party brand renders as house — lib/brand-denylist)
    const brand = brandFromRow(row)
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
      brand,
      creator: row.creator,
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
  if (!store) return { title: 'Creator page · Pantessa', robots: { index: false, follow: false } }
  const title = `@${store.handle} — links that move money · Pantessa`
  const description = `${store.links.length} intent link${store.links.length === 1 ? '' : 's'} by @${store.handle}. Tap one, connect your own wallet, and the path builds itself — guarded, signed only by you, receipted.`
  return {
    title,
    description,
    openGraph: { title, description, siteName: 'Pantessa', type: 'profile' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function StorefrontPage({ params }: Params) {
  const { handle } = await params
  const store = await getStorefront(handle)
  if (!store) notFound()

  // The owner sees their own page with the next step in hand (mint, brand,
  // share). Read-only session peek — no SIWE is ever prompted here (rule 6),
  // and the wallet address itself never renders.
  const viewer = await getSessionAddress()
  const isOwner = !!viewer && viewer.toLowerCase() === store.creator.toLowerCase()

  const totalMoved = store.links.reduce((s, l) => s + l.movedUsd, 0)
  const brand = store.brand

  // A branded page re-themes in place, scoped to this main — the site
  // chrome (nav/footer) stays Pantessa. fullBleed paints the bg past
  // .x-main's centered gutters (box-shadow spread + clip-path), so the
  // color runs edge to edge without touching layout.
  const themeStyle = brandThemeStyle(brand, { fullBleed: true })

  const pageUrl = absoluteUrl(`/l/${store.handle}`)
  const tweetHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Links that move money — @${store.handle}`)}&url=${encodeURIComponent(pageUrl)}`

  return (
    <>
      <main className="x-main" style={themeStyle}>
        <section className="max-w-2xl mx-auto px-4 py-16">
          <div className="flex items-center gap-2 mb-6">
            {brand?.logo ? (
              <>
                {/* data URI from our own DB, size-capped at scan time */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.logo} alt={brand.name ?? brand.domain ?? 'logo'} className="w-10 h-10 rounded-xl object-contain" />
                <span className="mono text-[12px] uppercase tracking-widest text-[color:var(--muted-2)]">
                  {brand.name ?? brand.domain}
                </span>
              </>
            ) : (
              <>
                <YeetfulMark size={15} />
                <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
                  Creator page
                </span>
              </>
            )}
            <a
              href="/"
              className="ml-auto inline-flex items-center gap-1.5 mono text-[10.5px] uppercase tracking-widest text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
              title="Non-custodial intent links — the visitor's wallet is the only signer"
            >
              Powered by <YeetfulMark size={12} /> Pantessa
            </a>
          </div>
          <h1 className="text-3xl font-semibold text-[color:var(--fg)] mb-2">@{store.handle}</h1>
          <p className="text-[15px] leading-relaxed text-[color:var(--muted)] max-w-xl mb-2">
            Links that move money. Tap one, connect your own wallet, and the path builds itself —
            guarded, signed only by you, receipted.
          </p>
          {totalMoved > 0 && (
            <p className="mono text-[12px] text-[color:var(--muted-2)] mb-8">
              {/* one template string — the SWC entity-space bug eats the space
                  between an expression and an entity-bearing text node */}
              {`$${totalMoved.toFixed(2)} moved through this page's links`}
            </p>
          )}

          {isOwner && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-2.5 mb-2">
              <span className="mono text-[10.5px] uppercase tracking-widest text-[color:var(--muted-2)]">
                Your page
              </span>
              <Link
                href={linksStudioHref({ ask: 'Buy $5 of AAPL' })}
                className="text-[12.5px] font-medium text-[color:var(--accent)] hover:underline underline-offset-2"
              >
                + Mint another link
              </Link>
              <Link
                href="/dashboard/customize"
                className="text-[12.5px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline underline-offset-2 decoration-dotted"
              >
                Customize this page
              </Link>
              <a
                href={tweetHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12.5px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline underline-offset-2 decoration-dotted"
              >
                Tweet your page
              </a>
            </div>
          )}

          {store.links.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted-2)] mt-8">
              {/* one template string — the SWC entity-space bug eats the space
                  between an expression and an entity-bearing text node */}
              {isOwner
                ? 'Nothing here yet — mint your first link and it lands on this page.'
                : `Nothing here yet — @${store.handle} hasn't published any links.`}
            </p>
          ) : (
            <ol className="divide-y divide-[var(--line)] border-y border-[var(--line)] mt-6">
              {store.links.map((l) => (
                <li key={l.slug}>
                  <Link
                    href={`/i/${l.slug}`}
                    className="flex items-center gap-4 py-3.5 group hover:bg-[color-mix(in_srgb,var(--fg)_4%,transparent)] transition-colors"
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

          <div className="mt-10 flex flex-wrap items-center gap-3">
            {/* branded pages repaint the solid pill in the creator's accent —
                the stock fg-on-bg fill goes dark-blob on saturated brand bgs */}
            <Link href={LINKS_STUDIO_HREF} className="btn btn--solid text-[13px]" style={brandCtaStyle(brand)}>
              Make your own page
            </Link>
            <Link href="/links" className="btn btn--ghost text-[13px]">
              The leaderboard
            </Link>
            <a href={tweetHref} target="_blank" rel="noopener noreferrer" className="btn btn--ghost text-[13px]">
              Share on 𝕏
            </a>
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
