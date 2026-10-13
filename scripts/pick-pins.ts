// Pins for lib/market-pick — the one market selection every live surface
// reads (GTM squad 2026-10-13, lane PICK). `npm run pins:pick`. Pure: no
// server, no DB, no browser.
import { ARMY_MEMORY_KEY, FALLBACK_ARMIES, MAX_ARMIES } from '../lib/battle'
import { LIVE_MARKETS_KEY } from '../lib/live-markets'
import {
  ARMY_SLICE, LEGACY_PICK_KEYS, MARKET_PICK_KEY, MAX_PICK,
  armiesOf, armySliceNote, lensFor, migrateLegacyPick, normalizeMarket, openingPick, parseMarketPick, parsePickParam, pickParam, pickSourceWord, removeFromPick, serializeMarketPick,
} from '../lib/market-pick'

let pass = 0
let fail = 0
function pin(name: string, ok: boolean, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} pick: ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

async function main() {
  pin('one key, two legacy keys named', MARKET_PICK_KEY === 'pantessa.markets.pick.v1' && eq(LEGACY_PICK_KEYS, [ARMY_MEMORY_KEY, LIVE_MARKETS_KEY]))
  pin('the battle slice is lib/battle\'s cap', ARMY_SLICE === MAX_ARMIES && MAX_PICK > ARMY_SLICE)

  pin('normalize keeps the venue case, lowers xyz:', normalizeMarket('kPEPE') === 'kPEPE' && normalizeMarket('XYZ:NVDA') === 'xyz:NVDA' && normalizeMarket('0xdead') === null && normalizeMarket('') === null)

  const round = parseMarketPick(serializeMarketPick(['HYPE', 'xyz:NVDA', 'HYPE', 'bad token'], 123))
  pin('memory round-trips, dedupes, drops bad shapes, is a hand\'s', !!round && eq(round.markets, ['HYPE', 'xyz:NVDA']) && round.source === 'hand' && round.at === 123)
  pin('an empty memory is real', eq(parseMarketPick(serializeMarketPick([], 5))?.markets, []))
  pin('a defect reads as nothing', parseMarketPick('{"v":2,"markets":["ETH"]}') === null && parseMarketPick('nope') === null && parseMarketPick(null) === null)
  pin('the memory caps at MAX_PICK', parseMarketPick(serializeMarketPick(Array.from({ length: 20 }, (_, i) => `M${i}`)))?.markets.length === MAX_PICK)

  const armies = JSON.stringify({ v: 1, armies: ['ZK', 'OP', 'AZTEC'], pick: 'gainers', at: 7 })
  const live = JSON.stringify({ v: 1, own: ['UNI', 'ETH'], at: 9 })
  pin('legacy: the battle\'s field wins over the live row', eq(migrateLegacyPick({ armies, live })?.markets, ['ZK', 'OP', 'AZTEC']) && migrateLegacyPick({ armies, live })?.at === 7)
  pin('legacy: the live row carries when no field was set', eq(migrateLegacyPick({ armies: null, live })?.markets, ['UNI', 'ETH']))
  pin('legacy: an empty live row carries as empty', eq(migrateLegacyPick({ armies: null, live: JSON.stringify({ v: 1, own: [], at: 1 }) })?.markets, []))
  pin('legacy: nothing → null', migrateLegacyPick({ armies: null, live: null }) === null)

  pin('?t= parses in any case, dedupes, caps', eq(parsePickParam('zk,XYZ:nvda,ZK,OP'), ['ZK', 'xyz:NVDA', 'OP']) && parsePickParam(null).length === 0 && parsePickParam(Array.from({ length: 12 }, (_, i) => `A${i}`).join(',')).length === MAX_PICK)
  pin('the param round-trips', eq(parsePickParam(pickParam(['HYPE', 'xyz:NVDA'])), ['HYPE', 'xyz:NVDA']))
  pin('the lens must be a pick', lensFor('HYPE', ['HYPE', 'ETH']) === 'HYPE' && lensFor('BTC', ['HYPE', 'ETH']) === null && lensFor(null, ['HYPE']) === null)

  const base = { url: [] as string[], memory: null, watch: [] as string[], held: null as string[] | null, venue: ['A', 'B', 'C'], waitForHeld: false }
  pin('opening: url first', openingPick({ ...base, url: ['ZK'], memory: { markets: ['X'], source: 'hand', at: 1 } })?.source === 'url')
  pin('opening: memory before the watchlist (empty counts)', openingPick({ ...base, memory: { markets: [], source: 'hand', at: 1 }, watch: ['UNI'] })?.source === 'hand')
  pin('opening: watchlist before holdings', openingPick({ ...base, watch: ['UNI'], held: ['ETH'] })?.source === 'watchlist')
  pin('opening: holdings before the venue', openingPick({ ...base, held: ['ETH'] })?.source === 'held')
  pin('opening: holds for a wallet that may still answer', openingPick({ ...base, waitForHeld: true }) === null)
  pin('opening: the venue, else the fallback trio', openingPick(base)?.source === 'venue' && eq(openingPick({ ...base, venue: [] })?.markets, FALLBACK_ARMIES))

  pin('the first five march; the note says so past five', eq(armiesOf(['A', 'B', 'C', 'D', 'E', 'F']), ['A', 'B', 'C', 'D', 'E']) && armySliceNote(['A', 'B', 'C', 'D', 'E', 'F']) === 'the first 5 of your 6 march' && armySliceNote(['A']) === null)
  pin('remove is exact', eq(removeFromPick(['A', 'B'], 'A'), ['B']))
  pin('source words', pickSourceWord('watchlist') === 'from your watchlist' && pickSourceWord('held') === 'from your wallet' && pickSourceWord('hand') === 'as you left them' && pickSourceWord('url') === null && pickSourceWord('venue') === null)

  console.log(`\npick pins: ${pass} passed / ${fail} failed`)
  if (fail) process.exit(1)
}
main()
