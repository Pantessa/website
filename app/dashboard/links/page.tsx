'use client'

// Dashboard · Intent links — mint short links that carry an ask, and watch
// each link's funnel: opens → connects → built → signed → dollars moved.
// The link is the ad; the funnel is the creator's scoreboard. The studio
// itself is LinksStudioView, shared verbatim with the chat surface's LINKS
// destination so the two surfaces can never drift.

import LinksStudioView from '@/components/LinksStudioView'

export default function DashboardLinksPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-[color:var(--fg)] mb-1">Intent links</h1>
      <p className="text-sm text-[color:var(--muted)] mb-6 max-w-2xl">
        A short link that carries an ask. Whoever opens it connects a wallet and the path builds
        itself — swaps, stock buys, funding legs — with their wallet as the only signer. Share the
        link; this table is your funnel.
      </p>
      <LinksStudioView readQueryPrefill />
    </div>
  )
}
