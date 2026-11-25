// Pins for squad called-gtm, lane PROFILE (2026-11-16). The lane owns this file:
// pure checks in calledGtmProfilePins, checks against a running server in
// calledGtmProfilePinsServed. Already wired into test-api and package.json by
// the contract commit, so no lane edits the harness.
//   npx tsx scripts/called-gtm-profile-pins.ts            (npm run pins:called-gtm-profile)
//   BASE=http://localhost:PORT npx tsx scripts/called-gtm-profile-pins.ts
//
// What is held: the account page (/x/<handle>) sums the records' own tallies
// in spec's own words; a "best call" is only ever a hit the scan found and a
// miss is shown the same size under its own label; the share text is ASCII,
// states the whole tally and fits a post; a crawler may index only a page
// with a judged call; the owner's block types no fee figure and no address of
// its own; the sheet is flat; and the served page carries all of it for the
// two real records the TEST DB holds.
import { readFileSync } from 'node:fs'
import { TAKEDOWN_EMAIL, PROFILE_CALLS_MAX, bestCallsOf, creatorShareWords, missCallsOf, profileIndexable, profileLine, profilePost, rateSentence, sumTally } from '../app/x/_lib/profile-rules'
import { headlineParts } from '../lib/called-it/card-layout'
import { FIXTURE_HANDLE } from '../lib/called-it/fixture'
import { MIN_JUDGED, callHref, type BoardCall, type BoardEntry } from '../lib/called-it/gtm'
import { LIST_MIN_FOLLOWERS, STANDING_NOT_VERIFIED, VERDICT_WORDS, chartHref, recordHeadline, recordHref, standingVerified, type CalledTally, type CallVerdict } from '../lib/called-it/spec'
import { CREATOR_FEE_SPLIT, LINK_FEE_PCT } from '../lib/fees'
import { LINKS_STUDIO_HREF } from '../lib/links-href'
import { SHARE_ASCII_RE, X_POST_MAX, xPostWeight } from '../lib/share-posts'
import { SITE_URL } from '../lib/site-url'
import { X_MENTION } from '../lib/social'

type Check = (name: string, ok: boolean, extra?: string) => void
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1')

const tally = (right: number, wrong: number, flat = 0, open = 0): CalledTally => ({ total: right + wrong + flat + open, right, wrong, flat, open })
const boardCall = (postId: string, verdict: CallVerdict): BoardCall => ({ postId, url: null, text: `post ${postId}`, quote: `quote ${postId}`, postedAt: 1_780_000_000_000, stance: 'bull', verdict, verdictWords: VERDICT_WORDS[verdict], move: '+10.0% in 30 days', priceAt: 100, likes: 1 })
const entry = (symbol: string, t: CalledTally, best: BoardCall | null, worst: BoardCall | null, handle = 'somebody'): BoardEntry => ({
  handle,
  symbol,
  name: 'Some Body',
  avatarUrl: null,
  followers: 250_000,
  verified: false,
  scannedAt: 1_790_000_000_000,
  tally: t,
  headline: recordHeadline(handle, symbol, 'all', t),
  coverage: null,
  hitRate: null,
  line: '',
  dots: [],
  best,
  worst,
})

export function calledGtmProfilePins(check: Check): void {
  // ── The one line across markets ──
  const btc = entry('BTC', tally(1, 4, 2, 1), boardCall('11111', 'right'), boardCall('22222', 'wrong'))
  const eth = entry('ETH', tally(4, 1, 0, 1), boardCall('33333', 'right'), boardCall('44444', 'wrong'))
  const sol = entry('SOL', tally(0, 1, 1, 0), null, boardCall('55555', 'wrong'))
  const all = [btc, eth, sol]
  const sum = sumTally(all)
  const line = profileLine('somebody', all)
  const parts = headlineParts(line)
  check(
    "called-gtm profile (the one line): an account's line across markets is the SUM of its records' own tallies, in spec's own words and order, and it parses like any record headline (who, then every count); on ONE market it is that record's headline to the letter; with nothing to sum there is no line",
    sum.total === 16 && sum.right === 5 && sum.wrong === 6 && sum.flat === 3 && sum.open === 2 &&
      line === '@somebody across 3 markets: 16 calls, 5 called it, 6 missed, 3 no real move, 2 too early to say.' &&
      !!parts && parts.who === '@somebody across 3 markets: ' && parts.counts.map((c) => c.kind).join() === 'total,right,wrong,flat,open' && parts.who + parts.counts.map((c) => c.text).join(', ') + parts.end === line &&
      profileLine('somebody', [btc]) === btc.headline && btc.headline === '@somebody on BTC: 8 calls, 1 called it, 4 missed, 2 no real move, 1 too early to say.' && profileLine('somebody', []) === '',
    line,
  )
  check(
    `called-gtm profile (the hit rate): a rate is a count over its denominator in a sentence that opens with spec's own word for a hit, never a bare percent, and nothing is printed under ${MIN_JUDGED} judged calls (two hits and no miss is not a rate)`,
    rateSentence(sum) === 'Called it on 5 of 11 judged calls.' && rateSentence(tally(1, 4)) === 'Called it on 1 of 5 judged calls.' && rateSentence(tally(2, 0, 0, 1)) === null && rateSentence(tally(0, 0)) === null && !/%/.test(rateSentence(sum) ?? '') &&
      (rateSentence(sum) ?? '').toLowerCase().startsWith(VERDICT_WORDS.right),
  )

  // ── Which calls the page shows ──
  const best = bestCallsOf(all)
  const misses = missCallsOf(all)
  const many = ['A', 'B', 'C', 'D', 'E'].map((s, i) => entry(s, tally(1, 1), boardCall(`9000${i}`, 'right'), boardCall(`8000${i}`, 'wrong')))
  check(
    `called-gtm profile (the calls): the hits shown are each market's own best call in the board's order, ${PROFILE_CALLS_MAX} at most, and only a call that reads "called it"; a market with no hit adds none, and an account with no hit anywhere has NO best calls (a miss is never dressed as one); the misses are chosen and cut the same way from each market's strongest miss`,
    PROFILE_CALLS_MAX === 3 && best.map((b) => `${b.symbol}:${b.call.postId}`).join() === 'BTC:11111,ETH:33333' && misses.map((m) => `${m.symbol}:${m.call.postId}`).join() === 'BTC:22222,ETH:44444,SOL:55555' &&
      bestCallsOf([sol]).length === 0 && bestCallsOf([]).length === 0 && missCallsOf([entry('X', tally(2, 0), boardCall('1', 'right'), null)]).length === 0 &&
      bestCallsOf(many).length === 3 && missCallsOf(many).length === 3 && bestCallsOf(many).map((b) => b.symbol).join('') === 'ABC' &&
      // A wrong-shaped entry (a miss in the best seat, a hit in the worst seat) is refused by the rule itself.
      bestCallsOf([entry('Y', tally(0, 1), boardCall('7', 'wrong'), null)]).length === 0 && missCallsOf([entry('Y', tally(1, 0), null, boardCall('7', 'right'))]).length === 0,
  )

  // ── Index or not ──
  check(
    'called-gtm profile (crawlers): the account page may be indexed only when it has a call judged either way; a page with nothing listed, a page whose calls are all still open or flat, and the fixture stay out',
    profileIndexable('somebody', all) && profileIndexable('somebody', [entry('X', tally(1, 0), null, null)]) && !profileIndexable('somebody', []) && !profileIndexable('somebody', [entry('X', tally(0, 0, 2, 3), null, null)]) && !profileIndexable(FIXTURE_HANDLE, all),
  )

  // ── The share text ──
  const theirs = profilePost({ handle: 'somebody', line, markets: 3, standing: STANDING_NOT_VERIFIED })
  const one = profilePost({ handle: 'somebody', line: btc.headline, markets: 1, standing: STANDING_NOT_VERIFIED })
  const mine = profilePost({ handle: 'somebody', line, markets: 3, standing: standingVerified('somebody'), mine: true })
  const bigTally = { total: 49_995, right: 9999, wrong: 9999, flat: 9999, open: 19_998 }
  const longest = profilePost({ handle: 'a_fifteen_chars', line: `@a_fifteen_chars across 24 markets: ${recordHeadline('a_fifteen_chars', 'BTC', 'all', bigTally).split(': ')[1]}`, markets: 24, standing: STANDING_NOT_VERIFIED })
  const posts = [theirs, one, mine, longest]
  check(
    "called-gtm profile (share text): the post for an account's page states the whole tally in the records' own words (hits and misses), tags the handle inside the sentence (never first), carries the standing line as given, names the house account, links the account's own page and nothing else; the verified owner's is in the first person; every text is one line of printable ASCII and fits a post with the link counted as X counts it",
    theirs.text === `Calls by @somebody on 3 markets, each pinned to the day it was posted: 16 calls, 5 called it, 6 missed, 3 no real move, 2 too early to say. ${STANDING_NOT_VERIFIED} Plot any handle with ${X_MENTION}:` &&
      one.text === `Calls by @somebody, each pinned to the day it was posted: 8 calls, 1 called it, 4 missed, 2 no real move, 1 too early to say. ${STANDING_NOT_VERIFIED} Plot any handle with ${X_MENTION}:` &&
      mine.text === `My calls on 3 markets, each pinned to the day I posted it: 16 calls, 5 called it, 6 missed, 3 no real move, 2 too early to say. ${standingVerified('somebody')} Plot yours with ${X_MENTION}:` &&
      theirs.url === `${SITE_URL}/x/somebody` && theirs.title === line && one.title === btc.headline &&
      posts.every((p) => SHARE_ASCII_RE.test(p.text) && xPostWeight(p.text) <= X_POST_MAX && !p.text.startsWith('@') && !/#|https?:/.test(p.text)) &&
      longest.text.includes('9999 called it, 9999 missed') && longest.text.includes('@a_fifteen_chars'),
    `${xPostWeight(theirs.text)} ${xPostWeight(longest.text)}`,
  )

  // ── The source: what the files promise ──
  const page = read('app/x/[handle]/page.tsx')
  const pieces = read('app/x/_lib/profile.tsx')
  const rules = read('app/x/_lib/profile-rules.ts')
  const css = read('components/called/called-profile.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const mineSrc = [page, pieces, rules]
  check(
    "called-gtm profile (reads): the page is drawn from the board (readBoard for this handle: the public list's rows, each from its own record), never from a fetch of our own API and never from the list's own call count; a listed market whose record did not summarize is still a row onto the chart; the metadata and the page share one read",
    /readBoard\(\{ handle, limit: LIST_ROWS \}\)/.test(page) && /const loadAccount = cache\(/.test(page) && (code(page).match(/loadAccount\(handle\)/g) ?? []).length === 2 && mineSrc.every((s) => !/fetch\(/.test(code(s))) && mineSrc.every((s) => !/\.calls\b/.test(code(s))) &&
      /<Link href=\{chartHref\(handle, r\.symbol\)\} className="xrc-row"/.test(page) && /board\.entries\.filter\(\(e\) => e\.handle === handle\)/.test(page),
  )
  check(
    "called-gtm profile (honesty in the source): the standing line is the record rule's own two strings; the tally, the hit rate, the coverage and every call's verdict and move are printed from the entry, never composed here; third-party words are text nodes (no inner HTML anywhere), cleaned and isolated; the best calls and the misses are the same row component; \"this viewer is the owner\" is the verified account's own X user id, never a name",
    /verified \? standingVerified\(handle\) : STANDING_NOT_VERIFIED/.test(page) && mineSrc.every((s) => !code(s).includes('dangerouslySetInnerHTML')) &&
      /<bdi>\{cleanLine\(top\?\.name \?\? '', 60\)\}<\/bdi>/.test(page) && /const words = cleanLine\(call\.quote \|\| call\.text, 180\)/.test(pieces) && /<bdi>\{words\}<\/bdi>/.test(pieces) &&
      /\{call\.verdictWords\}/.test(pieces) && /\{call\.move\}<\/span>/.test(pieces) && /\{entry\.coverage\}<\/span>/.test(pieces) && /headlineParts\(entry\.headline\)/.test(pieces) && /headlineParts\(line\)/.test(pieces) &&
      (code(pieces).match(/<CallRow /g) ?? []).length === 2 && /\{best\.length > 0 && \(/.test(pieces) && /\{misses\.length > 0 && \(/.test(pieces) &&
      /const mine = verified && !!me && !!row\?\.xUserId && me\.xUserId === row\.xUserId/.test(page) && !/me\.handle|me\.name/.test(code(page)) &&
      // No verdict word, no count and no percent is typed in the pieces: the only digits in its copy are sizes passed to helpers.
      !/called it|missed|no real move|too early/.test(code(pieces).replace(/aria-label="[^"]*"/g, '')) && !/\d%/.test(code(pieces)) && !/\d%/.test(code(page)),
  )
  check(
    "called-gtm profile (doors): a market's main press is the live chart with the account plotted and its quiet one the record; a shown call opens its own one-call address; the page's first press opens the top-ranked market's chart; the account's X profile is built from the normalized handle and opens apart; nothing here opens a sign-in door for looking",
    /<Link href=\{chartHref\(entry\.handle, entry\.symbol\)\} className="xpf-btn xpf-btn--main"/.test(pieces) && /<Link href=\{recordHref\(entry\.handle, entry\.symbol\)\} className="xpf-link"/.test(pieces) && /<Link href=\{callHref\(handle, symbol, call\.postId\)\} className="xpf-call"/.test(pieces) &&
      /<Link href=\{chartHref\(handle, lead\.symbol\)\} className="xpf-btn xpf-btn--lead xpf-btn--wide"/.test(page) && /href=\{`https:\/\/x\.com\/\$\{handle\}`\} className="xpf-id__x" target="_blank" rel="noopener noreferrer"/.test(page) &&
      !/SpineLink|openConnectModal|use-connect-to-act/.test(code(page) + code(pieces)) && chartHref('somebody', 'BTC') === '/t/BTC?x=somebody' && recordHref('somebody', 'BTC') === '/x/somebody/BTC' && callHref('somebody', 'BTC', '11111') === '/x/somebody/BTC?call=11111',
  )
  check(
    "called-gtm profile (the owner's block): Verify with X is the existing button, mounted once and with no path of this lane's making; the fee is lib/fees' own figure and the creator's share its own split (no fee number is typed), the claim is about a swap and says a path with no fee pays nothing; minting goes through the landing's one link to the links studio; the takedown address is the one the privacy policy names; a deleted post's note is spec's",
    (code(pieces).match(/<VerifyWithX /g) ?? []).length === 1 && /<VerifyWithX symbol=\{symbol\} \/>/.test(pieces) && !/<VerifyWithX[^>]*next=/.test(pieces + page) &&
      /import \{ CREATOR_FEE_SPLIT, LINK_FEE_PCT \} from '@\/lib\/fees'/.test(pieces) && /the link fee is \{LINK_FEE_PCT\} on a Uniswap or CoW swap/.test(pieces) && /On a swap through your link, \{share\} of Pantessa&rsquo;s fee is yours/.test(pieces) && /A path with no fee, like staking or lending, pays nothing\./.test(pieces) &&
      !/0\.\d+%|\d+ ?bps|\bhalf\b/.test(code(pieces)) && creatorShareWords(0.5) === 'half' && creatorShareWords(0.4) === '40%' && creatorShareWords(CREATOR_FEE_SPLIT).length > 0 && /^\d+\.\d\d%$/.test(LINK_FEE_PCT) &&
      /<LandingLink href=\{LINKS_STUDIO_HREF\} className="xpf-link"/.test(pieces) && LINKS_STUDIO_HREF === '/chat?tab=links' && /href="\/docs\/creator-earnings"/.test(pieces) &&
      read('app/docs/privacy/page.tsx').includes(`const CONTACT = '${TAKEDOWN_EMAIL}'`) && /mailto:\$\{TAKEDOWN_EMAIL\}/.test(pieces) && !/@pantessa\.com/.test(code(pieces)) && /\{DELETED_NOTE\}/.test(pieces),
  )
  check(
    "called-gtm profile (the unlisted account): a page with nothing listed says so in words that are true for an account nobody scanned AND for a scanned account under the public list's floor, names the floor from spec (never a typed number), offers three markets and the door, and never prints a standing line or a tally it does not have",
    /No market is listed for @\{handle\} yet\./.test(page) && /\{fmtCount\(LIST_MIN_FOLLOWERS\)\} followers or more, or one its owner has verified/.test(page) && LIST_MIN_FOLLOWERS === 5000 && /const STARTERS = \['BTC', 'ETH', 'SOL'\] as const/.test(page) &&
      /\{plots > 0 \? \(\s*<p className=\{`xpf-standing/.test(page) && /\{entries\.length > 0 && <ProfileSum line=\{line\} entries=\{entries\} \/>\}/.test(page) && /<OwnerBlock handle=\{handle\} symbol=\{lead\?\.symbol\} verified=\{verified\} listed=\{plots > 0\} \/>/.test(page),
  )
  const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((sel) => sel && !/^(from|to|\d+%)/.test(sel))
  const toned = [...css.matchAll(/([^{}]+)\{([^}]*var\(--xrc-tone\)[^}]*)\}/g)]
  check(
    'called-gtm profile (the sheet): flat. No shadow, no gradient, no blur, no glow, no italic and no literal colour; every rule is under the lane\'s own prefix and none names a class of the record sheet; a verdict\'s colour reaches only a mark, a dot or a thin rule, never a headline, a figure or a post; touch targets are 44px',
    !/box-shadow|text-shadow|gradient|backdrop-filter|filter: blur|font-style: italic|#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css) &&
      // The record sheet's own pin lets no other sheet name one of its classes, in a rule or in a comment.
      !/\.xrc[\w-]*/.test(read('components/called/called-profile.css')) &&
      selectors.length > 40 && selectors.every((sel) => sel.split(',').every((one) => /\.xpf/.test(one))) &&
      // RE-PINNED 2026-11-24 (squad mobile-sleek, lane XPAGES): the tally is the kit's score bar and a call's mark is the kit's tile, so this sheet tones one thing only, the square on a market's line. The rule itself stands: a verdict's colour here reaches a mark, a dot or a thin rule, never a headline, a figure or a post.
      toned.length >= 1 && toned.every((m) => /\.xpf-cell|\.xpf-mark|\.xpf-spark__dot|\.xpf-marks li::before/.test(m[1]) && /(border-top|background): [^;]*var\(--xrc-tone\)/.test(m[2])) &&
      !/\.xpf-(id__name|sec__title|aside__title|cell b|call__quote|mkt__sym)[^{]*\{[^}]*color: var\(--(accent|sell|gold|xrc-tone)\)/.test(css) && /@media \(hover: none\) \{[^@]*min-height: 44px/.test(css) && /\.xpf \.xpf-id__x \{[^}]*width: 44px; height: 44px/.test(css),
  )
  // ── A taken-down or protected account (review F3) ──
  const acct = code(read('app/x/[handle]/page.tsx'))
  const shell = acct.slice(acct.indexOf('const down = takenDown('), acct.indexOf('const { entries, rest, failed } = await loadAccount(handle)'))
  const meta = acct.slice(acct.indexOf('export async function generateMetadata'), acct.indexOf('function XGlyph'))
  check(
    'called-gtm profile (F3): /x/<handle> asks takenDown (the record\'s own rule) before anything is listed, in the page and in its metadata; a taken-down or protected handle gets the record page\'s refusal shell: the reason, a plain door with no handle in it, no "Plot @h" rows, no owner block, and a title without the handle, out of the index',
    /import \{ takenDown \} from '@\/lib\/called-it\/record'/.test(acct) && /const down = takenDown\(handle, await loadRow\(handle\)\)/.test(acct) && acct.indexOf('const down = takenDown(') < acct.indexOf('const { entries, rest, failed } = await loadAccount(handle)') &&
      /<h1 className="xrc-headline">\{down\.reason\}<\/h1>/.test(shell) && /<DoorBlock heading="Plot a handle" \/>/.test(shell) && !/initialHandle|PlotDoor|OwnerBlock|STARTERS|xpf-starter/.test(shell) &&
      /if \(takenDown\(handle, await loadRow\(handle\)\)\)/.test(meta) && meta.indexOf('takenDown(') < meta.indexOf('loadAccount(handle)') && /robots: \{ index: false, follow: false \}/.test(meta),
  )
}

// ── Served ──────────────────────────────────────────────────────────────

const HEAD = { 'x-yf-internal-run': '1' }
const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
const metaOf = (html: string, name: string): string | null => {
  const m = new RegExp(`<meta[^>]+(?:name|property)="${name}"[^>]+content="([^"]*)"`).exec(html)
  return m ? m[1].replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'") : null
}
/** The inside of the element that carries `data-xpf="<name>"`, up to the next section's marker (enough for a text check). */
const block = (html: string, name: string): string => {
  const from = html.indexOf(`data-xpf="${name}"`)
  if (from < 0) return ''
  const rest = html.slice(from)
  const next = rest.slice(20).search(/data-xpf="(sum|calls|best|misses|markets|rest|owner|share|door)"/)
  return next < 0 ? rest : rest.slice(0, next + 20)
}

export async function calledGtmProfilePinsServed(check: Check, base: string): Promise<void> {
  try {
    const page = async (path: string) => {
      const r = await fetch(`${base}${path}`, { headers: HEAD, redirect: 'manual' })
      return { status: r.status, html: await r.text(), location: r.headers.get('location') }
    }
    const boardOf = async (handle: string): Promise<BoardEntry[]> => {
      const r = await fetch(`${base}/api/x/board?handle=${handle}`, { headers: HEAD })
      return r.ok ? (((await r.json()) as { entries?: BoardEntry[] }).entries ?? []) : []
    }

    // ── A real record with hits AND misses (the TEST DB's cz_binance on BTC) ──
    const cz = await boardOf('cz_binance')
    const p = await page('/x/cz_binance')
    const text = textOf(p.html)
    if (!cz.length) {
      check('called-gtm profile (served): the TEST DB holds cz_binance on BTC, the record these checks draw', false, 'the board answered no entry for cz_binance')
    } else {
      const line = profileLine('cz_binance', cz)
      const sum = sumTally(cz)
      const rate = rateSentence(sum)
      const best = bestCallsOf(cz)
      const misses = missCallsOf(cz)
      const sumText = textOf(block(p.html, 'sum'))
      check(
        "called-gtm profile (served, the header): the account's page answers a real page with who (the handle, the follower count, a link to the account on X), the standing line, and ONE line across its markets that is the board's own summed tally to the letter, with the hit rate's words when there are enough judged calls; the first press opens the top-ranked market's live chart with the account plotted",
        p.status === 200 && /data-xrc="handle" data-status="ready"/.test(p.html) && text.includes('@cz_binance') && / followers/.test(text) && p.html.includes('href="https://x.com/cz_binance"') &&
          (cz[0].verified ? text.includes(standingVerified('cz_binance')) : text.includes(STANDING_NOT_VERIFIED)) && sumText.includes(line) && (rate ? sumText.includes(rate) : !/judged calls/.test(sumText)) &&
          p.html.includes(`href="${chartHref('cz_binance', cz[0].symbol).replace(/&/g, '&amp;')}"`) && text.includes(`Open the ${cz[0].symbol} chart with these calls`),
        `${p.status} "${sumText.slice(0, 140)}"`,
      )
      // The JUDGED half of the move words only: the "since" figure follows the live price, and the board's cached entry can turn over between this file's two reads (it did once in a full harness run).
      const judged = (move: string) => move.replace(/, [^,]* since$/, '')
      const bestHtml = block(p.html, 'best')
      const missHtml = block(p.html, 'misses')
      check(
        "called-gtm profile (served, the calls): each shown hit is the board's own best call for its market (its verdict's word, the market, the day's own move words) and links to that call's own address; the strongest miss is shown the same way under its own label; with the tally above them on the same page, hits and misses both",
        best.length > 0 && best.every((b) => bestHtml.includes(`href="${callHref('cz_binance', b.symbol, b.call.postId).replace(/&/g, '&amp;')}"`) && textOf(bestHtml).includes(judged(b.call.move)) && textOf(bestHtml).includes(VERDICT_WORDS.right)) && textOf(bestHtml).includes('Best calls') &&
          misses.length > 0 && misses.every((m) => missHtml.includes(`href="${callHref('cz_binance', m.symbol, m.call.postId).replace(/&/g, '&amp;')}"`) && textOf(missHtml).includes(judged(m.call.move)) && textOf(missHtml).includes(VERDICT_WORDS.wrong)) && textOf(missHtml).includes('Misses') &&
          (bestHtml.match(/class="xpf-call"/g) ?? []).length === best.length && (missHtml.match(/class="xpf-call"/g) ?? []).length === misses.length && p.html.indexOf('data-xpf="sum"') < p.html.indexOf('data-xpf="best"'),
        `${best.length} best, ${misses.length} misses`,
      )
      const mkts = block(p.html, 'markets')
      check(
        "called-gtm profile (served, the markets): one tile per market with its own tally (the record's headline counts, every one), a dot per call on its price line, the coverage words, the live chart as the main press and the record as the quiet one",
        (mkts.match(/<li class="xpf-mkt"/g) ?? []).length === cz.length &&
          cz.every((e) => mkts.includes(`data-symbol="${e.symbol}"`) && textOf(mkts).includes(e.headline.slice(e.headline.indexOf(': ') + 2)) && (!e.coverage || textOf(mkts).includes(e.coverage)) && mkts.includes(`href="${chartHref(e.handle, e.symbol)}"`) && mkts.includes(`href="${recordHref(e.handle, e.symbol)}"`)) &&
          (mkts.match(/class="xpf-spark__dot is-(right|wrong|flat|open)"/g) ?? []).length === cz.reduce((n, e) => n + (e.line ? e.dots.length : 0), 0),
        `${(mkts.match(/<li class="xpf-mkt"/g) ?? []).length} tiles`,
      )
      const owner = block(p.html, 'owner')
      const ownerText = textOf(owner)
      check(
        "called-gtm profile (served, the owner's block): \"Is this you?\" carries Verify with X (the existing button, aimed at X's sign-in start), the earning line with lib/fees' own link fee and the words that a path with no fee pays nothing, the link to mint and the docs, and one line on taking the page down with the privacy policy's address",
        ownerText.includes('Is this you?') && owner.includes('href="/api/x/auth/start?next=') && ownerText.includes('Verify with X') && ownerText.includes(`the link fee is ${LINK_FEE_PCT} on a Uniswap or CoW swap`) && ownerText.includes(`${creatorShareWords(CREATOR_FEE_SPLIT)} of Pantessa`) &&
          ownerText.includes('pays nothing') && owner.includes(`href="${LINKS_STUDIO_HREF}"`) && owner.includes('href="/docs/creator-earnings"') && ownerText.includes('Want this page taken down?') && owner.includes(`href="mailto:${TAKEDOWN_EMAIL}?subject=`) &&
          (p.html.match(/data-journey="called_verify_x"/g) ?? []).length === 1,
        ownerText.slice(0, 120),
      )
      const title = /<title>([^<]*)<\/title>/.exec(p.html)?.[1].replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'") ?? ''
      const robots = metaOf(p.html, 'robots') ?? ''
      const share = block(p.html, 'share')
      check(
        "called-gtm profile (served, metadata and share): the title and the card's headline are the summed line; the description opens with the standing line; the page is indexed exactly when it has a judged call; the canonical address is the account's own; the share row posts the whole tally and links the account's page",
        title === `${line.replace(/\.$/, '')} · Called it on Pantessa` && metaOf(p.html, 'og:title') === line && (metaOf(p.html, 'description') ?? '').startsWith(cz[0].verified ? standingVerified('cz_binance') : STANDING_NOT_VERIFIED) &&
          /noindex/.test(robots) === !profileIndexable('cz_binance', cz) && /<link rel="canonical" href="[^"]*\/x\/cz_binance"/.test(p.html) && /\/api\/og\/called\?handle=cz_binance$/.test(metaOf(p.html, 'og:image') ?? '') &&
          share.includes('data-share="row"') && decodeURIComponent((/href="(https:\/\/(?:x|twitter)\.com\/intent\/[^"]+)"/.exec(share)?.[1] ?? '').replace(/&amp;/g, '&').replace(/\+/g, ' ')).includes(line.slice(line.indexOf(': ') + 2)) && p.html.includes('id="share"') && p.html.includes('id="plot"'),
        `${title} | robots=${robots || 'index'}`,
      )
    }

    // ── A record with no miss, and under MIN_JUDGED (brian_armstrong on BTC, when the TEST DB has it) ──
    const ba = await boardOf('brian_armstrong')
    if (ba.length) {
      const q = await page('/x/brian_armstrong')
      const hasMiss = missCallsOf(ba).length > 0
      const rate = rateSentence(sumTally(ba))
      check(
        'called-gtm profile (served, a record with no miss): a group with nothing in it is absent (no empty "Misses"), and under the judged-call floor no hit rate is printed anywhere on the page',
        q.status === 200 && q.html.includes('data-xpf="misses"') === hasMiss && q.html.includes('data-xpf="best"') === bestCallsOf(ba).length > 0 && (rate !== null || !/judged calls/.test(textOf(q.html.slice(0, q.html.indexOf('data-xpf="door"'))))) &&
          textOf(block(q.html, 'sum')).includes(profileLine('brian_armstrong', ba)),
        `${q.status} misses=${hasMiss} rate=${rate}`,
      )
    }

    // ── Nothing listed, a bad handle, the canonical spelling ──
    const none = await page('/x/zz_pin_pf_none')
    const noneText = textOf(none.html)
    const bad = await page(`/x/${encodeURIComponent('"><svg onload=alert(1)>')}`)
    const canon = await page('/x/@CZ_Binance')
    check(
      'called-gtm profile (served, the other states): a handle with nothing listed is a real page (it says so, names the list\'s floor, offers three markets and the door, prints no standing line, no tally and no share row, and is not indexed); a string that is not a handle is refused in words and never echoed as markup; @Name lands on the one canonical address',
      none.status === 200 && /data-status="empty" data-plots="0"/.test(none.html) && noneText.includes('No market is listed for @zz_pin_pf_none yet.') && noneText.includes('5K followers or more') && ['BTC', 'ETH', 'SOL'].every((s) => none.html.includes(`href="/x/zz_pin_pf_none/${s}"`)) &&
        none.html.includes('id="plot"') && !none.html.includes('data-standing') && !none.html.includes('data-xpf="sum"') && !none.html.includes('data-xpf="share"') && !noneText.includes(STANDING_NOT_VERIFIED) && /noindex/.test(metaOf(none.html, 'robots') ?? '') && noneText.includes('Is this you?') &&
        bad.status === 200 && textOf(bad.html).includes('That is not an X handle.') && !bad.html.includes('<svg onload') &&
        [307, 308].includes(canon.status) && (canon.location ?? '').endsWith('/x/cz_binance'),
      `${none.status} ${bad.status} ${canon.status}→${canon.location}`,
    )
    // A taken-down handle (review F3), on a row this pin writes and removes (zz_pin_ rows are the harness's own).
    if (process.env.DATABASE_URL) {
      const { default: prisma } = await import('../lib/db')
      const DOWN = 'zz_pin_pf_down'
      try {
        await prisma.xHandle.upsert({ where: { handle: DOWN }, create: { handle: DOWN, followers: 250_000, hiddenAt: new Date(), hiddenBy: 'admin' }, update: { hiddenAt: new Date(), hiddenBy: 'admin', isProtected: false } })
        const d = await page(`/x/${DOWN}`)
        const dt = textOf(d.html)
        check(
          'called-gtm profile (served, F3): a taken-down handle\'s account page says it was taken down and nothing else about it: no "Plot @h" rows, no door prefilled with the handle, no owner block, no "not listed yet", and a title without the handle, out of the index',
          d.status === 200 && /data-status="refused"/.test(d.html) && dt.includes(`The record for @${DOWN} has been taken down`) && !d.html.includes(`href="/x/${DOWN}/BTC"`) && !dt.includes(`Plot @${DOWN}`) && !dt.includes('No market is listed') &&
            !d.html.includes(`value="${DOWN}"`) && !d.html.includes('data-xpf="owner"') && !/<title>[^<]*zz_pin_pf_down/.test(d.html) && /noindex/.test(metaOf(d.html, 'robots') ?? ''),
          `${d.status} ${dt.slice(0, 160)}`,
        )
      } finally {
        await prisma.xHandle.deleteMany({ where: { handle: DOWN } }).catch(() => undefined)
      }
    }
    const cssHref = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g
    const sheets = await Promise.all([...p.html.matchAll(cssHref)].map((m) => fetch(new URL(m[1].replace(/&amp;/g, '&'), base), { headers: HEAD }).then((r) => (r.ok ? r.text() : '')).catch(() => '')))
    // RE-PINNED 2026-11-24 (squad mobile-sleek, lane XPAGES): the sum's cells are the kit's score bar now, so the sheet is known by `.xpf-sum`.
    check('called-gtm profile (served, the sheet): the account page ships the lane\'s own rules', sheets.some((s) => s.includes('.xpf-sum') && s.includes('.xpf-mkt')), `${sheets.length} sheets`)
  } catch (e) {
    check('called-gtm profile (served): the server answered', false, e instanceof Error ? e.message : String(e))
  }
}

if (process.argv[1]?.endsWith('called-gtm-profile-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledGtmProfilePins(check)
    if (process.env.BASE) await calledGtmProfilePinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-gtm profile pins failed` : `\nall ${n} called-gtm profile pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
