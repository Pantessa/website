'use client'

import Link from 'next/link'
import { YeetfulMark } from '@/components/Logo'
import HouseLinkChip from '@/components/HouseLinkChip'
import IntentLinksBoard from '@/components/IntentLinksBoard'
import { MintLinkForm } from '@/components/MintLinkForm'
import type { CreatorPageRow, LinksBoard } from '@/lib/links-board'
import type { HouseLink } from '@/lib/house-links'

// The /links page body — ONE markup source for the public route and the
// chat surface's LINKS view (LinksWorkspace), so the two can never drift.
// The board leads: the live proof is the first thing either surface shows,
// with the mint composer right under it. The server page passes data it
// fetched itself; the in-app workspace feeds the same shape from
// GET /api/links/board.

export default function LinksBoardView({
  board,
  house,
  pages,
  inApp,
  onMinted,
}: {
  board: LinksBoard
  house: HouseLink[]
  pages: CreatorPageRow[]
  /** Rendered inside the chat scroller (tighter padding, no page footer). */
  inApp?: boolean
  /** In-app only: a mint should refresh the board it sits beside. */
  onMinted?: () => void
}) {
  return (
    <section className={`w-full max-w-2xl mx-auto px-4 ${inApp ? 'py-6' : 'py-16'}`}>
      <div className="flex items-center gap-2 mb-6">
        <YeetfulMark size={15} />
        <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
          Intent links · in the open
        </span>
      </div>
      <h1 className="text-3xl font-semibold text-[color:var(--fg)] mb-3">
        A link that moves money.
      </h1>
      <p className="text-[15px] leading-relaxed text-[color:var(--muted)] max-w-xl mb-8">
        Mint a link that carries an ask — &ldquo;Buy $12 of AAPL&rdquo;, &ldquo;DCA $25 into ETH
        weekly&rdquo;. Whoever opens it connects a wallet and the path builds itself: guarded,
        signed only by their own wallet, receipted. Creators earn half of Pantessa&apos;s 0.20%
        fee on the conversions their link produces.
      </p>

      {/* The board leads — live proof before the pitch. Every row is a link
          a visitor can tap right now. */}
      <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-3">
        The board
      </h2>
      {board.byClaims.length === 0 && board.byRecent.length === 0 ? (
        <p className="text-[13px] text-[color:var(--muted-2)]">
          The board is empty — the first link to move a dollar tops it. Mint yours below.
        </p>
      ) : (
        <IntentLinksBoard board={board} />
      )}
      <p className="mono text-[11px] text-[color:var(--muted-2)] mt-4 mb-12">
        A claim is a finished flow — the visitor signed with their own wallet. Dollars moved are
        guardrail-priced signed notional, the same source as /activity. Recently minted is the
        newest live links, straight from mint. Asks only; creators stay pseudonymous.
      </p>

      {/* Mint yours — the composer itself, not a button to a form behind
          sign-in. A stranger writes the sentence right here and watches
          the card their link will wear assemble; the mint press is the
          sign-in door (guestDoor), carrying the ask through to the
          studio. */}
      <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-3">
        Mint yours
      </h2>
      <MintLinkForm guestDoor onMinted={onMinted} className="mb-6" />
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/links/embed" className="btn btn--ghost text-[13px]">
          Put a button on your site
        </Link>
        <Link href="/mosaic" className="btn btn--ghost text-[13px]">
          Mint your bags as a Mosaic
        </Link>
        <Link href="/docs/links" className="btn btn--ghost text-[13px]">
          How it works
        </Link>
      </div>

      {/* Creator pages: every claimed /l/<handle> storefront. Claiming a
          name IS the opt-in to being listed — this is how a page gets
          found again (and how anyone else finds it at all). */}
      {pages.length > 0 && (
        <>
          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-12 mb-3">
            Creator pages
          </h2>
          <div className="flex flex-wrap gap-2.5">
            {pages.map((p) => (
              <Link
                key={p.handle}
                href={`/l/${p.handle}`}
                className="group rounded-full border border-[var(--line)] bg-[var(--surf-1)] px-4 py-2 hover:border-[var(--accent)] transition-colors"
              >
                <span className="text-[13px] text-[color:var(--fg)] group-hover:text-[color:var(--accent)] transition-colors">
                  @{p.handle}
                </span>
                <span className="mono text-[11px] text-[color:var(--muted-2)] ml-2">
                  {p.links} link{p.links === 1 ? '' : 's'}
                  {p.movedUsd > 0 ? ` · $${p.movedUsd.toFixed(2)}` : ''}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {house.length > 0 && (
        <>
          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-12 mb-3">
            Start here — the house links
          </h2>
          <div className="flex flex-wrap gap-2.5">
            {house.map((h) => (
              <HouseLinkChip key={h.slug} link={h} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
