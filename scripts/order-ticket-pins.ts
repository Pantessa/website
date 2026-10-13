// Pins for the order ticket (lib/order-ticket + its two seats): every
// sentence the form can compose lands native, the honesty rules refuse by
// name, the sizing math, the Available line, and the wiring the page pins
// (the strip's chips open the ticket, the ticket builds through the page's
// dock). Pure: no server, no chain, no DB. Called from scripts/test-api.ts,
// and runnable alone:
//   npx tsx scripts/order-ticket-pins.ts
import { readFileSync } from 'node:fs'
import { chartPairFor } from '../lib/charts'
import { buildsNatively, simulateLadder } from './ask-ladder'
import {
  availableFor,
  composeTicketAsk,
  defaultLimitPrice,
  fallbackSide,
  fmtTicketUnits,
  freshTicket,
  limitChainsFor,
  limitDistancePct,
  parseTicketAmount,
  sizeFromPct,
  ticketAmountKind,
  ticketSidesFor,
  ticketSizes,
  ticketTypesFor,
  usdWord,
  HL_MIN_USD,
  TICKET_AUTO_OPEN_MIN_PX,
  TICKET_SENT_NOTE,
  type TicketState,
} from '../lib/order-ticket'
import { canSellAsk } from '../lib/sell-gate'
import { canTradeAsk } from '../lib/trade-venue-gate'
import type { HeldSymbol } from '../lib/watchlists'
import { followOrderSize, orderSizeOf, ROUTE_USD_PRESETS, routeSizeView, routeUsdOf, sameOrderSize, useOrderSize } from '../lib/order-size'

type Check = (name: string, ok: boolean, extra?: string) => void

const rf = (p: string) => readFileSync(p, 'utf8')

export function orderTicketPins(check: Check): void {
  const eth = chartPairFor('ETH')!
  const uni = chartPairFor('UNI')!
  const aapl = chartPairFor('AAPL')!
  const hype = chartPairFor('HYPE')!
  const sol = chartPairFor('SOL')!
  const link = chartPairFor('LINK')!
  const compose = (pair: typeof eth, side: TicketState['side'], over: Partial<TicketState> = {}, last: number | null = 10) =>
    composeTicketAsk(pair, { ...freshTicket(pair, side, { usd: 25, last, type: over.type }), ...over }, last)
  const askOf = (out: ReturnType<typeof composeTicketAsk>) => (out.ok ? out.ask : `REFUSED: ${out.problem}`)

  // ── 1. The matrix: every shape the form can send lands native ────────────
  const matrix: string[] = []
  for (const pair of [eth, uni, aapl, hype, sol, link]) {
    const last = pair.source === 'robinhood' ? 187.5 : pair.symbol === 'HYPE' ? 42 : pair.symbol === 'SOL' ? 150 : 2447.25
    for (const side of ticketSidesFor(pair)) {
      for (const type of ticketTypesFor(pair, side)) {
        for (const unit of ['usd', 'token'] as const) {
          const base = freshTicket(pair, side, { usd: 25, last, type })
          const variants: Partial<TicketState>[] = [
            { unit, amount: unit === 'usd' ? 25 : 0.0123 },
            { unit, amount: unit === 'usd' ? 12.5 : 1234.5678 },
          ]
          if (side === 'sell') variants.push({ sellAll: true })
          if (side === 'long' || side === 'short') variants.push({ unit: 'usd', amount: 25, leverage: 2, withStop: true, stopPct: 10 }, { unit: 'usd', amount: 100, leverage: 10 })
          if (side === 'protect') variants.push({ stopPct: 15 })
          if (type === 'limit') for (const chain of limitChainsFor(pair.symbol)) variants.push({ unit, amount: unit === 'usd' ? 40 : 3, limitChain: chain.word })
          for (const v of variants) {
            const out = composeTicketAsk(pair, { ...base, ...v }, last)
            if (out.ok) matrix.push(out.ask)
          }
        }
      }
    }
  }
  const dead = matrix.filter((a) => !buildsNatively(a))
  check(
    `order ticket: every sentence the form composes lands native through the ladder replica (${matrix.length} shapes over ETH · UNI · AAPL · HYPE · SOL · LINK — dollars, units, All, limit on every CoW chain, leverage, a stop)`,
    matrix.length >= 60 && dead.length === 0,
    dead.length ? dead.slice(0, 4).join(' | ') : `${matrix.length} shapes`,
  )

  // ── 2. The shapes, one by one ─────────────────────────────────────────────
  check('order ticket: a buy is sized in dollars — "Buy $25 of UNI"; cents keep two decimals ("Buy $12.50 of UNI"); a buy typed in UNITS converts at the live price and the sentence says the dollars (2 UNI at $10 → "Buy $20 of UNI")',
    askOf(compose(uni, 'buy')) === 'Buy $25 of UNI' && askOf(compose(uni, 'buy', { amount: 12.5 })) === 'Buy $12.50 of UNI' && askOf(compose(uni, 'buy', { unit: 'token', amount: 2 })) === 'Buy $20 of UNI',
    `${askOf(compose(uni, 'buy'))} | ${askOf(compose(uni, 'buy', { unit: 'token', amount: 2 }))}`)
  check('order ticket: a unit buy with no live price refuses by name (never a guessed dollar figure); a buy under $1 refuses',
    !compose(uni, 'buy', { unit: 'token', amount: 2 }, null).ok && /live price/.test(askOf(compose(uni, 'buy', { unit: 'token', amount: 2 }, null))) && /start at \$1/.test(askOf(compose(uni, 'buy', { amount: 0.5 }))))
  check('order ticket: a sell opens in UNITS — "Sell 2.5 UNI"; the dollar box sends "Sell $25 of UNI"; the whole holding sends "Sell all my UNI" (sized from the live balance at build)',
    askOf(compose(uni, 'sell', { amount: 2.5 })) === 'Sell 2.5 UNI' && askOf(compose(uni, 'sell', { unit: 'usd', amount: 25 })) === 'Sell $25 of UNI' && askOf(compose(uni, 'sell', { sellAll: true })) === 'Sell all my UNI' &&
      freshTicket(uni, 'sell').unit === 'token' && freshTicket(uni, 'sell').amount === null && freshTicket(uni, 'buy', { usd: 40 }).amount === 40)
  check('order ticket: a stock ticket is Market only and sells in units ("Sell 0.5 AAPL") or all ("Sell all my AAPL"); a perp chart and a non-EVM coin are Market only too; a coin on the spot chains gets Limit',
    ticketTypesFor(aapl, 'buy').join() === 'market' && ticketTypesFor(hype, 'long').join() === 'market' && ticketTypesFor(sol, 'long').join() === 'market' && ticketTypesFor(uni, 'buy').join() === 'market,limit' && ticketTypesFor(eth, 'sell').join() === 'market,limit' &&
      askOf(compose(aapl, 'sell', { amount: 0.5 })) === 'Sell 0.5 AAPL' && askOf(compose(aapl, 'sell', { sellAll: true })) === 'Sell all my AAPL')
  const lb = compose(uni, 'buy', { type: 'limit', limitPrice: 9, amount: 25 })
  const ls = compose(uni, 'sell', { type: 'limit', limitPrice: 11, amount: 2.5, limitChain: 'Base' })
  check('order ticket: a limit BUY sizes its units at the LIMIT price and names the chain — "limit order: buy 2.7778 UNI for at most 25 USDC on Ethereum" (UNI rests on its home chain first); a limit SELL in units — "limit order: sell 2.5 UNI for at least 27.5 USDC on Base"; both land on the swap gate',
    askOf(lb) === 'limit order: buy 2.7778 UNI for at most 25 USDC on Ethereum' && askOf(ls) === 'limit order: sell 2.5 UNI for at least 27.5 USDC on Base' && simulateLadder(askOf(lb)).gate === 'swap' && simulateLadder(askOf(ls)).gate === 'swap' &&
      limitChainsFor('UNI').map((c) => c.word).join() === 'Ethereum,Base,Arbitrum' && limitChainsFor('ETH').map((c) => c.word).join() === 'Base,Ethereum,Arbitrum',
    `${askOf(lb)} | ${askOf(ls)}`)
  check('order ticket: a limit buy AT or ABOVE the market refuses by name (it rests UNDER), a limit sell at or below refuses (OVER), no price refuses, no live price refuses — never a market order in a limit\'s clothes',
    /UNDER/.test(askOf(compose(uni, 'buy', { type: 'limit', limitPrice: 10, amount: 25 }))) && /UNDER/.test(askOf(compose(uni, 'buy', { type: 'limit', limitPrice: 12, amount: 25 }))) &&
      /OVER/.test(askOf(compose(uni, 'sell', { type: 'limit', limitPrice: 9, amount: 2 }))) && /limit price/i.test(askOf(compose(uni, 'sell', { type: 'limit', limitPrice: null, amount: 2 }))) &&
      /live price/.test(askOf(compose(uni, 'buy', { type: 'limit', limitPrice: 9, amount: 25 }, null))))
  check('order ticket: the default limit rests 1% away (9.9 under $10 for a buy, 10.5 over at 5% for a sell) and the distance reads back signed',
    defaultLimitPrice('buy', 10) === 9.9 && defaultLimitPrice('sell', 10, 5) === 10.5 && Math.abs((limitDistancePct(9.9, 10) ?? 0) + 1) < 1e-9 && freshTicket(uni, 'buy', { last: 10, type: 'limit' }).limitPrice === 9.9 && freshTicket(uni, 'buy', { last: 10 }).limitPrice === null)
  const perp = compose(hype, 'long', { amount: 25, leverage: 2, withStop: true, stopPct: 10 }, 42)
  check('order ticket: a perp carries leverage and the stop as ONE sentence — "2x Long $25 of HYPE on Hyperliquid, then protect my HYPE long with a 10% stop" (a jobs-gate claim); venue leverage = no clause; a short with a stop protects the short',
    askOf(perp) === '2x Long $25 of HYPE on Hyperliquid, then protect my HYPE long with a 10% stop' && simulateLadder(askOf(perp)).gate === 'jobs' &&
      askOf(compose(hype, 'long', { amount: 25 }, 42)) === 'Long $25 of HYPE on Hyperliquid' && askOf(compose(hype, 'short', { amount: 25, withStop: true }, 42)) === 'Short $25 of HYPE on Hyperliquid, then protect my HYPE short with a 5% stop' &&
      askOf(compose(uni, 'short', { amount: 50, leverage: 10 })) === '10x Short $50 of UNI on Hyperliquid',
    askOf(perp))
  check(`order ticket: a perp under Hyperliquid's $${HL_MIN_USD} minimum refuses here by name, not at the venue`, /\$10/.test(askOf(compose(hype, 'long', { amount: 5 }, 42))) && !compose(hype, 'long', { amount: 9.99 }, 42).ok && compose(hype, 'long', { amount: 10 }, 42).ok)
  check('order ticket: Protect composes the pair\'s own guardian sentence at the picked stop (spot: in my wallet; perp: my X long); a stake is ETH-only, in units, or dollars at the chart price ("Stake 0.01 ETH on Lido" for $25 at $2500); Supply takes dollars',
    askOf(compose(eth, 'protect', { stopPct: 15 })) === 'Protect my ETH in my wallet with a 15% stop' && askOf(compose(hype, 'protect')) === 'Protect my HYPE long with a 5% stop' &&
      askOf(compose(eth, 'stake', { unit: 'token', amount: 0.5 }, 2500)) === 'Stake 0.5 ETH on Lido' && askOf(compose(eth, 'stake', { unit: 'usd', amount: 25 }, 2500)) === 'Stake 0.01 ETH on Lido' && !compose(uni, 'stake', { unit: 'token', amount: 1 }).ok &&
      askOf(compose(link, 'supply', { amount: 25 })) === 'Supply $25 of LINK to Aave' && ticketAmountKind('protect') === 'none' && ticketAmountKind('buy') === 'either' && ticketAmountKind('long') === 'usd')

  // ── 3. Numbers in a sentence never carry what a grammar can't read ───────
  check('order ticket: units in a sentence carry no separators and no exponent, two decimals from 1,000 up, four from 1, four significant figures under 1 capped at eight decimals, and nothing for dust that rounds to zero',
    fmtTicketUnits(1234.5678) === '1234.57' && fmtTicketUnits(2.5) === '2.5' && fmtTicketUnits(0.00001234) === '0.00001234' && fmtTicketUnits(0.0123) === '0.0123' && fmtTicketUnits(1e-12) === null && fmtTicketUnits(0) === null && fmtTicketUnits(Number.NaN) === null &&
      usdWord(25) === '$25' && usdWord(12.5) === '$12.50' && usdWord(12.346) === '$12.35')
  check('order ticket: the typed box takes digits, one dot, up to eight decimals, dropped separators and a stray $ — nothing else ("1,234.5" → 1234.5, "$12" → 12, "." / "" / "abc" / nine decimals → nothing)',
    parseTicketAmount('25') === 25 && parseTicketAmount('1,234.5') === 1234.5 && parseTicketAmount('$12') === 12 && parseTicketAmount('.') === null && parseTicketAmount('') === null && parseTicketAmount('abc') === null && parseTicketAmount('1.123456789') === null && parseTicketAmount('0') === null)
  check('order ticket: a percent of the basis — a sell at 100% is the whole holding (sellAll, sized at build), 50% of 10 UNI is 5 UNI, 25% of $383.6029 is $95.90 rounded DOWN to the cent; the sizes read both ways at a price',
    sizeFromPct(100, 10, 'sell').sellAll === true && sizeFromPct(50, 10, 'sell').amount === 5 && sizeFromPct(50, 10, 'sell').sellAll === false && sizeFromPct(25, 383.6029, 'buy').amount === 95.9 && sizeFromPct(100, 383.6029, 'buy').sellAll === false && sizeFromPct(100, 383.6029, 'buy').amount === 383.6 &&
      ticketSizes({ unit: 'usd', amount: 25 }, 10).units === 2.5 && ticketSizes({ unit: 'token', amount: 2.5 }, 10).usd === 25 && ticketSizes({ unit: 'token', amount: 2.5 }, null).usd === null)

  // ── 4. The Available line reads the wallet, never guesses ────────────────
  const reads = [
    { id: 8453, name: 'Base', ok: true, stable: { symbol: 'USDC', balance: 383.6029 } },
    { id: 1, name: 'Ethereum', ok: true, stable: { symbol: 'USDC', balance: 12 } },
    { id: 42161, name: 'Arbitrum', ok: false },
    { id: 4663, name: 'Robinhood Chain', ok: true, stable: { symbol: 'USDG', balance: 0 } },
  ]
  const av = availableFor(uni, reads)
  const avStock = availableFor(aapl, reads)
  check('order ticket: Available leads with the richest chain the buy can draw on and names the rest — "Available · $383.60 USDC on Base · $12.00 on Ethereum" (an unread chain is never a zero); a stock reads USDG on Robinhood Chain and an empty one says the build funds it; no reads → nothing said',
    av?.text === 'Available · $383.60 USDC on Base · $12.00 on Ethereum' && av.usd === 383.6 && av.chainId === 8453 && av.symbol === 'USDC' &&
      avStock?.usd === null && /No USDG on Robinhood Chain yet/.test(avStock.text) && availableFor(uni, null) === null && availableFor(uni, [{ id: 8453, name: 'Base', ok: false }]) === null && availableFor(aapl, reads.slice(0, 2)) === null,
    `${av?.text} | ${avStock?.text}`)

  // ── 5. The gates the chips answer to answer the ticket's sentence too ────
  const heldUniEth: HeldSymbol[] = [{ symbol: 'UNI', valueUsd: 25, amount: 2.5, chains: ['Ethereum'], chainIds: [1] }]
  check('order ticket: the sentence passes the same two gates as a chip — a unit sell needs the holding (unknown holdings = no), a limit sell on Base needs the token ON Base, a buy passes, and a limit order is left alone by the venue gate',
    canSellAsk('Sell 2.5 UNI', null) === false && canSellAsk('Sell 2.5 UNI', heldUniEth) === true && canSellAsk('Sell all my UNI', heldUniEth) === true &&
      canSellAsk('limit order: sell 2.5 UNI for at least 27.5 USDC on Base', heldUniEth) === false && canSellAsk('limit order: sell 2.5 UNI for at least 27.5 USDC on Ethereum', heldUniEth) === true &&
      canSellAsk('Buy $25 of UNI', null) === true && canTradeAsk('limit order: buy 2.7778 UNI for at most 25 USDC on Ethereum', {}) === true)
  check('order ticket: a side that leaves the honest set falls back to the first side still offered, and nothing when none is',
    fallbackSide('sell', ['buy', 'long']) === 'buy' && fallbackSide('long', ['buy', 'long']) === 'long' && fallbackSide('sell', []) === null && TICKET_AUTO_OPEN_MIN_PX === 900 && /under the chart/.test(TICKET_SENT_NOTE.strip) && /above the tabs/.test(TICKET_SENT_NOTE.card))

  // ── 6. The wiring the page pins ──────────────────────────────────────────
  const es = rf('components/markets/trade/ExecStrip.tsx')
  const ot = rf('components/markets/trade/OrderTicket.tsx')
  const sp = rf('components/markets/shell/SymbolPage.tsx')
  const tt = rf('components/markets/tabs/TradeTab.tsx')
  const css = rf('components/markets/trade/trade.css')
  check('order ticket (wired): the header strip\'s chips OPEN the ticket on their side (aria-pressed on the open one, the /chat prefill href kept as the no-JS fallback) and the ticket sends through the page\'s BUILD door, the act door when there is none; the server renders chips only',
    es.includes("import OrderTicket from '@/components/markets/trade/OrderTicket'") && es.includes('aria-pressed={shown === a.side}') && es.includes('onSend={onBuild ?? onAsk}') && es.includes('data-ticket={shown ?? undefined}') &&
      es.includes('const [ticket, setTicket] = useState<TicketSide | null>(null)') && es.includes('TICKET_AUTO_OPEN_MIN_PX') && es.includes('pickOnClick(a.side)'))
  check('order ticket (wired): SymbolPage hands both seats a build door that docks the sentence in Ask the chart\'s order ticket (lib/ask-door dock, send: true) and falls back to the act door; the Trade tab\'s order card IS the ticket (seat card) inside the pinned mkt-order section',
    sp.includes('const dock = useAskDoor.getState().dock') && sp.includes('if (dock) dock(ask, { send: true })') && sp.includes('onBuild={buildHere} last={stats?.last ?? null} />') && (sp.match(/onBuild=\{buildHere\}/g) ?? []).length === 2 &&
      tt.includes('seat="card"') && tt.includes('<section className="mkt-card mkt-order" aria-label={`Trade ${symbol}`}>') && tt.includes('onSend={onBuild ?? askText}') && tt.includes('const noOrder = sides.length === 0'))
  check('order ticket (wired): the form\'s box is a decimal keyboard, its button sends the composed sentence and nothing else, the live quote is the venue map\'s own read (never a build), and the CSS is one size container with 44px targets on touch',
    ot.includes('inputMode="decimal"') && ot.includes('onSend(out.ask)') && ot.includes("fetch(`/api/markets/routes?") && !ot.includes('/api/chat') && ot.includes('disabled={!out.ok || !allowed}') &&
      css.includes('.mkt-ticket { container: mkt-ticket / inline-size;') && css.includes('@container mkt-ticket (min-width: 640px)') && /@media \(hover: none\) \{\s*\.mkt-ticket__tab, \.mkt-ticket__preset, \.mkt-ticket__unit, \.mkt-ticket__px \{ min-height: 44px; \}/.test(css))

  // ── 7. One size for the page (lib/order-size, 2026-10-07) ────────────────
  // Nate: "when I enter my own amount can you update the amounts here" — the
  // venue map quoted $50 a row beside a $25 ticket. The pure rules first.
  check('order size (pure): a size is a dollar of at least $1 on a symbol, to the cent; leverage rides only above 1; nothing, NaN, $0.99 and an empty symbol publish nothing',
    orderSizeOf('UNI', 25.555, null, 'a')?.usd === 25.56 && orderSizeOf('UNI', 25, 1, 'a')?.leverage === null && orderSizeOf('HYPE', 25, 2.4, 'a')?.leverage === 2 &&
      orderSizeOf('UNI', 0.99, null, 'a') === null && orderSizeOf('UNI', null, null, 'a') === null && orderSizeOf('UNI', Number.NaN, null, 'a') === null && orderSizeOf('', 25, null, 'a') === null)
  check('order size (pure): two sizes agree on symbol, dollar and leverage, never on who wrote them; a follower takes a size set on ITS symbol by SOMEONE ELSE only',
    sameOrderSize({ symbol: 'UNI', usd: 25, leverage: null }, { symbol: 'UNI', usd: 25.004, leverage: null }) && !sameOrderSize({ symbol: 'UNI', usd: 25, leverage: null }, { symbol: 'UNI', usd: 25.01, leverage: null }) &&
      !sameOrderSize({ symbol: 'UNI', usd: 25, leverage: null }, { symbol: 'ETH', usd: 25, leverage: null }) && !sameOrderSize({ symbol: 'HYPE', usd: 25, leverage: 2 }, { symbol: 'HYPE', usd: 25, leverage: null }) && !sameOrderSize(null, { symbol: 'UNI', usd: 25, leverage: null }) &&
      followOrderSize({ symbol: 'UNI', usd: 25, leverage: null, by: 'ticket' }, 'UNI', 'table')?.usd === 25 && followOrderSize({ symbol: 'UNI', usd: 25, leverage: null, by: 'ticket' }, 'UNI', 'ticket') === null &&
      followOrderSize({ symbol: 'UNI', usd: 25, leverage: null, by: 'ticket' }, 'ETH', 'table') === null && followOrderSize(null, 'UNI', 'table') === null)
  check('order size (pure): the route table shows a followed dollar on its lit preset when it IS one, else in the custom box as a whole dollar (never under $1); the presets are the table\'s own five',
    routeSizeView(25).preset === 25 && routeSizeView(25).custom === '' && routeSizeView(25.5).preset === null && routeSizeView(25.5).custom === '26' && routeSizeView(25.4).custom === '25' &&
      routeSizeView(250).preset === 250 && routeSizeView(0.2).custom === '1' && routeUsdOf(49.5) === 50 && ROUTE_USD_PRESETS.join(',') === '10,25,50,100,250')
  {
    // The store returns the SAME state for an unchanged size whoever wrote it
    // (a follower re-publishing what it followed moves nothing), and a new
    // dollar or leverage is a new state.
    const store = useOrderSize
    store.getState().clear()
    store.getState().setSize({ symbol: 'UNI', usd: 25, leverage: null, by: 'ticket' })
    const first = store.getState().size
    store.getState().setSize({ symbol: 'UNI', usd: 25, leverage: null, by: 'table' })
    const sameAgain = store.getState().size === first && first?.by === 'ticket'
    store.getState().setSize({ symbol: 'UNI', usd: 30, leverage: null, by: 'table' })
    const moved = store.getState().size?.usd === 30 && store.getState().size?.by === 'table'
    store.getState().setSize({ symbol: 'UNI', usd: 30, leverage: 2, by: 'ticket' })
    const lev = store.getState().size?.leverage === 2 && store.getState().size?.by === 'ticket'
    store.getState().clear()
    check('order size (store): an unchanged size is a no-op (the first writer stays — no two surfaces can chase each other), a new dollar or a leverage is a new state, clear empties it',
      sameAgain && moved && lev && store.getState().size === null)
  }
  check('order size (wired): the ticket SEEDS a fresh mount from a size already set on its symbol (the remembered default applies to a cold page only), publishes its dollars from an effect keyed on the AMOUNT and the UNIT (never the price, which ticks) with a perp\'s leverage, never re-publishes a change it FOLLOWED (two tickets chased each other 25 ↔ 100 until React gave up), reads the store LIVE when it follows (the render\'s snapshot can predate a publish in the same commit), and a protect ticket (no amount) neither publishes nor follows',
    ot.includes("import { followOrderSize, orderSizeOf, useOrderSize } from '@/lib/order-size'") && ot.includes('}, [st.amount, st.unit, st.leverage, amountKind, isPerp, sym, sizeId, setSize])') &&
      ot.includes('const seed = followOrderSize(useOrderSize.getState().size, pair.symbol, sizeId)') && ot.includes('usd: seed?.usd ?? TICKET_DEFAULT_USD') && ot.includes('if (seededRef.current) return') && ot.includes('const followingRef = useRef(seededRef.current)') && ot.includes("return seed?.leverage != null && isPerpSide(side) ? { ...fresh, leverage: seed.leverage } : fresh") &&
      ot.indexOf('const sizeId = useId()') < ot.indexOf('const [st, setSt] = useState<TicketState>') &&
      ot.includes('const next = orderSizeOf(sym, usd, isPerp ? st.leverage : null, sizeId)') && ot.includes("setSt((s) => ({ ...s, unit: 'usd', amount: live.usd, sellAll: false, ...(lev != null ? { leverage: lev } : {}) }))") &&
      /if \(followingRef\.current\) \{\s*followingRef\.current = false\s*return\s*\}/.test(ot) && ot.indexOf('followingRef.current = true') < ot.indexOf("setSt((s) => ({ ...s, unit: 'usd', amount: live.usd") &&
      ot.includes('const live = followOrderSize(useOrderSize.getState().size, sym, sizeId)') && ot.includes('const lev = isPerp && live.leverage != null && live.leverage !== stRef.current.leverage ? live.leverage : null') && ot.includes('if (sameUsd && lev == null) return') &&
      ot.includes("if (!followed || amountKind === 'none') return") && ot.includes("if (amountKind === 'none') return") && !ot.includes('}, [st.amount, st.unit, st.leverage, amountKind, isPerp, sym, sizeId, setSize, last])'))
  const rt = rf('components/markets/trade/RouteTable.tsx')
  check('order size (wired): the route table seeds a fresh mount from a size already set on its symbol (one read, not two), follows a later one onto a lit preset or the custom box plus the slider, and its own presets and box publish back under its own id; the presets are lib/order-size\'s',
    rt.includes("import { followOrderSize, orderSizeOf, ROUTE_USD_PRESETS, routeSizeView, useOrderSize } from '@/lib/order-size'") && rt.includes('export const ROUTE_AMOUNTS = ROUTE_USD_PRESETS') &&
      rt.includes('const followed = followOrderSize(sharedSize, pair.symbol, sizeId)') && rt.includes('useState<number>(() => (followed ? (routeSizeView(followed.usd).preset ?? amountProp ?? DEFAULT_ROUTE_USD) : (amountProp ?? DEFAULT_ROUTE_USD)))') &&
      rt.includes('if (view.preset != null) setAmount(view.preset)') && rt.includes('if (live.leverage != null) setLeverage(Math.min(LEVERAGE_MAX, Math.max(1, live.leverage)))') && rt.includes('const live = followOrderSize(useOrderSize.getState().size, pair.symbol, sizeId) ?? followed') &&
      rt.includes('const next = orderSizeOf(pair.symbol, usd, null, sizeId)') && (rt.match(/publishSize\(/g) ?? []).length === 2 && rt.includes('const publishSize = (usd: number) => {'))
  // The header: the quote under the logo, the act seat on the right (CSS
  // only — the DOM order the harness pins is untouched).
  const mk = rf('components/markets/markets.css')
  const headBlock = mk.split('@container sym-head (min-width: 760px) {')[1]?.split('\n}')[0] ?? ''
  check('order ticket (header): the symbol header sits in a seat that is the size container (the chart stays outside it) and, from 760px of column width, ONE grid whose rows run across both columns (re-pinned 2026-10-08) — the logo in its own gutter, title / quote / meta down the left, eyebrow / chips / ticket down the right on the same rows, the guide seat a full row under; the quote left-aligns there',
    mk.includes('.sym__headseat { container: sym-head / inline-size; min-width: 0; }') && sp.includes('<div className="sym__headseat">') && sp.indexOf('<div className="sym__headseat">') < sp.indexOf('<header className="sym__head sym__head--mk2">') && !sp.includes('className="sym__headseat">\n        <div ref={shellRef}') && headBlock.includes('grid-template-areas: "logo . title . acta" "logo . quote . actb" ". . meta . actc";') && headBlock.includes('grid-template-rows: auto auto auto;') &&
      // RE-PINNED 2026-10-08 (header grid): the rows run ACROSS both columns —
      // the act seat's wrappers are `display: contents` and its eyebrow / chips /
      // ticket are placed by area (acta / actb / actc), the logo hangs in its own
      // gutter, the guide seat is row 4.
      headBlock.includes('.sym__head--mk2 > .sym__quote { grid-area: quote; justify-content: start; align-self: start; }') &&
      headBlock.includes('.sym__head--mk2 > .sym__id, .sym__head--mk2 > .sym__id > .sym__idtext, .sym__head--mk2 > .sym__exec, .sym__head--mk2 > .sym__exec > .sym__act { display: contents; }') &&
      headBlock.includes('.sym__head--mk2 .sym__act > .mkt-ticket--strip { grid-area: actc; margin-top: 0; }') && sp.includes('<div className="sym__idtext min-w-0">') &&
      headBlock.includes('.sym__head--mk2 > .guide-seat { grid-column: 1 / -1; grid-row: 4; margin-top: 0; }') && !sp.includes('sym__quote" style'),
    `block=${headBlock.length}`)
  check('order ticket (column seat): between 420 and 640px of ticket width the size row is box + presets on one line, the estimate and the slider under (grid order, no named areas), the button keeps the row, and the × keeps the corner while the available line takes its own',
    css.includes('@container mkt-ticket (min-width: 420px) and (max-width: 639.98px) {') && css.includes('.mkt-ticket__size > .mkt-ticket__presets { order: 1; justify-content: flex-end; }') &&
      css.includes('.mkt-ticket__eq { order: 2; grid-column: 1 / -1; }') && (css.split('@container mkt-ticket (max-width: 639.98px) {')[1]?.split('\n}')[0] ?? '').includes('.mkt-ticket__x { margin-left: auto; }'))
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /order-ticket-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  orderTicketPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
