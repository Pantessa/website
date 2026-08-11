import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import MosaicStudio from '@/components/MosaicStudio'

// The Mosaic studio — the public front door for executable portfolio links.
// Server shell owns the SEO surface only; everything interactive (the
// allocation editor, the mint, the wall) lives in components/MosaicStudio,
// because the whole page is wallet-aware. ?from=<slug> is the fork door the
// /i OG audience arrives through — read here and handed down as a plain prop
// so the client component never needs a useSearchParams Suspense boundary.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Mosaic — wear any allocation in one signature · Pantessa',
  description:
    'An allocation as a link. Mint "tile my wallet 50% ETH, 30% USDC, 20% wstETH" and every wallet that opens it gets the same sentence compiled into its own batch — sells then buys, built fresh and guard-checked at sign time.',
  openGraph: {
    title: 'Mosaic — executable portfolio links',
    description:
      'The portfolio pie chart is now a button. Mint a shape, share the link; every wallet that opens it gets its own personalized batch.',
    type: 'website',
  },
}

export default async function MosaicPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const from = typeof sp.from === 'string' && sp.from.trim() ? sp.from.trim() : undefined
  return (
    <>
      <main className="x-main x-main--fluid">
        <header className="hero" style={{ paddingBottom: 40 }}>
          <p className="hero__eyebrow">MOSAIC — EXECUTABLE PORTFOLIO LINKS</p>
          <h1 className="hero__h1 hero__h1--sm">
            The portfolio pie chart is now a <em className="hero__em">button.</em>
          </h1>
          <p className="hero__sub">
            Shape an allocation, mint it as a link. Every wallet that opens it gets the same
            sentence compiled into its own batch — sells settle first, then the buys, every leg
            built fresh and guard-checked at sign time, signed one by one.
          </p>
        </header>
        <MosaicStudio from={from} />
      </main>
      <Footer />
    </>
  )
}
