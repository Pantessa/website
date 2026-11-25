// Pins for "a symbol page's asks run in the app" (2026-11-16; lib/symbol-ask,
// lib/ask-door `handoff`, SymbolPage, AskChart). Nate on /t/AAPL: "let's not
// direct AI chat buys or questions to an embed, let's send them to the app
// page and make sure to add the correct MCPs the user will need to run the
// prompt." Pure: no server, no chain, no DB. Called from scripts/test-api.ts,
// and runnable alone:
//   npx tsx scripts/symbol-ask-pins.ts
import { readFileSync } from 'node:fs'
import { arrivalAllowed, ARRIVAL_MAX_MCPS } from '../lib/arrival-fence'
import { useAskDoor } from '../lib/ask-door'
import { FIRST_PARTY_APP_SLUGS } from '../lib/ask-apps'
import { chartPairFor } from '../lib/charts'
import { earnsChatCard, midChatCardServers } from '../lib/splash/types'
import { namesSymbol, pairVenueApp, symbolAskApps, symbolAskNeedsWallet, symbolAskText } from '../lib/symbol-ask'

type Check = (name: string, ok: boolean, extra?: string) => void
const rf = (p: string) => readFileSync(p, 'utf8')
/** Source with comments removed: a pin on what the code DOES must not pass on a sentence in a header. */
const code = (p: string) => rf(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

export function symbolAskPins(check: Check) {
  const aapl = chartPairFor('AAPL')!
  const amat = chartPairFor('AMAT')
  const uni = chartPairFor('UNI')!
  const eth = chartPairFor('ETH')!
  const hype = chartPairFor('HYPE')!
  const near = 'near-intents-mcp-yeetful'

  // ── the apps ────────────────────────────────────────────────────────────
  const buyAapl = symbolAskApps('Buy $355.65 of AAPL', aapl)
  const buyAmat = amat ? symbolAskApps('Buy $25 of AMAT', amat) : ['robinhood-free', near]
  check('symbol ask (apps): a stock buy arrives with Robinhood (the page knows the venue even when the sentence matches no stock word: AMAT) and NEAR Intents as the funding companion',
    buyAapl[0] === 'robinhood-free' && buyAapl.includes(near) && buyAmat[0] === 'robinhood-free' && buyAmat.includes(near), `${buyAapl.join(',')} | ${buyAmat.join(',')}`)
  const buyUni = symbolAskApps('Buy $25 of UNI', uni)
  const limitUni = symbolAskApps('limit order: buy 2.7778 UNI for at most 25 USDC on Ethereum', uni)
  const longUni = symbolAskApps('2x Long $25 of UNI on Hyperliquid, then protect my UNI long with a 5% stop', uni)
  const stakeEth = symbolAskApps('Stake 0.01 ETH on Lido', eth)
  const supplyEth = symbolAskApps('Supply $50 of LINK to Aave', chartPairFor('LINK')!)
  check('symbol ask (apps): a coin\'s plain buy arrives with Uniswap (no swap word in the sentence); a sentence that names its own venue brings THAT app and no Uniswap (CoW limit, Hyperliquid perp, Lido stake, Aave supply)',
    buyUni[0] === 'uniswap-free' && buyUni.includes(near) &&
      limitUni.includes('cow-free') && !limitUni.includes('uniswap-free') &&
      longUni.includes('hyperliquid-free') && !longUni.includes('uniswap-free') &&
      stakeEth.includes('lido-free') && !stakeEth.includes('uniswap-free') &&
      supplyEth.includes('aave') && !supplyEth.includes('uniswap-free'),
    [buyUni, limitUni, longUni, stakeEth, supplyEth].map((a) => a.join(',')).join(' | '))
  const longHype = symbolAskApps('Long $25 of HYPE on Hyperliquid', hype)
  check('symbol ask (apps): a Hyperliquid chart leads with Hyperliquid, once', longHype[0] === 'hyperliquid-free' && longHype.filter((s) => s === 'hyperliquid-free').length === 1, longHype.join(','))
  const whyAapl = symbolAskApps('Why is AAPL moving?', aapl)
  const whyUni = symbolAskApps('what is the trend here? (UNI)', uni)
  const index = chartPairFor('US10Y')
  check('symbol ask (apps): a QUESTION arrives with the symbol\'s venue app for its reads and never the funding companion; an index names no app at all',
    whyAapl.join(',') === 'robinhood-free' && whyUni.join(',') === 'uniswap-free' && pairVenueApp(index ?? { source: 'index' }) === null && pairVenueApp(null) === null, `${whyAapl.join(',')} | ${whyUni.join(',')}`)
  const withCaller = symbolAskApps('Fix gas on Arbitrum', eth, ['near-intents'])
  const all = [buyAapl, buyAmat, buyUni, limitUni, longUni, stakeEth, supplyEth, longHype, whyAapl, whyUni, withCaller]
  check('symbol ask (apps): a caller\'s apps ride along (a wallet flag\'s bridge leg), every list is deduped, first-party, slug-shaped and inside the arrival fence\'s cap',
    withCaller.includes('near-intents') && all.every((a) => new Set(a).size === a.length && a.length <= ARRIVAL_MAX_MCPS && a.every((s) => FIRST_PARTY_APP_SLUGS.has(s) || s.startsWith('yeetful-tool-'))), withCaller.join(','))

  // ── the text ────────────────────────────────────────────────────────────
  check('symbol ask (text): a question that does not name the symbol carries it; one that does, and every money-shaped sentence, travels exactly as typed (a typed swap of two other tokens gains nothing)',
    symbolAskText('why is it moving?', aapl) === 'why is it moving? (AAPL)' &&
      symbolAskText('  Why is AAPL moving?  ', aapl) === 'Why is AAPL moving?' &&
      symbolAskText('is $uni cheap here', uni) === 'is $uni cheap here' &&
      symbolAskText('Buy $355.65 of AAPL', aapl) === 'Buy $355.65 of AAPL' &&
      symbolAskText('swap $5 of ETH to USDC', uni) === 'swap $5 of ETH to USDC' &&
      symbolAskText('buy $20', uni) === 'buy $20' &&
      symbolAskText('', aapl) === '' && symbolAskText('what now', null) === 'what now')
  check('symbol ask (text): a short ticker only counts in capitals ("op" and "w" are words), a longer one in any case, and never inside another word',
    namesSymbol('is OP cheap', 'OP') && !namesSymbol('what is the op here', 'OP') && namesSymbol('uni looks strong', 'UNI') && !namesSymbol('the universe', 'UNI') && !namesSymbol('uniswap volume', 'UNI') && namesSymbol('why $AAPL?', 'AAPL'))
  check('symbol ask (wallet): looking needs no wallet, acting does — only a money-shaped sentence goes through the connect door',
    symbolAskNeedsWallet('Buy $355.65 of AAPL') && symbolAskNeedsWallet('2x Long $25 of UNI on Hyperliquid, then protect my UNI long with a 5% stop') && !symbolAskNeedsWallet('Why is AAPL moving?') && !symbolAskNeedsWallet('why is it moving? (AAPL)'))

  // ── the handoff record passes the receiver's fence ──────────────────────
  const now = 1_800_000_000_000
  const records = [
    { text: 'Buy $355.65 of AAPL', mcps: buyAapl, from: '/t/AAPL' },
    { text: symbolAskText('why is it moving?', aapl), mcps: whyAapl, from: '/t/AAPL' },
    { text: '2x Long $25 of UNI on Hyperliquid, then protect my UNI long with a 5% stop', mcps: longUni, from: '/t/UNI' },
  ]
  check('symbol ask (handoff): the record the page writes (its text, its apps, its /t path) is one the arrival fence lets RUN on /chat',
    records.every((r) => arrivalAllowed({ v: 1, at: now, ...r }, now).ok), records.map((r) => JSON.stringify(arrivalAllowed({ v: 1, at: now, ...r }, now))).join(' '))

  // ── the door ────────────────────────────────────────────────────────────
  const sent: unknown[] = []
  const door = useAskDoor.getState()
  door.setHandoff((text, opts) => sent.push([text, opts ?? null]))
  useAskDoor.getState().openDoor('Fix gas on Arbitrum', { send: true, mcps: ['near-intents'] })
  const afterSend = useAskDoor.getState()
  const shutOnSend = afterSend.open === false && afterSend.fire === null
  useAskDoor.getState().openDoor('Why is AAPL moving?')
  const drafted = useAskDoor.getState()
  const opensAsComposer = drafted.open === true && drafted.draft === 'Why is AAPL moving?' && drafted.fire === null
  useAskDoor.getState().closeDoor()
  useAskDoor.getState().setDraft('')
  useAskDoor.getState().setHandoff(null)
  useAskDoor.getState().openDoor('Buy $5 of ETH', { send: true })
  const sheetRuns = useAskDoor.getState().fire?.text === 'Buy $5 of ETH' && useAskDoor.getState().open === true
  useAskDoor.getState().takeFire()
  useAskDoor.getState().closeDoor()
  check('symbol ask (door): while a page hands its asks to the app, a SEND handed to the door goes to the page (with its apps) and the sheet stays shut, a draft still opens the sheet as a composer and fires nothing; with no handoff the sheet runs the ask again',
    sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(['Fix gas on Arbitrum', { mcps: ['near-intents'] }]) && shutOnSend && opensAsComposer && sheetRuns, JSON.stringify(sent))

  // ── the wiring, at the source ───────────────────────────────────────────
  const sp = code('components/markets/shell/SymbolPage.tsx')
  const ac = code('components/markets/ai/AskChart.tsx')
  const ad = code('components/AskDoor.tsx')
  const store = code('lib/ask-door.ts')
  const css = rf('components/markets/ai.css')
  check('symbol ask (wired, page): the handoff to /chat names its apps (lib/symbol-ask), the order ticket\'s button IS the act door, the say row and the ⌘K door share one sender (a nav ask navigates, a question skips the wallet, a trade takes the connect door), and the page takes the door\'s sends for as long as it is mounted',
    sp.includes("writeArrivalIntent({ text: ask, from: pathname ?? '', mcps: symbolAskApps(ask, pair, extra) })") && sp.includes('router.push(handed ? ARRIVAL_APP_HREF : promptHref(ask))') &&
      sp.includes('const orderToApp = act') && (sp.match(/onBuild=\{orderToApp\}/g) ?? []).length === 2 && sp.includes('onBuild={orderToApp} onSay={sayToApp} />') &&
      sp.includes('const nav = askDoorNav(said)') && sp.includes('const ask = symbolAskText(said, pair)') && sp.includes('if (symbolAskNeedsWallet(ask)) act(ask)') && sp.includes('else runAsk(ask)') &&
      sp.includes('useAskDoor.getState().setHandoff(sayToApp)') && sp.includes('return () => useAskDoor.getState().setHandoff(null)'))
  check('symbol ask (wired, no embed): nothing on the symbol page mounts a chat runtime or docks the door — SymbolPage and AskChart import no ChatInterface, the store has no dock, the panel hands an act to the page (onAsk) and sends the chart lane no order',
    !/ChatInterface/.test(sp) && !/ChatInterface/.test(ac) && !/\bsetDock\b|\bdock\b/.test(store) && !/\.dock\b|setDock/.test(sp) && !/\.dock\b/.test(ad) &&
      ac.includes("if (reply.kind === 'act') toApp(id, reply.chip.ask)") && ac.includes('onAsk?.(ask)') && !/\border:/.test(ac) && !ac.includes('injectedPrompt') && !ac.includes('useConnectToAct') &&
      ac.includes('onClick={appOnClick(s.ask)}') && ac.includes('href={promptHref(s.ask)}') && ac.includes('A TRADE OPENS IN THE APP · YOUR WALLET SIGNS · THE REST ANSWER HERE') &&
      !css.includes('.mk-ask__ticket') && !css.includes('.mk-ask__runtime'))
  check('symbol ask (wired, sheet): on a page with a handoff the ⌘K sheet is only the composer — its send closes it and goes to the page, after the navigation asks and before any runtime is mounted',
    /const handoff = useAskDoor\.getState\(\)\.handoff\s+if \(handoff\) \{\s+setDraft\(''\)\s+closeDoor\(\)\s+handoff\(text\)\s+return\s+\}\s+setCurrentChatId\(null\)/.test(ad) && ad.indexOf('const href = askDoorNav(text)') < ad.indexOf('const handoff = useAskDoor.getState().handoff'))
  const ci = code('components/ChatInterface.tsx')
  check('symbol ask (wired, receiver): /chat fires an arrival with the apps its page named, and an ask it has to PARK (no wallet here, or "Don\'t run it") keeps those apps for the unedited send',
    ci.includes('setComposerSend({ text: arrival.text, mcps: arrival.mcps })') && (ci.match(/parkAsk\(arrival\.text, arrival\.mcps\)/g) ?? []).length === 2 && ci.includes('parkedAppsRef.current = [...apps]') && ci.includes('sendChip(text, parkedAppsRef.current)'))

  // ── no card for an app the ask turned on (Nate, 2026-11-17) ─────────────
  // A TSLA buy handed from /t/TSLA compiled its job, and under it sat a
  // Robinhood Chain card: "Nothing here yet, try one of these".
  const rh = { id: 'rh', slug: 'robinhood-free', name: 'Robinhood Chain' }
  const other = { id: 'x', slug: 'some-mcp', name: 'Some MCP' }
  check('symbol ask (no card): an app an ask turned on earns no card in the chat, even when it can paint one and even when it was hand-picked on an earlier day; the same app opened by hand still does, and an app that can paint nothing needs the hand pick',
    !earnsChatCard(rh, [], new Set(['rh'])) && !earnsChatCard(rh, ['robinhood-free'], new Set(['rh'])) &&
      earnsChatCard(rh, [], new Set()) && earnsChatCard(rh, ['robinhood-free'], new Set(['x'])) &&
      !earnsChatCard(other, [], new Set()) && earnsChatCard(other, ['some-mcp'], new Set()) && !earnsChatCard(other, ['some-mcp'], new Set(['x'])))
  check('symbol ask (no card, wired): both places an ask turns apps on (the pre-send effect, the route\'s echoed apps) note the ids, the card list and the splash gate both read the one rule, and an app that goes off again is forgotten so a later hand pick earns its card',
    (ci.match(/noteAskApps\(missing\)/g) ?? []).length === 1 && (ci.match(/noteAskApps\(fresh\.map\(\(r\) => r\.id\)\)/g) ?? []).length === 1 &&
      (ci.match(/earnsChatCard\(s, manualSlugs, askAppsRef\.current\)/g) ?? []).length === 2 && !/splashCapable/.test(ci) &&
      ci.includes('if (!activeServerIds.includes(id)) askAppsRef.current.delete(id)'))

  // ── no card under an ask that ran on arrival (Nate, 2026-11-25) ─────────
  // "2x Long $25 of XMR" pressed on the home ran in /chat; the wallet's saved
  // apps landed after the send and the Pantessa Wallet card painted under the job.
  const wallet = { id: 'w', slug: 'yeetful-tool-wallet', name: 'Pantessa Wallet' }
  check('symbol ask (no late card): past the first message only an app switched on by hand SINCE earns a card; one the boot brought in late, one hand-picked before the conversation began and one that already has a card earn none',
    midChatCardServers([wallet, rh], new Set(), [], new Set()).length === 0 &&
      midChatCardServers([wallet, rh], new Set(), ['robinhood-free'], new Set(['robinhood-free'])).length === 0 &&
      midChatCardServers([wallet, rh], new Set(), ['robinhood-free'], new Set()).map((s) => s.id).join() === 'rh' &&
      midChatCardServers([wallet, rh], new Set(['rh']), ['robinhood-free'], new Set()).length === 0)
  check('symbol ask (no late card, wired): the chat mints a mid-conversation card through the one rule, and mints no dashboard at all while an ask from another page is arriving',
    ci.includes('midChatCardServers(splashableServers, covered, manualSlugs, manualAtStartRef.current)') &&
      ci.includes('if (emptyChat && arrival) return prev.length ? [] : prev') &&
      ci.includes('if (emptyChat) manualAtStartRef.current = new Set(manualSlugs)'))
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /symbol-ask-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  symbolAskPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
