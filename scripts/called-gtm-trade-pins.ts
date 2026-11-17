// Pins for squad called-gtm, lane TRADE (2026-11-16). The lane owns this file:
// pure checks in calledGtmTradePins, checks against a running server in
// calledGtmTradePinsServed. Already wired into test-api and package.json by
// the contract commit, so no lane edits the harness.
//   npx tsx scripts/called-gtm-trade-pins.ts            (npm run pins:called-gtm-trade)
//   BASE=http://localhost:PORT npx tsx scripts/called-gtm-trade-pins.ts
//
// What is pinned:
//   · the trade a call offers (lib/called-it/acts): a bull call the buy, a bear
//     call the sell (held only) and the short (perp listed), on a coin, a
//     stock, a perp-only coin and a perp chart; nothing where a gate refuses or
//     the market is look-only; every sentence the app's own composer's;
//   · the chart opening on a named call (lib/called-it/use-record): once, only
//     a call the record holds, the `call` key leaving the address with
//     replaceState when the card closes or another opens — driven through the
//     real store with a stubbed fetch;
//   · the wiring by source: CallActs goes through connect to act and the
//     arrival handoff with the symbol's apps, the card mounts it and the share
//     link, no `scrollIntoView` came back, no advice words.

import { readFileSync } from 'node:fs'
import { CALL_ACT_CAPTION, CALL_ACT_USD, callActCaption, callActSides, callActsFor } from '../lib/called-it/acts'
import { CALL_PARAM, callHref, chartCallHref } from '../lib/called-it/gtm'
import { callFromSearch, callParamStale, deepLinkFocus, useCalled, withoutCallParam } from '../lib/called-it/use-record'
import { chartPairFor } from '../lib/charts'
import { HL_SIGNING_CHAIN_ID } from '../lib/symbol-venues'
import { execSidesFor } from '../lib/trade-asks'
import type { TradabilityMap } from '../lib/tradability'
import type { HeldSymbol } from '../lib/watchlists'

type Check = (name: string, ok: boolean, extra?: string) => void

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const held = (symbol: string, chainIds: number[] = [8453]): HeldSymbol => ({ symbol, valueUsd: 100, amount: 1, chains: chainIds.map(String), chainIds } as HeldSymbol)
const now = Date.parse('2026-11-16T12:00:00Z')
const fresh = new Date(now - 60_000).toISOString()
const asks = (sym: string, stance: 'bull' | 'bear', gates: { tradable?: TradabilityMap | null; held?: readonly HeldSymbol[] | null } = {}) =>
  callActsFor(chartPairFor(sym), stance, { tradable: gates.tradable ?? {}, held: gates.held ?? null, now }).map((a) => a.ask)
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function calledGtmTradePins(check: Check): void {
  // ── The trade a call offers ──
  check('called-gtm trade: a bull call on a coin offers the spot buy, sized at $25, the composer\'s own sentence', same(asks('BTC', 'bull'), ['Buy $25 of BTC']) && CALL_ACT_USD === 25, JSON.stringify(asks('BTC', 'bull')))
  check('called-gtm trade: a bear call on a coin with no known holdings offers the short only (a sell needs the token held)', same(asks('BTC', 'bear'), ['Short $25 of BTC on Hyperliquid']), JSON.stringify(asks('BTC', 'bear')))
  check('called-gtm trade: a bear call on a coin the wallet holds offers the sell, then the short', same(asks('ETH', 'bear', { held: [held('ETH')] }), ['Sell $25 of ETH', 'Short $25 of ETH on Hyperliquid']), JSON.stringify(asks('ETH', 'bear', { held: [held('ETH')] })))
  check('called-gtm trade: a holding of another token does not open the sell', same(asks('ETH', 'bear', { held: [held('UNI')] }), ['Short $25 of ETH on Hyperliquid']))
  check('called-gtm trade: a stock: bull = the buy; bear = the sell when held, nothing when not (no perp offered on a stock)', same(asks('AAPL', 'bull'), ['Buy $25 of AAPL']) && same(asks('AAPL', 'bear'), []) && same(asks('AAPL', 'bear', { held: [held('AAPL', [4663])] }), ['Sell $25 of AAPL']), JSON.stringify([asks('AAPL', 'bull'), asks('AAPL', 'bear')]))
  check('called-gtm trade: a coin that trades here only as a perp (NEAR): bull = the long, bear = the short, both on Hyperliquid', same(asks('NEAR', 'bull'), ['Long $25 of NEAR on Hyperliquid']) && same(asks('NEAR', 'bear', { held: [held('NEAR')] }), ['Short $25 of NEAR on Hyperliquid']), JSON.stringify([asks('NEAR', 'bull'), asks('NEAR', 'bear')]))
  check('called-gtm trade: a perp chart (HYPE) offers the long / the short, never a protect', same(asks('HYPE', 'bull'), ['Long $25 of HYPE on Hyperliquid']) && same(asks('HYPE', 'bear'), ['Short $25 of HYPE on Hyperliquid']))
  check('called-gtm trade: a look-only index (US10Y) and an unknown market offer nothing', asks('US10Y', 'bull').length === 0 && asks('US10Y', 'bear').length === 0 && callActsFor(null, 'bull', { tradable: {}, held: null }).length === 0 && callActSides(chartPairFor('US10Y'), 'bull').length === 0)
  const btcShut: TradabilityMap = { BTC: { symbol: 'BTC', legs: [1, 8453, 42161].map((chainId) => ({ chainId, side: 'buy' as const, verdict: 'no-venue' as const, reason: 'No pool', checkedAt: fresh })) } }
  check('called-gtm trade: a buy every venue was measured refusing is not offered (canTradeAsk): no dead button', asks('BTC', 'bull', { tradable: btcShut }).length === 0, JSON.stringify(asks('BTC', 'bull', { tradable: btcShut })))
  const nearDelisted: TradabilityMap = { NEAR: { symbol: 'NEAR', legs: [{ chainId: HL_SIGNING_CHAIN_ID, side: 'perp', verdict: 'no-venue', reason: 'Not listed', checkedAt: fresh }] } }
  const nearGone = asks('NEAR', 'bear', { tradable: nearDelisted, held: [held('NEAR')] })
  check('called-gtm trade: a perp the venue was measured not listing is not offered (the short goes; nothing else stands in)', nearGone.length === 0 && asks('NEAR', 'bull', { tradable: nearDelisted }).length === 0, JSON.stringify(nearGone))
  const stale = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
  check('called-gtm trade: a stale refusal does not close a market (fails open, like every chip)', same(asks('BTC', 'bull', { tradable: { BTC: { symbol: 'BTC', legs: [{ chainId: 8453, side: 'buy', verdict: 'no-venue', checkedAt: stale }] } } }), ['Buy $25 of BTC']))
  check('called-gtm trade: the sides are a subset of what the symbol page\'s strip offers (no new grammar)', ['BTC', 'ETH', 'AAPL', 'NEAR', 'HYPE', 'UNI', 'PEPE'].every((s) => {
    const pair = chartPairFor(s)!
    const strip = execSidesFor(pair)
    return (['bull', 'bear'] as const).every((st) => callActSides(pair, st).every((side) => strip.includes(side)))
  }))
  check('called-gtm trade: every chip wears the buy or the sell tone by its side', callActsFor(chartPairFor('ETH'), 'bear', { tradable: {}, held: [held('ETH')], now }).every((a) => a.tone === 'sell') && callActsFor(chartPairFor('NEAR'), 'bull', { tradable: {}, held: null, now }).every((a) => a.tone === 'buy'))
  check('called-gtm trade: the caption is the exact words, and no offered sentence reads as advice', CALL_ACT_CAPTION === 'Your wallet signs. Pantessa never holds your funds.' && ['BTC', 'ETH', 'AAPL', 'NEAR'].flatMap((s) => [...asks(s, 'bull'), ...asks(s, 'bear', { held: [held(s)] })]).every((a) => !/\b(follow|copy|should|recommend)\b/i.test(a)))

  // ── The named call in the address ──
  check('called-gtm trade: `?call=` is read as a post id only (a malformed one is nothing)', callFromSearch('?x=cz_binance&call=1877000000000000001') === '1877000000000000001' && callFromSearch('?x=a&call=abc') === null && callFromSearch('?x=a&call=12') === null && callFromSearch('?x=a') === null)
  check('called-gtm trade: chartCallHref round-trips into the chart\'s reading of the address', callFromSearch(chartCallHref('cz_binance', 'BTC', '1877000000000000001').split('?')[1]) === '1877000000000000001' && CALL_PARAM === 'call')
  check('called-gtm trade: the `call` key leaves the address and nothing else does (order kept)', withoutCallParam('/t/BTC', '?x=cz_binance&side=bear&call=1877000000000000001&tf=1d') === '/t/BTC?x=cz_binance&side=bear&tf=1d' && withoutCallParam('/t/BTC', '?call=1877000000000000001') === '/t/BTC' && withoutCallParam('/t/BTC', '?x=a&pins=111111,222222&call=333333') === '/t/BTC?x=a&pins=111111,222222' && withoutCallParam('/t/BTC', '?x=a') === '/t/BTC?x=a')
  const rec = { calls: [{ postId: '111111' }, { postId: '222222' }] }
  check('called-gtm trade: a named call the record holds opens; one it does not hold opens nothing (and keeps what was open)', deepLinkFocus('222222', rec as never, null) === '222222' && deepLinkFocus('999999', rec as never, null) === null && deepLinkFocus('999999', rec as never, '111111') === '111111' && deepLinkFocus('222222', null, null) === null)
  check('called-gtm trade: the key is stale only once the named call was tried and the card on screen is not it', !callParamStale({ pendingCall: '1', linkedCall: '1', focusId: null }) && !callParamStale({ pendingCall: null, linkedCall: '1', focusId: '1' }) && callParamStale({ pendingCall: null, linkedCall: '1', focusId: null }) && callParamStale({ pendingCall: null, linkedCall: '1', focusId: '2' }) && !callParamStale({ pendingCall: null, linkedCall: null, focusId: null }))

  // ── Wiring, by source ──
  const acts = read('components/called/CallActs.tsx')
  const card = read('components/called/CallFocus.tsx')
  const panel = read('components/called/CallsPanel.tsx')
  const hook = read('lib/called-it/use-record.ts')
  const css = read('components/called/call-acts.css')
  check('called-gtm trade: CallActs sends through connect to act, then the arrival handoff to /chat with the symbol\'s apps (the #1073 door), prefill as the fallback; never raw RainbowKit', /useConnectToAct\(\{ run, redirectFor: promptHref \}\)/.test(acts) && /writeArrivalIntent\(\{ text: ask, from: pathname \?\? '', mcps: symbolAskApps\(ask, pair\) \}\)/.test(acts) && /router\.push\(handed \? ARRIVAL_APP_HREF : promptHref\(ask\)\)/.test(acts) && /act\(a\.ask\)/.test(acts) && !/openConnectModal|useConnectModal|rainbowkit/i.test(acts))
  check('called-gtm trade: CallActs labels each chip with its sentence, a `called_act_<side>` journey, the caption, and draws nothing before hydration or where nothing runs', /\{a\.ask\}\s*<\/a>/.test(acts) && /data-journey=\{`called_act_\$\{a\.side\}`\}/.test(acts) && /\{callActCaption\(handle\)\}/.test(acts) && /hydrated \? callActsFor\(/.test(acts) && /if \(!acts\.length\) return door \? <>\{door\}<\/> : null/.test(acts) && !/\b(follow this|copy this|copy trade)\b/i.test(acts))
  check('called-gtm trade: the call card mounts CallActs (row, a stack on the phone sheet) between the numbers and the foot, keeps "Open the post on X" as the main button, and links "Share this call" to callHref', /<CallActs symbol=\{record\.symbol\} stance=\{call\.stance\} handle=\{record\.handle\} postId=\{call\.postId\} variant=\{sheet \? 'stack' : 'row'\}/.test(card) && card.indexOf('<CallActs') > card.indexOf('</dl>') && card.indexOf('<CallActs') < card.indexOf('<footer className="xcf__foot">') && /className="xcf__x" href=\{call\.url\}/.test(card) && /href=\{callHref\(record\.handle, record\.symbol, call\.postId\)\}/.test(card) && />\s*Share this call\s*</.test(card))
  check(
    'called-gtm trade (F7): under a named account\'s call the caption gains a second sentence, "@<handle> has no part in this button. Not investment advice.", after the first sentence\'s exact words; with no handle it is the first sentence alone; both mounts pass the handle',
    callActCaption('dcinvestor') === 'Your wallet signs. Pantessa never holds your funds. @dcinvestor has no part in this button. Not investment advice.' && callActCaption() === CALL_ACT_CAPTION && callActCaption(null) === CALL_ACT_CAPTION &&
      callActCaption('cz_binance').startsWith(`${CALL_ACT_CAPTION} `) && /handle=\{record\.handle\}/.test(card) && /<CallActs [^>]*handle=\{handle\}/.test(read('components/called/CallLead.tsx')),
  )
  check(
    'called-gtm trade (F1): "Share this call" is absent on a pasted call\'s card (the card still opens it, marked); a call the scan found keeps the link',
    /\{call\.origin !== 'added' && \(\s*<Link className="xca-share" href=\{callHref\(record\.handle, record\.symbol, call\.postId\)\}/.test(card),
  )
  check('called-gtm trade: no `scrollIntoView` came back (the strip, the card, the store); the card never navigates for a named call', !/scrollIntoView/.test(panel) && !/scrollIntoView/.test(card) && !/scrollIntoView/.test(hook) && !/router\.(push|replace)/.test(hook))
  check('called-gtm trade: the `call` key is removed with history.replaceState, read once after mount, and a named call forces the fit (daily bars, every call in view)', /window\.history\.replaceState\(window\.history\.state, '', next\)/.test(hook) && /withoutCallParam\(pathname, search\)/.test(hook) && /const call = callFromSearch\(window\.location\.search\)/.test(hook) && /fit: !!call \|\|/.test(hook) && /pendingCall: body\.status === 'scanning' \? s\.pendingCall : null/.test(hook))
  check('called-gtm trade: call-acts.css is flat (no shadow, gradient, blur) under its own prefix, with 44px targets on a phone', !/box-shadow|gradient|backdrop-filter|text-shadow/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')) && css.replace(/\/\*[\s\S]*?\*\//g, '').match(/^\s*\.[\w-]+/gm)!.every((sel) => /^\s*\.xca/.test(sel)) && /min-height: 44px/.test(css))
}

/** Drive the real store: a named call opens once, a closed card stays closed, the key leaves the address. */
async function driveStore(check: Check): Promise<void> {
  const record = (symbol: string) => ({ status: 'ready', record: { handle: 'zz_trade_pin', symbol, side: 'all', calls: [{ postId: '111111', picked: false }, { postId: '222222', picked: false }], words: { headline: 'h', standing: 's' }, tally: {}, bySide: {}, profile: {}, scanned: true } })
  let answer: unknown = null
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  const settle = () => new Promise((r) => setTimeout(r, 30))
  try {
    const s = () => useCalled.getState()
    answer = record('ZZA')
    s().open('ZZA', { handle: 'zz_trade_pin', side: 'all', pins: [] }, { fit: true, call: '222222' })
    await settle()
    const opened = s().focusId === '222222' && s().focusBy === 'card' && s().pendingCall === null && s().linkedCall === '222222'
    s().focus(null, 'card')
    const stale = callParamStale(s())
    s().unlinkCall()
    s().retry()
    await settle()
    check('called-gtm trade (store): `?call=` opens that call once the record answers; closing it marks the key stale; the next answer does not reopen it', opened && stale && s().focusId === null && s().linkedCall === null, JSON.stringify({ opened, stale, focus: s().focusId }))
    // A phone sheet's own history entry pops back onto the address that still names the call (popstate → open again).
    s().open('ZZA', { handle: 'zz_trade_pin', side: 'all', pins: [] }, { fit: true, call: '222222' })
    await settle()
    check('called-gtm trade (store): back / forward onto an entry that still names the call does not reopen it (once per page), and the key leaves again', s().focusId === null && callParamStale(s()), JSON.stringify({ focus: s().focusId, pending: s().pendingCall, linked: s().linkedCall }))
    s().unlinkCall()
    answer = record('ZZB')
    s().open('ZZB', { handle: 'zz_trade_pin', side: 'all', pins: [] }, { fit: true, call: '999999' })
    await settle()
    check('called-gtm trade (store): an id the record does not hold opens nothing, says nothing, and its key goes', s().focusId === null && s().note === null && s().phase === 'settled' && callParamStale(s()))
    s().unlinkCall()
    answer = { status: 'scanning', handle: 'zz_trade_pin', symbol: 'ZZC', scanId: 'x', progress: '' }
    s().open('ZZC', { handle: 'zz_trade_pin', side: 'all', pins: [] }, { fit: true, call: '111111' })
    await settle()
    const waiting = s().pendingCall === '111111' && !callParamStale(s())
    s().clear()
    check('called-gtm trade (store): while somebody else\'s scan runs, the named call waits for the record (the key stays)', waiting)
    answer = record('ZZD')
    s().open('ZZD', { handle: 'zz_trade_pin', side: 'all', pins: [] }, { fit: true, call: '111111' })
    await settle()
    s().focus('222222', 'card')
    check('called-gtm trade (store): opening another call makes the key stale (it leaves the address)', callParamStale(s()))
    s().clear()
  } finally {
    globalThis.fetch = realFetch
  }
}

export async function calledGtmTradePinsServed(check: Check, base: string): Promise<void> {
  try {
    await driveStore(check)
    // A real record on the TEST DB: the chart page with a named call serves 200 and keeps the plot in its own address.
    const r = await fetch(`${base}/api/x/record?handle=cz_binance&sym=BTC`)
    const body = (await r.json().catch(() => null)) as { status?: string; record?: { calls?: { postId: string; stance: string }[] } } | null
    const call = body?.status === 'ready' ? body.record?.calls?.[0] : undefined
    if (!call) {
      check('called-gtm trade (served): the TEST record cz_binance/BTC answers with calls', false, `status ${r.status} ${body?.status ?? ''}`)
      return
    }
    const page = await fetch(`${base}${chartCallHref('cz_binance', 'BTC', call.postId)}`, { redirect: 'manual' })
    check('called-gtm trade (served): /t/BTC?x=cz_binance&call=<id> serves 200 (the card opens in the browser, after the record)', page.status === 200, `status ${page.status}`)
    const share = await fetch(`${base}${callHref('cz_binance', 'BTC', call.postId)}`, { redirect: 'manual' })
    check('called-gtm trade (served): the card\'s "Share this call" target (/x/<h>/<SYM>?call=<id>) answers', share.status === 200, `status ${share.status}`)
  } catch (e) {
    check('called-gtm trade (served): reachable', false, e instanceof Error ? e.message : String(e))
  }
}

if (process.argv[1]?.endsWith('called-gtm-trade-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledGtmTradePins(check)
    if (process.env.BASE) await calledGtmTradePinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-gtm trade pins failed` : `\nall ${n} called-gtm trade pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
