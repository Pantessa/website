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
for (const q of ['what should I buy', 'what is a stop loss', 'how does this work', 'buy now', 'run it back', 'tell me a joke'])
  check(`still prose: "${q}"`, simulateLadder(q).kind === 'planner', JSON.stringify(simulateLadder(q)))
check('moneyShaped: asset name is evidence', moneyShaped('buy apple') && moneyShaped('short btc') && moneyShaped('buy bitcoin'))
check('moneyShaped: English-word tickers are prose', !moneyShaped('buy now') && !moneyShaped('run it') && !moneyShaped('snap out of it'))
check('moneyShaped: yield shape, not a yield question', moneyShaped('earn yield') && !moneyShaped('what is the apy on aave?'))
check('asset words', isMoneyAssetWord('btc') && isMoneyAssetWord('apple') && isMoneyAssetWord('AAPL') && !isMoneyAssetWord('now') && !isMoneyAssetWord('on') && !isMoneyAssetWord('path'))
check('name → ticker', chartSymbolByName('apple') === 'AAPL' && chartSymbolByName('bitcoin') === 'BTC' && chartSymbolByName('JUNKXYZ') === null && chartSymbolByName('AAPL') === null)

console.log(`\npins:deadends — ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
