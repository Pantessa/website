// The home's suggestions read (lib/suggestions has the rules). Two GitHub
// searches, open and closed issues on the repo, through Next's data cache
// (10 minutes) so `/` stays ISR: GitHub's unauthenticated search allows 10
// requests a minute, and this makes 2 every ten. `GITHUB_TOKEN`, when set,
// rides along to raise that limit; nothing needs it.
//
// Fail-soft and capped in time like the home's other reads: GitHub down or slow
// → the section draws its doors with no lists, never a throw, never a wait past
// SUGGEST_BUDGET_MS.
import 'server-only'
import { EMPTY_SUGGESTIONS, SUGGEST_REPO, suggestionsOf, type SuggestionsSnapshot } from './suggestions'

export const SUGGEST_BUDGET_MS = 2500
const REVALIDATE_S = 600

async function search(state: 'open' | 'closed'): Promise<ReturnType<typeof suggestionsOf> | null> {
  const q = encodeURIComponent(`repo:${SUGGEST_REPO} is:issue state:${state}`)
  const sort = state === 'open' ? 'created' : 'updated'
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'pantessa-home' }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`https://api.github.com/search/issues?q=${q}&sort=${sort}&order=desc&per_page=20`, {
    headers,
    next: { revalidate: REVALIDATE_S, tags: ['suggestions'] },
  })
  if (!res.ok) return null
  return suggestionsOf(await res.json())
}

async function readAll(): Promise<SuggestionsSnapshot> {
  const [open, closed] = await Promise.all([search('open').catch(() => null), search('closed').catch(() => null)])
  if (!open && !closed) return EMPTY_SUGGESTIONS
  return {
    ok: true,
    open: open?.rows ?? [],
    closed: closed?.rows ?? [],
    openCount: open?.total ?? 0,
    closedCount: closed?.total ?? 0,
  }
}

/** The suggestions, or none. Never throws, never waits past SUGGEST_BUDGET_MS. */
export async function readSuggestions(): Promise<SuggestionsSnapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<SuggestionsSnapshot>((resolve) => {
    timer = setTimeout(() => resolve(EMPTY_SUGGESTIONS), SUGGEST_BUDGET_MS)
  })
  try {
    return await Promise.race([readAll().catch(() => EMPTY_SUGGESTIONS), late])
  } finally {
    clearTimeout(timer)
  }
}
