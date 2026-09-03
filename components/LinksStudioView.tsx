'use client'

// The creator's links studio — ONE markup source for /dashboard/links and
// the chat surface's LINKS destination (LinksWorkspace), so the two can
// never drift. It is the creator's own page: name it, mint into it, watch
// the funnel, claim the earnings.
//
// The public leaderboard (LinksBoardView) is still one tap away from both
// surfaces, but it is not what "my links" should open onto — a creator
// signing in to check their own funnel was landing on everyone else's
// board instead.

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
  /** Rendered inside the chat scroller: narrower measure, its own heading,
   *  no dashboard chrome around it. */
  inApp,
}: {
  readQueryPrefill?: boolean
  inApp?: boolean
}) {
  const { links, earnings, loadError, reload, updatedAt } = useIntentLinks()

  return (
    <section className={inApp ? 'w-full max-w-2xl mx-auto px-4 py-6' : undefined}>
      {inApp && (
        <div className="flex items-baseline justify-between gap-3 mb-5">
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

      {/* The page comes first: naming it (and branding it) is the thing every
          minted link then lands on. */}
      <CreatorPagePanel className="mb-6" />

      <MintLinkForm readQueryPrefill={readQueryPrefill} externalError={loadError} onMinted={reload} className="mb-8" />

      {earnings && (earnings.totalEarnedUsd > 0 || earnings.totalSignedUsd > 0) && (
        <LinkEarningsPanel earnings={earnings} onClaimed={reload} className="mb-6" />
      )}

      {links && links.length > 0 && (
        <>
          {/* the funnel is the scoreboard during a drill — it re-reads
              itself every 30s while this tab is visible */}
          <div className="flex items-center justify-end mb-2">
            <LivePill updatedAt={updatedAt} />
          </div>
          <LinkFunnelTable links={links} onChanged={reload} />
        </>
      )}
      {links && links.length === 0 && !loadError && (
        <p className="text-[13px] text-[color:var(--muted-2)]">
          No links yet — mint the first one above. The ask you&apos;d paste in chat is exactly the
          ask that belongs here.
        </p>
      )}
    </section>
  )
}
