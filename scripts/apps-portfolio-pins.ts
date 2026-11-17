// Pins for the apps page's "portfolio" lane (squad apps-page, 2026-11-17). The
// harness already calls this (scripts/test-api.ts), so no lane edits the
// harness. Pure: no server, no chain, no DB. These pin the RULES the
// Uniswap / Wallet / Robinhood / OpenSea sections and the page's Needs-you and
// Recurring blocks speak with (lib/apps-portfolio.ts), plus a source fence on
// the section files (no signing, no tx hooks, no fetch).
// Runnable alone:  npx tsx scripts/apps-portfolio-pins.ts

import fs from 'node:fs'
import path from 'node:path'
import {
  activityWords,
  agoText,
  balanceText,
  biggestHolding,
  dueFirst,
  holdingsCounts,
  holdingsSentence,
  holdingsShownUnder,
  needsAboutHoldings,
  needsPieces,
  nftCounts,
  nftSentence,
  rankHoldings,
  recurringMonthly,
  recurringSentence,
  rowTokenOf,
  spellCount,
  stockCount,
  usdText,
} from '../lib/apps-portfolio'
import type { HoldingRow, HoldingsTile, NftRow, RowsTile, SplashTile, StatRow } from '../lib/splash/types'

type Check = (name: string, ok: boolean, extra?: string) => void

const h = (symbol: string, valueUsd: number | null, chain?: string): HoldingRow => ({ symbol, address: `0x${symbol}`, balance: '1', priceUsd: null, valueUsd, chain })
const holdings = (over: Partial<HoldingsTile>): HoldingsTile => ({
  id: 'portfolio-holdings',
  mcpSlug: 'uniswap-free',
  mcpName: 'Uniswap',
  render: 'holdings',
  title: 'Your portfolio',
  chain: 'Ethereum · Base · Arbitrum · Optimism · Polygon',
  totalUsd: 6306.4,
  holdings: [h('ETH', 1214, 'Optimism'), h('USDC', 623.97, 'Ethereum')],
  prompts: [],
  ...over,
})
const nft = (collection: string, chain = 'Ethereum'): NftRow => ({
  name: `${collection} #1`,
  collection,
  collectionName: collection,
  imageUrl: null,
  chain,
  contract: `0x${collection}`,
  tokenId: '1',
  standard: 'erc721',
  floor: null,
})
const rowsTile = (rows: StatRow[], over: Partial<RowsTile> = {}): RowsTile => ({ id: 'x', mcpSlug: 'y', mcpName: 'Y', title: 't', render: 'rows', rows, prompts: [], ...over })

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

export function appsPortfolioPins(check: Check) {
  // ── numbers in words ──
  check('portfolio: spellCount words to nine, digits after', spellCount(5) === 'five' && spellCount(9) === 'nine' && spellCount(10) === '10' && spellCount(1) === 'one')
  check('portfolio: usdText whole dollars from 1,000, cents below', usdText(6306.4) === '$6,306' && usdText(623.97) === '$623.97' && usdText(152.5) === '$152.50' && usdText(0.0042) === '$0.0042')
  check('portfolio: balanceText trims to four places', balanceText('0.675812345') === '0.6758' && balanceText('1123.556') === '1,123.56' && balanceText('abc') === 'abc')

  // ── counts from the tile (the rows are only the largest few) ──
  const multi = holdingsCounts(holdings({ subtitle: '35 across 5 chains' }))
  check('portfolio: counts read "35 across 5 chains"', multi.positions === 35 && multi.chains === 5, JSON.stringify(multi))
  const one = holdingsCounts(holdings({ subtitle: '4 on Base', chain: 'Base' }))
  check('portfolio: counts read "4 on Base" as one named chain', one.positions === 4 && one.chains === 1 && one.chainName === 'Base', JSON.stringify(one))
  const rh = holdingsCounts(holdings({ subtitle: '2 stocks · 5 total', chain: 'Robinhood Chain' }))
  check('portfolio: counts read "2 stocks · 5 total" on Robinhood Chain', rh.positions === 5 && rh.chains === 1 && rh.chainName === 'Robinhood Chain', JSON.stringify(rh))
  const unknown = holdingsCounts(holdings({ subtitle: 'via Uniswap' }))
  check('portfolio: no count in the subtitle → the rows, chains unknown when they differ', unknown.positions === 2 && unknown.chains === null, JSON.stringify(unknown))
  check('portfolio: stockCount reads stocks, null otherwise', stockCount('2 stocks · 5 total') === 2 && stockCount('1 stock · 3 total') === 1 && stockCount('5 on Robinhood Chain') === null)

  // ── the headline ──
  check(
    'portfolio: headline "$6,306 in 35 positions on five chains."',
    holdingsSentence({ totalUsd: 6306.4, counts: multi }) === '$6,306 in 35 positions on five chains.',
    holdingsSentence({ totalUsd: 6306.4, counts: multi }),
  )
  check('portfolio: headline without a total leaves the money out', holdingsSentence({ totalUsd: null, counts: multi }) === '35 positions on five chains.')
  check('portfolio: headline names one chain', holdingsSentence({ totalUsd: 12.5, counts: one }) === '$12.50 in 4 positions on Base.')
  check('portfolio: headline with unknown chains says no chains', holdingsSentence({ totalUsd: 20, counts: unknown }) === '$20.00 in 2 positions.')
  check(
    'portfolio: headline digits past nine chains, singular position',
    holdingsSentence({ totalUsd: null, counts: { positions: 1, chains: 12, chainName: null } }) === '1 position on 12 chains.',
  )
  check(
    'portfolio: the wallet\'s lead',
    holdingsSentence({ totalUsd: 6306.4, counts: multi, lead: 'Your wallet holds' }) === 'Your wallet holds $6,306 in 35 positions on five chains.',
  )
  check('portfolio: a zero total is not a money claim', holdingsSentence({ totalUsd: 0, counts: multi }) === '35 positions on five chains.')

  // ── ranking ──
  const ranked = rankHoldings([h('A', 5), h('B', null), h('C', 50), h('D', 5)])
  check('portfolio: rank largest first, unpriced last, ties in order', ranked.map((r) => r.symbol).join('') === 'CADB', ranked.map((r) => r.symbol).join(''))
  check('portfolio: biggest is null when nothing is priced', biggestHolding([h('A', null)]) === null && biggestHolding([h('A', 3), h('B', 9)])?.symbol === 'B')

  // ── uniswap + wallet on one page ──
  const shared: SplashTile = holdings({ mcpSlug: 'uniswap-free', mcpName: 'Uniswap' })
  const bySlug = new Map<string, SplashTile[]>([
    ['uniswap-free', [shared]],
    ['yeetful-tool-wallet', []],
  ])
  check('portfolio: the app without the shared tiles points at the one with them', holdingsShownUnder('yeetful-tool-wallet', [], bySlug) === 'Uniswap')
  check('portfolio: the app with the shared tiles points nowhere', holdingsShownUnder('uniswap-free', [shared], bySlug) === null)
  check('portfolio: alone on the page there is nowhere to point', holdingsShownUnder('yeetful-tool-wallet', [], new Map([['yeetful-tool-wallet', []]])) === null)

  // ── activity ──
  const act = { hash: '0x1', chain: 'Base', direction: 'in' as const, asset: 'ETH', amount: '0.5', counterparty: '0xab…cd', timestamp: 0, explorerUrl: '' }
  check('portfolio: activity words', activityWords(act) === 'Received 0.5 ETH' && activityWords({ ...act, direction: 'out', amount: '' }) === 'Sent ETH' && activityWords({ ...act, direction: 'self' }) === 'Moved 0.5 ETH to yourself')
  const now = 1_800_000_000_000
  check('portfolio: agoText', agoText(0, now) === '' && agoText(now / 1000 - 30, now) === 'just now' && agoText(now / 1000 - 3 * 3600, now) === '3h ago' && agoText(now / 1000 - 3 * 86400, now) === '3d ago')

  // ── NFTs ──
  const c = nftCounts([nft('Pudgy'), nft('Pudgy'), nft('Azuki', 'Base')], '12+ across Ethereum · Base · Arbitrum')
  check('portfolio: nft counts read the scan\'s total', c.shown === 3 && c.total === 12 && c.more && c.collections === 2 && c.chains === 2, JSON.stringify(c))
  check('portfolio: a partial gallery does not count collections', nftSentence(c) === '12 or more NFTs.', nftSentence(c))
  const whole = nftCounts([nft('Pudgy'), nft('Pudgy'), nft('Azuki', 'Base')], '3 across Ethereum · Base · Arbitrum')
  check('portfolio: a whole gallery names its collections', nftSentence(whole) === '3 NFTs in two collections.' && nftSentence(nftCounts([nft('A')], '1 across Base')) === '1 NFT in one collection.', nftSentence(whole))

  // ── needs you ──
  const p = needsPieces({ label: '$152.50 of ETH on Base has no stop', value: '-$30.50 at 20%', sub: 'a 20% drop would cost that' })
  check('portfolio: needs pieces each end in a stop, small print capitalised', p.lead === '$152.50 of ETH on Base has no stop.' && p.value === '-$30.50 at 20%.' && p.sub === 'A 20% drop would cost that.', JSON.stringify(p))
  check('portfolio: needs pieces keep the row\'s own punctuation', needsPieces({ label: 'Ready?' }).lead === 'Ready?' && needsPieces({ label: 'x' }).value === null)
  const briefing = rowsTile([
    { label: 'ETH has no stop', chartSymbol: 'ETH', actions: [{ label: 'Protect it', prompt: 'protect my ETH' }] },
    { label: 'USDC idle', chartSymbol: 'USDC' },
    { label: '$158.16 USDC idle on Arbitrum', chartSymbol: 'ETH', actions: [{ label: 'Swap', prompt: 'swap' }] },
    { label: 'HYPE long', chartSymbol: 'HYPE', actions: [{ label: 'x', prompt: 'y' }] },
  ])
  check('portfolio: needs about holdings counts acting rows whose words name a held token', needsAboutHoldings(briefing, ['eth', 'USDC']) === 2 && needsAboutHoldings(briefing, ['ETH']) === 1 && needsAboutHoldings(null, ['ETH']) === 0)
  check('portfolio: a row is about the token its words name, not its swap side', rowTokenOf(briefing.rows[2]) === null && rowTokenOf(briefing.rows[0]) === 'ETH')

  // ── recurring ──
  const dca = rowsTile(
    [
      { label: '$10 → ETH weekly', value: 'bought this week' },
      { label: '$5 → AAPL daily', value: 'due now', actions: [{ label: 'Buy now', prompt: 'run my AAPL dca' }] },
    ],
    { viz: { kind: 'cadence', monthlyUsd: 193, items: [] } },
  )
  check('portfolio: recurring due rows first', dueFirst(dca.rows)[0].label === '$5 → AAPL daily')
  check('portfolio: recurring sentence', recurringSentence(dca) === '2 recurring buys, 1 due.' && recurringSentence(rowsTile([{ label: 'a', value: 'paused' }])) === '1 recurring buy, none due.' && recurringSentence(null) === null)
  check('portfolio: recurring monthly only from the chart', recurringMonthly(dca) === '$193 a month' && recurringMonthly(rowsTile([])) === null)

  // ── fences on the files this lane owns ──
  const root = path.resolve(__dirname, '..')
  const files = [
    'components/apps/sections/uniswap.tsx',
    'components/apps/sections/wallet.tsx',
    'components/apps/sections/robinhood.tsx',
    'components/apps/sections/opensea.tsx',
    'components/apps/NeedsYou.tsx',
    'components/apps/Recurring.tsx',
    'lib/apps-portfolio.ts',
  ]
  for (const f of files) {
    let src = ''
    try {
      src = strip(fs.readFileSync(path.join(root, f), 'utf8'))
    } catch {
      check(`portfolio: ${f} readable`, false)
      continue
    }
    const bad = /\b(useSendTransaction|useSignTypedData|useWriteContract|useSignMessage|sendTransaction|signTypedData|SendTxChain|SignOrderButton)\b|\bfetch\s*\(/.exec(src)
    check(`portfolio: ${f} never signs, sends or fetches`, !bad, bad?.[0])
  }
  // UI copy (JSX text and string literals) carries no em dash or arrow.
  for (const f of files) {
    const src = strip(fs.readFileSync(path.join(root, f), 'utf8'))
    const literals = src.match(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g) ?? []
    const jsxText = src.match(/>[^<>{}\n]+</g) ?? []
    const hit = [...literals, ...jsxText].find((s) => /[—→]/.test(s))
    check(`portfolio: ${f} copy has no em dash or arrow`, !hit, hit)
  }
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /apps-portfolio-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  appsPortfolioPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
