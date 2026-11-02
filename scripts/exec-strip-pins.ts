// THE EXECUTIONS STRIP — pins (2026-11-02). Pure: the words for the three
// honest states, the dash rule, the explorer link, the age, the newest-first
// ring, and the source fence (the strip rides the chart's ONE relay stream,
// beside positioning). Live (`--live`, BASE=…): the served symbol page carries
// the strip and its words for a covered and an uncovered market.
//
//   npx tsx scripts/exec-strip-pins.ts
//   BASE=http://localhost:3000 npx tsx scripts/exec-strip-pins.ts --live
import { readFileSync } from 'node:fs'
import { DEX_PRINT_SYMBOLS, chartLiveFeed } from '../lib/chart-live'
import { STRIP_MAX, ageWords, duneCoverageWords, effectWords, mergeStripFills, shortHash, stripEmptyWords, stripWords, txHref } from '../lib/exec-strip'
import type { TapeFill } from '../lib/tape'

type Check = (name: string, ok: boolean, extra?: string) => void

function fill(over: Partial<TapeFill> & { id: string; at: number }): TapeFill {
  return { market: 'UNI', side: 'buy', size: 10, price: 7.2, usd: 72, taker: null, maker: null, hash: null, effect: null, block: null, source: 'dune', venue: 'dex', chainId: 1, ...over }
}

export function execStripPins(check: Check): void {
  const uni = chartLiveFeed({ symbol: 'UNI', source: 'coinbase', pair: 'UNI-USD' })
  const sol = chartLiveFeed({ symbol: 'SOL', source: 'coinbase', pair: 'SOL-USD' })
  const hype = chartLiveFeed({ symbol: 'HYPE', source: 'hyperliquid', pair: 'HYPE' })
  const aapl = chartLiveFeed({ symbol: 'AAPL', source: 'robinhood', pair: 'AAPL' })

  check('exec strip: which markets the strip has is the chart\'s own live-feed map — UNI reads the three DEX chains, HYPE reads HyperCore, SOL and a stock have no Dune feed',
    !!uni && uni.venues.join(',') === 'dex-ethereum,dex-base,dex-arbitrum' && uni.markets.join(',') === 'UNI' && !!hype && hype.venues.join(',') === 'hypercore' && sol === null && aapl === null)
  check('exec strip: an uncovered market says "no Dune feed for this market yet" and names what Dune DOES stream (the chains and the coin list), never a fallback dressed as Dune',
    stripWords(null, sol, 'coinbase').startsWith('no Dune feed for this market yet') && stripWords(null, sol, 'coinbase').includes('Ethereum, Base and Arbitrum') && DEX_PRINT_SYMBOLS.includes('UNI') && stripWords(null, sol, 'coinbase').includes(duneCoverageWords()) && stripEmptyWords(null, sol) === 'nothing to show')
  check('exec strip: a tokenized stock says why — the Robinhood tape is one instrument, Dune\'s xyz stock perps another',
    stripWords(null, aapl, 'robinhood').includes('Robinhood tape is one instrument'))
  check('exec strip: the relay\'s states are named by name — live · reconnecting · connecting · "relay has no key" · "stream closed", and the empty row matches',
    stripWords('live', uni, 'coinbase') === 'DEX prints · live' && stripWords('live', hype, 'hyperliquid') === 'Hyperliquid prints · live' && stripWords('reconnecting', uni, 'coinbase') === 'DEX prints · reconnecting' && stripWords('connecting', uni, 'coinbase') === 'DEX prints · connecting' && stripWords(null, uni, 'coinbase') === 'DEX prints · connecting' &&
      stripWords('unconfigured', uni, 'coinbase') === 'Dune relay has no key · nothing drawn' && stripWords('closed', uni, 'coinbase') === 'Dune stream closed · nothing drawn' && stripEmptyWords('unconfigured', uni) === 'nothing drawn' && stripEmptyWords('live', uni) === 'waiting for the first execution')
  check('exec strip: the dash rule — a spot swap has no position effect (—); a perp fill prints the effect the wire carried; a missing block is a dash in the row',
    effectWords(fill({ id: 'a', at: 1 })) === '—' && effectWords(fill({ id: 'b', at: 1, venue: 'hyperliquid', chainId: null, effect: 'flip' })) === 'flip')
  check('exec strip: the explorer link is pinned per venue — a DEX swap links its chain\'s explorer, a HyperCore fill the Hyperliquid explorer, a Lighter fill none; no hash or a zero hash is no link',
    txHref(fill({ id: 'a', at: 1, hash: '0xabc', chainId: 1 })) === 'https://etherscan.io/tx/0xabc' && txHref(fill({ id: 'a', at: 1, hash: '0xabc', chainId: 8453 })) === 'https://basescan.org/tx/0xabc' && txHref(fill({ id: 'a', at: 1, hash: '0xabc', chainId: 42161 })) === 'https://arbiscan.io/tx/0xabc' &&
      txHref(fill({ id: 'a', at: 1, hash: '0xabc', chainId: null })) === null && txHref(fill({ id: 'a', at: 1, hash: '0xabc', venue: 'hyperliquid', chainId: null })) === 'https://app.hyperliquid.xyz/explorer/tx/0xabc' && txHref(fill({ id: 'a', at: 1, hash: '0xabc', venue: 'lighter', chainId: null })) === null &&
      txHref(fill({ id: 'a', at: 1, hash: null })) === null && txHref(fill({ id: 'a', at: 1, hash: '0x0000' })) === null && shortHash('0x1234567890abcdef') === '0x1234…cdef')
  const ring = mergeStripFills([fill({ id: 'old', at: 1000 })], [fill({ id: 'new', at: 3000 }), fill({ id: 'mid', at: 2000 }), fill({ id: 'old', at: 1000 })])
  const many = mergeStripFills([], Array.from({ length: STRIP_MAX + 5 }, (_, i) => fill({ id: `f${i}`, at: i })))
  check('exec strip: the ring is newest first, one row per venue id, cut at twenty',
    ring.map((f) => f.id).join(',') === 'new,mid,old' && many.length === STRIP_MAX && many[0].id === `f${STRIP_MAX + 4}` && mergeStripFills([fill({ id: 'x', at: 1 })], []).length === 1)
  check('exec strip: age reads 3s · 2m · 1h', ageWords(10_000, 7_000) === '3s' && ageWords(200_000, 80_000) === '2m' && ageWords(7_300_000, 100_000) === '2h' && ageWords(5, 9) === '0s')
  const chart = readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')
  check('exec strip: the strip rides the chart\'s ONE relay stream (every batch and the backfill reach its sink; the stream opens for it on every frame) and sits beside positioning in one row',
    chart.includes('stripPrintRef.current?.(batch)') && chart.includes('stripPrintRef.current?.(fills)') && chart.includes('|| depthOn || tapeOn || stripOn') && chart.includes('backfill: print || stripOn') && chart.includes('<div className="poshet-row">') && chart.includes('<ExecutionsStrip symbol={pair.symbol}') && !readFileSync('components/markets/chart/ExecutionsStrip.tsx', 'utf8').includes('EventSource'))
}

export async function execStripLivePins(check: Check, base: string): Promise<void> {
  const [uni, sol] = await Promise.all([fetch(`${base}/t/UNI`), fetch(`${base}/t/SOL`)])
  const [uniHtml, solHtml] = await Promise.all([uni.text(), sol.text()])
  check('exec strip live: /t/UNI serves the strip under the candles beside positioning, credited to Dune by name',
    uni.status === 200 && uniHtml.includes('poshet-row') && uniHtml.includes('aria-label="UNI executions"') && uniHtml.includes('data-feed="dune"') && uniHtml.includes('Executions · Dune'), `${uni.status}`)
  check('exec strip live: /t/SOL (outside Dune\'s spot trial) serves the strip saying there is no Dune feed for it yet, and what Dune streams',
    sol.status === 200 && solHtml.includes('data-feed="none"') && solHtml.includes('no Dune feed for this market yet'), `${sol.status}`)
}

if (process.argv[1]?.endsWith('exec-strip-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  }
  execStripPins(check)
  const done = process.argv.includes('--live') ? execStripLivePins(check, process.env.BASE ?? 'http://localhost:3000') : Promise.resolve()
  done.then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall exec strip pins green')
    process.exit(failed ? 1 : 0)
  })
}
