// Pins for squad called-gtm, the CONTRACT (2026-11-16): lib/called-it/gtm's
// pure rules, the board's pure half, and the public board route. Wired into
// test-api.
//   npx tsx scripts/called-gtm-coord-pins.ts            (npm run pins:called-gtm-coord)
//   BASE=http://localhost:PORT npx tsx scripts/called-gtm-coord-pins.ts
import { readFileSync } from 'node:fs'
import { CALL_PARAM, MIN_JUDGED, actSideFor, bestCallOf, callById, callHref, chartCallHref, hitRateOf, hitRateWords, parseCallParam, rankEntries } from '../lib/called-it/gtm'
import { boardSpark } from '../lib/called-it/board'
import { arrivalAllowed, arrivalSourceAllowed } from '../lib/arrival-fence'

type Check = (name: string, ok: boolean, extra?: string) => void
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

type C = Parameters<typeof bestCallOf>[0][number]
const call = (postId: string, verdict: C['verdict'], impact: number, postedAt: number, origin: C['origin'] = 'scan', hit = false): C => ({
  postId,
  verdict,
  impact,
  postedAt,
  origin,
  target: hit ? { span: '$5', unit: 'price', stated: '$5', price: 5, stop: 3, outcome: 'hit', at: postedAt } : null,
})

export function calledGtmCoordPins(check: Check): void {
  check(
    'called-gtm (contract): one call has one address on the record page and one on the chart; the key is `call`, the value a post id and nothing else',
    CALL_PARAM === 'call' &&
      callHref('dcinvestor', 'ETH', '1987654321012345678') === '/x/dcinvestor/ETH?call=1987654321012345678' &&
      callHref('dcinvestor', 'ETH', '1987654321012345678', 'bear') === '/x/dcinvestor/ETH?side=bear&call=1987654321012345678' &&
      chartCallHref('dcinvestor', 'ETH', '1987654321012345678') === '/t/ETH?x=dcinvestor&call=1987654321012345678' &&
      parseCallParam('1987654321012345678') === '1987654321012345678' &&
      parseCallParam(['12345', 'x']) === '12345' &&
      parseCallParam('12a45') === null &&
      parseCallParam('<script>') === null &&
      parseCallParam(undefined) === null,
  )
  const calls = [call('1', 'wrong', 99, 5), call('2', 'right', 10, 6), call('3', 'right', 40, 7), call('4', 'right', 90, 8, 'added'), call('5', 'right', 5, 9, 'scan', true), call('6', 'open', 80, 10)]
  check(
    'called-gtm (contract): the call an account is shown by is a HIT the scan found (a level that was hit first, then impact, then the newest); a pasted post, a miss or an open call never; no hit, no best call',
    bestCallOf(calls)?.postId === '5' && bestCallOf(calls.filter((c) => c.postId !== '5'))?.postId === '3' && bestCallOf(calls.filter((c) => c.verdict !== 'right' || c.origin === 'added')) === null && bestCallOf([]) === null && callById(calls, '6')?.postId === '6' && callById(calls, '77') === null && callById(calls, null) === null,
  )
  check(
    `called-gtm (contract): a hit rate is printed only over ${MIN_JUDGED} judged calls, and always with its denominator in the words`,
    MIN_JUDGED === 3 && hitRateOf({ right: 1, wrong: 1 }) === null && hitRateWords({ right: 1, wrong: 1 }) === null && hitRateOf({ right: 2, wrong: 2 }) === 0.5 && hitRateWords({ right: 5, wrong: 3 }) === '5 of 8 judged calls',
  )
  const e = (id: string, right: number, wrong: number, followers: number | null, scannedAt: number) => ({ id, tally: { total: right + wrong, right, wrong, flat: 0, open: 0 }, followers, scannedAt })
  const ranked = rankEntries([e('a', 0, 0, 900_000, 9), e('b', 2, 6, 10, 1), e('c', 2, 1, 5, 2), e('d', 5, 5, 1, 3), e('f', 2, 1, 50, 1)]).map((x) => x.id)
  check('called-gtm (contract): a board ranks by judged hits, then the hit rate, then followers, then the newest scan; an account with no judged call is last', ranked.join('') === 'dfcba', ranked.join(''))
  check('called-gtm (contract): a bull call offers the buy, a bear call the sell', actSideFor('bull') === 'buy' && actSideFor('bear') === 'sell')
  const closes = Array.from({ length: 40 }, (_, i) => ({ t: 1000 + i * 86400, c: 100 + i }))
  const spark = boardSpark(closes, [{ postId: '9', barTime: 1000 + 10 * 86400, priceAt: 110, verdict: 'right' }, { postId: '8', barTime: 5, priceAt: 100, verdict: 'wrong' }], 1000)
  check(
    'called-gtm (board, pure): the small line and its dots share one 100 by 100 box with air above and below; a call before the line starts has no dot; under two closes there is no line',
    spark.line.startsWith('M0 92') && spark.dots.length === 1 && spark.dots[0].postId === '9' && spark.dots[0].y > 8 && spark.dots[0].y < 92 && boardSpark(closes.slice(0, 1), [], 0).line === '',
    `${spark.line.slice(0, 12)} ${spark.dots.length}`,
  )
  const now = Date.now()
  const rec = (from: string, text: string) => arrivalAllowed({ v: 1, at: now, from, text }, now)
  check(
    'called-gtm (arrival fence): a Called it page may hand its trade chip to the app (/x/<handle>/<SYM>, /x/<handle>); /xx, /x?…, //x do not pass as sources; and the text rules still refuse a transfer, an address or a link arriving from /x',
    arrivalSourceAllowed('/x/dcinvestor/ETH') && arrivalSourceAllowed('/x/dcinvestor') && !arrivalSourceAllowed('/xx') && !arrivalSourceAllowed('/x?a=1') && !arrivalSourceAllowed('//x') && !arrivalSourceAllowed('/xyz/a') &&
      rec('/x/dcinvestor/ETH', 'Buy $25 of ETH').ok === true && rec('/x/dcinvestor/ETH', 'Send 1 ETH to 0x1234567890abcdef').ok === false && rec('/x/dcinvestor/ETH', 'Buy $25 of ETH at https://evil.example').ok === false,
  )
  const board = read('lib/called-it/board.ts')
  check(
    'called-gtm (board): the board reads the PUBLIC list only (readPlotted: never an internal run or a hidden handle), holds each entry in a cache, and never passes the background deleted-post check',
    /readPlotted\(/.test(board) && !/listPlotted\(/.test(board) && /unstable_cache/.test(board) && /refreshGone: undefined/.test(board),
  )
  const tab = read('components/markets/community/CommunityTab.tsx')
  check('called-gtm (contract): the Community tab mounts the scanned accounts above the rooms strip', tab.indexOf('<CalledBoard symbol={sym} />') > 0 && tab.indexOf('<CalledBoard symbol={sym} />') < tab.indexOf('<RoomsStrip symbol={sym} />'))
}

export async function calledGtmCoordPinsServed(check: Check, base: string): Promise<void> {
  try {
    const ok = await fetch(`${base}/api/x/board?sym=BTC`)
    const body = (await ok.json()) as { entries?: unknown[]; failed?: boolean }
    const bad = await fetch(`${base}/api/x/board?handle=not%20a%20handle`)
    const badSym = await fetch(`${base}/api/x/board?sym=${encodeURIComponent('<x>')}`)
    const entries = Array.isArray(body.entries) ? (body.entries as { handle: string; symbol: string; headline: string; tally: { total: number }; best: { verdict: string } | null }[]) : null
    check(
      'called-gtm (served): the public board answers a list for a market (every entry on that market, with its headline and a tally; a best call is always a hit), and refuses a string that is not a handle or not a market by name',
      ok.status === 200 && !!entries && entries.every((e) => e.symbol === 'BTC' && e.headline.length > 0 && e.tally.total > 0 && (e.best === null || e.best.verdict === 'right')) && bad.status === 400 && badSym.status >= 400,
      `${ok.status} ${entries?.length ?? '-'} · ${bad.status} · ${badSym.status}`,
    )
  } catch (err) {
    check('called-gtm (served): the server answered', false, err instanceof Error ? err.message : String(err))
  }
}

if (process.argv[1]?.endsWith('called-gtm-coord-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledGtmCoordPins(check)
    if (process.env.BASE) await calledGtmCoordPinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-gtm contract pins failed` : `\nall ${n} called-gtm contract pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
