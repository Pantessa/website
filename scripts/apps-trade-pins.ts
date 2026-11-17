// Pins for the apps page's "trade" lane (squad apps-page, 2026-11-17): the
// pure rules behind the Snapshot, Hyperliquid and CoW Protocol sections
// (lib/apps-trade.ts). The harness already calls this (scripts/test-api.ts).
// Pure: no server, no chain, no DB.
// Runnable alone:  npx tsx scripts/apps-trade-pins.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  closesWhen,
  cowBuyLowerAsk,
  cowHeadline,
  cowLine,
  cowSellHigherAsk,
  cowView,
  fmtFundingYearly,
  fmtPrice,
  fmtSignedPct,
  fundingYearlyPct,
  hlClosestLiq,
  hlHeadline,
  hlView,
  placeRows,
  snapshotHeadline,
  snapshotLine,
  snapshotView,
  timeLeftShort,
  topHlMarkets,
  voteAsk,
} from '../lib/apps-trade'
import type { ProposalRow, SplashTile } from '../lib/splash/types'

type Check = (name: string, ok: boolean, extra?: string) => void

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0) // Monday 16 Nov 2026, 12:00 UTC
const sec = (ms: number) => Math.floor(ms / 1000)
const H = 3_600_000
const D = 24 * H

function proposal(over: Partial<ProposalRow>): ProposalRow {
  return {
    id: over.id ?? 'p1',
    title: over.title ?? 'Upgrade the hook',
    spaceId: over.spaceId ?? 'uniswapgovernance.eth',
    spaceName: over.spaceName ?? 'Uniswap',
    avatarUrl: '',
    choices: over.choices ?? ['For', 'Against', 'Abstain'],
    leadingChoice: over.leadingChoice ?? null,
    leadingPct: over.leadingPct ?? null,
    endsAt: over.endsAt ?? sec(NOW + 4 * D),
  }
}
const proposalsTile = (ps: ProposalRow[]): SplashTile => ({
  id: 'snapshot-proposals',
  mcpSlug: 'snapshot-free',
  mcpName: 'Snapshot',
  render: 'proposals',
  title: 't',
  prompts: [],
  spaces: [...new Map(ps.map((p) => [p.spaceId, { id: p.spaceId, name: p.spaceName, avatarUrl: '' }])).values()],
  proposals: ps,
})

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

export function appsTradePins(check: Check) {
  // ── Time words ──
  check('trade: closesWhen minutes', closesWhen(sec(NOW + 40 * 60_000), NOW) === 'in 40 minutes', closesWhen(sec(NOW + 40 * 60_000), NOW))
  check('trade: closesWhen hours', closesWhen(sec(NOW + 5 * H), NOW) === 'in 5 hours')
  check('trade: closesWhen tomorrow', closesWhen(sec(NOW + 20 * H), NOW, 'UTC') === 'tomorrow', closesWhen(sec(NOW + 20 * H), NOW, 'UTC'))
  check('trade: closesWhen weekday', closesWhen(sec(NOW + 4 * D), NOW, 'UTC') === 'on Friday', closesWhen(sec(NOW + 4 * D), NOW, 'UTC'))
  check('trade: closesWhen a date past a week', closesWhen(sec(NOW + 16 * D), NOW, 'UTC') === 'on 2 Dec', closesWhen(sec(NOW + 16 * D), NOW, 'UTC'))
  check('trade: closesWhen past', closesWhen(sec(NOW - 1000), NOW) === 'has closed')
  check('trade: timeLeftShort', timeLeftShort(sec(NOW + 30 * 60_000), NOW) === '30 min left' && timeLeftShort(sec(NOW + 5 * H), NOW) === '5 hours left' && timeLeftShort(sec(NOW + 4 * D), NOW) === '4 days left' && timeLeftShort(sec(NOW - 1), NOW) === 'closed')

  // ── Snapshot ──
  const one = snapshotView([proposalsTile([proposal({})])], NOW)
  check('trade: snapshot headline, one vote', snapshotHeadline(one, NOW, 'UTC') === 'One Uniswap vote is open. It closes on Friday.', snapshotHeadline(one, NOW, 'UTC'))
  const three = snapshotView(
    [proposalsTile([proposal({ id: 'a', endsAt: sec(NOW + 6 * D) }), proposal({ id: 'b', endsAt: sec(NOW + 20 * H), title: 'Soonest' }), proposal({ id: 'c', spaceId: 'aave.eth', spaceName: 'Aave' })])],
    NOW,
  )
  check('trade: snapshot sorts soonest first', three.proposals[0].title === 'Soonest')
  check('trade: snapshot headline, two spaces', snapshotHeadline(three, NOW, 'UTC') === 'Three votes are open in two spaces. The first closes tomorrow.', snapshotHeadline(three, NOW, 'UTC'))
  const same = snapshotView([proposalsTile([proposal({ id: 'a' }), proposal({ id: 'b' })])], NOW)
  check('trade: snapshot headline, one space', snapshotHeadline(same, NOW, 'UTC') === 'Two Uniswap votes are open. The first closes on Friday.')
  const closedOnly = snapshotView([proposalsTile([proposal({ endsAt: sec(NOW - H) })])], NOW)
  check('trade: snapshot drops closed votes', closedOnly.proposals.length === 0 && snapshotHeadline(closedOnly, NOW) === 'No votes are open in the spaces you follow.')
  const none = snapshotView([{ id: 'x-preview', mcpSlug: 's', mcpName: 'S', render: 'empty', title: 't', message: 'm', prompts: [] }], NOW)
  check('trade: snapshot follows nothing', none.followsNothing && snapshotHeadline(none, NOW) === 'You follow no Snapshot space yet.')
  check('trade: snapshot line', snapshotLine(three).startsWith('3 votes are open. Next to close: Soonest'))
  check('trade: vote ask is the tile grammar', voteAsk({ spaceName: 'Uniswap', title: 'X' }) === 'Prepare my vote on the Uniswap proposal "X" — show me the choices.')

  // ── Hyperliquid ──
  check('trade: funding to yearly', Math.abs((fundingYearlyPct(0.0000125) ?? 0) - 10.95) < 1e-9, String(fundingYearlyPct(0.0000125)))
  check('trade: funding words', fmtFundingYearly(0.0000125) === '11.0% a year' && fmtFundingYearly(-0.0000017) === '-1.5% a year', `${fmtFundingYearly(0.0000125)} | ${fmtFundingYearly(-0.0000017)}`)
  const rows = (items: { coin: string; side: 'long' | 'short'; valueUsd: number; pnlUsd: number; leverage: number | null; liqDistancePct: number | null }[], account: number | null): SplashTile => ({
    id: 'hyperliquid-positions',
    mcpSlug: 'hyperliquid-free',
    mcpName: 'Hyperliquid',
    render: 'rows',
    title: 't',
    prompts: [],
    rows: [],
    headline: account != null ? { value: `$${account}`, caption: 'account value' } : undefined,
    viz: items.length ? { kind: 'positions', accountUsd: account, items } : undefined,
  })
  const two = hlView([rows([{ coin: 'ETH', side: 'long', valueUsd: 100, pnlUsd: 30.5, leverage: 3, liqDistancePct: 22.1 }, { coin: 'BTC', side: 'short', valueUsd: 50, pnlUsd: 10.7, leverage: null, liqDistancePct: 40 }], 300)])
  check('trade: hl headline, two up', hlHeadline(two) === 'Two positions open, up $41.20 so far.', hlHeadline(two))
  const down = hlView([rows([{ coin: 'ETH', side: 'long', valueUsd: 100, pnlUsd: -3.1, leverage: 3, liqDistancePct: null }], null)])
  check('trade: hl headline, one down', hlHeadline(down) === 'One position open, down $3.10 so far.', hlHeadline(down))
  check('trade: hl headline, idle account', hlHeadline(hlView([rows([], 120)])) === '$120 in the account, nothing open.', hlHeadline(hlView([rows([], 120)])))
  check('trade: hl headline, no account', hlHeadline(hlView([])) === 'Nothing open. Any market is one sentence away.')
  check('trade: hl closest liquidation', hlClosestLiq(two.positions)?.coin === 'ETH' && hlClosestLiq(down.positions) === null)
  const ctx = new Map([
    ['BTC', { markPx: 65000, prevDayPx: 64000, funding: 0.0000125, dayNtlVlm: 3e9 }],
    ['ETH', { markPx: 1800, prevDayPx: 1820, funding: 0.00001, dayNtlVlm: 7e8 }],
    ['xyz:NVDA', { markPx: 180, prevDayPx: 170, funding: 0, dayNtlVlm: 9e9 }],
    ['DEAD', { markPx: 1, prevDayPx: 1, funding: 0, dayNtlVlm: 0 }],
  ])
  const top = topHlMarkets(ctx, 8)
  check('trade: top markets: main book, by volume, no dead', top.map((m) => m.coin).join(',') === 'BTC,ETH', top.map((m) => m.coin).join(','))
  check('trade: top markets change', fmtSignedPct(top[1].changePct) === '-1.1%' && fmtSignedPct(top[0].changePct) === '+1.6%', `${fmtSignedPct(top[1].changePct)} ${fmtSignedPct(top[0].changePct)}`)
  check('trade: price words', fmtPrice(65182.4) === '$65,182' && fmtPrice(1847.6) === '$1,847.60' && fmtPrice(5.198) === '$5.198' && fmtPrice(0) === '')

  // ── CoW ──
  const cowTile = (r: { label: string; value?: string; sub?: string; progressPct?: number | null }[]): SplashTile => ({
    id: 'cow-activity',
    mcpSlug: 'cow-free',
    mcpName: 'CoW',
    render: 'rows',
    title: 't',
    prompts: [],
    rows: r.map((x) => ({ ...x, actions: [{ label: 'Cancel order', prompt: 'Help me cancel my order' }] })),
  })
  const cv = cowView([cowTile([{ label: 'WETH → USDC · sell', value: '42% filled', sub: 'open on base', progressPct: 42 }, { label: 'UNI → USDC', value: 'filled', sub: 'recent trade on mainnet' }])])
  check('trade: cow rows read back', cv.open.length === 1 && cv.open[0].pair === 'WETH → USDC' && cv.open[0].kind === 'sell' && cv.open[0].chain === 'base' && cv.fills.length === 1 && cv.fills[0].chain === 'mainnet')
  check('trade: cow headline, one part filled', cowHeadline(cv) === 'One order resting, 42% filled.', cowHeadline(cv))
  const life = cowView([cowTile([{ label: 'Lifetime trades', value: '7', sub: 'mainnet · base' }])])
  check('trade: cow lifetime only', life.open.length === 0 && life.lifetime === 7 && cowHeadline(life) === 'No orders resting. Name a price and let it wait.')
  check('trade: cow line', cowLine(cv) === '1 order resting: WETH → USDC.' && cowLine(life) === 'No orders resting.')
  check('trade: cow no history', cowView([]).noHistory && cowHeadline(cowView([])).startsWith('No orders resting'))

  const buy = cowBuyLowerAsk('eth', 2000, { chainWord: 'Base' })
  check('trade: cow buy lower ask grammar', !!buy && /^limit order: buy \d+(\.\d+)? ETH for at most \d+(\.\d+)? USDC on Base$/.test(buy.ask) && buy.at === 1900, buy?.ask)
  check('trade: cow buy needs a price', cowBuyLowerAsk('ETH', 0) === null && cowBuyLowerAsk('ETH', NaN) === null)
  const sell = cowSellHigherAsk('UNI', 5, 2, { chainWord: 'Ethereum' })
  check('trade: cow sell is sized to the holding', !!sell && Number(sell.units) <= 2 && /^limit order: sell [\d.]+ UNI for at least [\d.]+ USDC on Ethereum$/.test(sell.ask), sell?.ask)
  check('trade: cow sell needs a holding', cowSellHigherAsk('UNI', 5, 0) === null)

  const marks = new Map([['ETH', { markPx: 2000 }], ['UNI', { markPx: 5 }]])
  const pr = placeRows(
    [
      { symbol: 'USDC', units: 30, valueUsd: 30, chainWord: 'Base' },
      { symbol: 'UNI', units: 10, valueUsd: 50, chainWord: 'Ethereum' },
      { symbol: 'PEPE', units: 1e9, valueUsd: 40, chainWord: 'Base' },
    ],
    marks,
  )
  check('trade: place rows: ETH first on the USDC chain, held tokens priced, unpriced dropped', pr.map((r) => r.symbol).join(',') === 'ETH,UNI' && /on Base$/.test(pr[0].buy?.ask ?? '') && pr[0].sell === null && /on Ethereum$/.test(pr[1].sell?.ask ?? ''), pr.map((r) => `${r.symbol}:${r.buy?.ask}|${r.sell?.ask}`).join(' / '))
  const noMarks = placeRows([{ symbol: 'UNI', units: 10, valueUsd: 50, chainWord: 'Ethereum' }], new Map())
  check('trade: place rows never invent a price', noMarks.length === 0)
  const weth = placeRows([{ symbol: 'WETH', units: 0.05, valueUsd: 100, chainWord: 'Arbitrum' }], marks)
  check('trade: WETH prices as ETH and sells on its chain', weth.length === 1 && weth[0].symbol === 'WETH' && /sell [\d.]+ WETH .* on Arbitrum$/.test(weth[0].sell?.ask ?? ''), weth[0]?.sell?.ask)

  // ── Sections: no sign button, no tx hook; new copy carries no em dash or arrow ──
  for (const f of ['snapshot', 'hyperliquid', 'cow']) {
    let src = ''
    try {
      src = strip(readFileSync(join(process.cwd(), 'components/apps/sections', `${f}.tsx`), 'utf8'))
    } catch {
      check(`trade: ${f} section readable`, false)
      continue
    }
    check(`trade: ${f} section builds nothing`, !/useSendTransaction|useSignTypedData|useWriteContract|SignOrderButton|SendTxChain|SignVoteButton|signTypedData/.test(src))
    const literals = (src.match(/'[^'\n]*'|`[^`\n]*`|>[^<>{}\n]+</g) ?? []).join('\n')
    check(`trade: ${f} copy has no em dash or arrow`, !/[—→]/.test(literals), (literals.match(/.*[—→].*/g) ?? []).join(' | '))
  }
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /apps-trade-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  appsTradePins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
