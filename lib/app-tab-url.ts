// THE app tab's address. The spine's destinations (MCPS / JOBS / LINKS /
// TEAM / CHATS) used to be pure session state, so a refresh always dropped
// you back on MCPs — you could be deep in the links studio, reload, and land
// somewhere else. They live in the URL now: `?tab=<name>` on whatever chat
// route you're on (/chat or /chat/<id>), so a reload, a bookmark, a pasted
// link and the back button all land on the destination you were looking at.
//
// The param was already the product's deep-link contract (LINKS_STUDIO_HREF,
// the /dashboard/links redirect, the roster's "hire from the Team tab") —
// this makes it bidirectional rather than read-once.
//
// Pure here, DOM writes in `syncTabParam`, so the grammar is testable.

import type { RailTab } from '@/lib/store'

export const TAB_PARAM = 'tab'

/** Every destination that can own the URL. Kept as data (not derived from
 *  the spine's TABS) because TEAM is flag-gated at render time and an
 *  inbound /chat?tab=team must still parse when the flag is off — the spine
 *  simply won't show it. */
const TABS: RailTab[] = ['mcps', 'chats', 'jobs', 'links', 'team']

/** The tab the spine leads with. Never written to the URL: a bare /chat and
 *  /chat?tab=mcps restore identically, so the param stays out of the way of
 *  every shared chat link. */
export const DEFAULT_TAB: RailTab = 'mcps'

/** Read the destination out of a location.search string. Unknown names (a
 *  typo, a retired tab) resolve to null — the spine keeps its default rather
 *  than showing an empty drawer. */
export function parseTabParam(search: string): RailTab | null {
  const raw = new URLSearchParams(search).get(TAB_PARAM)
  return raw && (TABS as string[]).includes(raw) ? (raw as RailTab) : null
}

/** The URL for a destination, preserving the path and every OTHER param —
 *  the mint handoff (?ask=&mcps=), ?prompt=, ?mode=app all survive a tab
 *  change. `null` (and the default tab) drop the param entirely. */
export function tabUrl(tab: RailTab | null, pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  if (!tab || tab === DEFAULT_TAB) params.delete(TAB_PARAM)
  else params.set(TAB_PARAM, tab)
  const q = params.toString()
  return q ? `${pathname}?${q}` : pathname
}

/** Mirror the spine's live destination into the address bar.
 *
 *  replaceState, not router.replace: this is UI state catching the URL up,
 *  not a navigation — a Next route push would round-trip the RSC payload on
 *  every tab click, and a history ENTRY per click would turn the back button
 *  into a tab-undo instead of the way off the page. Deep links from
 *  elsewhere in the product stay real pushed navigations.
 *
 *  The `null` state is load-bearing: Next patches replaceState to copy its
 *  own internals forward and re-point the router's canonical URL, but it
 *  BYPASSES that whenever the state it's handed already carries Next's
 *  markers (`__NA`/`_N`). Passing window.history.state back would take the
 *  bypass and leave usePathname/useSearchParams reading a stale URL. */
export function syncTabParam(tab: RailTab | null): void {
  if (typeof window === 'undefined') return
  const { pathname, search } = window.location
  const next = tabUrl(tab, pathname, search)
  if (next === `${pathname}${search}`) return
  window.history.replaceState(null, '', next)
}
