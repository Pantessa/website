// Pins for the home's suggestions board (2026-11-17): lib/suggestions rules
// (pure) and the served `/` (with BASE).
//   npx tsx scripts/suggestions-pins.ts              (npm run pins:suggestions)
//   BASE=http://localhost:PORT npx tsx scripts/suggestions-pins.ts
//
// What is pinned: a pull request is never a suggestion; spam labels and bots
// stay off; a stranger's title is cut and drawn as text (never HTML); a row
// links only to the repo, built from its number; done vs closed follows
// GitHub's state_reason; the board sits between the how seat and the close
// seat; the read goes through the data cache (the home stays ISR) and is
// capped in time; the issue form exists and the door aims at it.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { NEW_SUGGESTION_URL, REPO_URL, TITLE_MAX, cutTitle, suggestionOf, suggestionsOf, agoWords } from '../lib/suggestions'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const issue = (over: Record<string, unknown> = {}) => ({
  number: 767,
  title: 'Twitter Link Broken',
  state: 'open',
  user: { login: 'Ledum-OS', type: 'User' },
  labels: [],
  comments: 1,
  reactions: { '+1': 2 },
  created_at: '2026-09-15T06:15:52Z',
  closed_at: null,
  html_url: 'https://evil.example/phish',
  ...over,
})

export function suggestionsPins(check: Check): void {
  const s = suggestionOf(issue())
  check('suggestions: an issue becomes a row', !!s && s.number === 767 && s.outcome === 'open' && s.by === 'Ledum-OS' && s.votes === 2 && s.comments === 1)
  check('suggestions: a row links to the repo by number, never the payload url', s?.url === `${REPO_URL}/issues/767`)
  check('suggestions: a pull request is not a suggestion', suggestionOf(issue({ pull_request: { url: 'x' } })) === null)
  check('suggestions: a bot is not a suggestion', suggestionOf(issue({ user: { login: 'dependabot', type: 'Bot' } })) === null)
  check('suggestions: spam / invalid / duplicate stay off', ['spam', 'Invalid', 'duplicate'].every((l) => suggestionOf(issue({ labels: [{ name: l }] })) === null))
  check('suggestions: wontfix still shows', suggestionOf(issue({ labels: [{ name: 'wontfix' }] })) !== null)
  check('suggestions: completed = Done, anything else closed = Closed', suggestionOf(issue({ state: 'closed', state_reason: 'completed', closed_at: '2026-09-17T10:23:03Z' }))?.outcome === 'done' && suggestionOf(issue({ state: 'closed', state_reason: 'not_planned' }))?.outcome === 'closed')
  check('suggestions: a closed row is dated by its closing', suggestionOf(issue({ state: 'closed', state_reason: 'completed', closed_at: '2026-09-17T10:23:03Z' }))?.at === '2026-09-17T10:23:03Z')
  const long = 'x'.repeat(400)
  check('suggestions: a long title is cut', cutTitle(long).length === TITLE_MAX && cutTitle(long).endsWith('…'))
  check('suggestions: an odd login reads "someone"', suggestionOf(issue({ user: { login: '<img src=x>', type: 'User' } }))?.by === 'someone')
  check('suggestions: garbage in, nothing out', suggestionOf(null) === null && suggestionOf('x') === null && suggestionOf(issue({ title: '   ' })) === null && suggestionsOf(undefined).rows.length === 0)
  const many = suggestionsOf({ total_count: 12, items: [issue({ number: 1 }), issue({ number: 2, labels: [{ name: 'spam' }] }), ...Array.from({ length: 8 }, (_, i) => issue({ number: 10 + i }))] })
  check('suggestions: capped at five, hidden ones leave the total', many.rows.length === 5 && many.total === 11, `${many.rows.length}/${many.total}`)
  check('suggestions: ago words', agoWords('2026-11-10T00:00:00Z', Date.parse('2026-11-17T00:00:00Z')) === '7d ago' && agoWords('nope', 0) === '')

  const board = strip(read('components/home/SuggestionsBoard.tsx'))
  check('suggestions: no HTML injection in the board', !/dangerouslySetInnerHTML/.test(board))
  check('suggestions: every outbound link opens with noopener', (board.match(/target="_blank"/g) ?? []).length === (board.match(/rel="noopener noreferrer"/g) ?? []).length)
  check('suggestions: the door aims at the issue form, and the form exists', NEW_SUGGESTION_URL.endsWith('template=suggestion.yml') && existsSync(path.join(ROOT, '.github/ISSUE_TEMPLATE/suggestion.yml')))
  const server = strip(read('lib/suggestions-server.ts'))
  check('suggestions: the read is cached (the home stays ISR) and capped', /revalidate:\s*REVALIDATE_S/.test(server) && !/no-store/.test(server) && /SUGGEST_BUDGET_MS/.test(server))
  check('suggestions: the read asks for issues only', /is:issue/.test(server))
  const index = read('components/markets/shell/MarketsIndex.tsx')
  const at = (k: string) => index.indexOf(k)
  check('suggestions: the seat sits between how and close', at('mk-how-seat') < at('mk-suggest-seat') && at('mk-suggest-seat') < at('mk-close-seat'))
}

export async function suggestionsPinsServed(check: Check, base: string): Promise<void> {
  const res = await fetch(`${base}/`, { headers: { 'x-yf-internal-run': '1' } }).catch(() => null)
  const html = res && res.ok ? await res.text() : ''
  check('suggestions (served): / carries the board and its door', /data-suggestions="(ok|off)"/.test(html) && html.includes('Tell us what to build next') && html.includes('template=suggestion.yml'), res ? String(res.status) : 'no answer')
}

if (require.main === module) {
  let fail = 0
  const check: Check = (name, ok, extra) => {
    if (!ok) fail++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` (${extra})` : ''}`)
  }
  suggestionsPins(check)
  const base = process.env.BASE
  ;(base ? suggestionsPinsServed(check, base) : Promise.resolve()).then(() => process.exit(fail ? 1 : 0))
}
