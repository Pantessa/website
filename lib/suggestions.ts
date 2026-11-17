// SUGGESTIONS ON THE HOME (2026-11-17, Nate: "a section on the home that anyone
// can make suggestions, that pantessa is open source and anyone can add an
// issue to github, we can also show open and closed suggestions … this is a
// community built project").
//
// Pure: the repo's addresses, and the rules that turn GitHub's search answer
// into the rows the home draws. The read itself is lib/suggestions-server.
//
// A suggestion is a GitHub ISSUE on Pantessa/website (never a pull request:
// the issues API mixes the two, so the read goes through search with
// `is:issue`). Its title is a stranger's text: it is drawn as text only, cut
// to a length, and an issue we closed as spam (labels below) is never shown.

export const SUGGEST_REPO = 'Pantessa/website'
export const REPO_URL = `https://github.com/${SUGGEST_REPO}`
/** The issue form (.github/ISSUE_TEMPLATE/suggestion.yml), so a suggestion arrives labelled. */
export const NEW_SUGGESTION_URL = `${REPO_URL}/issues/new?template=suggestion.yml`
export const OPEN_ISSUES_URL = `${REPO_URL}/issues?q=is%3Aissue+is%3Aopen`
export const CLOSED_ISSUES_URL = `${REPO_URL}/issues?q=is%3Aissue+is%3Aclosed`

/** Rows per list on the home. */
export const SUGGEST_SHOWN = 5
/** A title longer than this is cut with an ellipsis. */
export const TITLE_MAX = 110
/** Labels that keep an issue off the home (spam and mistakes, not decisions: `wontfix` still shows). */
export const HIDDEN_LABELS: readonly string[] = ['invalid', 'spam', 'duplicate']

export type SuggestionOutcome = 'open' | 'done' | 'closed'

export interface Suggestion {
  number: number
  title: string
  url: string
  outcome: SuggestionOutcome
  /** The GitHub login that opened it. */
  by: string
  comments: number
  /** 👍 reactions. */
  votes: number
  /** ISO; the closing time for a closed one, the opening time otherwise. */
  at: string
  labels: string[]
}

export interface SuggestionsSnapshot {
  /** False when GitHub did not answer: the section then shows only its doors. */
  ok: boolean
  open: Suggestion[]
  closed: Suggestion[]
  openCount: number
  closedCount: number
}

export const EMPTY_SUGGESTIONS: SuggestionsSnapshot = { ok: false, open: [], closed: [], openCount: 0, closedCount: 0 }

export function cutTitle(raw: string): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= TITLE_MAX) return t
  return t.slice(0, TITLE_MAX - 1).trimEnd() + '…'
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

/** One search item → a row, or null for anything that is not a public issue we would show. */
export function suggestionOf(item: unknown): Suggestion | null {
  if (!item || typeof item !== 'object') return null
  const it = item as Record<string, unknown>
  if (it.pull_request) return null
  const number = num(it.number)
  const title = cutTitle(typeof it.title === 'string' ? it.title : '')
  if (!number || !title) return null
  const user = (it.user ?? {}) as Record<string, unknown>
  if (user.type === 'Bot') return null
  const labels = Array.isArray(it.labels)
    ? it.labels.map((l) => (l && typeof l === 'object' ? String((l as Record<string, unknown>).name ?? '') : String(l ?? ''))).filter(Boolean)
    : []
  if (labels.some((l) => HIDDEN_LABELS.includes(l.toLowerCase()))) return null
  const state = it.state === 'closed' ? 'closed' : 'open'
  // GitHub's own words for why it closed: `completed` = done, anything else (not_planned, duplicate) = closed.
  const outcome: SuggestionOutcome = state === 'open' ? 'open' : it.state_reason === 'completed' ? 'done' : 'closed'
  const at = String((state === 'closed' ? it.closed_at : it.created_at) ?? '')
  const reactions = (it.reactions ?? {}) as Record<string, unknown>
  return {
    number,
    title,
    // The address is ours, built from the number: a row never links anywhere but the repo.
    url: `${REPO_URL}/issues/${number}`,
    outcome,
    by: typeof user.login === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(user.login) ? user.login : 'someone',
    comments: num(it.comments),
    votes: num(reactions['+1']),
    at,
    labels,
  }
}

/** A search answer → rows, newest first as GitHub sorted them, capped. */
export function suggestionsOf(body: unknown, shown = SUGGEST_SHOWN): { rows: Suggestion[]; total: number } {
  const b = (body ?? {}) as Record<string, unknown>
  const items = Array.isArray(b.items) ? b.items : []
  const rows = items.map(suggestionOf).filter((s): s is Suggestion => s !== null)
  // A hidden issue still counts in GitHub's total; take it out of ours when we can see it.
  const hidden = items.length - rows.length
  const total = Math.max(rows.length, num(b.total_count) - hidden)
  return { rows: rows.slice(0, shown), total }
}

/** "3 days ago" style, coarse, from a fixed now (the page is ISR). */
export function agoWords(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 3600) return 'just now'
  const h = Math.round(s / 3600)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const m = Math.round(d / 30)
  if (m < 12) return `${m}mo ago`
  return `${Math.round(m / 12)}y ago`
}

export function outcomeWord(o: SuggestionOutcome): string {
  return o === 'open' ? 'Open' : o === 'done' ? 'Done' : 'Closed'
}
