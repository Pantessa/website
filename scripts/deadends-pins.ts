/**
 * DEADENDS pins (squad pre-gtm, 2026-10-06) — pure, no server, no DB:
 *   npm run pins:deadends
 * Pins the refusal/rescue rules the lane shipped: a build failure never
 * prints plumbing and always carries a retry chip that the ladder builds;
 * the house-down chips build; a stranger's first asks reach the intent net
 * with ticker-spelled chips; a household name resolves to its ticker.
 */
import { buildFailedTurn, HOUSE_DOWN_CHIPS, leaksBuildPlumbing, swapAskSentence } from '../lib/build-failure'
import { moneyShaped } from '../lib/ask-failure-shape'
import { chartSymbolByName, isMoneyAssetWord } from '../lib/charts'
import { simulateLadder } from './ask-ladder'
import { SEND_HOLD_MS, sendHoldFor } from '../lib/wallet-reconnect'
import { isTransferShaped } from '../lib/intent-links'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}
const builds = (ask: string) => simulateLadder(ask).kind !== 'planner'

// ── build failures ──────────────────────────────────────────────────────
const prisma = new Error("\nInvalid `prisma.spendGrant.findFirst()` invocation:\n\n\nCan't reach database server at `host:5432`")
const t1 = buildFailedTurn('Uniswap swap', prisma, 'buy $10 of ETH', '🔄 ')
check('build failure: prisma text never reaches the reply', !/prisma|host:5432|database/i.test(t1.reply), t1.reply)
check('build failure: says nothing was built or signed', /Nothing was built and nothing was signed/.test(t1.reply))
check('build failure: carries a Try again chip = the ask', t1.clarify?.options[0]?.resume === 'buy $10 of ETH' && t1.clarify?.options[0]?.label === 'Try again')
check('build failure: the retry chip builds through the ladder', builds(t1.clarify!.options[0].resume))
const venue = buildFailedTurn('swap', new Error('No pool deep enough for 5000 UNI on Base'), 'Swap 5000 UNI for USDC on base', '🔄 ')
check("build failure: a venue's own words stay", /No pool deep enough/.test(venue.reply))
check('build failure: no ask text → no empty chip', buildFailedTurn('lend', prisma, '').clarify === undefined)
for (const m of ['Timed out fetching a new connection from the connection pool (P2024)', 'RPC Request failed.', 'HTTP request failed.', 'fetch failed', "TypeError: Cannot read properties of undefined (reading 'x')", ''])
  check(`plumbing fenced: ${JSON.stringify(m.slice(0, 40))}`, leaksBuildPlumbing(m))
for (const m of ['the wallet holds 0.01 ETH and the swap sells 0.05', 'USDG is 6-dec; the amount is below the venue minimum'])
  check(`human words kept: ${JSON.stringify(m.slice(0, 40))}`, !leaksBuildPlumbing(m))
check('swap retry: dollar buy', swapAskSentence({ sellAmountUsd: '25', buyToken: 'aapl' }, 'robinhood chain') === 'Buy $25 of AAPL on robinhood chain')
check('swap retry: token swap', swapAskSentence({ sellAmountHuman: '10', sellToken: 'usdc', buyToken: 'eth' }, 'base') === 'Swap 10 USDC for ETH on base')
check('swap retry: sell all', swapAskSentence({ sellAll: true, sellToken: 'eth' }, 'base') === 'Sell all my ETH on base')
check('swap retry: unrestatable → null', swapAskSentence({}) === null)
for (const s of [swapAskSentence({ sellAmountUsd: '25', buyToken: 'AAPL' }, 'robinhood chain')!, swapAskSentence({ sellAmountHuman: '10', sellToken: 'USDC', buyToken: 'ETH' }, 'base')!])
  check(`swap retry builds: ${s}`, builds(s))
for (const c of HOUSE_DOWN_CHIPS) check(`house-down chip builds: ${c.resume}`, builds(c.resume))

// ── the first asks a stranger types ─────────────────────────────────────
const net: [string, RegExp][] = [
  ['buy apple', /Buy \$10 of AAPL/],
  ['buy tesla', /Buy \$10 of TSLA/],
  ['buy bitcoin', /Buy \$10 of BTC/],
  ['I want to buy some apple', /Buy \$10 of AAPL/],
  ['short btc', /short BTC on hyperliquid/],
  ['earn yield', /Supply \$25 of USDC to Aave/],
  ['buy', /Buy \$10 of ETH/],
  ['bu $10 of eth', /Buy \$10 of ETH/],
]
for (const [ask, re] of net) {
  const o = simulateLadder(ask)
  check(`net: "${ask}" → chips`, o.kind === 'clarify' && o.gate === 'intent-net' && !!o.chips && re.test(o.note ?? ''), `${o.kind}/${o.gate} ${o.note ?? ''}`)
}
// RE-PINNED 2026-10-13 (polish): "why is eth moving" left this list — it is
// the market-read door now (pinned below), never planner prose.
for (const q of ['what should I buy', 'what is a stop loss', 'is aapl a buy', 'buy now', 'run it back', 'tell me a joke', 'what is the apy on aave?'])
  check(`still prose: "${q}"`, simulateLadder(q).kind === 'planner', JSON.stringify(simulateLadder(q)))
check('moneyShaped: asset name is evidence', moneyShaped('buy apple') && moneyShaped('short btc') && moneyShaped('buy bitcoin'))
check('moneyShaped: English-word tickers are prose', !moneyShaped('buy now') && !moneyShaped('run it') && !moneyShaped('snap out of it'))
check('moneyShaped: yield shape, not a yield question', moneyShaped('earn yield') && !moneyShaped('what is the apy on aave?'))
check('asset words', isMoneyAssetWord('btc') && isMoneyAssetWord('apple') && isMoneyAssetWord('AAPL') && !isMoneyAssetWord('now') && !isMoneyAssetWord('on') && !isMoneyAssetWord('path'))
check('name → ticker', chartSymbolByName('apple') === 'AAPL' && chartSymbolByName('bitcoin') === 'BTC' && chartSymbolByName('JUNKXYZ') === null && chartSymbolByName('AAPL') === null)

// ── wave 2: the starter door, other languages, verbless shapes ───────────
const starter: [string, RegExp][] = [
  ['help', /Buy \$10 of ETH \| Show me the ETH chart \| Buy \$10 of AAPL/],
  ['what can you do', /Buy \$10 of ETH/], ['how do I start?', /Buy \$10 of ETH/], ['how does this work', /Buy \$10 of ETH/], ['hi', /Buy \$10 of ETH/], ['gm', /Buy \$10 of ETH/],
  ['eth', /Show me the ETH chart \| Buy \$10 of ETH/], ['AAPL', /Show me the AAPL chart/], ['aapl', /Show me the AAPL chart/], ['apple stock', /Show me the AAPL chart/], ['tesla', /Show me the TSLA chart/], ['eth price', /Show me the ETH chart/],
]
for (const [ask, re] of starter) { const o = simulateLadder(ask); check(`starter: "${ask}"`, o.gate === 'starter' && o.kind === 'clarify' && re.test(o.note ?? ''), `${o.kind}/${o.gate} ${o.note ?? ''}`) }
for (const q of ['now', 'run', 'path', 'on', 'buy the dip', 'what is 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'])
  check(`starter stays out of: "${q}"`, simulateLadder(q).gate !== 'starter', JSON.stringify(simulateLadder(q)))
const wave2: [string, RegExp][] = [
  ['comprar bitcoin', /Buy \$10 of BTC/], ['compra $10 de ETH', /Buy \$10 of ETH/], ['kaufe ETH für 10$', /Buy \$10 of ETH/], ['买10美元的ETH', /Buy \$10 of ETH/],
  ['купить eth', /Buy \$10 of ETH/], ['vender eth', /Sell all my ETH/], ['bitcoin kaufen', /Buy \$10 of BTC/], ['stake eth por favor', /stake ETH on Lido/],
  ['$10 eth', /Buy \$10 of ETH/], ['0.01 eth to usdc', /Swap 0.01 ETH for USDC/], ['5 usdc -> eth', /Swap 5 USDC for ETH/],
  ['perp hype', /long HYPE on hyperliquid \| short HYPE on hyperliquid/], ['leverage eth', /long ETH on hyperliquid/], ['get eth', /Buy \$10 of ETH/], ['gimme eth', /Buy \$10 of ETH/],
  ['🚀 buy eth', /Buy \$10 of ETH/], ['buy eth!!', /Buy \$10 of ETH/], ['i want eth', /Buy \$10 of ETH/],
]
for (const [ask, re] of wave2) { const o = simulateLadder(ask); check(`wave2: "${ask}"`, o.kind !== 'planner' && re.test(o.note ?? ''), `${o.kind}/${o.gate} ${o.note ?? ''}`) }
for (const bad of ['sell everything', 'buy the dip']) { const o = simulateLadder(bad); check(`no invented ticker: "${bad}"`, !/EVERYTHING|of DIP/.test(o.note ?? ''), o.note ?? '') }

// ── r3: the SEND hold ──────────────────────────────────────────────────────
const H = (o: Partial<Parameters<typeof sendHoldFor>[0]>) => sendHoldFor({ walletStatus: 'reconnecting', hasAddress: false, stored: true, heldAt: null, now: 1_000_000, ...o })
check('send hold: stored wallet still restoring → hold', H({}) === 'hold' && H({ walletStatus: 'connecting' }) === 'hold')
check('send hold: the address landed → send', H({ hasAddress: true }) === 'send' && H({ walletStatus: 'connected' }) === 'send')
check('send hold: a settled disconnect → send', H({ walletStatus: 'disconnected' }) === 'send')
check('send hold: nothing stored (a stranger) → send at once', H({ stored: false }) === 'send')
check('send hold: the cap releases without the wallet', H({ heldAt: 1_000_000 - SEND_HOLD_MS }) === 'send' && H({ heldAt: 1_000_000 - SEND_HOLD_MS + 1 }) === 'hold')
check('send hold: cap is 10s', SEND_HOLD_MS === 10_000)
const ci = readFileSync(join(__dirname, '../components/ChatInterface.tsx'), 'utf8')
const hs = ci.slice(ci.indexOf('const handleSend = async'), ci.indexOf('const handleSend = async') + 1600)
check('send hold: handleSend asks sendHoldFor before anything else', /sendHoldFor\(\{ walletStatus, hasAddress: !!effectiveAddress, stored: hasStoredWalletConnection/.test(hs) && hs.indexOf('sendHoldFor') < hs.indexOf('parseChartAsk(raw)'))
check('send hold: a released send never re-holds', /if \(!released && sendHoldFor/.test(hs) && /handleSendRef\.current\(heldSend\.text, true\)/.test(ci))
check('send hold: the held ask is shown while it waits', /Connecting your wallet… “\$\{heldSend\.text/.test(ci))
// ── r3: pay / tip ─────────────────────────────────────────────────────────
for (const [ask, want] of [['pay nate.eth 5 usdc', 'clarify'], ['tip vitalik.eth 1 usdc on base', 'action'], ['pay 5 usdc to nate.eth on base', 'action'], ['send 5 usdc to nate.eth on base', 'action']] as const) {
  const o = simulateLadder(ask); check(`pay/tip: "${ask}" → transfer ${want}`, o.gate === 'transfer' && o.kind === want, `${o.gate}/${o.kind} ${o.note ?? ''}`)
}

// ── FINISH: the /i belt knows every verb the grammar builds a transfer from ─
// A link never auto-sends a transfer-shaped ask (IntentRuntime prefills it).
for (const ask of ['tip vitalik.eth 1 usdc on base', 'tip 0x1234567890abcdef1234567890abcdef12345678 50 USDC', 'donate 5 usdc to nate.eth', 'enviar 50 USDC a 0x1234567890abcdef1234567890abcdef12345678', 'envoyer 10 USDC à nate.eth', 'senden 10 USDC an nate.eth', '转账 10 USDC 给 nate.eth', 'pay nate.eth 5 usdc', 'send 5 usdc to nate.eth on base'])
  check(`transfer belt: "${ask}" holds (prefill only)`, isTransferShaped(ask))
for (const ask of ['Buy $25 of AAPL', 'comprar $20 de ETH', 'Swap 10 USDC for ETH on base', 'tip: buy the dip $10 of ETH'])
  check(`transfer belt: "${ask}" runs (not a transfer)`, !isTransferShaped(ask))

// ── POLISH (2026-10-13): THE INVENTORY + the market READ door ─────────────
// Every sentence the composers offer (scripts/deadend-inventory.ts) is
// backed by a response: native, a clarify whose chips build, a deterministic
// door, or a refusal with a next step. 0 planner, 0 bare refusal.
{
  const { enumerate } = require('./deadend-inventory') as typeof import('./deadend-inventory')
  const inv = enumerate()
  const planner = inv.filter((r) => r.verdict === 'planner')
  const bare = inv.filter((r) => r.verdict === 'refusal')
  const surfaces = new Set(inv.map((r) => r.surface))
  check(`inventory: ${inv.length} offered sentences over ${surfaces.size} surfaces — 0 fall to the planner`, inv.length > 1500 && surfaces.size >= 20 && planner.length === 0, planner.slice(0, 6).map((r) => `[${r.surface}] ${r.sentence} (${r.why})`).join(' | '))
  check('inventory: 0 bare refusals (every refusal carries a chip that builds)', bare.length === 0, bare.slice(0, 6).map((r) => `[${r.surface}] ${r.sentence}`).join(' | '))
  for (const surface of ['header strip (execAsks)', 'venue routes (venuesFor)', 'order ticket', 'AI bar question chip', 'ask door chips (/t)', 'guide CTA', 'tape follow', 'pick alert (armSentence)', 'earn board', 'wallet flags', 'alert action chips (lib/watchlists)'])
    check(`inventory covers: ${surface}`, surfaces.has(surface))
}
{
  const { marketReadAsk, marketReadWords, marketReadChips } = require('../lib/market-read') as typeof import('../lib/market-read')
  const { chartPairFor: cp } = require('../lib/charts') as typeof import('../lib/charts')
  const reads: [string, string, string][] = [
    ['Why is ETH moving?', 'ETH', 'move'], ['why is tsla down today', 'TSLA', 'move'], ["why's BTC pumping", 'BTC', 'move'], ['Why is HYPE moving?', 'HYPE', 'move'],
    ['What is moving AAPL right now — price, 24h change, and the news behind it?', 'AAPL', 'move'], ["what's going on with apple", 'AAPL', 'move'], ['how is NVDA doing', 'NVDA', 'move'],
    ['What is the current price and 24h change for ETH?', 'ETH', 'price'], ["what's the price of bitcoin", 'BTC', 'price'],
    ['What is the trend in the SOL candles on screen?', 'SOL', 'trend'],
  ]
  for (const [q, sym, kind] of reads) { const r = marketReadAsk(q); check(`market read: "${q}" → ${sym} ${kind}`, r?.symbol === sym && r.kind === kind, JSON.stringify(r)) }
  check('market read: the page names the symbol ("what\'s the trend?" on /t/HYPE)', marketReadAsk("What's the trend?", 'HYPE')?.symbol === 'HYPE' && marketReadAsk("What's the trend?") === null)
  for (const q of ['eth price', 'buy eth', 'Buy $25 of ETH', 'why is it moving', 'why is the market down', 'how do I start?', 'what is staking?', 'Show me the ETH chart', 'why is ZZQX moving', 'what is moving 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'])
    check(`market read stays out of: "${q}"`, marketReadAsk(q) === null, JSON.stringify(marketReadAsk(q)))
  for (const q of ['Why is ETH moving?', 'What is the current price and 24h change for ETH?', 'What is moving TSLA right now — price, 24h change, and the news behind it?']) {
    const o = simulateLadder(q)
    check(`ladder: "${q}" → the market-read gate (never the planner)`, o.gate === 'market-read' && o.kind === 'action', JSON.stringify(o))
  }
  check('ladder: "eth price" stays the starter door (chart chips), not a read', simulateLadder('eth price').gate === 'starter')
  const eth = cp('ETH')!
  const full = marketReadWords({ pair: eth, kind: 'move', last: 2512.3, change24hPct: 3.21, tf: '1d', tech: { summary: 'Buy', oscillators: 'Neutral', movingAverages: 'Strong Buy', rsi: 61.7, sma50: 2400, sma200: 2600 }, news: [{ title: 'ETH ETF flows [record]', url: 'https://example.com/a', source: 'Cointelegraph', age: '2h ago' }] })
  check('market read words: price, move, rating, averages, news, honesty line', /\*\*\$2,512\.30\*\*, up 3\.21% over 24h/.test(full) && /reads \*\*Buy\*\*/.test(full) && /above its 50-bar average/.test(full) && /below its 200-bar average/.test(full) && /\[ETH ETF flows record\]\(https:\/\/example\.com\/a\) — Cointelegraph, 2h ago/.test(full) && /not advice/.test(full), full)
  const empty = marketReadWords({ pair: eth, kind: 'move', last: null, change24hPct: null, tech: null, news: [] })
  check('market read words: every feed down still answers (no number invented)', /didn't answer just now/.test(empty) && /No ETH headlines/.test(empty) && !/\$\d/.test(empty), empty)
  for (const w of [full, empty]) check('market read words: never "I can\'t" / Yahoo / this environment / an env var', !/I can['’]t|I cannot|yahoo|this environment|process\.env|[A-Z]{3,}_[A-Z]{3,}_?KEY|prisma/i.test(w))
  const trend = marketReadWords({ pair: eth, kind: 'trend', last: 2500, change24hPct: -1, tech: null, news: null })
  check('market read words: a trend read carries no news line', !/news|headlines/i.test(trend) && /down 1\.00%/.test(trend))
  for (const sym of ['ETH', 'AAPL', 'HYPE', 'SOL', 'UNI']) {
    const chips = marketReadChips(cp(sym)!)
    check(`market read chips (${sym}): the chart + the lead order, every one builds`, chips.length === 2 && chips.every((c) => builds(c.resume) && simulateLadder(c.resume).kind === 'action') && !chips.some((c) => /^Sell/.test(c.resume)), JSON.stringify(chips))
  }
  const chat = readFileSync(join(__dirname, '../app/api/chat/route.ts'), 'utf8')
  const iChart = chat.indexOf('const chartAsk = parseChartAsk(message)')
  const iRead = chat.indexOf('const marketRead = marketReadAsk(message)')
  const iSwap = chat.indexOf('// ── Swap intent: Pantessa-NATIVE transaction building')
  check('chat route: the market-read gate sits right after the chart gate, before every money layer', iChart > 0 && iRead > iChart && iRead < iSwap)
  check('chat route: the read answers with the chart + chips and never throws (feeds caught)', /readTape\(pair\.symbol, '1d'\)\.catch\(\(\) => null\)/.test(chat) && /getNews\(pair\.symbol, 3\)\.catch\(\(\) => null\)/.test(chat) && /buildPath: 'native-market-read'/.test(chat))
  check('chat route: the chart reply no longer offers DCA (retired 2026-09-16)', !/Tap Buy, Sell, or DCA/.test(chat))
  const mask = readFileSync(join(__dirname, '../app/api/markets/ask/route.ts'), 'utf8')
  check('markets ask: a read question answers from the tape when the model is down or walled', /if \(read\) return readAnswer\('none'\)/.test(mask) && /if \(read\) return readAnswer\('wall'\)/.test(mask))
  check('markets ask: none of our own replies says "I can\'t"', !/text: [`'"][^`'"]*I can['’]t/.test(mask))
  {
    const re = mask.match(/const DEAD_END_PROSE = (\/.*\/i)\n/)
    const rx = re ? (eval(re[1]) as RegExp) : null
    check('markets ask: model prose that dead-ends is replaced by the tape\'s read (I can\'t · no real-time access · Yahoo · this environment · an env var)', !!rx && ['I can\'t see live prices.', "I don't have access to real-time data", 'Try Yahoo Finance', 'not available in this environment', 'set ANTHROPIC_API_KEY'].every((t) => rx.test(t)) && !['The trend is up on the daily chart.', 'Support sits near 2,400.'].some((t) => rx.test(t)) && /const h = honest\(m\.text\)/.test(mask) && /const h = honest\(modelProse\(text\)\)/.test(mask))
  }
}
// ── POLISH: composers speak the order the route would offer ───────────────
{
  const { composeAsk, tradeAsks } = require('../lib/trade-asks') as typeof import('../lib/trade-asks')
  const { followAsk } = require('../lib/tape') as typeof import('../lib/tape')
  const { alertActionChips } = require('../lib/watchlists') as typeof import('../lib/watchlists')
  const { chartPairFor: cp } = require('../lib/charts') as typeof import('../lib/charts')
  const sol = cp('SOL')!
  check('non-EVM home: "Buy SOL" composes the Hyperliquid long (was "Buy $50 of SOL" → the refusal door)', composeAsk(sol, 'buy', { usd: 50 }) === 'Long $50 of SOL on Hyperliquid' && composeAsk(sol, 'sell', { usd: 50 }) === 'Short $50 of SOL on Hyperliquid' && tradeAsks(sol).map((a) => a.label).join() === 'Long SOL,Short SOL')
  check('non-EVM home: every SOL/XRP chip builds natively', [...tradeAsks(sol), ...tradeAsks(cp('XRP')!)].every((a) => simulateLadder(a.ask).kind === 'action'))
  check('EVM coin + stock unchanged: "Buy $50 of ETH" · "Buy $50 of AAPL"', composeAsk(cp('ETH')!, 'buy', { usd: 50 }) === 'Buy $50 of ETH' && composeAsk(cp('AAPL')!, 'buy', { usd: 50 }) === 'Buy $50 of AAPL')
  check('tape: a "SOL" printed on a Base pool follows as the perp, not the look-alike', followAsk({ market: 'SOL', side: 'buy', venue: 'dex', chainId: 8453 })?.ask === 'Long $25 of SOL on Hyperliquid' && followAsk({ market: 'WETH', side: 'buy', venue: 'dex', chainId: 8453 })?.ask === 'Buy $25 of ETH on Base')
  const hype = alertActionChips({ symbol: 'HYPE', condition: 'pct_move', value: 5 } as never, cp('HYPE'))
  check('alert chips: a perp alert offers Long/Short on Hyperliquid, a stock alert keeps Buy/Sell', hype[0].ask === 'Long $50 of HYPE on Hyperliquid' && hype[1].ask === 'Short $50 of HYPE on Hyperliquid' && alertActionChips({ symbol: 'AAPL', condition: 'pct_move', value: 5 } as never, cp('AAPL'))[0].ask === 'Buy $50 of AAPL')
}

// ── POLISH: every refusal carries a next step (lib/refusal-next-step) ─────
{
  const { refusalNextSteps, quotedSentences, namedMarket, NEXT_STEP_QUESTION } = require('../lib/refusal-next-step') as typeof import('../lib/refusal-next-step')
  const { buildsNatively: bn } = require('./ask-ladder') as typeof import('./ask-ladder')
  check('next step: quoted sentences, curly and straight, punctuation trimmed', quotedSentences('Say “supply 10 USDC to Aave on Ethereum.” or "lend 10 USDC on Morpho on Base"').join('|') === 'supply 10 USDC to Aave on Ethereum|lend 10 USDC on Morpho on Base')
  const aaveChain = refusalNextSteps('supply 10 USDC to aave on base', "🏦 Aave v4 is live on **Ethereum only** today — I can't build a supply on base. Say “supply 10 USDC to Aave on Ethereum” and I'll prepare it.", bn)
  check('next step: a native wall that names its fix gets it as a chip (the refusal\'s own words)', aaveChain.length === 1 && aaveChain[0].resume === 'supply 10 USDC to Aave on Ethereum' && aaveChain[0].label === 'Supply 10 USDC to Aave on Ethereum', JSON.stringify(aaveChain))
  const readOnly = refusalNextSteps('withdraw 10 USDC from aave', "🏦 You don't have any USDC supplied on Aave v4 — nothing to withdraw. Ask “show my Aave position” to see what's there.", bn)
  check('next step: a quoted READ the ladder can\'t build is never a chip', readOnly.length === 0, JSON.stringify(readOnly))
  const transient = refusalNextSteps('Buy $10 of AAPL', '🔄 I couldn\'t read your USDG balance on Robinhood Chain just now (the RPC didn\'t answer), so I won\'t build the swap blind — try again in a moment.', bn)
  check('next step: a transient wall offers "Try again" with the ask', transient.length === 1 && transient[0].label === 'Try again' && transient[0].resume === 'Buy $10 of AAPL', JSON.stringify(transient))
  const funding = refusalNextSteps('Buy $50 of ETH', '🔄 The swap sells 50 USDC on Base and the wallet holds 0. Send ETH or USDC to this wallet on any of those chains, then ask again — nothing was built.', bn)
  check('next step: a funding shortfall (native) gets nothing here — the funding layer owns its chips', funding.length === 0, JSON.stringify(funding))
  const prose = refusalNextSteps('buy some apple stock', 'I can help with that — which amount?', bn, { planner: true })
  check('next step: planner prose on a money ask gets the grammar\'s read (net chips)', prose.length > 0 && prose.every((c) => bn(c.resume)), JSON.stringify(prose))
  const market = refusalNextSteps('is TSLA a good trade at this price, should I size up', 'Here is a balanced view…', bn, { planner: true })
  check('next step: planner prose naming a market gets its chart + lead order', market.map((c) => c.resume).join('|') === 'Show me the TSLA chart|Buy $25 of TSLA', JSON.stringify(market))
  check('next step: never re-offers the refused ask on a permanent wall', refusalNextSteps('supply 10 USDC to Aave on Ethereum', 'Say “supply 10 USDC to Aave on Ethereum”', bn).length === 0)
  check('next step: namedMarket reads tickers and household names, never English words', namedMarket('sell my $TSLA now') === 'TSLA' && namedMarket('buy some apple') === 'AAPL' && namedMarket('put it all on red') === null)
  const chat = readFileSync(join(__dirname, '../app/api/chat/route.ts'), 'utf8')
  const iBelt = chat.indexOf('refusalNextSteps(askText, preData.reply, buildsNatively')
  const iOpt = chat.indexOf("if (req.headers.get('x-yf-no-ask-log') === '1') return res")
  check('chat route: the next-step belt runs in the POST wrapper (every refusal site, every origin) before the harness opt-out', iBelt > 0 && iOpt > iBelt && chat.includes(`question: NEXT_STEP_QUESTION`))
  check('chat route: the failures queue logs the ORIGINAL turn (a chip is not a fix)', /const data = preData\n\s+const kind = preKind/.test(chat))
  // Every “say …” / “try …” suggestion in the route's own copy that names a
  // money action must build — "say X and I'll build it" with an X that falls
  // to the planner is a dead end with our name on it. Reads (positions,
  // "where can I earn") ride the venue's MCP and context follow-ups ride the
  // pending turn; they are listed, never chips.
  const READ_OR_CONTEXT = /^(cancel|vote on \d|make it|privately|where can I|what can I|show my|\$\{message\})/i
  const fill = (x: string) => x.replace(/\$\{[^}]*amount[^}]*\}/gi, '10').replace(/\$\{[^}]*token[^}]*\}/gi, 'USDC').replace(/\$\{[^}]*(sym|Sym|coin)[^}]*\}/g, 'ETH').replace(/\$\{[^}]*chain[^}]*\}/gi, 'base').replace(/\$\{[^}]*op[^}]*\}/gi, 'withdraw').replace(/\$\{[^}]*\}/g, 'X')
  const said = [...chat.matchAll(/(?:[Ss]ay|[Tt]ry|[Aa]sk|e\.g\.|like)[^“\n]{0,40}“([^”\n]{4,140})”/g)].map((m) => m[1]).filter((x) => !READ_OR_CONTEXT.test(x) && !/[`<]/.test(x)) // nested templates / <placeholders> are prose
  const dead = said.map((x) => fill(x).replace(/[.,;:!?…]+$/, '')).filter((x) => !bn(x))
  check(`chat route: every money sentence the refusal copy tells you to say builds (${said.length} quoted)`, said.length >= 10 && dead.length === 0, dead.join(' | '))
}

console.log(`\npins:deadends — ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
