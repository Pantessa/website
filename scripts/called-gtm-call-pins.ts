// Pins for squad called-gtm, lane CALL (2026-11-16). The lane owns this file:
// pure checks in calledGtmCallPins, checks against a running server in
// calledGtmCallPinsServed. Already wired into test-api and package.json by
// the contract commit, so no lane edits the harness.
//   npx tsx scripts/called-gtm-call-pins.ts            (npm run pins:called-gtm-call)
//   BASE=http://localhost:PORT npx tsx scripts/called-gtm-call-pins.ts
//
// What is held here (the page and the image an account is sent about ONE of
// its calls, /x/<handle>/<SYM>?call=<postId>):
//   · the call's words: its title says the verdict in spec's word and no
//     other ("called it" only when the verdict is right), and what unfurls
//     under it always carries the record's whole tally and standing line;
//   · the image's quote: the whole post as X shows it, or the labeled span
//     with an ellipsis wherever the post goes on; never a reworded word;
//   · the image's address: `call=` and nothing else (no side, no pins);
//   · the share posts: ASCII, 280 as X counts, never an @mention first, the
//     verdict in spec's word, the whole tally (or a pointer to it) always in
//     the text, "Not verified" where it applies, first person only for the
//     verified owner; a pasted post says it is not counted;
//   · the source: a call address reads the WHOLE record, an unknown id is the
//     plain page, the lead prints the record's own headline and standing line
//     and mounts the trade buttons, a post is a text node, the sheet is flat;
//   · served: the fixture and (when the TEST DB holds it) a real record.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Candle } from '../lib/charts'
import { FIXTURE_HANDLE, FIXTURE_PROFILE, fixturePosts } from '../lib/called-it/fixture'
import { ADDED_MARK, STANDING_NOT_VERIFIED, VERDICT_WORDS, buildRecord, fmtDay, moveLine, standingVerified, type CalledCall, type CalledRecord, type CallVerdict, type RecordResponse } from '../lib/called-it/spec'
import { bestCallOf, callHref, callPlaceOf, chartCallHref, leadCallOf } from '../lib/called-it/gtm'
import {
  OG_CALL,
  OG_CALL_QUOTE_STEPS,
  OG_CALL_QUOTE_UNITS,
  OG_SIZE,
  callDescription,
  callHeadline,
  callPlot,
  callQuote,
  callQuoteFit,
  calledImageHref,
  displayPost,
  headlineTally,
  plotScale,
  sentenceCase,
  textUnits,
} from '../lib/called-it/card-layout'
import { CALLED_FULL_AT_LINK, CALLED_NO_TALLY, SHARE_ASCII_RE, X_POST_MAX, calledCallPost, myCalledCallPost, xPostWeight } from '../lib/share-posts'
import { X_MENTION } from '../lib/social'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = new URL('..', import.meta.url).pathname
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1')
const DAY = 86_400
const NOW = Date.UTC(2026, 10, 11, 12)

function bars(f: (i: number) => number, n = 400): Candle[] {
  const end = Math.floor(NOW / 1000 / DAY) * DAY
  return Array.from({ length: n }, (_, i) => {
    const c = f(i)
    return { t: end - (n - 1 - i) * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }
  })
}

const VERDICTS: CallVerdict[] = ['right', 'wrong', 'flat', 'open']

export function calledGtmCallPins(check: Check): void {
  const posts = fixturePosts(NOW)
  // A wavy line, so the fixture's ten calls come out as hits, misses, flats and open calls.
  const candles = bars((i) => 100 + 30 * Math.sin(i / 17) + i * 0.05)
  const rec = (handle: string, symbol: string, verified: boolean, extra: Partial<Parameters<typeof buildRecord>[0]> = {}): CalledRecord =>
    buildRecord({ handle, symbol, side: 'all', profile: { ...FIXTURE_PROFILE, handle }, verified: verified ? { at: NOW } : null, posts: posts.map((p) => ({ ...p, handle })), candles, nowMs: NOW, scannedAt: NOW, postsRead: posts.length, ...extra })
  const fx = rec(FIXTURE_HANDLE, 'BTC', false)
  const mineRec = rec(FIXTURE_HANDLE, 'BTC', true)
  const byVerdict = (v: CallVerdict) => fx.calls.find((c) => c.verdict === v)
  const seen = VERDICTS.filter((v) => byVerdict(v))

  // ── The call's own words ──
  const hit = byVerdict('right') as CalledCall
  check(
    'called-gtm call (words): one call\'s title is who, the market, the day and the verdict in spec\'s word; "called it" is said only of a call whose verdict is right; a pasted post says it was added by a viewer',
    seen.length >= 3 && !!hit &&
      seen.every((v) => {
        const c = byVerdict(v) as CalledCall
        const t = callHeadline(FIXTURE_HANDLE, 'btc', c)
        return t === `@${FIXTURE_HANDLE} on BTC, ${fmtDay(c.postedAt)}: ${VERDICT_WORDS[v]}.` && t.includes('called it') === (v === 'right')
      }) &&
      callHeadline('a', 'ETH', { postedAt: Date.UTC(2026, 7, 15), verdict: 'wrong', origin: 'added' }) === `@a on ETH, 15 Aug 2026 (${ADDED_MARK}): missed.` && sentenceCase(VERDICT_WORDS.right) === 'Called it' && sentenceCase(VERDICT_WORDS.open) === 'Too early to say',
    `${seen.join()} ${hit ? callHeadline(FIXTURE_HANDLE, 'BTC', hit) : '-'}`,
  )
  const desc = callDescription(fx, hit)
  check(
    'called-gtm call (words): what unfurls under the title is the price that day and the record\'s own move words, then the WHOLE tally and the standing line, each in the record\'s own words; no number in it is the page\'s',
    desc.includes(moveLine(hit)) && desc.includes(`Full record: ${headlineTally(fx.words.headline)}`) && desc.endsWith(fx.words.standing) && desc.startsWith('BTC was $') && /\d+ calls, /.test(desc) &&
      callDescription(mineRec, hit).endsWith(standingVerified(FIXTURE_HANDLE)) && callDescription(fx, hit, 'yield').startsWith(`BTC was ${hit.priceAt.toFixed(3)}%`),
    desc,
  )

  // ── The image's quote ──
  const reply = "@QuintenFrancois @someone_else Soon, millionaires won't be able to afford 1 full Bitcoin. \u{1F937} https://t.co/AbC123xyz"
  const long = `Was semi "offline" for a few days. Busy with year end, book, family, etc.\n\nBTC will be fine. ${'Many more words follow here, about other things entirely. '.repeat(8)}The end.`
  const qLong = callQuote(long, 'BTC will be fine.')
  const hugeSpan = 'up only '.repeat(80).trim()
  const qHuge = callQuote(`Listen. ${hugeSpan} Trust me.`, hugeSpan)
  const cleanOf = (s: string) => s.replace(/\s+/g, ' ').trim()
  /** Every run of the quote between ellipses is in the post, in order: nothing was reworded or moved. */
  const verbatim = (q: string, text: string) => {
    let from = 0
    const flat = cleanOf(text)
    for (const run of q.split('…').map((r) => r.trim()).filter(Boolean)) {
      const at = flat.indexOf(run, from)
      if (at < 0) return false
      from = at + run.length
    }
    return true
  }
  check(
    'called-gtm call (image quote): a post that fits is quoted whole, the way X shows it (the accounts a reply opens with and the t.co links it closes with are left off, not a word between them touched); a longer post is quoted by the span the label marked, with an ellipsis on every side where the post goes on; a span too long itself is cut on a word with an ellipsis; nothing is ever reworded or reordered, and the quote always fits the card',
    displayPost(reply) === "Soon, millionaires won't be able to afford 1 full Bitcoin. \u{1F937}" && displayPost('@only_a_mention') === '@only_a_mention' && displayPost('gm\n\n  frens') === 'gm frens' && displayPost('look @inside the post') === 'look @inside the post' &&
      callQuote(reply, 'Soon, millionaires').text === displayPost(reply) && callQuote(reply, 'Soon, millionaires').cut === false &&
      qLong.text === '…BTC will be fine.…' && qLong.cut && callQuote(`BTC will be fine. ${'x '.repeat(300)}`, 'BTC will be fine.').text === 'BTC will be fine.…' &&
      qHuge.cut && qHuge.text.startsWith('…up only up only') && qHuge.text.endsWith('…') && !qHuge.text.endsWith('……') && textUnits(qHuge.text) <= OG_CALL_QUOTE_UNITS + 0.01 &&
      [reply, long, `Listen. ${hugeSpan} Trust me.`, 'short one', '‮evil‬ text here that is fine'].every((t) => [null, 'BTC will be fine.', hugeSpan, 'not in the post at all'].every((q) => { const r = callQuote(t, q); return verbatim(r.text, displayPost(t)) && textUnits(r.text) <= OG_CALL_QUOTE_UNITS + 0.01 && !/[‪-‮]/.test(r.text) })),
    `${JSON.stringify(qLong)} ${qHuge.text.slice(0, 24)} ${textUnits(qHuge.text)}`,
  )
  check(
    'called-gtm call (image quote): the quote is set big while it is short and never under 34px; each size holds what it promises and the smallest holds the longest quote the image draws',
    OG_CALL_QUOTE_STEPS.every((s, i, a) => i === 0 || (s.capacity > a[i - 1].capacity && s.size < a[i - 1].size && s.lines > a[i - 1].lines)) && OG_CALL_QUOTE_STEPS[OG_CALL_QUOTE_STEPS.length - 1].capacity === OG_CALL_QUOTE_UNITS && Math.min(...OG_CALL_QUOTE_STEPS.map((s) => s.size)) >= 34 &&
      // The quote's box holds every step: its lines at 1.14 line height, and its words (half an em a letter width, the two quote marks counted) in four fifths of them, since lines break on words.
      OG_CALL_QUOTE_STEPS.every((s) => s.lines * s.size * 1.14 <= OG_CALL.quote.h && (s.capacity + 2) * s.size * 0.5 <= 0.8 * s.lines * (OG_CALL.quote.w - 27)) &&
      callQuoteFit(10).size === 60 && callQuoteFit(51).size === 49 && callQuoteFit(9999).size === 34,
    OG_CALL_QUOTE_STEPS.map((s) => `${s.capacity}:${Math.round(s.lines * s.size * 1.14)}/${OG_CALL.quote.h}:${Math.round((s.capacity + 2) * s.size * 0.5)}/${Math.round(0.8 * s.lines * (OG_CALL.quote.w - 27))}`).join(' '),
  )

  // ── The image's layout and address ──
  const closes = candles.map((c) => ({ t: c.t, c: c.c }))
  const scale = plotScale(closes, fx.calls.map((c) => c.priceAt))
  const toIn = (c: CalledCall) => ({ id: c.postId, t: c.barTime, price: c.priceAt })
  const plot = callPlot(scale, toIn(hit), fx.calls.map(toIn))
  const B = OG_CALL.plot
  const Q = OG_CALL.quote
  const inside = (p: { x: number; y: number }) => p.x >= B.x && p.x <= B.x + B.w && p.y >= B.y && p.y <= B.y + B.h
  check(
    'called-gtm call (image layout): the words and the price line stand side by side inside the picture and above the record\'s foot, never over each other; this call\'s day is one point on the line and every OTHER call of the record keeps its own dot (the line never shows one call alone); with no chart there is no line',
    !!plot && inside(plot.dot) && plot.others.length === fx.calls.length - 1 && plot.others.every((o) => inside(o) && o.id !== hit.postId) && callPlot(null, toIn(hit), []) === null &&
      Q.x + Q.w <= B.x && Q.x >= OG_CALL.pad && B.x + B.w <= OG_SIZE.w - OG_CALL.pad && Q.y + Q.h <= OG_CALL.footY && B.y + B.h + 110 <= OG_CALL.footY && OG_CALL.footY + 90 <= OG_SIZE.h,
    JSON.stringify(plot?.dot),
  )
  check(
    'called-gtm call (image address): a call\'s image is named by handle, market and `call` and nothing else (a side or a viewer\'s pins never ride with a call: it is always drawn beside the whole record); the record\'s own addresses are unchanged',
    calledImageHref('cz_binance', 'btc', 'all', [], '2088559989162217593') === '/api/og/called?handle=cz_binance&sym=BTC&call=2088559989162217593' &&
      calledImageHref('cz_binance', 'BTC', 'bear', ['123456'], '2088559989162217593') === '/api/og/called?handle=cz_binance&sym=BTC&call=2088559989162217593' &&
      calledImageHref('cz_binance', 'BTC', 'bear', ['123456']) === '/api/og/called?handle=cz_binance&sym=BTC&side=bear&pins=123456' && calledImageHref('cz_binance', 'BTC', 'all', [], null) === '/api/og/called?handle=cz_binance&sym=BTC',
  )

  // ── The share posts ──
  const tally = headlineTally(fx.words.headline)
  const okPost = (text: string) => SHARE_ASCII_RE.test(text) && xPostWeight(text) <= X_POST_MAX && !text.startsWith('@') && !text.includes('#') && !/https?:/.test(text)
  const theirs = fx.calls.map((c) => ({ c, p: calledCallPost(fx, c) }))
  const mine = mineRec.calls.map((c) => ({ c, p: myCalledCallPost(mineRec, c) }))
  const lean = (c: CalledCall) => (c.stance === 'bull' ? 'Bullish' : 'Bearish')
  check(
    'called-gtm call (share post): the post for one call says whose, the day, the verdict in spec\'s word and the record\'s own move words; the WHOLE tally is in the text; it says "Not verified" for a plot of somebody else; ASCII, one link, never an @mention first, 280 as X counts it; the link is the call\'s own address on the whole record (no side)',
    theirs.length >= 8 &&
      theirs.every(({ c, p }) => p.text.startsWith(`${lean(c)} $BTC call by @${FIXTURE_HANDLE}, ${fmtDay(c.postedAt)}: ${VERDICT_WORDS[c.verdict]}, ${moveLine(c)}. Full record: ${tally}`) && p.text.includes('Not verified') && okPost(p.text) && p.url.endsWith(callHref(FIXTURE_HANDLE, 'BTC', c.postId)) && !p.url.includes('side=') && p.title === callHeadline(FIXTURE_HANDLE, 'BTC', c)) &&
      theirs[0].p.text === `${lean(theirs[0].c)} $BTC call by @${FIXTURE_HANDLE}, ${fmtDay(theirs[0].c.postedAt)}: ${VERDICT_WORDS[theirs[0].c.verdict]}, ${moveLine(theirs[0].c)}. Full record: ${tally} ${STANDING_NOT_VERIFIED} Plot any handle with ${X_MENTION}:`,
    `${theirs[0]?.p.text} (${xPostWeight(theirs[0]?.p.text ?? '')})`,
  )
  check(
    'called-gtm call (share post, the owner): the verified account\'s own post is first person with the same verdict word, the same whole tally and the record\'s "Verified" line; it never says "Not verified", and somebody else\'s post never says "Verified" on its own',
    mine.every(({ c, p }) => p.text.startsWith(`My ${lean(c).toLowerCase()} $BTC call, ${fmtDay(c.postedAt)}: ${VERDICT_WORDS[c.verdict]}, ${moveLine(c)}. My full record: ${tally}`) && p.text.includes(standingVerified(FIXTURE_HANDLE)) && !p.text.includes('Not verified') && okPost(p.text) && p.url === theirs.find((t) => t.c.postId === c.postId)?.p.url) &&
      theirs.every(({ p }) => !/verified/i.test(p.text.replace('Not verified', ''))),
    mine[0]?.p.text,
  )
  // The words are spec's whatever the verdict: a miss is shared as a miss.
  const afterLead = (text: string) => text.slice(text.indexOf(': ') + 2, text.indexOf('. '))
  check(
    'called-gtm call (share post, honesty): "called it" opens the result only for a call whose verdict is right; a miss is shared as "missed", an open call as "too early to say"',
    theirs.every(({ c, p }) => afterLead(p.text).startsWith(VERDICT_WORDS.right) === (c.verdict === 'right')) && mine.every(({ c, p }) => afterLead(p.text).startsWith(VERDICT_WORDS.right) === (c.verdict === 'right')),
  )
  // The longest it can get: a 15-character handle, a symbol X draws no cashtag for, a five-digit tally, a target's words.
  const h15 = 'a_very_long_h15'
  const big = { handle: h15, symbol: 'XYZ:LONGSYMBOL.NAME-24CH', side: 'all' as const, words: { headline: `@${h15} on XYZ:LONGSYMBOL.NAME-24CH: 12345 calls, 2345 called it, 3456 missed, 1234 no real move, 5310 too early to say.`, standing: STANDING_NOT_VERIFIED } }
  const targetCall = { postId: '2088559989162217593', postedAt: Date.UTC(2026, 8, 28), stance: 'bear' as const, verdict: 'wrong' as const, judgedPct: -0.5, now: -0.123, origin: 'scan' as const, target: { span: '$150,000', unit: 'price' as const, stated: '$150,000', price: 150000, stop: 1, outcome: 'expired' as const, at: null } }
  const bigPost = calledCallPost(big, targetCall)
  const bigMine = myCalledCallPost({ ...big, words: { ...big.words, standing: standingVerified(h15) } }, targetCall)
  const huge = { ...big, words: { ...big.words, headline: `@${h15} on XYZ:LONGSYMBOL.NAME-24CH: ${'123456789 calls, '.repeat(9)}1 missed.` } }
  check(
    'called-gtm call (share post, the limit): the longest call still fits X with the whole tally in it (the closing sentence and the standing line\'s second half go first); only a tally that cannot fit at all is replaced, by words that say the full record, hits and misses, is at the link',
    okPost(bigPost.text) && bigPost.text.includes(headlineTally(big.words.headline)) && bigPost.text.includes('$150,000 target not reached in 180 days') && okPost(bigMine.text) && bigMine.text.includes(headlineTally(big.words.headline)) &&
      calledCallPost(huge, targetCall).text.endsWith(CALLED_FULL_AT_LINK) && myCalledCallPost(huge, targetCall).text.endsWith(CALLED_FULL_AT_LINK) && !/\d/.test(CALLED_FULL_AT_LINK) && /hits and misses/.test(CALLED_FULL_AT_LINK),
    `${xPostWeight(bigPost.text)} ${bigPost.text}`,
  )
  // A post a viewer pasted has an address too: it says what it is, and that it is not counted.
  const pasted = { ...hit, origin: 'added' as const }
  const pastedPost = calledCallPost(fx, pasted)
  const noScan = calledCallPost({ ...fx, scanned: false, words: { ...fx.words, headline: `@${FIXTURE_HANDLE} on BTC: 2 posts added by a viewer. No scan yet, so no tally.` } }, pasted)
  check(
    'called-gtm call (share post, a pasted post): a post a viewer added is shared as a post added by a viewer and says it is not counted in the record\'s tally; on a record nobody scanned the post states no counts at all and says there is no tally',
    pastedPost.text.includes(`post by @${FIXTURE_HANDLE}, ${ADDED_MARK}, `) && pastedPost.text.includes(`Full record (this post is not counted): ${tally}`) && okPost(pastedPost.text) && !/\bcall by\b/.test(pastedPost.text) &&
      noScan.text.includes(CALLED_NO_TALLY) && !/Full record/.test(noScan.text) && !/\d+ calls?\b|\d+ (called it|missed)/.test(noScan.text) && okPost(noScan.text) && myCalledCallPost(mineRec, pasted).text.includes(`post, ${ADDED_MARK}, `),
    `${pastedPost.text} | ${noScan.text}`,
  )

  // ── The source: what the files themselves promise ──
  const page = read('app/x/[handle]/[symbol]/page.tsx')
  const lead = read('components/called/CallLead.tsx')
  const ogRoute = read('app/api/og/called/route.tsx')
  const ogCard = read('app/api/og/called/card.tsx')
  const callCard = read('components/called/CallCard.tsx')
  const shareRow = read('components/called/ShareRow.tsx')
  const oneCall = code(ogCard).slice(code(ogCard).indexOf('function callPlotSvg'), code(ogCard).indexOf('export async function renderCalledCard'))
  check(
    'called-gtm call (source, the page): `call` is read with the contract\'s parser and the record is then read WHOLE (no side: one call is never set beside half a tally); only a call the record holds leads, anything else is the plain page; the plain page\'s highlight is the contract\'s best call or nothing; a call\'s metadata points its canonical at the record, stays out of the index, and takes the call\'s own image and address',
    /const callId = parseCallParam\(q\[CALL_PARAM\]\)/.test(page) && /loadRecordView\(rawHandle, rawSymbol, '', first\(q\.pins\)\)/.test(page) && /whole\.body\.status === 'ready' \? leadCallOf\(whole\.body\.record, callId\) : null/.test(page) && !/callById\(/.test(code(page)) && /if \(call\) return \{ view: whole/.test(page) &&
      /const best = call \? null : bestCallOf\(record\.calls\)/.test(page) && /\{best && <BestCall record=\{record\} call=\{best\}/.test(page) && /alternates: \{ canonical: absoluteUrl\(recordHref\(handle, symbol\)\) \},\s*\n\s*robots: \{ index: false, follow: true \}/.test(page) &&
      /calledImageHref\(handle, symbol, 'all', \[\], call\.postId\)/.test(page) && /url: absoluteUrl\(callHref\(handle, symbol, call\.postId\)\)/.test(page) && /callHeadline\(handle, symbol, call\)/.test(page) && /callDescription\(ready, call, view\.unit\)/.test(page) &&
      /call \? \(mine \? myCalledCallPost\(record, call\) : calledCallPost\(record, call\)\) : mine \? myCalledPost\(record\) : calledPost\(record\)/.test(page) && /kind=\{call \? 'call' : 'record'\}/.test(page) && !/dangerouslySetInnerHTML/.test(code(page)),
  )
  check(
    'called-gtm call (source, the lead): the verdict is spec\'s word (the file spells no verdict of its own); the record\'s own headline and standing line are printed in the lead, above the button; the one button is the contract\'s chart address for this call and the trade buttons are mounted under it; the post is a text node around a <mark> inside <bdi>, never HTML; the link to X is rebuilt from the handle and the id; a pasted post wears spec\'s mark',
    /sentenceCase\(VERDICT_WORDS\[call\.verdict\]\)/.test(lead) && !/called it|missed|no real move|too early to say/i.test(code(lead).replace(/data-journey="[^"]*"/g, '')) && /headlineParts\(record\.words\.headline\)/.test(lead) && /\{record\.words\.standing\}/.test(lead) &&
      lead.indexOf('data-record-headline') < lead.indexOf('chartCallHref(handle, symbol, call.postId)') && lead.indexOf('data-standing') < lead.indexOf('chartCallHref(handle, symbol, call.postId)') &&
      /<CallActs symbol=\{symbol\} stance=\{call\.stance\} handle=\{handle\} postId=\{call\.postId\} variant="stack" \/>/.test(lead) && lead.indexOf('chartCallHref(handle, symbol, call.postId)') < lead.indexOf('<CallActs ') &&
      /<mark className="xcl-quote">\{parts\[1\]\}<\/mark>/.test(lead) && /<bdi>/.test(lead) && !/dangerouslySetInnerHTML/.test(code(lead)) && /const post = call\.url \? postUrl\(handle, call\.postId\) : null/.test(lead) && !/href=\{call\.url/.test(lead) && /\{ADDED_MARK\}/.test(lead) && !/added by a viewer/.test(code(lead)) &&
      /callHref\(record\.handle, record\.symbol, call\.postId\)/.test(lead) && !/SpineLink|lightweight-charts|charting_library/.test(code(lead)),
  )
  check(
    'called-gtm call (source, the image): the route reads `call` with the contract\'s parser and then the WHOLE record; only a call the record holds is drawn as one, anything else falls through to the record\'s own picture; the call card prints the record\'s own headline pieces and standing line, the verdict in spec\'s word, spec\'s mark on a pasted post, and its drawing takes no text from a post; the fallbacks are untouched',
    /const callId = parseCallParam\(q\.get\(CALL_PARAM\)\)/.test(ogRoute) && /loadRecordView\(handleRaw, symRaw, '', ''\)/.test(ogRoute) && /leadCallOf\(whole\.body\.record, callId\)/.test(ogRoute) && !/callById\(/.test(code(ogRoute)) && /kind: 'call'/.test(ogRoute) && /input\.kind !== 'call'/.test(ogRoute) &&
      /return generic\(\)/.test(ogRoute) && /within\(renderCalledCard\(input, address\), RENDER_BUDGET_MS\)/.test(ogRoute) && /input\.kind === 'call' \|\|/.test(ogRoute) &&
      /headlineParts\(record\.words\.headline\)/.test(oneCall) && /\{record\.words\.standing\}/.test(oneCall) && /sentenceCase\(VERDICT_WORDS\[call\.verdict\]\)/.test(oneCall) && /\{ADDED_MARK\}/.test(oneCall) && /callQuote\(call\.text, call\.quote\)/.test(oneCall) && /unreadShare\(scale, record\.coverage\?\.from\)/.test(oneCall) &&
      !/\.text\b|quote/.test(oneCall.slice(0, oneCall.indexOf('function OneCallCard'))) && !/'called it'|'missed'|radial-gradient|linear-gradient|boxShadow/.test(oneCall),
  )
  check(
    'called-gtm call (source, the card and the share row): on a call\'s page the card of that call says it is the one the link is about and nothing else about it changes; the share row still composes nothing and only labels what kind of thing it sends',
    /lead\?: boolean/.test(callCard) && /data-lead=\{lead \? 'yes' : undefined\}/.test(callCard) && /lead=\{c\.postId === call\?\.postId\}/.test(page) && shareRow.startsWith("'use client'") && !/calledCallPost|myCalledCallPost|calledPost|x-auth/.test(code(shareRow)) && /data-share-kind=\{kind\}/.test(shareRow),
  )

  // ── The sheet: its own prefix, flat ──
  const css = read('components/called/called-call.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const classes = [...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c))
  const foreign: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (name === 'node_modules' || name.startsWith('.') || name === 'charting_library') continue
      const rel = `${dir}/${name}`
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)
      else if (name.endsWith('.css') && rel !== 'components/called/called-call.css' && /\.xcl[\w-]*/.test(readFileSync(join(ROOT, rel), 'utf8'))) foreign.push(rel)
    }
  }
  for (const d of ['app', 'components', 'public']) walk(d)
  const own = (c: string) => c === 'xcl' || c.startsWith('xcl-') || c.startsWith('is-')
  check(
    'called-gtm call (stylesheet): every class it styles is its own (xcl; the record sheet\'s prefix is never named in it), no other stylesheet in the repo uses that prefix, and it is FLAT: no shadow, no gradient, no blur, no italic, no literal colour, px font or px radius (the site\'s one token scale)',
    classes.length > 40 && classes.every(own) && foreign.length === 0 && !/box-shadow|text-shadow|drop-shadow|gradient\(|backdrop-filter|blur\(/.test(css) && !/font-style:\s*italic/.test(css) && !/#[0-9a-fA-F]{3,8}\b/.test(css) && !/\b(?:rgba?|hsla?|oklch)\(/.test(css) && !/font-size:\s*\d+px/.test(css) && !/border-radius:\s*(?:[5-9]|\d{2,})px/.test(css) &&
      /@media \(max-width: 640px\)/.test(css) && /@media \(hover: none\)/.test(css) && /min-height: 44px/.test(css) && /min-height: 52px/.test(css),
    `${classes.filter((c) => !own(c)).slice(0, 5).join(' ')} ${foreign.join(' ')}`,
  )
  // ── Round 3 (review F1, F2) ──
  {
    const k = (postId: string, origin: 'scan' | 'added') => ({ postId, origin })
    const calls = [k('101', 'scan'), k('102', 'added'), k('103', 'scan'), k('104', 'scan')]
    check(
      'called-gtm call (F1): only a call the SCAN found on a SCANNED record leads a one-call page or image: a pasted post\'s id, any id on an unscanned record, an unknown id and no id all answer null (the plain record)',
      leadCallOf({ scanned: true, calls }, '103')?.postId === '103' && leadCallOf({ scanned: true, calls }, '102') === null && leadCallOf({ scanned: false, calls: [k('102', 'added')] }, '102') === null && leadCallOf({ scanned: false, calls }, '103') === null &&
        leadCallOf({ scanned: true, calls }, '999') === null && leadCallOf({ scanned: true, calls }, null) === null,
    )
    check(
      'called-gtm call (F2): "This is call N of M" counts the calls the scan found, N and M both (M = the tally\'s total, never a count with a pasted post in it); a pasted call has no place; the lead prints it from callPlaceOf, never from record.calls.length',
      callPlaceOf(calls, '103')?.n === 2 && callPlaceOf(calls, '103')?.of === 3 && callPlaceOf(calls, '104')?.n === 3 && callPlaceOf(calls, '102') === null &&
        /const place = callPlaceOf\(record\.calls, call\.postId\)/.test(lead) && /This is call \{place\.n\} of \{place\.of\}/.test(lead) && !/of \{record\.calls\.length\}/.test(lead),
    )
  }
  void chartCallHref
  void bestCallOf
}

// ── Served ──────────────────────────────────────────────────────────────

const HEAD = { 'x-yf-internal-run': '1' }
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
const decodeEnt = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => ENT[m])
/** The page as a reader gets it: scripts, styles, tags and React's comment seams off, entities decoded. */
function textOf(html: string): string {
  return decodeEnt(
    html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\s+/g, ' ')
}
const metaOf = (html: string, key: string): string | null => {
  const m = new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`).exec(html) ?? new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${key}"`).exec(html)
  return m ? decodeEnt(m[1]) : null
}
const canonicalOf = (html: string): string | null => /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/.exec(html)?.[1] ?? /<link[^>]+href="([^"]*)"[^>]+rel="canonical"/.exec(html)?.[1] ?? null
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()

export async function calledGtmCallPinsServed(check: Check, base: string): Promise<void> {
  const page = async (path: string) => {
    const r = await fetch(`${base}${path}`, { headers: HEAD, redirect: 'manual' })
    return { status: r.status, location: r.headers.get('location'), html: r.status < 300 ? await r.text() : '' }
  }
  const image = async (qs: string) => {
    const r = await fetch(`${base}/api/og/called${qs}`, { headers: HEAD, redirect: 'manual' })
    const buf = Buffer.from(await r.arrayBuffer())
    const png = buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47
    return { status: r.status, type: r.headers.get('content-type'), card: r.headers.get('x-pantessa-card'), cache: r.headers.get('cache-control') ?? '', w: png ? buf.readUInt32BE(16) : 0, h: png ? buf.readUInt32BE(20) : 0, bytes: buf.length }
  }
  const okPng = (i: Awaited<ReturnType<typeof image>>) => i.status === 200 && i.type === 'image/png' && i.w === 1200 && i.h === 630 && i.bytes > 20_000
  const record = async (handle: string, sym: string): Promise<CalledRecord | null> => {
    const api = (await (await fetch(`${base}/api/x/record?handle=${handle}&sym=${sym}`, { headers: HEAD })).json()) as RecordResponse
    return api.status === 'ready' ? api.record : null
  }
  const H = FIXTURE_HANDLE
  try {
    const rec = await record(H, 'BTC')
    const best = rec ? bestCallOf(rec.calls) : null
    const other = rec ? (rec.calls.find((c) => c.verdict === 'wrong') ?? rec.calls.find((c) => c.verdict !== 'right') ?? null) : null
    if (!rec || !best || !other) {
      check('called-gtm call (served): the fixture on BTC is a ready record with a hit and a call that is not one (start the server with XCALLS_FAKE=1)', false, `${rec ? rec.words.headline : 'no record'}`)
      return
    }
    const n = rec.calls.findIndex((c) => c.postId === best.postId) + 1
    // "call N of M" counts the calls the scan found (review F2): M is the tally's total.
    const scannedN = rec.calls.filter((c) => c.origin === 'scan').findIndex((c) => c.postId === best.postId) + 1
    const p = await page(callHref(H, 'BTC', best.postId))
    const t = textOf(p.html)
    const html = p.html.replace(/<!--[\s\S]*?-->/g, '')
    const at = (needle: string) => html.indexOf(needle)
    const chartLink = `href="${chartCallHref(H, 'BTC', best.postId).replace(/&/g, '&amp;')}"`
    check(
      'called-gtm call (served, the fixture\'s hit): the call\'s address answers a page that LEADS with that call: the verdict in spec\'s word as the page\'s one h1, who and the day, the post in full with the labeled span marked, the price that day and the record\'s own move words; then, before the button, the record\'s own headline to the letter and its standing line; then ONE button onto the live chart with this call open; then the whole record as always (every call\'s card, the chart, the toggle, the door, how it is judged)',
      p.status === 200 && html.includes('data-lead="call"') && html.includes(`data-xcl="lead" data-call="${best.postId}" data-verdict="right"`) && (html.match(/<h1[ >]/g) ?? []).length === 1 && /<h1 class="xcl-verdict">.*?<span class="xcl-verdict__word">Called it\.<\/span>/.test(html) &&
        t.includes(flat(best.text)) && html.includes('<mark class="xcl-quote">') && t.includes(moveLine(best)) && t.includes(rec.words.headline) && t.includes(rec.words.standing) && t.includes(`This is call ${scannedN} of ${rec.tally.total}`) &&
        at('data-xcl="lead"') > 0 && at('data-xcl="lead"') < at('data-record-headline') && at('data-record-headline') < at('data-standing') && at('data-standing') < at(chartLink) && at(chartLink) < at('<li class="xrc-call ') &&
        (html.match(/<li class="xrc-call /g) ?? []).length === rec.calls.length && (html.match(/data-lead="yes"/g) ?? []).length === 1 && html.includes(`id="call-${n}" data-call="${best.postId}"`) && html.includes('class="xrc-sides"') && html.includes('id="plot"') && t.includes('How this is judged') &&
        !!rec.words.coverage && t.includes(rec.words.coverage) && !/https:\/\/x\.com\/pantessa_test\/status/.test(html) && !t.includes('Open the post on X'),
      `${p.status} lead ${at('data-xcl="lead"')} headline ${at('data-record-headline')} button ${at(chartLink)} cards ${(html.match(/<li class="xrc-call /g) ?? []).length} h1 ${(html.match(/<h1[ >]/g) ?? []).length}`,
    )
    const og = metaOf(p.html, 'og:image') ?? ''
    const desc = metaOf(p.html, 'description') ?? ''
    check(
      'called-gtm call (served, metadata): the card that unfurls is the CALL\'s: its title is the call\'s own sentence, its text carries the record\'s whole tally and standing line, og:image and twitter:image are the call\'s image (handle, market, call and nothing else), og:url is the call\'s address; the canonical is the record and the call address stays out of the index',
      (metaOf(p.html, 'og:title') ?? '') === callHeadline(H, 'BTC', best) && new RegExp(`<title>@${H} on BTC, [^<]*: called it · Called it on Pantessa</title>`).test(p.html) && metaOf(p.html, 'twitter:card') === 'summary_large_image' &&
        og.endsWith(calledImageHref(H, 'BTC', 'all', [], best.postId)) && og === (metaOf(p.html, 'twitter:image') ?? '') && !og.includes('side=') && !og.includes('pins=') && (metaOf(p.html, 'og:url') ?? '').endsWith(callHref(H, 'BTC', best.postId)) &&
        desc === callDescription(rec, best) && desc.includes(headlineTally(rec.words.headline)) && desc.endsWith(rec.words.standing) && (canonicalOf(p.html) ?? '').endsWith(`/x/${H}/BTC`) && /noindex/.test(metaOf(p.html, 'robots') ?? ''),
      `${og} · ${canonicalOf(p.html)} · ${metaOf(p.html, 'robots')}`,
    )
    const intent = decodeEnt(/href="(https:\/\/twitter\.com\/intent\/tweet\?[^"]*)"/.exec(html)?.[1] ?? '')
    const sent = intent ? new URL(intent).searchParams : null
    const expected = calledCallPost(rec, best)
    check(
      'called-gtm call (served, the share row): a call\'s page shares THAT call: the prefilled post is the call\'s own (verdict, move, the whole tally, "Not verified"), its link is the call\'s address, the saved image is the call\'s image, and the card it unfurls as is shown beside it',
      html.includes('data-share="row" data-share-surface="called" data-share-kind="call"') && !!sent && sent.get('text') === expected.text && (sent.get('url') ?? '').endsWith(callHref(H, 'BTC', best.postId)) && (sent.get('text') ?? '').includes(headlineTally(rec.words.headline)) && (sent.get('text') ?? '').includes('Not verified') &&
        html.includes(`href="${calledImageHref(H, 'BTC', 'all', [], best.postId).replace(/&/g, '&amp;')}" download="called-it-${H}-BTC-${best.postId}.png"`) && html.includes('class="xcl-card"') && t.includes('Share this call') && !t.includes('Share this record'),
      `${sent?.get('text')}`,
    )

    // Any verdict has an address; only the wording changes.
    const q = await page(callHref(H, 'BTC', other.postId))
    const qh = q.html.replace(/<!--[\s\S]*?-->/g, '')
    const word = sentenceCase(VERDICT_WORDS[other.verdict])
    check(
      `called-gtm call (served, a call that is not a hit): its address leads with it the same way, in spec's word for its verdict ("${word}."), and nothing on its lead, its title or its card text says "called it" of it; the whole tally and the standing line are there all the same`,
      q.status === 200 && qh.includes(`data-xcl="lead" data-call="${other.postId}" data-verdict="${other.verdict}"`) && qh.includes(`<span class="xcl-verdict__word">${word}.</span>`) && !/xcl-verdict__word">Called it/.test(qh) && (metaOf(q.html, 'og:title') ?? '') === callHeadline(H, 'BTC', other) &&
        !(metaOf(q.html, 'og:title') ?? '').includes('called it') && textOf(q.html).includes(rec.words.headline) && textOf(q.html).includes(rec.words.standing) && textOf(q.html).includes(moveLine(other)) && (metaOf(q.html, 'og:image') ?? '').endsWith(`call=${other.postId}`),
      `${q.status} ${metaOf(q.html, 'og:title')}`,
    )

    // A side on a call address changes nothing: the record is read whole.
    const oneSide = best.stance === 'bull' ? 'bear' : 'bull'
    const s = await page(`/x/${H}/BTC?side=${oneSide}&call=${best.postId}`)
    const unknown = await page(`/x/${H}/BTC?call=99999999`)
    const junk = await page(`/x/${H}/BTC?call=${encodeURIComponent('<script>alert(1)</script>')}`)
    const plain = await page(`/x/${H}/BTC`)
    const ph = plain.html.replace(/<!--[\s\S]*?-->/g, '')
    const bestLink = `href="${callHref(H, 'BTC', best.postId)}"`
    check(
      'called-gtm call (served, the edges): a side on a call\'s address changes nothing (the call still leads and the tally is the WHOLE record\'s, both sides); an id the record does not hold, and a string that is not an id, answer the plain record page with no error; the plain page shows the record\'s hit as one highlight that links to its call address, and its own card stays the record\'s',
      s.status === 200 && s.html.includes(`data-xcl="lead" data-call="${best.postId}"`) && textOf(s.html).includes(rec.words.headline) && s.html.includes('data-side="all"') &&
        unknown.status === 200 && unknown.html.includes('data-lead="record"') && !unknown.html.includes('data-xcl="lead"') && textOf(unknown.html).includes(rec.words.headline) && !(metaOf(unknown.html, 'og:image') ?? '').includes('call=') &&
        junk.status === 200 && junk.html.includes('data-lead="record"') && !junk.html.includes('data-xcl="lead"') && !/<script>alert\(1\)<\/script>/.test(junk.html) &&
        plain.status === 200 && (ph.match(/data-xcl="best"/g) ?? []).length === 1 && ph.includes(`data-xcl="best" data-call="${best.postId}"`) && ph.includes(bestLink) && ph.indexOf('data-xcl="best"') < ph.indexOf('id="chart"') && !(metaOf(plain.html, 'og:image') ?? '').includes('call=') && ph.includes('data-share-kind="record"'),
      `${s.status} ${unknown.status} ${junk.status} ${plain.status} best ${(ph.match(/data-xcl="best"/g) ?? []).length}`,
    )

    const iCall = await image(`?handle=${H}&sym=BTC&call=${best.postId}`)
    const iOther = await image(`?handle=${H}&sym=BTC&call=${other.postId}`)
    const iSide = await image(`?handle=${H}&sym=BTC&side=${oneSide}&call=${best.postId}`)
    const iUnknown = await image(`?handle=${H}&sym=BTC&call=99999999`)
    const iJunk = await image(`?handle=${H}&sym=BTC&call=${encodeURIComponent('<img src=x>')}`)
    const iNobody = await image(`?handle=zz_pin_none&sym=BTC&call=${best.postId}`)
    const iNoChart = await image(`?handle=${H}&sym=NOCHART99&call=${best.postId}`)
    check(
      'called-gtm call (served, the image): a 1200 by 630 PNG every time, never a 500. A call the record holds draws the call card (any verdict, and whatever side rides along); an id it does not hold, or garbage, draws the record\'s own card; a handle nobody plotted draws "not plotted yet"; a market with no chart draws the refusal; a drawn call is held five minutes at the edge like a drawn record',
      okPng(iCall) && iCall.card === 'call' && okPng(iOther) && iOther.card === 'call' && okPng(iSide) && iSide.card === 'call' && okPng(iUnknown) && iUnknown.card === 'record' && okPng(iJunk) && iJunk.card === 'record' && okPng(iNobody) && iNobody.card === 'unscanned' && okPng(iNoChart) && iNoChart.card === 'refused' && /s-maxage=300/.test(iCall.cache),
      [iCall, iOther, iSide, iUnknown, iJunk, iNobody, iNoChart].map((i) => `${i.status}:${i.card}:${i.w}x${i.h}`).join(' '),
    )

    // A real record on the TEST DB (public posts already scanned; nothing is read from X here).
    const real = await record('cz_binance', 'BTC')
    const realBest = real ? bestCallOf(real.calls) : null
    if (!real || !realBest) {
      console.log('   (called-gtm call: this database holds no cz_binance/BTC record with a hit, so the real-record check was not run)')
    } else {
      const rp = await page(callHref('cz_binance', 'BTC', realBest.postId))
      const rt = textOf(rp.html)
      const ri = await image(`?handle=cz_binance&sym=BTC&call=${realBest.postId}`)
      check(
        'called-gtm call (served, a real record): the call a real account is shown by leads its page with the post\'s own words, the record\'s whole tally and "Not verified", links out to that one post on X (rebuilt from the handle and the id), and unfurls as its call card',
        rp.status === 200 && rp.html.includes(`data-xcl="lead" data-call="${realBest.postId}" data-verdict="right"`) && rt.includes(flat(realBest.text)) && rt.includes(real.words.headline) && rt.includes(real.words.standing) && rt.includes(moveLine(realBest)) &&
          rp.html.includes(`href="https://x.com/cz_binance/status/${realBest.postId}"`) && rt.includes('Open the post on X') && (real.verified !== null || rt.includes(STANDING_NOT_VERIFIED)) && okPng(ri) && ri.card === 'call',
        `${rp.status} ${ri.status}:${ri.card} ${real.words.headline}`,
      )
    }
  } catch (err) {
    check('called-gtm call (served): the server answered', false, err instanceof Error ? err.message : String(err))
  }
}

if (process.argv[1]?.endsWith('called-gtm-call-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledGtmCallPins(check)
    if (process.env.BASE) await calledGtmCallPinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-gtm call pins failed` : `\nall ${n} called-gtm call pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
