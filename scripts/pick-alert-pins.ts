// Pins for lib/pick-alerts — alerts armed from the pick in one tap (GTM
// squad 2026-10-13, lane ALERTS). `npm run pins:pick-alerts`. Pure: no
// server, no DB, no browser. The source pins at the end read the wiring
// (the seats, the door, the server-side base, the bell on /live) so a
// refactor that drops a rule goes red here, not in a stranger's hand.
import { readFileSync } from 'node:fs'
import { parseAlertAsk } from '../lib/markets-ai'
import { MAX_PICK } from '../lib/market-pick'
import {
  ALERTS_CHANGED_EVENT,
  DEFAULT_ALERT_PCT,
  HELD_ARM_KEY,
  HELD_ARM_TTL_MS,
  WATCH_CAP,
  alertFollowAsk,
  alertSymbolFor,
  armGate,
  armLabel,
  armSentence,
  armTicker,
  armedWords,
  cleanPct,
  heldArmRecord,
  isPctAlertOn,
  pickAlertPlan,
  readHeldArm,
  watchPlan,
} from '../lib/pick-alerts'
import { canSellAsk } from '../lib/sell-gate'
import { canTradeAsk } from '../lib/trade-venue-gate'
import type { TradabilityMap } from '../lib/tradability'
import { alertFires, alertLabel, alertRuleProblem } from '../lib/watchlists'

let pass = 0
let fail = 0
function pin(name: string, ok: boolean, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} pick alerts: ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const ASCII = /^[\x20-\x7E]+$/
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

async function main() {
  // ── Constants ─────────────────────────────────────────────────────────
  pin('the default distance is ±5%, the watch cap is the pick\'s own cap', DEFAULT_ALERT_PCT === 5 && WATCH_CAP === MAX_PICK)
  pin('a held arm lives 10 minutes under one key; the change event is named', HELD_ARM_TTL_MS === 10 * 60_000 && HELD_ARM_KEY === 'pantessa.alerts.heldArm.v1' && ALERTS_CHANGED_EVENT === 'pantessa:alerts-changed')

  // ── The symbol the sweep can price ────────────────────────────────────
  pin('a coin the chart names keeps its symbol; a stock perp drops its dex', alertSymbolFor('HYPE') === 'HYPE' && alertSymbolFor('xyz:NVDA') === 'NVDA' && alertSymbolFor('OP') === 'OP' && alertSymbolFor('ETH') === 'ETH')
  pin('a market the sweep cannot price gets NO control (ZK, AZTEC, kPEPE today)', alertSymbolFor('ZK') === null && alertSymbolFor('AZTEC') === null && alertSymbolFor('kPEPE') === null)
  pin('garbage is nothing', alertSymbolFor('') === null && alertSymbolFor('bad token') === null && alertSymbolFor('0xdead') === null && alertSymbolFor('xyz:') === null)
  pin('the ticker a sentence names drops the dex', armTicker('xyz:NVDA') === 'NVDA' && armTicker('HYPE') === 'HYPE')

  // ── The distance ──────────────────────────────────────────────────────
  pin('a percent the API refuses falls to the default', cleanPct(0) === 5 && cleanPct(100) === 5 && cleanPct(-3) === 5 && cleanPct('x') === 5 && cleanPct(NaN) === 5)
  pin('a percent the API accepts is kept, rounded to cents', cleanPct(2.5) === 2.5 && cleanPct(10) === 10 && cleanPct(3.14159) === 3.14)

  // ── The sentence is the chat lane's own grammar ───────────────────────
  pin('"Tell me when NVDA moves 5%" for the stock perp', armSentence('xyz:NVDA') === 'Tell me when NVDA moves 5%' && armSentence('HYPE', 10) === 'Tell me when HYPE moves 10%')
  const parsed = parseAlertAsk(armSentence('HYPE'), 'HYPE', 42)
  pin('lib/markets-ai parseAlertAsk reads the control\'s sentence as the same ±5% rule', !!parsed && parsed.condition === 'pct_move' && parsed.value === 5 && parsed.basePrice === 42 && parsed.symbol === 'HYPE')
  pin('every sentence is pure ASCII', ASCII.test(armSentence('HYPE')) && ASCII.test(armSentence('xyz:NVDA', 2.5)))

  // ── The plan: one pct_move row, no base, the follow ask as the chip ───
  const hype = pickAlertPlan('HYPE')
  pin('one row at ±5%, no base named (the server anchors it)', !!hype && eq(hype.body, { symbol: 'HYPE', condition: 'pct_move', value: 5, actionAsk: 'Long $25 of HYPE on Hyperliquid' }) && !('basePrice' in hype.body))
  pin('the API accepts the body once the server adds its base', !!hype && alertRuleProblem({ ...hype.body, basePrice: 42 }) === null && alertRuleProblem({ ...hype.body, basePrice: null }) !== null)
  pin('±5% is ONE row: the API fires on |move| ≥ 5 either way', alertFires({ symbol: 'HYPE', condition: 'pct_move', value: 5, basePrice: 100 }, 105) && alertFires({ symbol: 'HYPE', condition: 'pct_move', value: 5, basePrice: 100 }, 95) && !alertFires({ symbol: 'HYPE', condition: 'pct_move', value: 5, basePrice: 100 }, 104.9))
  pin('the chip is the battle\'s own follow ask: a coin longs on Hyperliquid, a stock perp buys the stock', alertFollowAsk('HYPE') === 'Long $25 of HYPE on Hyperliquid' && alertFollowAsk('xyz:NVDA') === 'Buy $25 of NVDA' && hype?.chip === 'Long $25 of HYPE on Hyperliquid')
  const nvda = pickAlertPlan('xyz:NVDA')
  pin('the chip passes the venue gate (an empty map offers) and the sell gate (never a sell)', !!nvda && !!hype && canTradeAsk(hype.chip!, {}) && canTradeAsk(nvda.chip!, {}) && canSellAsk(hype.chip!, null) && canSellAsk(nvda.chip!, null))
  const refusing: TradabilityMap = { NVDA: { symbol: 'NVDA', legs: [{ chainId: 4663, side: 'buy', verdict: 'no-venue', reason: 'no pool', checkedAt: new Date().toISOString() }] } }
  const gated = pickAlertPlan('xyz:NVDA', 5, (ask) => canTradeAsk(ask, refusing))
  pin('a measured refusal drops the chip, keeps the alert (notify only)', !!gated && gated.chip === null && gated.body.actionAsk === null && gated.body.symbol === 'NVDA')
  pin('canAct false → no chip; the plan still arms', pickAlertPlan('HYPE', 5, () => false)?.body.actionAsk === null)
  pin('an unpriceable market plans nothing', pickAlertPlan('ZK') === null && pickAlertPlan('kPEPE') === null)
  pin('every chip is pure ASCII', ASCII.test(hype!.chip!) && ASCII.test(nvda!.chip!))

  // ── Already armed ─────────────────────────────────────────────────────
  const live = [{ symbol: 'HYPE', condition: 'pct_move', value: 5, status: 'active' }]
  pin('an active or paused ±5% rule counts; a fired one, another pct, another symbol do not', isPctAlertOn(live, 'HYPE') && isPctAlertOn([{ ...live[0], status: 'paused' }], 'HYPE') && !isPctAlertOn([{ ...live[0], status: 'fired' }], 'HYPE') && !isPctAlertOn(live, 'HYPE', 10) && !isPctAlertOn(live, 'ETH') && !isPctAlertOn(null, 'HYPE'))
  pin('the armed words are the API\'s own label', armedWords('HYPE', 5, 42) === alertLabel({ symbol: 'HYPE', condition: 'pct_move', value: 5, basePrice: 42 }) && /from \$42/.test(armedWords('HYPE', 5, 42)))

  // ── Watch these: one consent over the pick ────────────────────────────
  const w = watchPlan(['ZK', 'OP', 'AZTEC', 'HYPE', 'OP', 'xyz:NVDA'], live, 5, () => true)
  pin('arms every priceable, un-armed pick in order; names what it skipped', eq(w.plans.map((p) => p.symbol), ['OP', 'NVDA']) && eq(w.skipped, { unpriceable: ['ZK', 'AZTEC'], already: ['HYPE'], overCap: [] }))
  pin('the consent sentence counts the rows', w.sentence === 'Watch these 2 · tell me when any moves 5%')
  const many = ['HYPE', 'ETH', 'BTC', 'SOL', 'OP', 'ZRO', 'xyz:NVDA', 'xyz:AAPL', 'xyz:TSLA', 'FARTCOIN', 'SYRUP']
  const capped = watchPlan(many, null)
  pin(`the cap holds at ${WATCH_CAP}; the rest are named overCap`, capped.plans.length === WATCH_CAP && capped.skipped.overCap.length === many.length - WATCH_CAP)
  pin('nothing to arm says so; every-pick-armed says why', watchPlan(['ZK'], null).sentence === 'Nothing to arm' && watchPlan(['HYPE'], live).sentence === 'Nothing to arm · every pick is already watched')
  pin('a market twice in the pick arms once', watchPlan(['HYPE', 'HYPE'], null).plans.length === 1)

  // ── The guest rule (rule 6) ───────────────────────────────────────────
  pin('a SIWE session is ready; loading waits', armGate('authed', '0xabc') === 'ready' && armGate('loading', null) === 'loading')
  pin('a guest AND a connect-only wallet get the door', armGate('guest', null) === 'door' && armGate('guest', '0xabc') === 'door' && armGate('authed', null) === 'door')

  // ── The held arm across the door ──────────────────────────────────────
  const rec = heldArmRecord('HYPE', 5, '/live', 1000)
  pin('a held arm round-trips on its page within the TTL', eq(readHeldArm(rec, '/live', 1000 + HELD_ARM_TTL_MS), { market: 'HYPE', pct: 5, path: '/live', at: 1000 }))
  pin('another page, a stale record, the future, a defect, an unpriceable market → nothing', readHeldArm(rec, '/', 2000) === null && readHeldArm(rec, '/live', 1000 + HELD_ARM_TTL_MS + 1) === null && readHeldArm(rec, '/live', 999) === null && readHeldArm('{"v":2}', '/live', 1000) === null && readHeldArm('nope', '/live', 1000) === null && readHeldArm(null, '/live') === null && readHeldArm(heldArmRecord('ZK', 5, '/live', 1000), '/live', 1000) === null)
  pin('the labels per seat', armLabel('scoreboard', 'HYPE') === '±5%' && armLabel('deck', 'xyz:NVDA') === 'Alert NVDA ±5%' && armLabel('strip', 'HYPE') === 'Watch these')

  // ── Wiring (source) ───────────────────────────────────────────────────
  const arm = src('components/live/ArmAlert.tsx')
  pin('ArmAlert opens the UNIFIED door (CreateAccountButton), never a raw connect modal, with no redirectTo', /from '@\/components\/CreateAccountButton'/.test(arm) && !/openConnectModal/.test(arm) && !/redirectTo=/.test(arm))
  pin('ArmAlert arms through the shared instance or POST /api/alerts with the session cookie — nothing else', /shared\.create\(p\.body\)/.test(arm) && /fetch\('\/api\/alerts'/.test(arm) && /credentials: 'same-origin'/.test(arm) && !/walletAddress|owner:/.test(arm))
  pin('ArmAlert gates the chip with the venue gate AND the sell gate', /canTradeAsk\(ask, tradable\) && canSellAsk\(ask, null\)/.test(arm))
  pin('every arm wears a journey name', /data-journey=\{`Arm alert \$\{market\}`\}/.test(arm) && /data-journey="Watch these"/.test(arm))
  pin('a provider-less arm tells the page\'s bell (the deck on /)', /dispatchEvent\(new Event\(ALERTS_CHANGED_EVENT\)\)/.test(arm))
  pin('the held arm is claimed on read (removeItem before it runs) and runs once', /removeItem\(HELD_ARM_KEY\)/.test(arm) && /ranHeldRef\.current = true/.test(arm))
  const bell = src('components/markets/watchlist/useWatchlists.ts')
  pin('useAlerts re-reads on the change event', /addEventListener\(ALERTS_CHANGED_EVENT/.test(bell) && /removeEventListener\(ALERTS_CHANGED_EVENT/.test(bell))
  const store = src('lib/watchlists-store.ts')
  const create = store.slice(store.indexOf('export async function createAlert'), store.indexOf('export async function setAlertStatus'))
  pin('createAlert anchors a base-less pct_move on ITS OWN quote read, before the rule check', /rule\.condition === 'pct_move' && rule\.basePrice == null/.test(create) && /readQuotes\(\[symbol\]\)/.test(create) && create.indexOf('readQuotes([symbol])') < create.indexOf('alertRuleProblem(rule)'))
  pin('a base-less pct_move with no live price is refused by name (409), never stored', /No live price for \$\{symbol\}/.test(create) && /status: 409/.test(create))
  const battle = src('components/live/Battle.tsx')
  const deck = src('components/home/Deck.tsx')
  pin('the seats: the scoreboard row and the deck\'s bar', /<ArmAlert market=\{army\.market\} seat="scoreboard" \/>/.test(battle) && /<ArmAlert market=\{bookMarket\} seat="deck" \/>/.test(deck))
  const feed = src('components/live/LiveFeed.tsx')
  const strip = src('components/markets/shell/MarketsTopStrip.tsx')
  pin('the bell is on /live: both views render MarketsSide, whose strip mounts RailAlerts', /<MarketsSide label="War log">/.test(battle) && /<MarketsSide label="Triggers">/.test(feed) && /<RailAlerts \/>/.test(strip))
  const css = src('components/live/arm-alert.css')
  pin('44px under a coarse pointer, tokens only', /@media \(pointer: coarse\)[\s\S]*min-height: 44px/.test(css) && !/#[0-9a-f]{6}\b(?![^;]*\))/i.test(css.replace(/var\([^)]*\)/g, '')))

  console.log(`\npick alert pins: ${pass} passed / ${fail} failed`)
  if (fail) process.exit(1)
}
main()
