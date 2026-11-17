// Pins for "never offer an automatic sell that cannot be armed" (2026-11-17,
// Nate on the apps page's "Protect spot ETH" card: "do we actually set stop
// losses?"). The Spot Guardian and the DCA autopilot spend through a Coinbase
// spend permission on Base; their builders refuse unless CDP is configured and
// CDP_SPEND_NETWORK=base, which prod does not set. lib/autopilot-live is the
// one switch every offer reads; next.config stamps it at build time.
//
// Each pin runs the same composer with the switch OFF (what prod builds today)
// and ON (what prod builds once the env is set), so it holds whichever env
// this machine has. No server, no DB:
//   npx tsx scripts/autosell-pins.ts
import { autoSellLive, autoSellStamp, isDcaAutopilotArm } from '../lib/autopilot-live'
import { chartPairFor } from '../lib/charts'
import { actionKindsFor, composeLineActions } from '../lib/chart-actions'
import { composeBriefingItems, type BriefingInputs } from '../lib/briefing'
import { fenceGuardianCoin } from '../lib/hl-guardian-fence'
import { parseGuardianArm } from '../lib/hl-guardian'
import { canSellAsk } from '../lib/sell-gate'
import { venuesFor } from '../lib/symbol-venues'
import { verdictChips } from '../lib/technicals'
import { execSidesFor, sidesFor } from '../lib/trade-asks'
import { canTradeAsk } from '../lib/trade-venue-gate'
import type { HeldSymbol } from '../lib/watchlists'

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++
  else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function withSwitch<T>(on: boolean, fn: () => T): T {
  const prev = process.env.NEXT_PUBLIC_SPOT_AUTOSELL
  process.env.NEXT_PUBLIC_SPOT_AUTOSELL = on ? '1' : ''
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SPOT_AUTOSELL
    else process.env.NEXT_PUBLIC_SPOT_AUTOSELL = prev
  }
}

export function runAutosellPins(): { pass: number; fail: number; failures: string[] } {
  // ── the stamp mirrors the builders' own condition ──
  const keys = { CDP_API_KEY_ID: 'a', CDP_API_KEY_SECRET: 'b', CDP_WALLET_SECRET: 'c' }
  check('stamp: keys + base = on', autoSellStamp({ ...keys, CDP_SPEND_NETWORK: 'base' }) === '1')
  check('stamp: keys, no network = off (prod today)', autoSellStamp({ ...keys }) === '')
  check('stamp: base-sepolia = off', autoSellStamp({ ...keys, CDP_SPEND_NETWORK: 'base-sepolia' }) === '')
  check('stamp: network without keys = off', autoSellStamp({ CDP_SPEND_NETWORK: 'base' }) === '')
  check('switch reads the stamp', withSwitch(false, autoSellLive) === false && withSwitch(true, autoSellLive) === true)

  // ── the DCA autopilot arm sentence ──
  for (const s of ['make my ETH dca autonomous', 'arm my ETH dca', 'Make my AAPL DCA autonomous']) check(`dca arm: "${s}"`, isDcaAutopilotArm(s))
  for (const s of ['turn off my ETH dca autopilot', 'pause my ETH dca', 'Buy $10 of ETH every week', 'cancel my ETH dca']) check(`not a dca arm: "${s}"`, !isDcaAutopilotArm(s))

  // ── the chip gates ──
  const spotStops = ['Protect my spot ETH with a 10% stop loss', 'Protect my UNI in my wallet with a 5% stop', 'protect my spot ETH if it drops to $2300']
  for (const ask of spotStops) {
    check(`canTradeAsk off: "${ask}"`, withSwitch(false, () => canTradeAsk(ask, null)) === false)
    check(`canTradeAsk on: "${ask}"`, withSwitch(true, () => canTradeAsk(ask, null)) === true)
  }
  check('canTradeAsk off: dca arm', withSwitch(false, () => canTradeAsk('make my ETH dca autonomous', null)) === false)
  check('canTradeAsk off: dca disarm still offered', withSwitch(false, () => canTradeAsk('turn off my ETH dca autopilot', null)) === true)
  // What is NOT gated: the HL Guardian, swaps, CoW limits.
  for (const ask of ['Protect my HYPE long with a 5% stop', 'Buy $25 of ETH', 'Sell all my UNI', 'limit order: sell 0.1 ETH for at least 300 USDC']) {
    check(`canTradeAsk off keeps: "${ask}"`, withSwitch(false, () => canTradeAsk(ask, null)) === true)
  }
  const held: HeldSymbol[] = [{ symbol: 'ETH', amount: 1, chainIds: [8453], guardable: true } as HeldSymbol]
  check('canSellAsk off: guardable spot ETH', withSwitch(false, () => canSellAsk('Protect my spot ETH with a 10% stop loss', held)) === false)
  check('canSellAsk on: guardable spot ETH', withSwitch(true, () => canSellAsk('Protect my spot ETH with a 10% stop loss', held)) === true)

  // ── the symbol page ──
  const uni = chartPairFor('UNI')
  const hype = chartPairFor('HYPE')
  if (!uni || !hype) throw new Error('chart pairs missing')
  check('sidesFor off: coin has no protect', !withSwitch(false, () => sidesFor(uni)).includes('protect'))
  check('sidesFor on: coin has protect', withSwitch(true, () => sidesFor(uni)).includes('protect'))
  check('sidesFor off: perp keeps protect (Guardian)', withSwitch(false, () => sidesFor(hype)).includes('protect'))
  check('execSidesFor off: coin has no protect', !withSwitch(false, () => execSidesFor(uni)).includes('protect'))
  check('execSidesFor off: perp keeps protect', withSwitch(false, () => execSidesFor(hype)).includes('protect'))
  const spotRow = (on: boolean) => withSwitch(on, () => venuesFor('UNI', uni)).some((r) => r.kind === 'protect' && r.venue === 'pantessa')
  check('venuesFor off: no "Spot stop on Base" row', !spotRow(false))
  check('venuesFor on: the row', spotRow(true))

  // ── the chart's drawn levels ──
  check('actionKindsFor off: coin has no stop', !withSwitch(false, () => actionKindsFor('UNI', 'coinbase')).has('stop'))
  check('actionKindsFor off: perp keeps stop', withSwitch(false, () => actionKindsFor('HYPE', 'hyperliquid')).has('stop'))
  const level = (on: boolean) => withSwitch(on, () => composeLineActions({ symbol: 'UNI', source: 'coinbase', price: 6, last: 7 } as Parameters<typeof composeLineActions>[0]))
  check('level off: no "Stop under this"', !level(false).some((o) => /protect my spot/i.test(o.action.ask)))
  check('level on: "Stop under this"', level(true).some((o) => /protect my spot/i.test(o.action.ask)))

  // ── technicals verdict chips ──
  for (const rating of ['strong_sell', 'strong_buy', 'neutral'] as const) {
    const chips = withSwitch(false, () => verdictChips({ symbol: 'UNI', source: 'coinbase', rating, support: 6, resistance: 8 }))
    check(`verdictChips off (${rating}): no spot stop`, !chips.some((c) => /protect my spot/i.test(c.ask)), chips.map((c) => c.ask).join(' | '))
    check(`verdictChips off (${rating}): still offers something`, chips.length > 0)
  }
  check('verdictChips on: spot stop back', withSwitch(true, () => verdictChips({ symbol: 'UNI', source: 'coinbase', rating: 'strong_buy' })).some((c) => /protect my spot/i.test(c.ask)))
  check('verdictChips off: perp keeps the Guardian', withSwitch(false, () => verdictChips({ symbol: 'HYPE', source: 'hyperliquid', rating: 'strong_buy' })).some((c) => /protect my HYPE long/i.test(c.ask)))

  // ── the apps page's "needs you" row (Nate's screenshot) ──
  const inputs: BriefingInputs = {
    firedRecently: [],
    positions: [],
    protectedCoins: [],
    spotProtectedSymbols: [],
    funding: { sources: [{ chainId: 8453, chainWord: 'Base', token: 'ETH', balance: 0.05, usd: 152.24 }], stranded: [], readChains: [8453], failedChains: [] } as unknown as BriefingInputs['funding'],
    aave: null,
    failed: [],
  }
  const unwatched = (on: boolean) => withSwitch(on, () => composeBriefingItems(inputs)).some((r) => /unwatched/.test(r.label))
  check('briefing off: no "unwatched · no stop loss" row', !unwatched(false))
  check('briefing on: the row', unwatched(true))

  // ── the HL Guardian's redirect for a non-HL coin ──
  const arm = parseGuardianArm('Protect my UNI long with a 10% stop')
  check('guardian arm parses', !!arm)
  if (arm) {
    const off = withSwitch(false, () => fenceGuardianCoin(arm, { listed: new Set(['HYPE', 'BTC']), delisted: new Set() }))
    const chips = off && 'chips' in off ? (off.chips as { resume: string }[]) : []
    check('guardian redirect off: no spot chip', !chips.some((c) => /spot/i.test(c.resume)))
    const on = withSwitch(true, () => fenceGuardianCoin(arm, { listed: new Set(['HYPE', 'BTC']), delisted: new Set() }))
    check('guardian redirect on: the spot chip', !!on && 'chips' in on && (on.chips as { resume: string }[]).some((c) => /spot/i.test(c.resume)))
  }

  return { pass, fail, failures }
}

if (process.argv[1] && /autosell-pins/.test(process.argv[1])) {
  const r = runAutosellPins()
  for (const f of r.failures) console.log(`❌ ${f}`)
  console.log(`autosell pins: ${r.pass} passed, ${r.fail} failed`)
  process.exit(r.fail ? 1 : 0)
}
