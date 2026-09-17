'use client'

// The creator's links studio — THE link center. It is the app's LINKS
// destination (AppSpine → LinksWorkspace), which is now the only place the
// product mints from: name your page, mint into it, watch the funnel, claim
// the earnings. It used to live on /dashboard/links as well, and minting in
// two surfaces meant every CTA had to pick one; that route now redirects
// here (lib/links-href), and the dashboard is settings.
//
// The public leaderboard (LinksBoardView) is still one tap away, but it is
// not what "my links" should open onto — a creator signing in to check their
// own funnel was landing on everyone else's board instead.
//
// Layout (.linkstudio in x402-design.css): a size container, so it follows
// its OWN width, not the viewport's (the rail drawer can sit beside it). Wide:
// the mint stage and your page side by side, then the money and the funnel
// table across both. Narrow: one column — page, mint, money, table.

import Link from 'next/link'
import { CreatorPagePanel } from '@/components/CreatorPagePanel'
import { LinkEarningsPanel } from '@/components/LinkEarningsPanel'
import { LinkFunnelTable } from '@/components/LinkFunnelTable'
import { MintLinkForm } from '@/components/MintLinkForm'
import { LivePill } from '@/components/LivePill'
import { useIntentLinks } from '@/lib/intent-links-ui'

export default function LinksStudioView({
  /** Read the chat handoff (?ask= + ?mcps=) from the URL once on mount.
   *  The dashboard route owns that contract; the in-app view does not —
   *  /chat's own query params mean something else entirely. */
  readQueryPrefill,
  /** Rendered inside the chat scroller: its own heading and gutters, no
   *  dashboard chrome around it. */
  inApp,
}: {
  readQueryPrefill?: boolean
  inApp?: boolean
}) {
  const { links, earnings, loadError, reload, updatedAt } = useIntentLinks()

  return (
    <section className={`linkstudio${inApp ? ' px-4 sm:px-6 py-6' : ''}`}>
      {inApp && (
        <div className="flex items-baseline justify-between gap-3 mb-6">
          <h1 className="text-xl font-semibold text-[color:var(--fg)]">Your intent links</h1>
          {/* The board didn't go away — it just stopped being the front
              door to your own links. */}
          <Link
            href="/links"
            className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] hover:text-[color:var(--accent)] transition-colors flex-shrink-0"
          >
            The board →
          </Link>
        </div>
      )}

      <div className="linkstudio__top">
        {/* The page comes first in reading order: naming it (and branding
            it) is the thing every minted link then lands on. On a wide
            screen it sits beside the mint stage instead of above it. */}
        <CreatorPagePanel className="linkstudio__page" />

        <MintLinkForm
          readQueryPrefill={readQueryPrefill}
          externalError={loadError}
          onMinted={reload}
          className="linkstudio__mint"
        />
      </div>

      {earnings && (earnings.totalEarnedUsd > 0 || earnings.totalSignedUsd > 0) ? (
        <LinkEarningsPanel earnings={earnings} onClaimed={reload} className="mt-8" />
      ) : (
        links &&
        links.length > 0 && (
          // No earnings yet is a STATE, not an absence — say what fills it.
          <p className="mt-8 text-[12px] text-[color:var(--muted-2)]">
            Nothing earned yet — earnings appear here the first time a visitor signs a swap or stock buy
            from one of your links.
          </p>
        )
      )}

      {/* The list is loading, or it failed: both used to render as an empty
          studio with no word — indistinguishable from "you have no links". */}
      {links === null && !loadError && (
        <p className="mt-8 text-[13px] text-[color:var(--muted-2)]" aria-live="polite">
          Loading your links…
        </p>
      )}
      {loadError && (
        <p className="mt-8 text-[13px] text-[color:var(--muted)]" role="status">
          {loadError}{' '}
          <button type="button" onClick={reload} className="text-[color:var(--accent)] hover:underline">
            Try again
          </button>
        </p>
      )}

      {links && links.length > 0 && (
        <div className="mt-10">
          {/* the funnel is the scoreboard during a drill — it re-reads
              itself every 30s while this tab is visible */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
              Your links <span className="text-[color:var(--muted)]">· {links.length}</span>
            </h2>
            <LivePill updatedAt={updatedAt} />
          </div>
          <LinkFunnelTable links={links} onChanged={reload} />
        </div>
      )}
      {links && links.length === 0 && !loadError && (
        <p className="mt-8 text-[13px] text-[color:var(--muted-2)]">
          No links yet — mint the first one above. The ask you&apos;d paste in chat is exactly the
          ask that belongs here.
        </p>
      )}
    </section>
  )
}
