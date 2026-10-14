#!/usr/bin/env tsx
/**
 * THE INVENTORY (squad polish, 2026-10-13, DEADENDS lane) — every sentence the
 * product OFFERS, enumerated from the composers themselves (never a hand list),
 * replayed through the replicas the product answers with:
 *
 *   • a chat-bound sentence (a chip that SENDS, a door that sends, a row action)
 *     → scripts/ask-ladder simulateLadder, the route's ladder replica;
 *   • a markets-ask question (the AI bar's question chips, the alert sentences)
 *     → the route's deterministic doors in order (alert · draw · overlay ·
 *       a complete ask), else the model.
 *
 * Verdicts (README §A, the dead-end rule):
 *   native  — a native gate builds it (kind 'action')
 *   clarify — a clarify whose EVERY chip builds natively
 *   door    — a deterministic door answers it (chart | alert | overlay | act |
 *             a native READ gate in the chat route)
 *   refusal — a named refusal (a clarify without chips): counted, listed
 *   planner — falls to the model. EVERY planner is a bug: fix the grammar or
 *             the composer, then pin it (scripts/deadends-pins.ts).
 *
 * Symbol classes: a coin with an EVM home (ETH, UNI, LINK), a coin with a perp
 * (BTC), a non-EVM-home coin (SOL, XRP), a stock (AAPL, TSLA, NVDA), an HL perp
 * (HYPE, FARTCOIN), an unlisted ticker (ZZQX). Surface states: held / not held,
 * chain named / not, wallet / no wallet, a live last price / none, leverage.
 *
 *   npm run inventory:deadends          # the table + nonzero exit on any planner
 *   npm run inventory:deadends -- -v    # every sentence with its verdict
 *   npm run inventory:deadends -- --md  # the table as markdown (for DEADENDS.md)
 */
import { buildsNatively, simulateLadder, type Outcome } from './ask-ladder'
import { chartPairFor, type ChartPair } from '../lib/charts'
import { execAsks, tradeAsks, composeAsk, composeExecAsk, execSidesFor, sidesFor, AMOUNTS, STOPS } from '../lib/trade-asks'
import { venuesFor } from '../lib/symbol-venues'
import { askChartSuggestions } from '../lib/markets-ai-suggestions'
import { composeTicketAsk, freshTicket, ticketSidesFor, ticketTypesFor, TICKET_USD_PRESETS, TICKET_LEVERAGE_PRESETS, TICKET_STOP_PRESETS } from '../lib/order-ticket'
import { followAsk } from '../lib/tape'
import { armSentence, alertFollowAsk, pickAlertPlan } from '../lib/pick-alerts'
import { HOUSE_LINKS } from '../lib/house-links'
import { robinhoodRowActions } from '../lib/robinhood-row-actions'
import { GUIDE_HINTS, guideCta } from '../lib/guide'
import { aaveRows, lidoRow, morphoRows, EARN_AMOUNTS } from '../lib/earn'
import { HOUSE_DOWN_CHIPS } from '../lib/build-failure'
import { INTENT_NET_PROBES, rescueIntent } from '../lib/intent-rescue'
import { STARTER_CHIPS, starterDoor } from '../lib/starter-door'
import { EXAMPLE_PROMPTS } from '../lib/examples'
import { askDoorChips } from '../lib/ask-door'
import { parseAlertAsk, parseDrawAsk, parseOverlayAsk } from '../lib/markets-ai'
import { validateProposedAsk } from '../lib/markets-ai-ladder'
import { walletFlags } from '../lib/wallet-flags'
import { alertActionChips } from '../lib/watchlists'
import { composeLineActions, composeZoneActions } from '../lib/chart-actions'
import { composeBriefingItems } from '../lib/briefing'
import { chipMenu } from '../lib/markets-ai'
import { APP_CHAINS } from '../lib/chains'
import { gasStateFor, type WalletChainView } from '../lib/wallet-view'
import { asksAboutOwnWallet } from '../lib/own-wallet-read'
import { marketReadAsk as marketReadAskFor } from '../lib/market-read'

export type Verdict = 'native' | 'clarify' | 'door' | 'refusal' | 'planner'
export interface Row { surface: string; state: string; sentence: string; route: 'chat' | 'markets-ask'; verdict: Verdict; why: string }

const VERBOSE = process.argv.includes('-v')
const MD = process.argv.includes('--md')

// ── The symbol classes ─────────────────────────────────────────────────────
export const INVENTORY_SYMBOLS: { sym: string; cls: string; last: number }[] = [
  { sym: 'ETH', cls: 'coin (EVM home, stake)', last: 2500 },
  { sym: 'UNI', cls: 'coin (EVM home)', last: 8.16 },
  { sym: 'LINK', cls: 'coin (Aave reserve)', last: 14.2 },
  { sym: 'BTC', cls: 'coin (perp listed)', last: 64000 },
  { sym: 'SOL', cls: 'coin (non-EVM home)', last: 150 },
  { sym: 'XRP', cls: 'coin (non-EVM home)', last: 0.55 },
  { sym: 'AAPL', cls: 'stock', last: 230 },
  { sym: 'TSLA', cls: 'stock', last: 240 },
  { sym: 'NVDA', cls: 'stock', last: 120 },
  { sym: 'HYPE', cls: 'HL perp', last: 30 },
  { sym: 'FARTCOIN', cls: 'HL perp', last: 1.1 },
  { sym: 'ZZQX', cls: 'unlisted ticker', last: 1 },
]

// ── Replay ─────────────────────────────────────────────────────────────────
/** A chat-bound sentence through the route's ladder replica. */
export function chatVerdict(sentence: string): { verdict: Verdict; why: string } {
  const o: Outcome = simulateLadder(sentence)
  // A READ the route answers natively (the market-read gate) is a door.
  if (o.kind === 'action' && o.gate === 'market-read') return { verdict: 'door', why: `market-read ${o.note ?? ''}` }
  if (o.kind === 'action') return { verdict: 'native', why: o.gate }
  // "What's in my wallet?" — no wallet: the route's sign-in door (the ask is
  // held and re-runs on connect); a wallet: the wallet MCP's portfolio card.
  // The route reaches it only after every native gate passed (same here).
  if (o.kind === 'planner' && asksAboutOwnWallet(sentence)) return { verdict: 'door', why: 'own-wallet read (sign-in door · wallet MCP portfolio)' }
  if (o.kind === 'planner') return { verdict: 'planner', why: o.gate }
  // A clarify: every chip must build. The replica notes chips as ' | '-joined
  // resumes for the net and the starter door; the HL size clarify's resumes
  // are full orders (pinned by audit:asks).
  if (o.chips || o.gate === 'hyperliquid') {
    const resumes = o.gate === 'intent-net' || o.gate === 'starter' ? (o.note ?? '').split(' | ').filter(Boolean) : []
    const bad = resumes.filter((r) => !buildsNatively(r))
    return bad.length ? { verdict: 'planner', why: `${o.gate} chip falls: ${bad.join(' ; ')}` } : { verdict: 'clarify', why: o.gate }
  }
  return { verdict: 'refusal', why: `${o.gate}: ${(o.note ?? '').slice(0, 90)}` }
}

/** A markets-ask question through the route's deterministic doors, in order
 *  (app/api/markets/ask/route.ts: alert → draw → overlay → a complete ask). */
export function marketsAskVerdict(question: string, symbol: string, last: number | null): { verdict: Verdict; why: string } {
  if (parseAlertAsk(question, symbol, last)) return { verdict: 'door', why: 'alert' }
  if (parseDrawAsk(question)) return { verdict: 'door', why: 'chart (draw)' }
  if (parseOverlayAsk(question).length) return { verdict: 'door', why: 'overlay' }
  const direct = validateProposedAsk(question, symbol)
  if (direct.ok) return { verdict: 'door', why: `act (${direct.gate})` }
  if (marketReadAskFor(question, symbol)) return { verdict: 'door', why: 'market-read (the tape when the model is down)' }
  return { verdict: 'planner', why: 'the model' }
}

const rows: Row[] = []
const seen = new Set<string>()
function add(surface: string, state: string, sentence: string | null | undefined, route: Row['route'] = 'chat', ctx: { symbol?: string; last?: number | null } = {}) {
  if (!sentence) return
  const key = `${surface}|${route}|${sentence}`
  if (seen.has(key)) return
  seen.add(key)
  const v = route === 'chat' ? chatVerdict(sentence) : marketsAskVerdict(sentence, ctx.symbol ?? 'ETH', ctx.last ?? null)
  rows.push({ surface, state, sentence, route, ...v })
}
const safe = (surface: string, fn: () => void) => {
  try {
    fn()
  } catch (e) {
    rows.push({ surface, state: 'composer threw', sentence: '(none)', route: 'chat', verdict: 'planner', why: `composer threw: ${(e as Error).message.slice(0, 120)}` })
  }
}

// ── Enumerate every composer ───────────────────────────────────────────────
export function enumerate(): Row[] {
  rows.length = 0
  seen.clear()
  for (const { sym, cls, last } of INVENTORY_SYMBOLS) {
    const pair = chartPairFor(sym)
    const tag = `${sym} · ${cls}`
    if (!pair) {
      // An unlisted ticker: no chart, so no symbol-page composer runs. The
      // surfaces that still name it are the tape's follow ask and the pick
      // alerts (a market the stream printed).
      safe('tape follow (unlisted)', () => {
        add('tape follow', `${tag} · buy print`, followAsk({ market: sym, side: 'buy' })?.ask)
        add('tape follow', `${tag} · sell print`, followAsk({ market: sym, side: 'sell' })?.ask)
      })
      continue
    }
    const p: ChartPair = pair
    // Header strip (the cockpit's chips) — with and without a live last, and with leverage.
    safe('header strip', () => {
      for (const a of execAsks(p, { usd: 50, last })) add('header strip (execAsks)', `${tag} · last`, a.ask)
      for (const a of execAsks(p, { usd: 50 })) add('header strip (execAsks)', `${tag} · no last`, a.ask)
      for (const lev of [2, 3]) for (const a of execAsks(p, { usd: 25, last, leverage: lev })) add('header strip (execAsks)', `${tag} · ${lev}x`, a.ask)
    })
    safe('overview chips', () => {
      for (const a of tradeAsks(p)) add('overview chips (tradeAsks)', tag, a.ask)
      for (const side of sidesFor(p)) for (const usd of AMOUNTS) add('trade panel (composeAsk)', `${tag} · $${usd}`, composeAsk(p, side, { usd }))
      for (const pct of STOPS) if (sidesFor(p).includes('protect')) add('trade panel (composeAsk)', `${tag} · stop ${pct}%`, composeAsk(p, 'protect', { pct }))
      for (const side of execSidesFor(p)) add('exec sides (composeExecAsk)', tag, composeExecAsk(p, side, { usd: 25, last }))
    })
    safe('venue routes', () => {
      for (const card of [false, true]) for (const r of venuesFor(sym, p, { last, card })) add('venue routes (venuesFor)', `${tag} · card ${card ? 'open' : 'shut'}`, r.ask)
      for (const r of venuesFor(sym, p, {})) add('venue routes (venuesFor)', `${tag} · no last`, r.ask)
    })
    safe('ai suggestions', () => {
      for (const s of askChartSuggestions(sym, p)) {
        if (s.kind === 'act') add('AI bar act chip', tag, s.ask)
        else add('AI bar question chip', tag, s.q, 'markets-ask', { symbol: p.symbol, last })
      }
    })
    safe('ask door', () => {
      for (const c of askDoorChips(`/t/${sym}`)) add('ask door chips (/t)', tag, c.ask)
    })
    safe('order ticket', () => {
      for (const side of ticketSidesFor(p)) {
        for (const type of ticketTypesFor(p, side)) {
          for (const usd of TICKET_USD_PRESETS) {
            const st = freshTicket(p, side, { usd, last, type })
            const c = composeTicketAsk(p, st, last)
            if (c.ok) add('order ticket', `${tag} · ${side} ${type} $${usd}`, c.ask)
            if (side === 'long' || side === 'short') {
              for (const lev of TICKET_LEVERAGE_PRESETS) {
                const c2 = composeTicketAsk(p, { ...st, leverage: lev }, last)
                if (c2.ok) add('order ticket', `${tag} · ${side} ${lev}x $${usd}`, c2.ask)
                for (const stop of TICKET_STOP_PRESETS) {
                  const c3 = composeTicketAsk(p, { ...st, leverage: lev, withStop: true, stopPct: stop }, last)
                  if (c3.ok) add('order ticket', `${tag} · ${side} ${lev}x +${stop}% stop`, c3.ask)
                }
              }
            }
          }
          if (side === 'sell') {
            const st = freshTicket(p, side, { last, type })
            const all = composeTicketAsk(p, { ...st, sellAll: true }, last)
            if (all.ok) add('order ticket', `${tag} · sell all`, all.ask)
            const units = composeTicketAsk(p, { ...st, unit: 'token', amount: 2.5 }, last)
            if (units.ok) add('order ticket', `${tag} · sell 2.5 units`, units.ask)
          }
        }
      }
    })
    safe('pick alerts', () => {
      add('pick alert (armSentence)', tag, armSentence(sym), 'markets-ask', { symbol: p.symbol, last })
      add('pick alert follow', tag, alertFollowAsk(sym))
      const plan = pickAlertPlan(sym)
      if (plan && 'followAsk' in plan) add('pick alert plan', tag, (plan as { followAsk?: string | null }).followAsk ?? null)
    })
    safe('chart actions', () => {
      // lib/chart-actions — the chips a drawn level / zone offers (above and
      // below market, both sides of a zone, straddling).
      for (const k of [0.8, 0.95, 1.05, 1.2]) for (const a of composeLineActions({ symbol: p.symbol, source: p.source, price: Number((last * k).toPrecision(5)), last })) add('chart level/zone offers (lib/chart-actions)', `${tag} · level ${k}×`, a.action.ask)
      for (const [a, b] of [[0.8, 0.9], [1.1, 1.2], [0.95, 1.05]]) for (const o of composeZoneActions({ symbol: p.symbol, source: p.source, p1: last * a, p2: last * b, last })) add('chart level/zone offers (lib/chart-actions)', `${tag} · zone ${a}–${b}×`, o.action.ask)
    })
    safe('ai brief menu', () => {
      // lib/markets-ai chipMenu — the AiBrief's menu (the route ladder-filters
      // it before the model picks; the inventory reads it UNFILTERED so a drop
      // is visible here, not silent).
      for (const c of chipMenu({ pair: p, last, tech: null })) add('AI brief menu (chipMenu, unfiltered)', tag, c.ask)
    })
    safe('alert action chips', () => {
      // lib/watchlists alertActionChips — the chips a saved alert offers and
      // the fired alert hands back (above / below / a move).
      for (const rule of [
        { symbol: p.symbol, condition: 'above' as const, value: Number((last * 1.1).toPrecision(4)) },
        { symbol: p.symbol, condition: 'below' as const, value: Number((last * 0.9).toPrecision(4)) },
        { symbol: p.symbol, condition: 'pct_move' as const, value: 5 },
      ]) for (const c of alertActionChips(rule as never, p)) add('alert action chips (lib/watchlists)', `${tag} · ${rule.condition}`, c.ask)
    })
    safe('tape follow', () => {
      add('tape follow', `${tag} · buy print`, followAsk({ market: p.source === 'robinhood' ? `xyz:${sym}` : sym, side: 'buy' })?.ask)
      add('tape follow', `${tag} · sell print`, followAsk({ market: p.source === 'robinhood' ? `xyz:${sym}` : sym, side: 'sell' })?.ask)
      for (const chainId of [8453, 1, 42161, null]) add('tape follow (dex)', `${tag} · dex buy chain ${chainId ?? 'none'}`, followAsk({ market: sym, side: 'buy', venue: 'dex', chainId })?.ask)
    })
  }

  // Robinhood Chain row actions (the wallet drawer) — held stock, idle USDG, loose ETH.
  safe('robinhood row actions', () => {
    for (const h of [
      { symbol: 'AAPL', kind: 'stock', balance: '0.0376', usd: 11.89 },
      { symbol: 'AAPL', kind: 'stock', balance: '0', usd: 0 },
      { symbol: 'SPY', kind: 'etf', balance: '0.02', usd: 12 },
      { symbol: 'USDG', kind: 'stable', balance: '12.5' },
      { symbol: 'USDG', kind: 'stable', balance: '120' },
      { symbol: 'ETH', kind: 'native', balance: '0.01', priceUsd: 2500 },
    ]) for (const a of robinhoodRowActions(h)) add('wallet drawer (robinhoodRowActions)', `${h.symbol} ${h.balance}`, a.prompt)
  })

  // House links (the landing's lane + /links start-here).
  safe('house links', () => {
    for (const l of HOUSE_LINKS) add('house links', l.slug, l.ask)
  })

  // The guide's door CTAs (a hint that opens the ask door with a sentence).
  safe('guide', () => {
    for (const h of GUIDE_HINTS) {
      for (const surface of ['home', 'symbol', 'live', 'chat', 'wallet'] as const) {
        for (const sym of ['ETH', 'AAPL', 'HYPE']) {
          const cta = guideCta(h, { surface, symbol: sym, connected: true } as never)
          if (cta && (cta.kind === 'door' || cta.kind === 'ask')) add('guide CTA', `${h.id} · ${surface} · ${sym}`, cta.value)
        }
      }
    }
  })

  // The Earn board: one chip per row × amount.
  safe('earn', () => {
    const aave = aaveRows([
      { asset: { symbol: 'USDC' }, active: true, canSupply: true, supplyApyPct: 4.1, suppliedUsd: 1e8, spoke: 'Main' },
      { asset: { symbol: 'USDC' }, active: true, canSupply: true, supplyApyPct: 5.2, suppliedUsd: 1e7, spoke: 'Ethena' },
      { asset: { symbol: 'WETH' }, active: true, canSupply: true, supplyApyPct: 1.9, suppliedUsd: 1e8, spoke: 'Main' },
      { asset: { symbol: 'LINK' }, active: true, canSupply: true, supplyApyPct: 0.3, suppliedUsd: 1e7, spoke: 'Main' },
      { asset: { symbol: 'AAVE' }, active: true, canSupply: true, supplyApyPct: 0.1, suppliedUsd: 1e7, spoke: 'Main' },
    ] as never)
    const lido = lidoRow(2.3, 3e10, 2500)
    const morpho = [...morphoRows([{ id: `0x${'a'.repeat(64)}`, loanAsset: { symbol: 'USDC' }, collateralAsset: { symbol: 'WETH' }, supplyApyPct: 5, supplyUsd: 5e7, curated: true } as never], 8453), ...morphoRows([{ id: `0x${'b'.repeat(64)}`, loanAsset: { symbol: 'USDC' }, collateralAsset: { symbol: 'WBTC' }, supplyApyPct: 4.5, supplyUsd: 6e7, curated: true } as never], 1)]
    for (const r of [...aave, lido, ...morpho]) for (const usd of EARN_AMOUNTS) add('earn board', `${r.venueLabel} ${r.asset} · $${usd}`, r.askFor(usd))
  })

  // /wallet flags: every action that carries an ask.
  safe('wallet flags', () => {
    const chainOf = (id: number) => APP_CHAINS.find((c) => c.id === id)!
    const mk = (id: number, nativeEth: number, tokens: [string, number, number | null][]): WalletChainView => {
      const c = chainOf(id)
      const holdings = [
        ...(nativeEth > 0 ? [{ symbol: 'ETH', address: 'native', balance: String(nativeEth), priceUsd: 2500, valueUsd: nativeEth * 2500, native: true as const, chain: c.name }] : []),
        ...tokens.map(([symbol, balance, valueUsd]) => ({ symbol, address: `0x${symbol.toLowerCase().padEnd(40, '0')}`, balance: String(balance), priceUsd: valueUsd == null ? null : valueUsd / balance, valueUsd, chain: c.name })),
      ]
      const tokenUsd = tokens.reduce((a, [, , usd]) => a + (usd ?? 0), 0)
      return { id, key: c.key, name: c.name, short: c.short, color: c.color, totalUsd: tokenUsd + nativeEth * 2500, nativeEth, nativeUsd: nativeEth * 2500, gas: gasStateFor(id, nativeEth, tokenUsd), gasSymbol: 'ETH', gasUnits: nativeEth, holdings } as WalletChainView
    }
    const wallets: [string, WalletChainView[]][] = [
      ['Arbitrum stalled, Base funded', [mk(8453, 0.0075, [['USDC', 13.47, 13.47]]), mk(1, 0.074, []), mk(42161, 0, [['USDC', 1.99, 1.99]])]],
      ['Robinhood stalled', [mk(8453, 0.0075, [['USDC', 25, 25]]), mk(4663, 0, [['USDG', 12, 12]])]],
      ['Base stalled, mainnet ETH only', [mk(1, 0.05, []), mk(8453, 0, [['USDC', 20, 20]])]],
    ]
    for (const [name, chains] of wallets) for (const f of walletFlags(chains, 2500)) for (const a of f.actions) add('wallet flags', `${name} · ${f.kind}`, a.ask)
  })

  // The wallet briefing (/w/<address>, the splash's "what Pantessa noticed").
  safe('briefing', () => {
    const src = (chainId: number, chainWord: string, token: string, usd: number) => ({ chainId, chainWord, token, balance: token === 'ETH' ? usd / 2500 : usd, usd })
    const inputs = {
      firedRecently: [],
      positions: [{ coin: 'HYPE', side: 'long', positionValueUsd: 120, unrealizedPnl: 4, leverage: 2 }, { coin: 'ETH', side: 'short', positionValueUsd: 60, unrealizedPnl: -2, leverage: 3 }],
      protectedCoins: [], spotProtectedSymbols: [],
      funding: { sources: [src(8453, 'Base', 'ETH', 400), src(42161, 'Arbitrum', 'ETH', 12), src(8453, 'Base', 'USDC', 80)], stranded: [src(10, 'Optimism', 'USDC', 30), src(1, 'Ethereum', 'USDC', 40)], readChains: [1, 8453, 42161, 10], failedChains: [] },
      aave: { healthFactor: 1.3, hasBorrows: true },
      failed: [],
    }
    for (const row of composeBriefingItems(inputs as never)) for (const a of (row as { actions?: { prompt?: string }[] }).actions ?? []) add('wallet briefing (lib/briefing)', String((row as { label?: string }).label ?? ''), a.prompt)
  })

  // The refusal + rescue chips the chat route hands back.
  safe('house-down chips', () => {
    for (const c of HOUSE_DOWN_CHIPS) add('build failure (HOUSE_DOWN_CHIPS)', 'a build threw', c.resume)
  })
  safe('intent net', () => {
    for (const { family, ask } of INTENT_NET_PROBES) {
      const r = rescueIntent(ask, buildsNatively)
      for (const c of r?.chips ?? []) add('intent-net chip', family, c.resume)
    }
  })
  safe('starter door', () => {
    for (const c of STARTER_CHIPS as unknown as { resume?: string; ask?: string; label: string }[]) add('starter door chip', 'static', c.resume ?? c.ask)
    for (const q of ['help', 'eth', 'AAPL', 'hi']) for (const c of starterDoor(q)?.clarify.options ?? []) add('starter door chip', `"${q}"`, c.resume)
  })
  safe('examples', () => {
    for (const e of EXAMPLE_PROMPTS) add('example prompts (ask door, chat empty)', e.label, e.prompt)
  })
  return rows
}

// ── Report ─────────────────────────────────────────────────────────────────
export function summarize(all: Row[]) {
  const by = new Map<string, Record<Verdict, number>>()
  for (const r of all) {
    const k = r.surface
    const t = by.get(k) ?? { native: 0, clarify: 0, door: 0, refusal: 0, planner: 0 }
    t[r.verdict]++
    by.set(k, t)
  }
  return by
}

function main() {
  const all = enumerate()
  const by = summarize(all)
  const totals = { native: 0, clarify: 0, door: 0, refusal: 0, planner: 0 }
  const lines: string[] = []
  if (MD) lines.push('| surface | sentences | native | clarify | door | refusal | planner |', '|---|---:|---:|---:|---:|---:|---:|')
  else lines.push(`${'surface'.padEnd(44)} ${'n'.padStart(4)} ${'native'.padStart(6)} ${'clarify'.padStart(7)} ${'door'.padStart(5)} ${'refusal'.padStart(7)} ${'planner'.padStart(7)}`)
  for (const [surface, t] of [...by.entries()].sort()) {
    const n = t.native + t.clarify + t.door + t.refusal + t.planner
    for (const k of Object.keys(totals) as Verdict[]) totals[k] += t[k]
    lines.push(MD ? `| ${surface} | ${n} | ${t.native} | ${t.clarify} | ${t.door} | ${t.refusal} | ${t.planner} |` : `${surface.padEnd(44)} ${String(n).padStart(4)} ${String(t.native).padStart(6)} ${String(t.clarify).padStart(7)} ${String(t.door).padStart(5)} ${String(t.refusal).padStart(7)} ${String(t.planner).padStart(7)}`)
  }
  const n = all.length
  lines.push(MD ? `| **all** | **${n}** | ${totals.native} | ${totals.clarify} | ${totals.door} | ${totals.refusal} | **${totals.planner}** |` : `${'ALL'.padEnd(44)} ${String(n).padStart(4)} ${String(totals.native).padStart(6)} ${String(totals.clarify).padStart(7)} ${String(totals.door).padStart(5)} ${String(totals.refusal).padStart(7)} ${String(totals.planner).padStart(7)}`)
  console.log(lines.join('\n'))
  const show = all.filter((r) => VERBOSE || r.verdict === 'planner' || r.verdict === 'refusal')
  if (show.length) {
    console.log(`\n${VERBOSE ? 'Every sentence' : 'Planner falls + refusals'}:`)
    for (const r of show) console.log(`  ${r.verdict === 'planner' ? '❌' : r.verdict === 'refusal' ? '⚠️ ' : '✅'} [${r.surface} · ${r.state}] "${r.sentence}" → ${r.verdict} (${r.why})`)
  }
  console.log(`\ninventory:deadends — ${n} sentences · ${totals.planner} planner · ${totals.refusal} refusal`)
  process.exit(totals.planner ? 1 : 0)
}

// ── --live: the refusal sweep (README §A rule 4) ───────────────────────────
// Asks that historically end in a refusal, POSTed to a running server
// (BASE) as a stranger with a fresh empty wallet. Every money-shaped answer
// must be actionable (lib/ask-failure classifyTurn) — a build, a clarify with
// chips, a door, a connect gate. Nothing real runs: the wallet is empty and
// watch-only, nothing is signed; harness-stamped (x-yf-internal-run) and kept
// off the failures queue (x-yf-no-ask-log is NOT sent — the belt runs before
// the opt-out either way).
export const REFUSAL_SWEEP: string[] = [
  'supply 10 USDC to aave on base', 'withdraw 10 USDC from aave on arbitrum', 'lend 10 USDC on morpho on arbitrum',
  'buy $10 of ZZQX', 'swap 10 ZZQX for USDC on base', 'sell all my ZZQX', 'buy $10 of AAPL on base',
  'swap 10 USDC for USDC on base', 'limit order: buy 1 ETH for at most 100 USDC on arbitrum chain 999',
  'long $5 of HYPE on hyperliquid', 'long $10 of ZZQX on hyperliquid', 'protect my ZZQX long with a 5% stop',
  'stake 0.0001 ETH on lido', 'bridge 5 USDC from base to solana', 'send 5 USDC to @nate',
  'Buy $50 of ETH', 'Buy $10 of AAPL', 'Sell $50 of ETH', 'Supply $25 of USDC to Aave',
  'Why is ETH moving?', 'What is the current price and 24h change for ETH?', 'buy some apple stock',
  'is TSLA a good trade right now', 'should I buy HYPE',
]

async function live(base: string) {
  const { classifyTurn } = await import('../lib/ask-failure')
  const { moneyShaped } = await import('../lib/ask-failure-shape')
  const wallet = '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
  let bare = 0
  for (const ask of REFUSAL_SWEEP) {
    let d: Record<string, unknown> | null = null
    try {
      const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1' }, body: JSON.stringify({ message: ask, history: [], walletAddress: wallet, sessionId: `harness-deadends-${Date.now()}` }) })
      d = r.headers.get('content-type')?.includes('json') ? ((await r.json()) as Record<string, unknown>) : { reply: '(stream)', streamed: true }
    } catch (e) { d = { error: (e as Error).message } }
    const k = d?.streamed ? null : classifyTurn(d).kind
    const money = moneyShaped(ask)
    const chips = ((d?.clarify as { options?: { resume: string }[] })?.options ?? []).map((o) => o.resume)
    const isBare = !!k && money
    if (isBare) bare++
    console.log(`${isBare ? '❌' : k ? '·' : '✅'} ${ask}\n     ${k ?? 'actionable'} · ${String(d?.buildPath ?? '')} · ${chips.length ? `chips: ${chips.join(' | ')}` : 'no chips'}\n     ${String(d?.reply ?? d?.error ?? '').replace(/\s+/g, ' ').slice(0, 220)}`)
  }
  console.log(`\nrefusal sweep: ${REFUSAL_SWEEP.length} asks · ${bare} money asks with nothing to tap`)
  process.exit(bare ? 1 : 0)
}

if (require.main === module) {
  if (process.argv.includes('--live')) void live((process.env.BASE || 'http://localhost:4072').replace(/\/$/, ''))
  else main()
}
