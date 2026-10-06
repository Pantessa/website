import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { PantessaMark } from '@/components/Logo'
import { MARKETS_HREF } from '@/lib/markets'

// Where a shared link lands when the thing it named is gone: a watchlist
// made private again, a call or a receipt that never existed, a chat whose
// owner turned sharing off. The site 404 says "nothing at this address" and
// points at the docs; someone who tapped a link in a feed came for a chart
// or a trade, so this says what happened in the link's own words and puts
// the live product one tap away. Nothing ran and nothing was signed.

export interface SharedGoneProps {
  /** What the link was ("watchlist", "chart call", "receipt", "shared chat"). */
  what: string
  /** One sentence on why it may be gone. */
  why: string
}

export default function SharedGone({ what, why }: SharedGoneProps) {
  const chip =
    'inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full border border-[var(--line)] bg-[var(--surf-1)] text-[13px] font-medium text-[color:var(--fg)] hover:border-[var(--accent)] transition-colors'
  return (
    <main className="x-main" data-shared-gone={what}>
      <div className="max-w-xl mx-auto px-4 max-sm:px-0 py-24 max-sm:py-14">
        <div className="flex items-center gap-2 mb-8">
          <PantessaMark size={15} />
          <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">{what} · not available</span>
        </div>
        <h1 className="text-[clamp(1.6rem,4vw,2.4rem)] leading-tight font-medium text-[color:var(--fg)] [text-wrap:balance]" style={{ fontFamily: 'var(--font-serif)' }}>
          This {what} isn’t here any more.
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--muted)] max-w-md">
          {why} Nothing ran and nothing was signed by opening the link. The live board is one tap away.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          <SpineLink href={MARKETS_HREF} className={`${chip} border-[var(--accent)]`}>
            Open Markets
          </SpineLink>
          <SpineLink href="/t/AAPL" className={chip}>
            See a live chart
          </SpineLink>
          <Link href="/links" className={chip}>
            Links that move money
          </Link>
          <Link href="/" className={chip}>
            Home
          </Link>
        </div>
      </div>
    </main>
  )
}
