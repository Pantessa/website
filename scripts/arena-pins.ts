// Pins for lib/arena — the words of the fight (GTM squad 2026-10-13, lane
// ARENA): the challenge, the stage headline, the shareable war-log line, the
// first-run sheet's rows and its once-per-browser rule. `npm run pins:arena`.
// Pure: no server, no DB, no browser. Also reads components/live/PickSheet.tsx
// and arena.css as text for the rules a component must keep (nothing on the
// server frame, no chat route, a journey label on every control).
import { readFileSync } from 'node:fs'
import { ARMY_SLICE, MAX_PICK } from '../lib/market-pick'
import { DEFAULT_PICK, FRONT_WINDOWS, PICK_MODES } from '../lib/battle'
import {
  CHALLENGE_TAIL, EMPTY_CHALLENGE, FILL_FROM_VENUE, NO_GROUND_HEADLINE, PICK_SHEET_OFFER_DELAY_MS, PICK_SHEET_SEEN_KEY, SOLO_TAIL,
  arenaHeadline, challengeLine, fillRows, fmtUtcMinute, hillLine, namesLine, pickSheetBlurb, pickSheetTitle, pickTriggerWord, shouldOfferFirstRun, sinceWords, warLogLine, windowWord,
} from '../lib/arena'

let pass = 0
let fail = 0
function pin(name: string, ok: boolean, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} arena: ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

async function main() {
  // ── The challenge ─────────────────────────────────────────────────────
  pin('the tails are ASCII words (a tweet, a title, an alt — never a surprise); the separator is the house dot', /^[\x20-\x7e]+$/.test(CHALLENGE_TAIL) && /^[\x20-\x7e]+$/.test(SOLO_TAIL) && EMPTY_CHALLENGE === `Pick your markets · ${CHALLENGE_TAIL}`)
  pin("three armies: 'ZK vs OP vs AZTEC · 1h · who's winning'", challengeLine(['ZK', 'OP', 'AZTEC'], '1h') === "ZK vs OP vs AZTEC · 1h · who's winning", challengeLine(['ZK', 'OP', 'AZTEC'], '1h'))
  pin('a stock perp wears its dex in the challenge', challengeLine(['xyz:NVDA', 'HYPE'], '24h') === `NVDA·xyz vs HYPE · 24h · ${CHALLENGE_TAIL}`)
  pin('one market is not a fight: it asks where it stands', challengeLine(['HYPE'], '15m') === `HYPE · 15m · ${SOLO_TAIL}`)
  pin('an empty pick reads the empty challenge, never a blank', challengeLine([], '1h') === EMPTY_CHALLENGE && EMPTY_CHALLENGE.includes(CHALLENGE_TAIL))
  pin('since open names the window in words', challengeLine(['A', 'B'], 'open') === `A vs B · since open · ${CHALLENGE_TAIL}` && FRONT_WINDOWS.every((w) => windowWord(w.id) === w.label))
  const eight = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  pin(`past the slice (${ARMY_SLICE}) the challenge names five and counts the rest`, challengeLine(eight, '1h') === `A vs B vs C vs D vs E +3 · 1h · ${CHALLENGE_TAIL}` && namesLine(eight) === 'A · B · C · D · E +3' && namesLine(['A', 'B']) === 'A · B')

  // ── The headline ──────────────────────────────────────────────────────
  pin("'OP leads · +8.88% since 1h ago'", arenaHeadline({ leader: 'OP', groundPct: 8.88, window: '1h' }) === 'OP leads · +8.88% since 1h ago', arenaHeadline({ leader: 'OP', groundPct: 8.88, window: '1h' }))
  pin('every army under water: the leader holds up best', arenaHeadline({ leader: 'OP', groundPct: -1.2, window: '4h', armies: 3 }) === 'OP holds up best · −1.20% since 4h ago')
  pin('a lone army stands, leads nobody', arenaHeadline({ leader: 'HYPE', groundPct: 0.5, window: '15m', armies: 1 }) === 'HYPE stands at +0.50% since 15m ago')
  pin('a partial window is said (the series starts after its edge)', arenaHeadline({ leader: 'ZK', groundPct: 2, window: '24h', partial: true }) === 'ZK leads · +2.00% since the first price held (24h window)' && sinceWords('open', true) === 'since open')
  pin('no leader or no ground → the waiting words', arenaHeadline({ leader: null, groundPct: 1, window: '1h' }) === NO_GROUND_HEADLINE && arenaHeadline({ leader: 'A', groundPct: null, window: '1h' }) === NO_GROUND_HEADLINE && arenaHeadline({ leader: 'A', groundPct: NaN, window: '1h' }) === NO_GROUND_HEADLINE)
  pin('zero ground prints as 0.00% (fmtPct), still a lead', arenaHeadline({ leader: 'A', groundPct: 0, window: '1h' }) === 'A leads · 0.00% since 1h ago')
  pin('the hill is named or open', hillLine('HYPE') === 'HYPE holds the hill' && hillLine('xyz:NVDA') === 'NVDA·xyz holds the hill' && hillLine(null) === 'the hill is open')

  // ── The war log ───────────────────────────────────────────────────────
  const at = Date.UTC(2026, 9, 13, 14, 2, 31)
  pin('the UTC minute, zero-padded, Z', fmtUtcMinute(at) === '14:02Z' && fmtUtcMinute(Date.UTC(2026, 0, 1, 0, 0, 0)) === '00:00Z' && fmtUtcMinute(NaN) === '—')
  pin('a burst: dollars · side · market · price · minute', warLogLine({ kind: 'burst', market: 'HYPE', side: 'buy', usd: 120_000, price: 42.1, at }) === '$120.00K bought on HYPE in one fill at 42.1 · 14:02Z', warLogLine({ kind: 'burst', market: 'HYPE', side: 'buy', usd: 120_000, price: 42.1, at }))
  pin('a sell burst says sold; a stock perp wears its dex', warLogLine({ kind: 'burst', market: 'xyz:NVDA', side: 'sell', usd: 9_500, price: 181.25, at }) === '$9.50K sold on NVDA·xyz in one fill at 181.25 · 14:02Z')
  pin('a lead change names the runner-up when it has ground', warLogLine({ kind: 'lead', market: 'HYPE', pct: 2.1, second: { market: 'ETH', pct: 1 }, at }) === 'HYPE took the lead at +2.10%, ahead of ETH at +1.00% · 14:02Z')
  pin('a lead change with no runner-up ground stands alone', warLogLine({ kind: 'lead', market: 'HYPE', pct: 2.1, second: { market: 'ETH', pct: null }, at }) === 'HYPE took the lead at +2.10% · 14:02Z' && warLogLine({ kind: 'lead', market: 'HYPE', pct: 2.1, at }) === 'HYPE took the lead at +2.10% · 14:02Z')

  // ── The first-run sheet ───────────────────────────────────────────────
  const rows = fillRows({ watch: ['UNI', 'ETH'], held: ['ETH', 'HYPE', 'BTC'], gainers: ['ZK', 'OP', 'AZTEC', 'KAITO'], biggest: ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP'] })
  pin('four rows in order: watchlist · wallet · gainers · biggest', eq(rows.map((r) => r.id), ['watchlist', 'held', 'gainers', 'biggest']))
  pin("the rows' words: pickSourceWord's for yours, the venue's PICK_MODES labels for its lists", rows[0].label === 'From your watchlist' && rows[1].label === 'From your wallet' && rows[2].label === PICK_MODES[0].label && rows[3].label === PICK_MODES[1].label)
  pin(`the venue's lists fill ${FILL_FROM_VENUE} (= lib/battle DEFAULT_PICK); yours fill up to MAX_PICK`, FILL_FROM_VENUE === DEFAULT_PICK && eq(rows[2].markets, ['ZK', 'OP', 'AZTEC']) && eq(rows[3].markets, ['BTC', 'ETH', 'SOL']) && fillRows({ watch: eight.concat(['I', 'J']), held: [], gainers: [], biggest: [] })[0].markets.length === MAX_PICK)
  pin('a row that resolves to nothing is OMITTED, never a dead button', eq(fillRows({ watch: [], held: [], gainers: ['A'], biggest: [] }).map((r) => r.id), ['gainers']) && fillRows({ watch: [], held: [], gainers: [], biggest: [] }).length === 0)
  pin('every row carries a journey label of the shape "<Verb> <object>"', rows.every((r) => /^[A-Z][a-z]+ [a-z][a-z ]+$/.test(r.journey)) && new Set(rows.map((r) => r.journey)).size === rows.length)

  pin('the sheet offers itself only on an untouched row, only once', shouldOfferFirstRun({ source: 'fallback', seen: false }) && shouldOfferFirstRun({ source: 'venue', seen: false }) && shouldOfferFirstRun({ source: 'watchlist', seen: false }) && shouldOfferFirstRun({ source: 'held', seen: false }) && !shouldOfferFirstRun({ source: 'hand', seen: false }) && !shouldOfferFirstRun({ source: 'url', seen: false }) && !shouldOfferFirstRun({ source: 'fallback', seen: true }))
  pin('the once flag has its own key and the offer waits for the page to paint', PICK_SHEET_SEEN_KEY === 'pantessa.markets.picksheet.v1' && PICK_SHEET_OFFER_DELAY_MS >= 600 && PICK_SHEET_OFFER_DELAY_MS <= 3000)
  pin('titles and blurbs per seat say the slice', pickSheetTitle('battle') === 'Pick your armies' && pickSheetTitle('pulse') === 'Pick your markets' && pickSheetBlurb('battle').includes(`first ${ARMY_SLICE}`) && pickSheetBlurb('tape').includes(`first ${ARMY_SLICE}`) && pickSheetBlurb('tape').includes(`${MAX_PICK}`))
  pin('the trigger reads Pick on an empty row, Change on a filled one', pickTriggerWord([]) === 'Pick' && pickTriggerWord(['A']) === 'Change')

  // ── The component's rules, read as text ───────────────────────────────
  const sheet = readFileSync('components/live/PickSheet.tsx', 'utf8')
  const css = readFileSync('components/live/arena.css', 'utf8').replace(/\/\*[^]*?\*\//g, '')
  pin('the sheet renders nothing on the server (the deck frame stays byte-identical): mounted gate before any markup', /const \[mounted, setMounted\] = useState\(false\)/.test(sheet) && /if \(!mounted\) return null/.test(sheet))
  pin('the sheet never fires a chat turn and only writes the pick by hand', !/fetch\(['"`]\/api\/chat/.test(sheet) && !/openDoor|useConnectToAct|composerSend/.test(sheet) && /pick\.set\([^)]*'hand'\)/.test(sheet))
  const controls = sheet.match(/<button[\s\S]*?(?<!=)>(?!=)/g) ?? []
  pin('every button in the sheet carries a journey label', controls.length >= 4 && controls.every((b) => /data-journey=/.test(b)), `${controls.filter((b) => !/data-journey=/.test(b)).length} of ${controls.length} unlabeled`)
  pin('the once flag is written on offer AND on dismiss, read after mount', (sheet.match(/writePickSheetSeen\(/g) ?? []).length >= 2 && /readPickSheetSeen\(\)/.test(sheet) && /PICK_SHEET_OFFER_DELAY_MS/.test(sheet))
  pin('a phone gets a bottom sheet with 44px rows and safe-area padding; a desktop a popover', /@media \(max-width: 640px\)/.test(css) && /min-height: 44px/.test(css) && /env\(safe-area-inset-bottom/.test(css) && /position: absolute/.test(css) && /position: fixed/.test(css))
  pin('the typed add goes through pick.add (lib/battle resolveMarket against the universe); unknown names are said', /pick\.add\(/.test(sheet) && /unknown/.test(sheet) && /lists no market/.test(sheet))
  pin('the panel is mounted only while open (a closed seat reads nothing); the scrim and Esc close it', /\{open && <PickSheetPanel/.test(sheet) && /e\.key === 'Escape'/.test(sheet) && /picksheet__scrim/.test(sheet))

  console.log(`\narena pins: ${pass} passed / ${fail} failed`)
  if (fail) process.exit(1)
}
main()
