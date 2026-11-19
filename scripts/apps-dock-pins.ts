// Pins for the apps page's "dock" lane (squad apps-page, 2026-11-17). The
// harness already calls this (scripts/test-api.ts). Pure where possible: no
// server, no chain, no DB. The rules live in lib/apps-dock.ts; the wiring
// checks read source with comments stripped.
// Runnable alone:  npx tsx scripts/apps-dock-pins.ts

import fs from 'node:fs'
import path from 'node:path'
import { firstSentence, isChatShortcut, marksPlan, onePerName, pickerMatches, pickerSections, trayApps, trayLine, trayPrice } from '../lib/apps-dock'
import { chatScopeLabel } from '../lib/apps-page'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
/** Source without comments (block, line, and JSX comment blocks). */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const srv = (slug: string, o: Partial<{ name: string; gated: boolean; description: string; priceUsd: string | null }> = {}) => ({
  id: slug,
  slug,
  name: o.name ?? slug,
  gated: o.gated ?? false,
  description: o.description ?? '',
  priceUsd: o.priceUsd ?? null,
})

export function appsDockPins(check: Check) {
  // ── marksPlan (2026-11-19): the row is marks and one button, on one line ──
  // A mark is 36 wide with 6 after it; the button is 110 with its words, 42 as its icon.
  const plan = (width: number, count: number) => marksPlan({ width, count, mark: 36, gap: 6, add: 110, addCompact: 42 })
  const wide = plan(600, 5)
  check('dock: marksPlan shows every mark and the whole button when they fit', wide.shown === 5 && wide.more === 0 && !wide.compact, JSON.stringify(wide))
  const exact = plan(5 * 42 + 110, 5)
  check('dock: marksPlan keeps the words at an exact fit', exact.shown === 5 && !exact.compact, JSON.stringify(exact))
  const mid = plan(5 * 42 + 109, 5)
  check('dock: marksPlan folds the button to its icon BEFORE it hides a mark', mid.shown === 5 && mid.more === 0 && mid.compact, JSON.stringify(mid))
  const tight = plan(4 * 42 + 42, 9)
  check('dock: marksPlan counts what does not fit in a "+N" that takes one seat', tight.compact && tight.shown === 3 && tight.more === 6 && tight.shown + tight.more === 9, JSON.stringify(tight))
  const tiny = plan(50, 4)
  check('dock: marksPlan never goes negative (no room: every app is in the count)', tiny.shown === 0 && tiny.more === 4, JSON.stringify(tiny))
  const cold = plan(0, 6)
  check('dock: marksPlan with no measurement yet shows every mark (the first paint hides nothing)', cold.shown === 6 && cold.more === 0 && !cold.compact, JSON.stringify(cold))
  const none = plan(300, 0)
  check('dock: marksPlan with no app on is just the button', none.shown === 0 && none.more === 0 && !none.compact, JSON.stringify(none))

  // ── The directory the picker reads ────────────────────────────────────────
  const dir = [
    srv('uniswap-free', { name: 'Uniswap (Free)' }),
    srv('snapshot-free', { name: 'Snapshot DAO (Free)' }),
    srv('aave', { name: 'Aave' }),
    srv('aave-free', { name: 'Aave (Free)' }),
    srv('yeetful-tool-wallet', { name: 'Pantessa Wallet' }),
    srv('paid-x', { name: 'Paid X', gated: true, priceUsd: '0.01', description: 'Weather for any city.' }),
  ]
  check('dock: onePerName drops a name already on the page', onePerName([srv('aave-free', { name: 'Aave (Free)' })], [{ name: 'Aave' }]).length === 0)

  // ── pickerSections: yours first and STILL, the rest by the switch ─────────
  const sec = (pinnedIds: string[], view: 'free' | 'paid' = 'free', query = '') => {
    const r = pickerSections({ servers: dir, pinnedIds, view, query })
    return { yours: r.yours.map((s) => s.slug), more: r.more.map((s) => s.slug) }
  }
  const open2 = sec(['snapshot-free', 'uniswap-free'])
  check('dock: "Your apps" is the set that was on when the picker opened, in its order', open2.yours.join(',') === 'snapshot-free,uniswap-free', open2.yours.join(','))
  check('dock: "More apps" never repeats one of yours, and names each app once', !open2.more.includes('uniswap-free') && !open2.more.includes('snapshot-free') && open2.more.filter((x) => x.startsWith('aave')).length === 1, open2.more.join(','))
  check('dock: the free list keeps the internal tools and shows no paid app', open2.more.includes('yeetful-tool-wallet') && !open2.more.includes('paid-x'), open2.more.join(','))
  check('dock: the paid list is the paid catalog alone', sec(['uniswap-free'], 'paid').more.join(',') === 'paid-x')
  const found = sec(['uniswap-free'], 'free', 'weather')
  check('dock: a search looks through free AND paid at once, whatever the switch says', found.more.join(',') === 'paid-x' && found.yours.length === 0, JSON.stringify(found))
  const mine = sec(['uniswap-free'], 'paid', 'uni')
  check('dock: a search filters "Your apps" too', mine.yours.join(',') === 'uniswap-free' && mine.more.length === 0, JSON.stringify(mine))
  check('dock: a search matches every word, in the name, the plain line or the slug', pickerMatches(dir[0], 'swaps uni') && pickerMatches(dir[0], 'UNISWAP-FREE') && !pickerMatches(dir[0], 'uni lending') && pickerMatches(dir[0], '   '))

  // ── trayApps: everything off the page, free or paid ───────────────────────
  const free = trayApps(dir, ['uniswap-free'], 'free').map((s) => s.slug)
  const paid = trayApps(dir, ['uniswap-free'], 'paid').map((s) => s.slug)
  check('dock: the free tray keeps the internal tools (the drawer had them)', free.includes('yeetful-tool-wallet'), free.join(','))
  check('dock: the free tray lists no paid app and nothing on the page', !free.includes('paid-x') && !free.includes('uniswap-free'))
  check('dock: the paid tray lists only paid apps', paid.length === 1 && paid[0] === 'paid-x', paid.join(','))
  check('dock: a paid row shows its price per call', trayPrice(srv('paid-x', { gated: true, priceUsd: '0.01' })) === '$0.01/call')
  check('dock: a free row or an unknown price shows no price', trayPrice(srv('a')) === null && trayPrice(srv('b', { gated: true, priceUsd: null })) === null)

  // ── trayLine / firstSentence: one plain line per app ──────────────────────
  check('dock: a first-party app gets its own plain line', trayLine(srv('aave-free', { name: 'Aave (Free)', description: 'Aave v4 lending, free and non-gated: markets...' })) === 'Lend and borrow. Puts idle stablecoins to work.')
  const fs1 = firstSentence('Weather Co, free and non-gated: live forecasts for any city. Also alerts.')
  check('dock: firstSentence drops the catalog boilerplate and keeps one sentence', fs1 === 'Live forecasts for any city.', fs1)
  const fs2 = firstSentence('x '.repeat(200), 40)
  check('dock: firstSentence caps the length on a word with an ellipsis', fs2.length <= 40 && fs2.endsWith('…'), fs2)
  check('dock: firstSentence shows the brand as Pantessa', /Pantessa/.test(firstSentence('A Yeetful tool for swaps.')) && !/yeetful/i.test(firstSentence('A Yeetful tool for swaps.')))
  check('dock: firstSentence of nothing is empty', firstSentence(undefined) === '' && firstSentence('   ') === '')

  // ── The scope words in the dock's header ──────────────────────────────────
  check('dock: scope words name one or two apps, count three or more', chatScopeLabel(['Uniswap']) === 'Uniswap' && chatScopeLabel(['Uniswap', 'Aave']) === 'Uniswap and Aave' && chatScopeLabel(['a', 'b', 'c']) === '3 apps')

  // ── The "/" shortcut ──────────────────────────────────────────────────────
  const k = (key: string, target: { tagName?: string; isContentEditable?: boolean; type?: string } | null, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing: boolean }> = {}) => isChatShortcut({ key, target, ...mods })
  check('dock: "/" on the page opens the chat', k('/', { tagName: 'BODY' }) && k('/', { tagName: 'BUTTON' }) && k('/', null))
  check('dock: "/" while typing anywhere is just a slash', !k('/', { tagName: 'TEXTAREA' }) && !k('/', { tagName: 'INPUT', type: 'text' }) && !k('/', { tagName: 'DIV', isContentEditable: true }) && !k('/', { tagName: 'SELECT' }))
  check('dock: "/" on a checkbox still opens the chat', k('/', { tagName: 'INPUT', type: 'checkbox' }))
  check('dock: a modified "/" or another key is not the shortcut', !k('/', { tagName: 'BODY' }, { metaKey: true }) && !k('/', { tagName: 'BODY' }, { ctrlKey: true }) && !k('?', { tagName: 'BODY' }) && !k('k', { tagName: 'BODY' }) && !k('/', { tagName: 'BODY' }, { isComposing: true }))

  // ── Wiring: the other postures are untouched ──────────────────────────────
  const ci = strip(read('components/ChatInterface.tsx'))
  const dockUses = [...ci.matchAll(/<(DockScope|DockControls|DockEmpty|DockShortcut)\b/g)].map((m) => m.index ?? 0)
  const guarded = dockUses.every((at) => /besideApps\s*(?:\?|&&)[^;]*$/.test(ci.slice(Math.max(0, at - 260), at).replace(/\n/g, ' ')))
  check('dock: every dock piece in ChatInterface sits behind besideApps', dockUses.length >= 4 && guarded, `uses=${dockUses.length}`)
  check('dock: besideApps is first-party only (never embed, simple, docked)', /const besideApps = beside === 'apps' && !embedded && !simple && !docked/.test(ci))
  check('dock: the account pill leaves the dock header only beside the apps page', /showAppChrome && !besideApps &&/.test(ci))
  const dock = strip(read('components/apps/Dock.tsx'))
  check('dock: the shortcut never fires inside a dialog', /role="dialog"\]\[aria-modal="true"\]/.test(dock))
  check('dock: the controls keep expand + close', /data-dock-expand/.test(dock) && /data-dock-close/.test(dock))
  // ── The app row and its picker (re-cut 2026-11-19) ───────────────────────
  const chips = strip(read('components/apps/AppChips.tsx'))
  const marks = strip(read('components/apps/AppMarks.tsx'))
  const picker = strip(read('components/apps/AppPicker.tsx'))
  const phone = strip(read('components/apps/AppsPhone.tsx'))
  check('dock: the picker offers no "Add your own MCP"', !/AddMcpModal|data-tray-own|data-sheet-open="addmcp"/.test(chips + marks + picker))
  check('dock: no sign button or tx hook in the dock lane', !/useSendTransaction|useSignTypedData|useWriteContract|SendTxChain/.test(chips + marks + picker + dock))
  check(
    'dock: the row shows an app as its mark alone (the name is the tooltip and the accessible name, never text in the row)',
    /<BrandIcon server=\{server\} size=\{18\} \/>/.test(marks) && /data-name=\{name\}/.test(marks) && /aria-label=\{`\$\{name\}, on this page\./.test(marks) && !/>\s*\{name\}\s*</.test(marks) && !/cleanServerName/.test(chips),
  )
  check('dock: a mark never removes its app (it opens the picker; the switch there removes)', !/toggle|onToggle|markManualMcp|setActiveServerIds/.test(marks) && /onClick=\{\(\) => onOpen\(server\.slug\)\}/.test(marks))
  check('dock: a mark on its way out is out of reach (no tab stop, hidden from readers, disabled)', /aria-hidden=\{leaving \? true : undefined\}/.test(marks) && /tabIndex=\{leaving \? -1 : undefined\}/.test(marks) && /disabled=\{leaving\}/.test(marks))
  check(
    'dock: the row has ONE door to the picker, a button with words, and it says whether the picker is open',
    (chips.match(/data-apps-add=""/g) ?? []).length === 1 && /aria-expanded=\{isOpen\}/.test(chips) && /aria-controls="apgk-pop"/.test(chips) && /'Add app'/.test(chips) && !/Browse all/.test(chips + picker),
  )
  check('dock: the row is planned by marksPlan and re-planned when its width changes', /marksPlan\(\{ width: list\.clientWidth, count: active\.length/.test(chips) && /new ResizeObserver\(\(\) => measure\(\)\)/.test(chips))
  check(
    'dock: the picker closes on Escape and on a press outside the marks, the button and itself',
    /e\.key === 'Escape' && !e\.defaultPrevented/.test(chips) && /listRef\.current\?\.contains\(t\) \|\| popRef\.current\?\.contains\(t\)/.test(chips) && /addEventListener\('pointerdown', onDown\)/.test(chips),
  )
  check(
    'dock: every app in the picker is a switch that says its state, with its page one link away',
    /role="switch"/.test(picker) && /aria-checked=\{on\}/.test(picker) && /onClick=\{\(\) => onToggle\(s\)\}/.test(picker) && /href=\{`\/servers\/\$\{s\.slug\}`\}/.test(picker),
  )
  check('dock: the picker keeps the set it opened on (rows never move while it is open)', /const \[pinnedIds\] = useState\(\(\) => active\.map\(\(s\) => s\.id\)\)/.test(picker) && /pickerSections\(\{ servers, pinnedIds, view, query \}\)/.test(picker))
  check('dock: in the search, the first Escape clears it and Enter switches the first match', /e\.key === 'Escape' && query/.test(picker) && /e\.preventDefault\(\)\s*setQuery\(''\)/.test(picker) && /e\.key === 'Enter' && searching/.test(picker))
  check('dock: the desktop row and the phone render the SAME picker and the SAME marks', /<AppPicker\b/.test(chips) && /<AppPicker\b[^>]*\bsheet\b/.test(phone) && /<AppMarks\b/.test(chips) && /<AppMarks\b/.test(phone) && !/AppsRailTab/.test(phone))
  check('dock: the phone never raises the keyboard on open (no autoFocus in the sheet)', !/<AppPicker\b[^>]*autoFocus/.test(phone) && /<AppPicker\b[^>]*autoFocus/.test(chips))
  const pcss = read('components/apps/picker.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const psel = pcss.match(/(^|\})\s*([^{}@]+)\{/g) ?? []
  const pown = psel.filter((x) => !/^\}?\s*(from|to|\d+%)/.test(x.replace(/\s+/g, ' ')))
  check('dock: every rule in picker.css is scoped by the apgk- prefix', pown.length > 40 && pown.every((x) => /apgk-|\.apgk\b/.test(x)), pown.filter((x) => !/apgk-|\.apgk\b/.test(x)).join(' | '))
  // The switch is drawn beside the row's button, after it: a press on it must fall through to the
  // button (2026-11-19: it did not, and every switch in the picker ignored a press). A real-mouse
  // drive proves it: scripts/apps-page-shot.mjs --click presses like a mouse and --assert fails a miss.
  check('dock: a press on a switch falls through to its row\'s button (the switch takes no pointer events)', /\.apgk-switch \{ pointer-events: none; \}/.test(pcss) && /<span className="apgk-switch" aria-hidden>/.test(picker))
  const reduce = pcss.slice(pcss.indexOf('@media (prefers-reduced-motion: reduce)'))
  check(
    'dock: every animation in picker.css is switched off under prefers-reduced-motion',
    /\.apgk-pop,/.test(reduce) && /\.apgk-mark\[data-state\]/.test(reduce) && /\[data-entering\] \.apgk-opt/.test(reduce) && /\.apgk-opt\[data-flash\]/.test(reduce) && /animation: none/.test(reduce) && /transition: none/.test(reduce),
  )
  const css = read('components/apps/dock.css')
  check('dock: dock.css styles the chat only under [data-chat-dock] or its own prefix', !/(^|\n)\s*\.(?!apgd-|apg-)[a-z]/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')))
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /apps-dock-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  appsDockPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
