// Pins for THE GUIDE (lib/guide, components/guide): the hints and where
// they may sit, the pick rules (one per load, shown < GUIDE_MAX_SHOWS,
// dismissed never returns, off, the quiet surface), the record (round-trips;
// garbage reads as fresh), the spine dots, the honesty rules (every fee
// number derived from lib/fees; every ask the copy quotes builds natively
// through the ladder replica; no hint claims something happened), and the
// one-line seats in the files that mount them. Pure: no server, no socket,
// no DB. Runnable alone:
//   npx tsx scripts/guide-pins.ts
// Squad front-door (2026-10-06), GUIDE lane.
import { readFileSync } from 'node:fs'
import {
  CREATOR_SPLIT_WORD,
  GUIDE_COMPACT_SURFACES,
  GUIDE_FRESH,
  GUIDE_HINTS,
  GUIDE_MAX_SHOWS,
  GUIDE_QUIET_MS,
  GUIDE_RECORD_MAX_BYTES,
  GUIDE_STORAGE_KEY,
  GUIDE_SURFACES,
  GUIDE_TOTAL,
  GUIDE_VISITS,
  compactOnPhone,
  dotFor,
  freshGuideState,
  guideCta,
  guideIndexOf,
  markDismissed,
  markOff,
  markShown,
  nextHint,
  noteEvent,
  readGuideState,
  renderGuideText,
  serializeGuideState,
  type GuideCtx,
  type GuideHintId,
  type GuideState,
  type GuideSurface,
} from '../lib/guide'
import { CREATOR_FEE_SPLIT, LINK_FEE_PCT, LINK_SWAP_FEE_BPS, SWAP_FEE_PCT, feePctLabel } from '../lib/fees'
import { composeAsk } from '../lib/trade-asks'
import { chartPairFor } from '../lib/charts'
import { LINKS_STUDIO_HREF } from '../lib/links-href'
import { WALLET_PAGE_HREF } from '../lib/wallet-page'
import { isPublicAppPath } from '../lib/app-entry'
import { simulateLadder } from './ask-ladder'
import { CHATS_DOOR, FIRST_RUN_ASKS, I_STEPS, JOBS_DOOR, LINKS_DOOR, WALLET_DOOR, WALLET_EMPTY_DOOR } from '../lib/first-run'

type Check = (name: string, ok: boolean, extra?: string) => void

const NOW = 1_791_292_800_000 // 2026-10-06 ~11:20Z
const src = (p: string) => readFileSync(p, 'utf8')
const count = (hay: string, needle: string) => hay.split(needle).length - 1

const hint = (id: GuideHintId) => GUIDE_HINTS.find((h) => h.id === id)!
const first = (surface: GuideSurface, state: GuideState, ctx: GuideCtx = {}, now = NOW) => nextHint(surface, state, ctx, now)?.id ?? null
const deepEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A busy record: everything stamped. */
function busyState(): GuideState {
  let s = freshGuideState()
  s = markShown(s, 'pulse', NOW - 5_000)
  s = markShown(s, 'chart', NOW - 4_000)
  s = markDismissed(s, 'chart', 'symbol', NOW - 3_000)
  s = noteEvent(s, 'visited:home', NOW - 6_000)
  s = noteEvent(s, 'visited:jobs', NOW - 2_000)
  s = noteEvent(s, 'chip', NOW - 1_500)
  s = noteEvent(s, 'connected', NOW - 1_000)
  return s
}

export function guidePins(check: Check): void {
  // ── The hints ─────────────────────────────────────────────────────────
  const ids = GUIDE_HINTS.map((h) => h.id)
  check(
    'guide: seven hints in the brief\'s priority order (pulse · chart · triggers · links · jobs · wallet · alerts), ids unique, every surface a GuideSurface, the storage key fixed',
    ids.join(',') === 'pulse,chart,triggers,links,jobs,wallet,alerts' &&
      new Set(ids).size === 7 &&
      GUIDE_TOTAL === 7 &&
      GUIDE_HINTS.every((h) => h.surfaces.length > 0 && h.surfaces.every((s) => GUIDE_SURFACES.includes(s))) &&
      GUIDE_STORAGE_KEY === 'pantessa.guide.v1' &&
      guideIndexOf('pulse') === 1 &&
      guideIndexOf('alerts') === 7,
    ids.join(','),
  )
  check(
    'guide: a fresh browser leads with the surface\'s own lesson — pulse on the splash, ask-the-chart on a symbol, triggers on the tape, links in the chat and on the wallet page',
    first('home', GUIDE_FRESH) === 'pulse' && first('symbol', GUIDE_FRESH) === 'chart' && first('live', GUIDE_FRESH) === 'triggers' && first('chat', GUIDE_FRESH) === 'links' && first('wallet', GUIDE_FRESH) === 'links',
    [first('home', GUIDE_FRESH), first('symbol', GUIDE_FRESH), first('live', GUIDE_FRESH), first('chat', GUIDE_FRESH), first('wallet', GUIDE_FRESH)].join(','),
  )

  // ── Honesty: numbers derive from lib/fees; no claim that something happened ──
  const allowedPct = new Set([LINK_FEE_PCT, SWAP_FEE_PCT, feePctLabel(LINK_SWAP_FEE_BPS * CREATOR_FEE_SPLIT)])
  const texts: string[] = []
  for (const h of GUIDE_HINTS) {
    for (const connected of [false, true]) {
      const ctx: GuideCtx = { symbol: 'AAPL', ask: 'Buy $25 of AAPL', connected }
      texts.push(renderGuideText(h.title, ctx), renderGuideText(h.body, ctx))
      const cta = guideCta(h, ctx)
      if (cta) texts.push(cta.label)
    }
  }
  const pcts = texts.flatMap((t) => t.match(/\d+(?:\.\d+)?%/g) ?? [])
  const stray = texts.map((t) => t.replace(/\d+(?:\.\d+)?%/g, '').replace(/\$\d+/g, '').replace(/\d+\/\d+/g, '')).filter((t) => /\d/.test(t))
  check(
    'guide: every percent a hint prints is a lib/fees label (the link fee, the swap fee, or the creator\'s slice of the link fee), the split word derives from CREATOR_FEE_SPLIT, and no hint carries a bare count or a typed number',
    pcts.length > 0 && pcts.every((p) => allowedPct.has(p)) && stray.length === 0 && (CREATOR_FEE_SPLIT !== 0.5 || CREATOR_SPLIT_WORD === 'half') && hint('links').body.includes(LINK_FEE_PCT) && hint('links').body.includes(CREATOR_SPLIT_WORD),
    `pcts=${pcts.join('|')} stray=${stray.join(' // ')}`,
  )
  check(
    'guide: no hint claims a result (earned, settled, trending, running) — only what can happen; nothing names a count',
    texts.every((t) => !/\b(you earned|you(?:'|’)ve earned|settled|trending|is running|has run|\d+ (?:people|traders|wallets|strangers))\b/i.test(t)),
  )
  check(
    'guide: the wallet hint never promises the card door (ONRAMP is env-gated, off on this machine) and the links hint never says "for life" (first-touch attribution is the #851/#900 regression)',
    !/card/i.test(hint('wallet').body) && !/for life|lifetime/i.test(hint('links').body),
  )

  // ── Honesty: every sentence the copy quotes as an ask builds natively ──
  const ladderRows: string[] = []
  for (const sym of ['AAPL', 'ETH', 'HYPE']) {
    const pair = chartPairFor(sym)
    if (!pair) {
      ladderRows.push(`${sym}:no-pair`)
      continue
    }
    const ask = composeAsk(pair, 'buy', { usd: 25 })
    const out = simulateLadder(ask)
    const body = renderGuideText(hint('chart').body, { symbol: sym, ask })
    ladderRows.push(`${sym}:${out.kind}:${out.gate}:${body.includes(ask) ? 'quoted' : 'MISSING'}`)
  }
  check(
    'guide: the chart hint quotes the symbol page\'s own buy sentence, and for a stock, a coin and a perp that sentence lands on a native gate as an action (the ladder replica) — a hint never teaches a dead end',
    ladderRows.length === 3 && ladderRows.every((r) => /:action:[^:]+:quoted$/.test(r)),
    ladderRows.join(' '),
  )
  const askCtas = GUIDE_HINTS.flatMap((h) => [false, true].map((connected) => guideCta(h, { symbol: 'ETH', ask: 'Buy $25 of ETH', connected }))).filter((c) => c?.kind === 'ask')
  check(
    'guide: an ask-kind CTA (none shipped today; the kind exists for the next hint) must itself be an action on the ladder',
    askCtas.every((c) => c && simulateLadder(c.value).kind === 'action'),
    askCtas.map((c) => c?.value).join(' | '),
  )
  check(
    'guide: the chart CTA is a DOOR with a question as a draft (nothing fires), and it names the symbol',
    guideCta(hint('chart'), { symbol: 'TSLA' })?.kind === 'door' && guideCta(hint('chart'), { symbol: 'TSLA' })?.value === 'Why is TSLA moving?' && guideCta(hint('chart'), { symbol: 'TSLA' })?.label === 'Why is TSLA moving?',
  )

  // ── The CTAs lead where the brief says ────────────────────────────────
  const linksStranger = guideCta(hint('links'), { connected: false })
  const linksWallet = guideCta(hint('links'), { connected: true })
  check(
    'guide: pulse → /live (public, plain link); links → the public board for a stranger and the studio through the door (SpineLink) for a connected wallet; jobs → /chat?tab=jobs through the door; wallet → /wallet through the door; alerts and triggers scroll to a real selector',
    deepEq(guideCta(hint('pulse'), {}), { label: 'Open the live tape →', short: 'Live tape →', kind: 'href', value: '/live' }) &&
      isPublicAppPath('/live') &&
      linksStranger?.kind === 'href' &&
      linksStranger.value === '/links' &&
      linksWallet?.kind === 'spine' &&
      linksWallet.value === LINKS_STUDIO_HREF &&
      guideCta(hint('jobs'), {})?.kind === 'spine' &&
      guideCta(hint('jobs'), {})?.value === '/chat?tab=jobs' &&
      guideCta(hint('wallet'), {})?.kind === 'spine' &&
      guideCta(hint('wallet'), {})?.value === WALLET_PAGE_HREF &&
      guideCta(hint('alerts'), {})?.kind === 'scroll' &&
      guideCta(hint('triggers'), {})?.kind === 'scroll' &&
      guideCta(hint('triggers'), {})?.value === '[data-slot="triggers"]',
  )
  check(
    'guide: a plain-link CTA never points into the signed-in app (a stranger would bounce home); every link INTO it is the spine kind',
    GUIDE_HINTS.flatMap((h) => [false, true].map((connected) => guideCta(h, { connected }))).every((c) => !c || c.kind !== 'href' || !/^\/(chat|wallet|dashboard)(\?|\/|$)/.test(c.value)),
  )

  // ── requires ──────────────────────────────────────────────────────────
  let s = freshGuideState()
  s = markDismissed(s, 'pulse', null, NOW - 100_000)
  s = markDismissed(s, 'chart', null, NOW - 100_000)
  const later = NOW + GUIDE_QUIET_MS + 1
  check(
    'guide: links waits for a chip on the splash and on a chart (or an earlier chart visit); any time in the chat and on the wallet page',
    first('home', s, {}, later) === null &&
      first('home', noteEvent(s, 'chip'), {}, later) === 'links' &&
      first('symbol', s, {}, later) === null &&
      first('symbol', noteEvent(s, 'chip'), {}, later) === 'links' &&
      first('symbol', noteEvent(s, 'visited:symbol'), {}, later) === 'links' &&
      first('chat', s, {}, later) === 'links' &&
      first('wallet', s, {}, later) === 'links',
  )
  let t = markDismissed(s, 'links', null, NOW - 100_000)
  check(
    'guide: jobs needs an earlier ask in the chat, a chip on the splash and the chart, nothing on the wallet page',
    first('chat', t, {}, later) === null &&
      first('chat', noteEvent(t, 'asked'), {}, later) === 'jobs' &&
      first('home', noteEvent(t, 'chip'), {}, later) === 'jobs' &&
      first('home', t, {}, later) === null &&
      first('symbol', noteEvent(t, 'chip'), {}, later) === 'jobs' &&
      first('wallet', t, {}, later) === 'jobs',
  )
  t = markDismissed(t, 'jobs', null, NOW - 100_000)
  check(
    'guide: the wallet hint waits for a connected wallet (home, chart, live, chat), and never sits on the wallet page itself',
    first('home', t, {}, later) === null &&
      first('home', noteEvent(t, 'connected'), {}, later) === 'wallet' &&
      first('symbol', noteEvent(t, 'connected'), {}, later) === 'wallet' &&
      first('chat', noteEvent(t, 'connected'), {}, later) === 'wallet' &&
      first('live', markDismissed(noteEvent(t, 'connected'), 'triggers', null, NOW - 100_000), {}, later) === 'wallet' &&
      !hint('wallet').surfaces.includes('wallet'),
  )
  t = markDismissed(t, 'wallet', null, NOW - 100_000)
  check(
    'guide: alerts is a second-visit lesson — a visit on file for THIS surface (the seat reads before it writes), home and chart only',
    first('home', t, {}, later) === null &&
      first('home', noteEvent(t, 'visited:home'), {}, later) === 'alerts' &&
      first('symbol', noteEvent(t, 'visited:home'), {}, later) === null &&
      first('symbol', noteEvent(t, 'visited:symbol'), {}, later) === 'alerts' &&
      !hint('alerts').surfaces.includes('live') &&
      !hint('alerts').surfaces.includes('chat'),
  )

  // ── The pick rules ────────────────────────────────────────────────────
  let twice = freshGuideState()
  for (let i = 0; i < GUIDE_MAX_SHOWS; i++) twice = markShown(twice, 'pulse', NOW - 1_000 * (i + 1))
  check(
    `guide: a hint shown ${GUIDE_MAX_SHOWS} times retires on its own (the splash falls silent on a fresh browser once pulse has had its turns), and a dismissed hint never returns however much later`,
    first('home', markShown(freshGuideState(), 'pulse', NOW - 1_000)) === 'pulse' &&
      first('home', twice) === null &&
      first('home', markDismissed(freshGuideState(), 'pulse', null, NOW - 100_000), {}, NOW + 365 * 86_400_000) === null &&
      first('home', markDismissed(freshGuideState(), 'pulse', 'home', NOW - 100_000), {}, NOW + 365 * 86_400_000) === null,
  )
  const dismissedHome = noteEvent(markDismissed(freshGuideState(), 'pulse', 'home', NOW), 'visited:home', NOW - 10)
  check(
    'guide: a dismiss quiets THAT surface for the quiet window (a reload never swaps a replacement card into the hole), then the next lesson may come; other surfaces are untouched',
    first('home', dismissedHome, {}, NOW + 1_000) === null &&
      first('home', dismissedHome, {}, NOW + GUIDE_QUIET_MS - 1) === null &&
      first('home', dismissedHome, {}, NOW + GUIDE_QUIET_MS) === 'alerts' &&
      first('symbol', dismissedHome, {}, NOW + 1_000) === 'chart' &&
      first('live', dismissedHome, {}, NOW + 1_000) === 'triggers' &&
      GUIDE_QUIET_MS === 10 * 60_000,
  )
  const off = markOff(busyState())
  check(
    'guide: "Don\'t show tips" ends it on every surface and takes the dots with it',
    off.off === true && GUIDE_SURFACES.every((sf) => first(sf, off, { connected: true }, later) === null) && !dotFor('jobs', off) && !dotFor('links', off) && !dotFor('wallet', off),
  )
  let loaded = noteEvent(noteEvent(noteEvent(freshGuideState(), 'chip', NOW - 50), 'connected', NOW - 40), 'visited:home', NOW - 30)
  loaded = markDismissed(loaded, 'pulse', null, NOW - 100_000)
  const order: string[] = []
  for (let i = 0; i < 6; i++) {
    const id = first('home', loaded, { connected: true }, later)
    order.push(id ?? '∅')
    if (!id) break
    loaded = markDismissed(loaded, id, null, NOW - 100_000)
  }
  check('guide: on a splash that has seen a chip, a wallet and an earlier visit, the lessons come in order — links, jobs, wallet, alerts, then silence', order.join(' → ') === 'links → jobs → wallet → alerts → ∅', order.join(' → '))

  // ── The record ────────────────────────────────────────────────────────
  const busy = busyState()
  const round = readGuideState(serializeGuideState(busy))
  check(
    'guide: the record round-trips byte-for-byte through localStorage (seen counts, dismissals, visits, acts, the quiet stamp), the first stamp of a visit or an act is the one kept, and GUIDE_FRESH is a frozen v1',
    deepEq(round, busy) &&
      round.seen.pulse?.n === 1 &&
      round.dismissed.chart === NOW - 3_000 &&
      round.quiet.symbol === NOW - 3_000 &&
      round.visited.jobs === NOW - 2_000 &&
      round.acted.chip === NOW - 1_500 &&
      noteEvent(busy, 'chip', NOW).acted.chip === NOW - 1_500 &&
      noteEvent(busy, 'visited:home', NOW).visited.home === NOW - 6_000 &&
      Object.isFrozen(GUIDE_FRESH) &&
      GUIDE_FRESH.v === 1 &&
      deepEq(GUIDE_FRESH, freshGuideState()),
  )
  const garbage = [
    null,
    undefined,
    '',
    'x',
    '[]',
    '{}',
    'null',
    '42',
    '{"v":2}',
    '{"v":1}',
    '{"v":1,"seen":5,"dismissed":{},"off":false,"visited":{},"acted":{}}',
    '{"v":1,"seen":{},"dismissed":{},"off":"yes","visited":{},"acted":{}}',
    '{"v":1,"seen":{"pulse":{"n":-1,"at":1}},"dismissed":{},"off":false,"visited":{},"acted":{}}',
    '{"v":1,"seen":{"pulse":{"n":1,"at":"soon"}},"dismissed":{},"off":false,"visited":{},"acted":{}}',
    '{"v":1,"seen":{},"dismissed":{"pulse":"yesterday"},"off":false,"visited":{},"acted":{}}',
    '{"v":1,"seen":{},"dismissed":{},"off":false,"visited":{"home":0},"acted":{}}',
    '{"v":1,"seen":{},"dismissed":{},"off":false,"visited":{},"acted":{"chip":true}}',
    '{"v":1,"seen":{},"dismissed":{},"off":false,"visited":{},"acted":{},"quiet":[]}',
    '{"v":1,"seen":{},"dismissed":{},"off":false,"visited":[],"acted":{}}',
  ]
  const fresh = freshGuideState()
  check(
    'guide: a corrupt record reads as FRESH — not JSON, an array, a number, a wrong version, a field of the wrong shape, a negative count, a stamp that is a word, a zero stamp, a boolean act, a quiet array',
    garbage.every((g) => deepEq(readGuideState(g), fresh)),
    garbage.filter((g) => !deepEq(readGuideState(g), fresh)).map(String).join(' | '),
  )
  const retired = readGuideState('{"v":1,"seen":{"retired":{"n":1,"at":1}},"dismissed":{"retired":1},"off":false,"visited":{"attic":1,"home":7},"acted":{}}')
  const noQuiet = readGuideState('{"v":1,"seen":{"pulse":{"n":1,"at":7}},"dismissed":{},"off":false,"visited":{},"acted":{}}')
  check(
    'guide: a record from a retired hint or place is kept, not reset (the unknown keys drop), and a record written before `quiet` existed still reads',
    deepEq(retired.seen, {}) && deepEq(retired.dismissed, {}) && retired.visited.home === 7 && noQuiet.seen.pulse?.n === 1 && deepEq(noQuiet.quiet, {}),
  )

  // ── The dots ──────────────────────────────────────────────────────────
  check(
    'guide: the spine dots are on for JOBS, LINKS and WALLET on a fresh browser, each goes out alone when its place is visited, and a chip or a wallet never clears one',
    dotFor('jobs', fresh) &&
      dotFor('links', fresh) &&
      dotFor('wallet', fresh) &&
      !dotFor('jobs', noteEvent(fresh, 'visited:jobs')) &&
      dotFor('links', noteEvent(fresh, 'visited:jobs')) &&
      dotFor('wallet', noteEvent(fresh, 'visited:jobs')) &&
      !dotFor('links', noteEvent(fresh, 'visited:links')) &&
      !dotFor('wallet', noteEvent(fresh, 'visited:wallet')) &&
      dotFor('jobs', noteEvent(noteEvent(fresh, 'chip'), 'connected')),
  )

  // ── renderGuideText ───────────────────────────────────────────────────
  check(
    'guide: {SYM} and {ASK} fill from the seat\'s ctx; with no symbol the chart words still read ("it"), and the example ask falls back to a sentence the ladder builds',
    renderGuideText('Why is {SYM} moving? Try “{ASK}”', { symbol: 'NVDA', ask: 'Buy $25 of NVDA' }) === 'Why is NVDA moving? Try “Buy $25 of NVDA”' &&
      renderGuideText('Why is {SYM} moving?', {}) === 'Why is it moving?' &&
      simulateLadder(renderGuideText('{ASK}', {})).kind === 'action',
  )

  // ── The compact row (the home seat on a phone) ────────────────────────
  const homeCtas = GUIDE_HINTS.filter((h) => h.surfaces.includes('home')).flatMap((h) => [false, true].map((connected) => guideCta(h, { connected, symbol: 'ETH' })))
  check(
    'guide: every hint that can sit on the splash carries a SHORT CTA label for the compact row (≤ 12 characters, an arrow, never empty), and a short label is never longer than the full one',
    homeCtas.length > 0 && homeCtas.every((c) => !!c && !!(c.short ?? c.label) && (c.short ?? c.label).length <= 12 && /→$/.test(c.short ?? c.label) && (c.short ?? c.label).length <= c.label.length),
    homeCtas.map((c) => c?.short ?? c?.label).join(' | '),
  )
  const padded = JSON.stringify({ ...busyState(), pad: 'x'.repeat(20_000) })
  check(
    `guide: an OVERSIZED record (${padded.length} bytes of otherwise valid JSON) reads as fresh — the cap is ${GUIDE_RECORD_MAX_BYTES} bytes, and a busy record is well under it`,
    deepEq(readGuideState(padded), fresh) && GUIDE_RECORD_MAX_BYTES === 8_192 && serializeGuideState(busyState()).length < 1_024,
    `busy=${serializeGuideState(busyState()).length}B`,
  )

  // ── The card, the seats, the dots in the files that mount them ────────
  const uncommented = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const card = uncommented(src('components/guide/GuideCard.tsx'))
  const css = src('components/guide/guide.css')
  const seat = src('components/guide/GuideSeat.tsx')
  check(
    'guide: the card is a NOTE — role="note", no aria-live, no portal, no scrim, no fixed positioning; the Emerald Cut mark, the mono eyebrow GUIDE · n/N, Got it, and "Don\'t show tips" behind a <details> overflow',
    /role="note"/.test(card) &&
      !/aria-live/.test(card) &&
      !/createPortal/.test(card) &&
      !/scrim|backdrop/i.test(card) &&
      !/position:\s*fixed/.test(css) &&
      /PantessaMark/.test(card) &&
      /GUIDE · \{n\}\/\{GUIDE_TOTAL\}/.test(card) &&
      /Got it/.test(card) &&
      /<details className="guide__more">/.test(card) &&
      /Don’t show tips/.test(card),
  )
  check(
    'guide: the compact row is for the SPLASH and the SYMBOL page (GUIDE_COMPACT_SURFACES = home + symbol; GuideSeat passes compactOnPhone(surface)); /live, /chat and /wallet keep the full card on a phone — nothing there competes for the first screen',
    GUIDE_COMPACT_SURFACES.join(',') === 'home,symbol' &&
      compactOnPhone('home') &&
      compactOnPhone('symbol') &&
      !compactOnPhone('live') &&
      !compactOnPhone('chat') &&
      !compactOnPhone('wallet') &&
      /compact=\{compactOnPhone\(surface\)\}/.test(seat) &&
      !/surface === 'home'/.test(seat),
  )
  const compactCtas = GUIDE_HINTS.filter((h) => h.surfaces.some((s) => compactOnPhone(s))).flatMap((h) => [false, true].map((connected) => guideCta(h, { connected, symbol: 'ETH' })))
  check(
    'guide: every hint that can sit on a compacting surface carries a SHORT CTA label (≤12 characters, an arrow) — the chart hint\'s is "Ask it →" ("Why is AAPL moving?" is ~152px and would leave ~40px for the title at 320); the full label stands wider than 640px',
    compactCtas.length > 0 &&
      compactCtas.every((c) => !!c && !!c.short && c.short.length <= 12 && /→$/.test(c.short) && c.short.length <= c.label.length) &&
      guideCta(hint('chart'), { symbol: 'AAPL' })?.short === 'Ask it →' &&
      guideCta(hint('chart'), { symbol: 'AAPL' })?.label === 'Why is AAPL moving?',
    compactCtas.map((c) => c?.short ?? '∅').join(' | '),
  )
  check(
    'guide: on a phone the symbol seat spends no margin above its row (the header\'s own gap is the air) and a hair below — the chart stays primary',
    /@media \(max-width: 640px\) \{[\s\S]*\.sym__head--mk2 > \.guide-seat \{ margin-top: 0; margin-bottom: 2px; \}/.test(css),
  )
  check(
    'guide: the compact row — one row under 640px, the title clamps to two lines, the × is "Got it" (44×44), the body / text Got it / ⋯ step aside; the full card keeps the ⋯ and its <details>',
    /compact=\{compactOnPhone\(surface\)\}/.test(seat) &&
      /className=\{compact \? 'guide guide--compact' : 'guide'\}/.test(card) &&
      /className="guide__x" aria-label="Got it"/.test(card) &&
      /@media \(max-width: 640px\) \{[\s\S]*\.guide--compact \{[\s\S]*grid-template-areas: "mark body acts";[\s\S]*-webkit-line-clamp: 2;[\s\S]*\.guide--compact \.guide__x \{ display: inline-grid;[^}]*width: 44px; height: 44px;/.test(css) &&
      /\.guide--compact \.guide__eyebrow, \.guide--compact \.guide__text, \.guide--compact \.guide__got, \.guide--compact \.guide__more \{ display: none; \}/.test(css) &&
      /^\.guide__x \{ display: none; \}/m.test(css),
  )
  check(
    'guide: the CTA carries ONE label on screen and in the DOM — the short one only while the compact row is laid out (the same 640px query the CSS uses, read in the card), never two spans with one hidden — so the journey tracker\'s click label (the control\'s text) is the visible label, not a doubled one (QA R2); the CSS swaps no label',
    /export const GUIDE_COMPACT_MQ = '\(max-width: 640px\)'/.test(card) &&
      /window\.matchMedia\(GUIDE_COMPACT_MQ\)/.test(card) &&
      /const words = cta \? \(row && cta\.short \? cta\.short : cta\.label\) : null/.test(card) &&
      !/guide__cta-short|guide__cta-full/.test(card) &&
      !/guide__cta-short|guide__cta-full/.test(css) &&
      /@media \(max-width: 640px\)/.test(css) &&
      (card.match(/\{words\}/g) ?? []).length === 5 &&
      !/aria-label=\{cta/.test(card),
  )
  check(
    'guide: the record\'s `visited.home` is a contract — SPLASH\'s claim reads it once at mount through getGuideState() (components/home/SplashClaim.tsx) — so the key stays, round-trips, and is written by the home seat after its pick',
    (GUIDE_VISITS as readonly string[]).includes('home') &&
      readGuideState(serializeGuideState(noteEvent(freshGuideState(), 'visited:home', NOW))).visited.home === NOW &&
      (() => {
        const claim = src('components/home/SplashClaim.tsx')
        return /import \{ getGuideState \} from '@\/lib\/guide'/.test(claim) && /getGuideState\(\)\.visited\.home/.test(claim)
      })(),
  )
  check(
    'guide: the look is tokens only (surface, line, fg, muted, accent, ink; rounded corners, never the facet clip that cuts the border), reduced motion drops the entrance, and a thumb gets ≥44px controls',
    /var\(--accent\)/.test(css) &&
      /var\(--ink\)/.test(css) &&
      /var\(--line\)/.test(css) &&
      /\.guide \{[^}]*border-radius: 12px;/.test(css) &&
      !/clip-path: var\(--mk-facet/.test(css) &&
      !/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')) &&
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.guide \{ animation: none; \}/.test(css) &&
      /@media \(hover: none\)[\s\S]*min-height: 44px/.test(css) &&
      /\.guide-dot \{[\s\S]*width: 6px;[\s\S]*background: var\(--accent\)/.test(css),
  )
  check(
    'guide: the seat gates on hydration (SSR and the hydration render show nothing), picks ONCE through pickHintForLoad, records its visit AFTER the pick, notes a connected wallet, and reports shown / cta / dismissed / off through lib/analytics with the id only',
    /useHydrated\(\)/.test(seat) &&
      /pickHintForLoad\(surface/.test(seat) &&
      seat.indexOf('pickHintForLoad(surface') < seat.indexOf('noteGuideEvent(`visited:${surface}`)') &&
      /noteGuideEvent\('connected'\)/.test(seat) &&
      /analytics\.guide\(picked\.hint\.id, 'shown'\)/.test(seat) &&
      /analytics\.guide\(hint\.id, 'cta', cta\.kind\)/.test(seat) &&
      /analytics\.guide\(hint\.id, 'dismissed'\)/.test(seat) &&
      /analytics\.guide\(hint\.id, 'off'\)/.test(seat) &&
      /turnGuideOff\(\)/.test(seat) &&
      !/walletAddress|address\b.*analytics|analytics\.guide\([^)]*(address|body|title)/.test(seat.split('analytics.guide').slice(1).join('')),
  )
  const analytics = src('lib/analytics.ts')
  check(
    'guide: analytics.guide sends the label guide_<id>_<state> with nothing but the action kind beside it (QA\'s rule: never a wallet, never the hint body), and the chat send notes the guide\'s `asked`',
    /guide: \(id: string, state: GuideOutcome, kind\?: string\) =>\s*send\(`guide_\$\{id\}_\$\{state\}`, kind \? \{ kind \} : undefined\)/.test(analytics) && /noteGuideEvent\('asked'\)/.test(analytics),
  )
  check(
    'guide: lib/guide is pure at import — no React, no analytics, no DOM read outside a function',
    (() => {
      const g = uncommented(src('lib/guide.ts'))
      return !/from 'react'/.test(g) && !/from '@\/lib\/analytics'/.test(g) && !/^(?:export )?(?:const|let|var) .*=.*(?:window|document)\./m.test(g)
    })(),
  )
  check(
    'guide: the chip signal lives in the ONE place every markets chip passes through (lib/use-connect-to-act `act`)',
    /const act = useCallback\(\s*\(ask: string\) => \{[\s\S]{0,200}noteGuideEvent\('chip'\)/.test(src('lib/use-connect-to-act.tsx')),
  )
  const home = src('components/home/HomeSurface.tsx')
  const symbol = src('components/markets/shell/SymbolPage.tsx')
  const live = src('components/live/LiveFeed.tsx')
  const chat = src('components/chat/EmptyState.tsx')
  const wallet = src('components/WalletPage.tsx')
  check(
    'guide: five seats, one line each — home (MarketsIndex\'s guide seat), the symbol header under the act strip quoting the pair\'s own buy sentence, /live once per posture (rail on desktop, main column on a phone), the chat empty state, the wallet page under its header',
    /<GuideSeat surface="home" \/>/.test(home) &&
      /\{pair && <GuideSeat surface="symbol" symbol=\{sym\} ask=\{composeAsk\(pair, 'buy', \{ usd: 25 \}\)\} \/>\}/.test(symbol) &&
      symbol.indexOf('data-seat="ExecStrip"') < symbol.indexOf('<GuideSeat surface="symbol"') &&
      count(live, '<GuideSeat surface="live" posture="phone" />') === 1 &&
      count(live, '<GuideSeat surface="live" posture="desktop" />') === 1 &&
      live.indexOf('className="live__rail">') < live.indexOf('<GuideSeat surface="live" posture="desktop" />') &&
      count(chat, '<GuideSeat surface="chat" />') === 1 &&
      count(wallet, '<GuideSeat surface="wallet" />') === 1 &&
      wallet.indexOf('</header>') < wallet.indexOf('<GuideSeat surface="wallet" />'),
  )
  const spine = src('components/AppSpine.tsx')
  check(
    'guide: the spine dots sit inside the JOBS, LINKS and WALLET seats in both postures (four mounts), never on MARKETS, CHATS, DOCS or SETTINGS',
    count(spine, `{(tab === 'jobs' || tab === 'links') && <SpineGuideDot tab={tab} />}`) === 2 &&
      count(spine, '<SpineGuideDot tab="wallet" />') === 2 &&
      count(spine, '<SpineGuideDot ') === 4 &&
      count(spine, "import SpineGuideDot from '@/components/guide/SpineGuideDot'") === 1 &&
      // Anchored to the ICON: every dot sits inside the icon's own `relative`
      // wrapper (the bar's overflow can never clip it; no posture moves it).
      count(spine, `<span className="relative"><Icon className="w-[18px] h-[18px]" />{(tab === 'jobs' || tab === 'links') && <SpineGuideDot tab={tab} />}</span>`) === 1 &&
      count(spine, `<span className="relative"><Wallet className="w-[18px] h-[18px]" /><SpineGuideDot tab="wallet" /></span>`) === 2 &&
      spine.split('<SpineGuideDot ').slice(1).every((_, i) => /className="relative"[^]{0,160}$/.test(spine.split('<SpineGuideDot ').slice(0, i + 1).join('<SpineGuideDot ').slice(-220))) &&
      !/SpineGuideDot tab="(mcps|chats|team|docs|markets)"/.test(spine),
  )
  const dot = src('components/guide/SpineGuideDot.tsx')
  check(
    'guide: the dot renders nothing before hydration, reads dotFor, and notices a drawer visit from the store AppSpine already writes (desktop drawer open on the tab, or the phone screen) — never from a click',
    /useHydrated\(\)/.test(dot) && /dotFor\(tab, state\)/.test(dot) && /railTab === tab && railOpen/.test(dot) && /phoneScreen === tab/.test(dot) && !/onClick|addEventListener\('click'/.test(dot) && /title=\{TITLE\[tab\]\}/.test(dot),
  )
  // ── THE EMPTY DOORS (squad pre-gtm, FIRSTRUN) ─────────────────────────
  const doorAsks = FIRST_RUN_ASKS.map((a) => [a, simulateLadder(a)] as const)
  check(
    'first-run: every ask an empty door offers as its first action lands on a native gate as an ACTION through the ladder replica (a door never teaches a dead end)',
    doorAsks.length >= 2 && doorAsks.every(([, o]) => o.kind === 'action'),
    doorAsks.map(([a, o]) => `${o.kind}:${o.gate} ← ${a}`).join(' | '),
  )
  check(
    'first-run: the jobs door\'s ask is a JOB (the "then" sentence lands on the jobs gate), and its copy names "then"',
    doorAsks[0][1].gate === 'jobs' && /then/i.test(JOBS_DOOR.title) && JOBS_DOOR.lines.length === 3,
  )
  check(
    'first-run: the links door derives its fee words from lib/fees (creator split + link fee), never typed',
    LINKS_DOOR.body.includes(LINK_FEE_PCT) && LINKS_DOOR.body.includes(CREATOR_FEE_SPLIT === 0.5 ? 'half' : `${Math.round(CREATOR_FEE_SPLIT * 100)}%`) && !/0\.[0-9]+%/.test(LINKS_DOOR.body.replace(LINK_FEE_PCT, '')),
  )
  check(
    'first-run: the chats door teaches the account contract in rule 6\'s words (connect to act, sign in to keep) and never promises a saved thread to a wallet that has not signed in',
    /Connect to act\. Sign in to keep\./.test(CHATS_DOOR.title) && /sign-in/.test(CHATS_DOOR.body) && WALLET_DOOR.lines.some((l) => /no signature/.test(l)),
  )
  const door = src('components/guide/EmptyDoor.tsx')
  check(
    'first-run: EmptyDoor is a note (role="note"), sends an ask only through the connect-to-act door, carries the Emerald Cut, and links into the app through SpineLink — no modal, no portal, no raw connect modal',
    /role="note"/.test(door) && /useConnectToAct\(/.test(door) && /PantessaMark/.test(door) && /<SpineLink /.test(door) && !/openConnectModal|createPortal|role="dialog"/.test(door),
  )
  const sites: Array<[string, RegExp]> = [
    ['components/JobsRailTab.tsx', /<EmptyDoor[\s\S]*?id="jobs"[\s\S]*?kind: 'ask'/],
    ['components/ChatsRailTab.tsx', /<EmptyDoor[\s\S]*?id="chats"/],
    ['components/LinksStudioView.tsx', /<EmptyDoor[\s\S]*?id="links"/],
    ['components/WalletPage.tsx', /<EmptyDoor[\s\S]*?id="wallet"[\s\S]*?walletConnectOnly/],
  ]
  const siteRows = sites.map(([f, re]) => `${f}:${re.test(src(f)) ? 'door' : 'MISSING'}`)
  check(
    'first-run: the four spine empty states (JOBS · CHATS · LINKS studio · WALLET page) render the empty door — the jobs door\'s action is a chip that SENDS, the wallet door keeps the connect-only lane (rule 6)',
    siteRows.every((r) => r.endsWith(':door')),
    siteRows.join(' '),
  )
  const jobsSrc = src('components/JobsRailTab.tsx')
  check(
    'first-run: the jobs rail no longer answers a stranger with "Sign in with your wallet to see…" and nothing else — both empty branches carry the door, and the chip sends into the chat beside it (setComposerSend), never a prefill',
    !/Sign in with your wallet to see the jobs/.test(jobsSrc) && !/Nothing running yet\. Protections/.test(jobsSrc) && count(jobsSrc, '<EmptyDoor') === 2 && /setComposerSend\(\{ text, mcps: askAppSlugs\(text\) \}\)/.test(jobsSrc),
  )
  const chatsSrc = src('components/ChatsRailTab.tsx')
  check(
    'first-run: the chats door offers the wallet\'s own sign-in when connected, the unified door (CreateAccountButton, no redirectTo) when nothing is connected, and "Start a chat" to a signed-in wallet',
    /needsSignIn\s*\?\s*\{ kind: 'button'/.test(chatsSrc) && /<CreateAccountButton className="door__cta" label="Sign in to keep them" \/>/.test(chatsSrc) && /label: 'Start a chat'/.test(chatsSrc) && !/Your chats are saved when you sign in/.test(chatsSrc),
  )
  const doorCss = src('components/guide/guide.css')
  check(
    'first-run: the door\'s CSS is tokens only (no hex, no rgb literal beyond the light hairline shadow), respects reduced motion, and gives a thumb 44px controls',
    /\.door \{/.test(doorCss) && /prefers-reduced-motion: reduce\)[\s\S]*\.door \{ animation: none; \}/.test(doorCss) && /\(hover: none\)[\s\S]*\.door__cta, \.door__link \{ min-height: 44px; \}/.test(doorCss) && !/\.door[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(doorCss),
  )

  const iSrc = src('components/IntentRuntime.tsx')
  check(
    'first-run: the /i splash tells a stranger what happens next in three steps (connect → see the plan, nothing signed by looking → sign or close), rendered from lib/first-run only while nothing is connected, never a fourth control',
    I_STEPS.length === 3 && /Nothing is signed by looking/.test(I_STEPS[1].body) && /only thing that can move money/.test(I_STEPS[2].body) && /data-i-steps/.test(iSrc) && /!isConnected && \(\s*<ol[^>]*data-i-steps/.test(iSrc) && !/data-i-steps[\s\S]{0,900}<(button|a) /.test(iSrc),
  )

  const panelSrc = src('components/WalletPanel.tsx')
  check(
    'first-run: the wallet window at $0 (every chain read, nothing held) wears the empty door with the card buy as its action and the receive address second — on the page and in the popup',
    /walletEmpty = !!view && funded\.length === 0 && emptyChains\.length > 0/.test(panelSrc) && /<EmptyDoor[\s\S]*?id="wallet-empty"[\s\S]*?onClick: \(\) => void buy\(\)/.test(panelSrc) && /setReceive\(true\)/.test(panelSrc) && WALLET_EMPTY_DOOR.lines.length === 3,
  )
  const mintSrc = src('components/MintLinkForm.tsx')
  const studioSrc = src('components/LinksStudioView.tsx')
  check(
    'first-run: the links door hands its example ask to MintLinkForm through the `prefill` prop (fills only an empty ask, scrolls + focuses) — no native value setter anywhere',
    /prefill\?: \{ ask: string; at: number \} \| null/.test(mintSrc) && /setAsk\(\(cur\) => \(cur\.trim\(\) \? cur : prefill\.ask/.test(mintSrc) && /prefill=\{prefill\}/.test(studioSrc) && !/getOwnPropertyDescriptor/.test(studioSrc),
  )
  const askDoorSrc = src('components/AskDoor.tsx')
  const designCss = src('app/x402-design.css')
  check(
    'first-run: the floating Ask pill yields while a composer (a visible textarea, Ask the chart’s input, or data-ask-door-yield) is on screen, and the app frame\'s scroller keeps the pill\'s height clear under its last row (DEADENDS F5)',
    /composerInView/.test(askDoorSrc) && /\.mk-ai--ask input/.test(askDoorSrc) && /\|\| yielding\) return null/.test(askDoorSrc) && /body:has\(\[data-app-frame\]\):has\(\.askdoor-pill:not\(\[data-away\]\)\) \[data-app-scroll\] \{ padding-bottom: calc\(72px \+ env\(safe-area-inset-bottom\)\)/.test(designCss),
  )

}

if (process.argv[1]?.endsWith('guide-pins.ts')) {
  let failed = 0
  guidePins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall guide pins green')
  process.exit(failed ? 1 : 0)
}
