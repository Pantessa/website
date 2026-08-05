// ─────────────────────────────────────────────────────────────────────────
//  THE canonical public origin of this app. One source, imported everywhere.
//
//  This used to be a `process.env.NEXT_PUBLIC_SITE_URL ?? '<literal>'` copied
//  into nine files, and the copies had DRIFTED: six said the apex
//  `https://yeetful.com`, three said `https://www.yeetful.com`. With the env
//  var unset in production (it was), the apex copies won every metadata
//  surface — so canonical, og:url, the sitemap, robots' Sitemap: line and the
//  RSS feed all advertised a host that only redirects, and the www copies
//  disagreed with them.
//
//  Getting this wrong is quiet, not loud:
//    - metadata → a canonical/og:url pointing at a redirect splits SEO and
//      social-scrape signal instead of erroring;
//    - Stripe → success/cancel/return URLs that bounce through a redirect;
//    - anything sending an auth header → `fetch` DROPS Authorization across a
//      cross-origin redirect, so the request fails as unauthenticated.
//
//  Hence: always the CANONICAL origin — the exact host that serves 200, with
//  www, no trailing slash. Never the apex, never a host that redirects.
//
//  NOT in scope here: the `*.yeetful.com` MCP endpoints, the `uniswap|lifi|
//  transfer.yeetful.com` policy attribution hosts, or the facilitator. Those
//  are infrastructure, they still serve, and the policy hosts are written into
//  stored spend-grant allowlists — renaming them would refuse live agents.
// ─────────────────────────────────────────────────────────────────────────

/** Canonical origin, no trailing slash. Overridable via NEXT_PUBLIC_SITE_URL. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.pantessa.com').replace(
  /\/+$/,
  '',
)

/** Absolute URL for a site-relative path. `absoluteUrl('/i/abc')`. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
