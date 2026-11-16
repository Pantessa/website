// Pins for squad called-gtm, lane COMMUNITY (2026-11-16). The lane owns this file:
// pure checks in calledGtmCommunityPins, checks against a running server in
// calledGtmCommunityPinsServed. Already wired into test-api and package.json by
// the contract commit, so no lane edits the harness.
//   npx tsx scripts/called-gtm-community-pins.ts            (npm run pins:called-gtm-community)
//   BASE=http://localhost:PORT npx tsx scripts/called-gtm-community-pins.ts
//
// What is pinned: "Called it on <SYM>" on the symbol page's Community tab
// (components/markets/community/CalledBoard + called-board-rules): the address
// each press builds, the four-card cap, no highlight without a scanned hit, a
// failed read draws nothing, third-party text is never set as HTML, the sheet is
// flat, and the served board for BTC holds what a card draws.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  BOARD_DOOR_HREF,
  BOARD_SHOWN,
  avatarSrc,
  boardHref,
  boardView,
  displayName,
  fullRecordHref,
  handleLine,
  highlightOf,
  noEntriesLine,
  plotHref,
  shownEntries,
} from '../components/markets/community/called-board-rules'
import type { BoardCall, BoardEntry } from '../lib/called-it/gtm'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const BEST: BoardCall = {
  postId: '1878000000000000001',
  url: 'https://x.com/someone/status/1878000000000000001',
  text: 'BTC to 100k',
  quote: 'BTC to 100k',
  postedAt: Date.UTC(2026, 0, 10),
  stance: 'bull',
  verdict: 'right',
  verdictWords: 'called it',
  move: '+12.0% in 30 days',
  priceAt: 90000,
  likes: 10,
}

function entry(over: Partial<BoardEntry> = {}): BoardEntry {
  return {
    handle: 'someone',
    symbol: 'BTC',
    name: 'Some One',
    avatarUrl: null,
    followers: 12_345,
    verified: false,
    scannedAt: Date.now(),
    tally: { total: 4, right: 2, wrong: 1, flat: 1, open: 0 } as BoardEntry['tally'],
    headline: '@someone on BTC: 4 calls, 2 called it, 1 missed, 1 no real move.',
    coverage: null,
    hitRate: '2 of 3 judged calls',
    line: 'M0 50L100 40',
    dots: [],
    best: BEST,
    worst: { ...BEST, postId: '1878000000000000002', verdict: 'wrong', verdictWords: 'missed' },
    ...over,
  }
}

export function calledGtmCommunityPins(check: Check): void {
  // ── The presses ──
  check('community board: the card plots on THIS page with the best call open', plotHref(entry()) === '/t/BTC?x=someone&call=1878000000000000001', plotHref(entry()))
  check('community board: no best call → the plain plot on this page', plotHref(entry({ best: null })) === '/t/BTC?x=someone', plotHref(entry({ best: null })))
  check('community board: Full record → /x/<handle>/<SYM>', fullRecordHref(entry()) === '/x/someone/BTC', fullRecordHref(entry()))
  check('community board: the door → /x', BOARD_DOOR_HREF === '/x')
  check('community board: the read → /api/x/board?sym=', boardHref('BTC') === '/api/x/board?sym=BTC' && boardHref('A B') === '/api/x/board?sym=A%20B')

  // ── The cap ──
  const six = Array.from({ length: 6 }, (_, i) => i)
  check('community board: four cards before "Show all"', BOARD_SHOWN === 4 && shownEntries(six, false).shown.length === 4 && shownEntries(six, false).hidden === 2)
  check('community board: "Show all" shows every entry, in the board order', JSON.stringify(shownEntries(six, true).shown) === JSON.stringify(six) && shownEntries(six, true).hidden === 0)
  check('community board: four or fewer → no "Show all"', shownEntries([1, 2, 3, 4], false).hidden === 0 && shownEntries([1], false).shown.length === 1)

  // ── Honesty ──
  check('community board: no best call → no highlight (a miss is never dressed up)', highlightOf(entry({ best: null })) === null)
  check('community board: the highlight is the best hit', highlightOf(entry())?.postId === BEST.postId)
  const rulesSrc = strip(read('components/markets/community/called-board-rules.ts'))
  const boardSrc = strip(read('components/markets/community/CalledBoard.tsx'))
  check('community board: `worst` is never read on the board', !/\.worst\b/.test(rulesSrc) && !/\.worst\b/.test(boardSrc))
  check('community board: text is never set as HTML', !/dangerouslySetInnerHTML|innerHTML/.test(boardSrc))
  check('community board: the display name is a <bdi> text node', /<bdi>\{name\}<\/bdi>/.test(boardSrc))
  check('community board: Verified only when the entry says so', /\{e\.verified && <span className="xbd-card__verified">Verified<\/span>\}/.test(boardSrc))
  check('community board: an unverified record carries the standing line', /!e\.verified && <p className="xbd-card__standing">\{STANDING_NOT_VERIFIED\}<\/p>/.test(boardSrc))
  check('community board: the entries are never re-sorted', !/\.sort\(/.test(boardSrc) && !/\.sort\(/.test(rulesSrc))
  check('community board: the post is cleaned to a line', /cleanLine\(best\.quote \|\| best\.text, 160\)/.test(boardSrc))
  check('community board: the avatar sends no referrer and falls back to an initial', /referrerPolicy="no-referrer"/.test(boardSrc) && /initialOf\(e\.name, e\.handle\)/.test(boardSrc))
  check('community board: a journey label on each press', ['called_board_plot', 'called_board_record', 'called_board_more', 'called_board_door'].every((l) => boardSrc.includes(`data-journey="${l}"`)))

  check('community board: a press re-reads the tab once the address lands (state-less popstate, then the top)', /new PopStateEvent\('popstate', \{ state: null \}\)/.test(boardSrc) && /onClick=\{\(\) => onPlot\(plot\)\}/.test(boardSrc) && /href=\{plot\}/.test(boardSrc))

  // ── Words ──
  check('community board: followers line', handleLine(entry()) === '@someone · 12K followers' && handleLine(entry({ followers: null })) === '@someone' && handleLine(entry({ followers: 1 })) === '@someone · 1 follower', handleLine(entry()))
  check('community board: a blank name falls back to the handle', displayName(entry({ name: '   ' })) === '@someone' && displayName(entry({ name: null })) === '@someone')
  check('community board: the empty line names the market', noEntriesLine('ETH') === 'No X account has been plotted on ETH yet.')
  check('community board: avatars only from X image hosts', avatarSrc('https://pbs.twimg.com/profile_images/1/a_normal.jpg') === 'https://pbs.twimg.com/profile_images/1/a_200x200.jpg' && avatarSrc('https://evil.example/a.jpg') === null && avatarSrc('http://pbs.twimg.com/a.jpg') === null && avatarSrc('nope') === null)

  // ── States ──
  check('community board: a failed read draws nothing', boardView('error') === 'hidden' && boardView({ entries: [1], failed: true }) === 'hidden')
  check('community board: no entries → one quiet line', boardView({ entries: [], failed: false }) === 'none')
  check('community board: entries → cards; loading → placeholder', boardView({ entries: [1], failed: false }) === 'cards' && boardView('loading') === 'loading')

  // ── The sheet: flat, its own prefix ──
  const css = read('components/markets/community/called-board.css')
  const cssBody = strip(css)
  check('community board: the sheet is flat (no shadow, gradient, blur)', !/box-shadow|text-shadow|gradient\(|backdrop-filter|filter:\s*blur/.test(cssBody))
  check('community board: every class in the sheet is .xbd', (cssBody.match(/\.[a-z][\w-]*/g) ?? []).filter((c) => !/^\.(xbd|is-)/.test(c)).length === 0, (cssBody.match(/\.[a-z][\w-]*/g) ?? []).filter((c) => !/^\.(xbd|is-)/.test(c)).join(' '))
  check('community board: the heading is upright and one colour', /\.xbd__title \{[^}]*font-style: normal/.test(cssBody) && !/\.xbd__title[^{]*\{[^}]*(italic|--accent)/.test(cssBody))
  check('community board: the line keeps its stroke when stretched', /vector-effect: non-scaling-stroke/.test(cssBody) && /preserveAspectRatio="none"/.test(boardSrc))
}

export async function calledGtmCommunityPinsServed(check: Check, base: string): Promise<void> {
  try {
    const r = await fetch(`${base}/api/x/board?sym=BTC`, { headers: { 'x-yf-internal-run': '1' } })
    const d = (await r.json()) as { entries?: BoardEntry[]; failed?: boolean }
    check('community board (served): /api/x/board?sym=BTC answers entries', r.ok && Array.isArray(d.entries) && d.failed === false, `${r.status}`)
    const es = d.entries ?? []
    check('community board (served): BTC holds at least one scanned account', es.length > 0, `${es.length}`)
    check(
      'community board (served): every entry carries what a card draws',
      es.every((e) => typeof e.handle === 'string' && e.symbol === 'BTC' && typeof e.headline === 'string' && typeof e.line === 'string' && Array.isArray(e.dots) && typeof e.verified === 'boolean'),
    )
    check('community board (served): a best call is always a scanned hit', es.every((e) => e.best === null || e.best.verdict === 'right'))
    check('community board (served): every card press stays on /t/BTC', es.every((e) => plotHref(e).startsWith('/t/BTC?x=')))
    const tab = await fetch(`${base}/t/BTC?tab=community`, { headers: { 'x-yf-internal-run': '1' } })
    check('community board (served): the Community tab renders', tab.ok, `${tab.status}`)
  } catch (e) {
    check('community board (served): the server answered', false, (e as Error).message)
  }
}

if (process.argv[1]?.endsWith('called-gtm-community-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledGtmCommunityPins(check)
    if (process.env.BASE) await calledGtmCommunityPinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-gtm community pins failed` : `\nall ${n} called-gtm community pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
