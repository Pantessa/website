// Pins for THE APPS PAGE contract (squad apps-page, 2026-11-17; lib/apps-page,
// components/apps, ChatWorkspace's dock). Nate: "if just Uniswap is selected
// it's a killer app in itself … less data would show as they deselect items …
// make sure the AI app chat is easy to find no matter the scroll."
// Pure: no server, no chain, no DB. Called from scripts/test-api.ts, and
// runnable alone:  npx tsx scripts/apps-page-pins.ts
import { readFileSync } from 'node:fs'
import {
  APP_FAMILIES,
  appFamily,
  appsViewOn,
  askPlaceholder,
  chatScopeLabel,
  densityEyebrow,
  densityFor,
  dockSuggestions,
  lineFor,
  needsLeads,
  needsYouRows,
  pageHeadline,
  pageTotalUsd,
  quietSentence,
  sectionDensityFor,
  splitPageTiles,
} from '../lib/apps-page'
import type { RowsTile, SplashTile } from '../lib/splash/types'

type Check = (name: string, ok: boolean, extra?: string) => void
const rf = (p: string) => readFileSync(p, 'utf8')
/** Source with comments removed: a pin on what the code DOES must not pass on a sentence in a header. */
const code = (p: string) => rf(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const base = { mcpName: 'X', title: '', prompts: [] as { label: string; prompt: string }[] }
const briefing: RowsTile = {
  ...base, id: 'briefing', mcpSlug: 'yeetful', render: 'rows',
  rows: [
    { label: '$152.50 of ETH on Base has no stop.', tone: 'neg', actions: [{ label: 'Protect it', prompt: 'Protect my spot ETH with a 10% stop loss' }] },
    { label: 'ETH is up 2% today.' },
  ],
}
const dca: RowsTile = { ...base, id: 'dca-schedules', mcpSlug: 'yeetful', render: 'rows', rows: [{ label: '$10 → AAPL weekly', value: 'due now' }] }
const holdings: SplashTile = {
  ...base, id: 'portfolio-holdings', mcpSlug: 'uniswap-free', render: 'holdings', totalUsd: 6306.4, chain: 'x',
  holdings: [{ symbol: 'ETH', address: '0x', balance: '1', priceUsd: 1, valueUsd: 1 }, { symbol: 'USDC', address: '0x', balance: '1', priceUsd: 1, valueUsd: 1 }],
  prompts: [{ label: 'Swap', prompt: 'Swap $50 of ETH to USDC' }],
}
const votes: SplashTile = {
  ...base, id: 'snapshot-proposals', mcpSlug: 'snapshot-free', render: 'proposals', spaces: [],
  proposals: [{ id: '1', title: 'Upgrade the hook', spaceId: 's', spaceName: 'Uniswap', avatarUrl: '', choices: ['For'], leadingChoice: 'For', endsAt: 0 }],
}
const quietHl: SplashTile = { ...base, id: 'hl', mcpSlug: 'hyperliquid-free', render: 'empty', message: 'Nothing open.' }

export function appsPagePins(check: Check) {
  // ── density: the selected apps are the page ───────────────────────────────
  check('apps page (density): no app is empty, ONE app is shown in full, two or three sit side by side, four or more get one line each',
    densityFor(0) === 'empty' && densityFor(1) === 'full' && densityFor(2) === 'side' && densityFor(3) === 'side' && densityFor(4) === 'lines' && densityFor(9) === 'lines' &&
      sectionDensityFor('full') === 'full' && sectionDensityFor('side') === 'side' && sectionDensityFor('lines') === 'line')
  check('apps page (density): the eyebrow says the count and the rule in the page\'s own words',
    densityEyebrow(1) === '1 APP ON THIS PAGE · SHOWN IN FULL' && densityEyebrow(2) === '2 APPS ON THIS PAGE · SIDE BY SIDE' && densityEyebrow(5) === '5 APPS ON THIS PAGE · ONE LINE EACH' && densityEyebrow(0) === 'NO APPS ON THIS PAGE')

  // ── families ──────────────────────────────────────────────────────────────
  const fam = (slug: string, name = slug) => appFamily({ slug, name })
  check('apps page (families): every fleet app lands on its own section; the wallet and funding tools are not mistaken for an app with a similar word; a custom MCP is "other"',
    fam('uniswap-free') === 'uniswap' && fam('snapshot-free') === 'snapshot' && fam('hyperliquid-free') === 'hyperliquid' && fam('cow-free') === 'cow' &&
      fam('near-intents-mcp-yeetful', 'NEAR Intents') === 'near' && fam('aave-free') === 'aave' && fam('lido-free') === 'lido' && fam('morpho-free') === 'morpho' &&
      fam('robinhood-free') === 'robinhood' && fam('opensea-free') === 'opensea' && fam('yeetful-tool-wallet', 'Pantessa Wallet') === 'wallet' &&
      fam('yeetful-tool-funding', 'Pantessa Funding') === 'funding' && fam('my-server', 'My Server') === 'other' && fam('cowboy', 'Cowboy tools') === 'other' &&
      new Set(APP_FAMILIES).size === APP_FAMILIES.length)
  const idx = code('components/apps/sections/index.ts')
  check('apps page (families): the registry maps every family to a module (a family with no entry would crash the page)',
    APP_FAMILIES.every((f) => (f === 'other' ? /other: generic/.test(idx) : new RegExp(`\\n  ${f},`).test(idx))))

  // ── which place is showing ────────────────────────────────────────────────
  const on = { narrow: false, hasWallet: true, railTab: 'mcps', railOpen: true, mainView: 'chat' }
  check('apps page (place): it owns the main area only for a connected wallet on a desktop with the APPS tab lit and open; a phone, no wallet, a collapsed tab, another tab and the links board all keep the classic surface',
    appsViewOn(on) && !appsViewOn({ ...on, narrow: true }) && !appsViewOn({ ...on, hasWallet: false }) && !appsViewOn({ ...on, railOpen: false }) &&
      !appsViewOn({ ...on, railTab: 'chats' }) && !appsViewOn({ ...on, mainView: 'links' }))

  // ── the chat's scope, in words ────────────────────────────────────────────
  check('apps page (chat scope): one app is named, two are joined, more are counted; the composer asks the same way',
    chatScopeLabel(['Uniswap']) === 'Uniswap' && chatScopeLabel(['Uniswap', 'Snapshot']) === 'Uniswap and Snapshot' && chatScopeLabel(['a', 'b', 'c']) === '3 apps' && chatScopeLabel([]) === 'no app yet' &&
      askPlaceholder(['Uniswap']) === 'Ask Uniswap anything' && askPlaceholder(['a', 'b']) === 'Ask your 2 apps anything' && askPlaceholder([]) === 'Pick an app to chat with')

  // ── tiles → the page ──────────────────────────────────────────────────────
  const page = splitPageTiles([briefing, dca, holdings, votes, quietHl], ['uniswap-free', 'snapshot-free'])
  check('apps page (tiles): the briefing and the recurring buys are the page\'s own (no app owns them); an app\'s tiles group under its slug; a tile from an app that is OFF never reaches the page',
    page.briefing === briefing && page.recurring === dca && page.bySlug.get('uniswap-free')?.[0] === holdings && page.bySlug.get('snapshot-free')?.[0] === votes && !page.bySlug.has('hyperliquid-free') && !page.bySlug.has('yeetful'))
  check('apps page (needs you): only a briefing row that carries an action asks for you; an observation never raises the strip',
    needsYouRows(briefing).length === 1 && needsYouRows(briefing)[0].label.includes('no stop') && needsYouRows(null).length === 0)

  check('apps page (needs you): the wallet\'s list leads the page with two or more apps or a portfolio app alone; when another app is the whole page, that app leads and the list follows it',
    needsLeads('side', null) && needsLeads('lines', null) && needsLeads('full', 'uniswap') && needsLeads('full', 'wallet') && !needsLeads('full', 'hyperliquid') && !needsLeads('full', 'snapshot') && !needsLeads('full', 'aave'))

  // ── one line per app ──────────────────────────────────────────────────────
  const lh = lineFor([holdings])
  const lv = lineFor([votes])
  const lq = lineFor([quietHl])
  check('apps page (lines): an app\'s one line is one fact and one button from its own tiles; an app with nothing to report is quiet and folds into ONE sentence',
    lh.text === '$6,306 in 2 positions.' && lh.act?.prompt === 'Swap $50 of ETH to USDC' && !lh.quiet && lv.text === '1 vote is open: Upgrade the hook' && !lv.quiet &&
      lq.quiet && lq.text === 'Nothing open.' && lineFor([]).quiet &&
      quietSentence(['Hyperliquid']) === 'Nothing new from Hyperliquid.' && quietSentence(['Hyperliquid', 'CoW Protocol', 'NEAR Intents']) === 'Nothing new from Hyperliquid, CoW Protocol or NEAR Intents.' && quietSentence([]) === '')

  // ── the headline ──────────────────────────────────────────────────────────
  check('apps page (headline): the default headline says what the page can see and what it asks of you, and never prints a number it was not given',
    pageHeadline({ count: 0, totalUsd: null, needs: 0 }) === 'Pick an app to start.' &&
      pageHeadline({ count: 5, totalUsd: 6306.4, needs: 1 }) === 'You have $6,306 on this page. One thing needs you.' &&
      pageHeadline({ count: 2, totalUsd: null, needs: 2 }) === 'Two things need you.' && pageHeadline({ count: 2, totalUsd: 0, needs: 0 }) === 'Nothing needs you right now.')

  check('apps page (headline): the total the headline names is what the OPEN APPS carry (never the wallet-level map: OpenSea alone read "$20 on this page"), never less than a section on the same page prints; nothing priced is null, never $0',
    pageTotalUsd([{ ...holdings, totalUsd: 28.4, facts: [{ bucket: 'spot', usd: 8, label: 'long tail' }] } as SplashTile]) === 28.4 &&
      pageTotalUsd([{ ...quietHl, facts: [{ bucket: 'earning', usd: 1121, label: 'supplied on Aave' }] } as SplashTile, votes]) === 1121 &&
      pageTotalUsd([votes]) === null && pageTotalUsd([]) === null && pageHeadline({ count: 1, totalUsd: pageTotalUsd([votes]), needs: 0 }) === 'Nothing needs you right now.')

  // ── the dock ──────────────────────────────────────────────────────────────
  const sug = dockSuggestions([[{ label: 'a1', prompt: 'a1' }, { label: 'a2', prompt: 'a2' }], [{ label: 'b1', prompt: 'b1' }], []])
  check('apps page (dock): the empty dock offers every open app\'s first ask before any app\'s second, never the same ask twice, three at most',
    sug.map((s) => s.prompt).join(',') === 'a1,b1,a2' && dockSuggestions([[{ label: 'x', prompt: 'x' }], [{ label: 'x2', prompt: 'x' }]]).length === 1 &&
      dockSuggestions(Array.from({ length: 6 }, (_, i) => [{ label: `p${i}`, prompt: `p${i}` }])).length === 3)

  // ── wired ─────────────────────────────────────────────────────────────────
  const ws = code('components/ChatWorkspace.tsx')
  check('apps page (wired, one chat): the workspace docks the SAME ChatInterface beside the page (one mount, never a second runtime) and the page is its own slot before it, so the thread keeps its tree position',
    (ws.match(/<ChatInterface /g) ?? []).length === 1 && ws.includes("<ChatInterface injectedPrompt={injected} beside={besideApps ? 'apps' : undefined} />") && ws.includes('const besideApps = appsView || (isNarrow && !!address)') &&
      ws.indexOf('{appsView && address && <AppsPage address={address} />}') > 0 && ws.indexOf('{appsView && address && <AppsPage address={address} />}') < ws.indexOf('<ChatInterface '))
  check('apps page (wired, chat in reach): the chat is its own column beside the page\'s scroller, never inside it; with the dock closed the page keeps ONE ask bar pinned outside its scroller',
    ws.includes("className={appsView ? 'apg-dock' : 'flex-1 min-h-0 flex flex-col'}") && (() => {
      const pg = code('components/apps/AppsPage.tsx')
      const scrollOpen = pg.indexOf('className="apg__scroll"')
      const bar = pg.indexOf('{!chatOpen && <AskBar')
      const closeOfScroll = pg.lastIndexOf('</div>', bar)
      return scrollOpen > 0 && bar > scrollOpen && closeOfScroll > scrollOpen && !pg.slice(scrollOpen, closeOfScroll).includes('<AskBar')
    })() && /\.apg__scroll \{[^}]*overflow-y: auto/.test(rf('components/apps/apps.css')) && /\.apg-askbar \{[^}]*flex: none/.test(rf('components/apps/apps.css')))
  const ci = code('components/ChatInterface.tsx')
  check('apps page (wired, dock): beside the page the chat mints no splash cards (the page is the dashboard), shows the dock\'s own empty state, names its scope and carries expand + close',
    ci.includes('const besideApps = beside === \'apps\' && !embedded && !simple && !docked') && ci.includes('const splashableServers = simple || besideApps') &&
      ci.includes('!besideApps &&\n') && ci.includes('<DockEmpty count={activeServers.length} onPick={runExample} phone={isNarrow} />') && ci.includes('<DockScope servers={activeServers} />') && ci.includes('{besideApps && <DockControls />}'))
  check('apps page (wired, arrival opens the dock): an ask handed over from another page (a hero logo, a row chip) or carried in ?prompt= opens the dock, so a closed dock never runs it unseen beside the page',
    /const taken = takeArrivalIntent\(\)\s*if \(!taken\) return\s*setArrival\(taken\)\s*useAppsUi\.getState\(\)\.setChatOpen\(true\)/.test(ci) &&
      /setUrlPrompt\(\{ text, send: false, at: Date\.now\(\) \}\)\s*useAppsUi\.getState\(\)\.setChatOpen\(true\)/.test(ws))
  const rail = code('components/ChatRail.tsx')
  check('apps page (wired, drawer): while the page owns the APPS tab the drawer does not draw the same list twice; with no wallet the classic drawer stands',
    rail.includes('if (appsViewOn({ narrow: false, hasWallet: !!address, railTab, railOpen: mcpRailOpen, mainView })) return null') && rail.includes('<AppsRailTab />'))
  const pg = code('components/apps/AppsPage.tsx')
  check('apps page (wired, asks): a button on the page builds nothing — every section\'s ask goes to the chat through sendAsk; no section file imports a sign button or a tx builder',
    pg.includes('sendAsk(text, { send: opts?.send, mcps: slug ? [slug] : undefined })') &&
      ['generic', 'uniswap', 'wallet', 'snapshot', 'hyperliquid', 'cow', 'near', 'aave', 'lido', 'morpho', 'robinhood', 'opensea', 'funding'].every((f) => {
        const src = code(`components/apps/sections/${f}.tsx`)
        return !/SendTx|SignOrder|SignVote|SignHlAction|useSendTransaction|useSignTypedData|writeContract/.test(src)
      }))
  check('apps page (css): the page\'s class prefix collides with no other stylesheet in the repo (Next\'s CSS is global once loaded)',
    !/\.apg[-_]/.test(rf('app/globals.css')) && !/\.apg[-_]/.test(rf('app/x402-design.css')) && !/\.apg[-_]/.test(rf('app/native-shell.css')))
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /apps-page-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  appsPagePins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
