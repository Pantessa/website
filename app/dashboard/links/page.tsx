'use client'

// Dashboard · Intent links — mint short links that carry an ask, and watch
// each link's funnel: opens → connects → built → signed → dollars moved.
// The link is the ad; the funnel is the creator's scoreboard. The studio
// itself lives in extracted components (MintLinkForm, CreatorPagePanel,
// LinkEarningsPanel, LinkFunnelTable) so other surfaces can open the same
// flow; this page is the full-width composition of all four.

import { CreatorPagePanel } from '@/components/CreatorPagePanel'
import { LinkEarningsPanel } from '@/components/LinkEarningsPanel'
import { LinkFunnelTable } from '@/components/LinkFunnelTable'
import { MintLinkForm } from '@/components/MintLinkForm'
import { useIntentLinks } from '@/lib/intent-links-ui'

export default function DashboardLinksPage() {
  const { links, earnings, loadError, reload } = useIntentLinks()

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-[color:var(--fg)] mb-1">Intent links</h1>
      <p className="text-sm text-[color:var(--muted)] mb-6 max-w-2xl">
        A short link that carries an ask. Whoever opens it connects a wallet and the path builds
        itself — swaps, stock buys, funding legs — with their wallet as the only signer. Share the
        link; this table is your funnel.
      </p>

      {/* The page comes first: naming it (and branding it) is the thing every
          minted link then lands on, so it leads instead of sitting under the
          mint form where a fresh creator scrolls past it. */}
      <CreatorPagePanel className="mb-6" />

      <MintLinkForm readQueryPrefill externalError={loadError} onMinted={reload} className="mb-8" />

      {earnings && (earnings.totalEarnedUsd > 0 || earnings.totalSignedUsd > 0) && (
        <LinkEarningsPanel earnings={earnings} onClaimed={reload} className="mb-6" />
      )}

      {links && links.length > 0 && <LinkFunnelTable links={links} onChanged={reload} />}
      {links && links.length === 0 && !loadError && (
        <p className="text-[13px] text-[color:var(--muted-2)]">
          No links yet — mint the first one above. The ask you'd paste in chat is exactly the ask
          that belongs here.
        </p>
      )}
    </div>
  )
}
