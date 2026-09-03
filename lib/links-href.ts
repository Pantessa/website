// THE link center's address. One constant, because the studio moved.
//
// Intent links used to live at /dashboard/links, with the chat surface's
// LINKS tab showing the public leaderboard beside it — two places to mint,
// and the dashboard one won by default from every CTA in the product. The
// studio is now the app's LINKS destination (AppSpine → LinksWorkspace →
// LinksStudioView) and the dashboard is settings. Every "mint a link" /
// "watch the funnel" / "claim" door in the product points here.
//
// /dashboard/links still resolves — it redirects here, query intact — so
// links already posted to the world keep working.

export const LINKS_STUDIO_HREF = '/chat?tab=links'

/** The studio, optionally carrying the chat→mint handoff (?ask= + ?mcps=).
 *  MintLinkForm reads exactly these two params (readQueryPrefill), so the
 *  sentence and its dapp set re-light on arrival. */
export function linksStudioHref(opts?: { ask?: string; mcps?: string[] | string }): string {
  const ask = opts?.ask?.trim()
  const mcps = Array.isArray(opts?.mcps) ? opts.mcps.join(',') : opts?.mcps
  const q = new URLSearchParams({ tab: 'links' })
  if (ask) q.set('ask', ask.slice(0, 400))
  if (mcps) q.set('mcps', mcps)
  return `/chat?${q.toString()}`
}
