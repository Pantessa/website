// Pins for the apps page's "dock" lane (squad apps-page, 2026-11-17). The
// harness already calls this (scripts/test-api.ts). Pure where possible: no
// server, no chain, no DB. The rules live in lib/apps-dock.ts; the wiring
// checks read source with comments stripped.
// Runnable alone:  npx tsx scripts/apps-dock-pins.ts

import fs from 'node:fs'
import path from 'node:path'
import { fitOffered, firstSentence, isChatShortcut, offeredApps, onePerName, trayApps, trayLine, trayPrice } from '../lib/apps-dock'
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
  // ── fitOffered: how many offered chips fit the row's room ─────────────────
  check('dock: fitOffered counts whole chips with a gap each', fitOffered(300, [100, 100, 100], 8) === 2)
  check('dock: fitOffered fits exactly at the edge', fitOffered(216, [100, 100], 8) === 2)
  check('dock: fitOffered never shows a partial chip', fitOffered(215, [100, 100], 8) === 1)
  check('dock: fitOffered with no room shows none', fitOffered(0, [50], 8) === 0 && fitOffered(-40, [50], 8) === 0)
  check('dock: fitOffered stops at an unmeasured chip', fitOffered(1000, [80, 0, 80], 8) === 1)
  check('dock: fitOffered keeps order (a wide chip blocks the ones after it)', fitOffered(200, [80, 300, 40], 8) === 1)

  // ── offeredApps: free first-party apps only, each name once ───────────────
  const dir = [
    srv('uniswap-free', { name: 'Uniswap (Free)' }),
    srv('snapshot-free', { name: 'Snapshot DAO (Free)' }),
    srv('aave', { name: 'Aave' }),
    srv('aave-free', { name: 'Aave (Free)' }),
    srv('yeetful-tool-wallet', { name: 'Pantessa Wallet' }),
    srv('paid-x', { name: 'Paid X', gated: true, priceUsd: '0.01' }),
  ]
  const off = offeredApps(dir, ['uniswap-free']).map((s) => s.slug)
  check('dock: offered never repeats an app on the page', !off.includes('uniswap-free'), off.join(','))
  check('dock: offered never shows an internal tool or a paid app', !off.includes('yeetful-tool-wallet') && !off.includes('paid-x'), off.join(','))
  check('dock: offered names each app once', off.filter((s) => s.startsWith('aave')).length === 1, off.join(','))
  check('dock: offered caps', offeredApps(dir, [], 1).length === 1)
  check('dock: onePerName drops a name already on the page', onePerName([srv('aave-free', { name: 'Aave (Free)' })], [{ name: 'Aave' }]).length === 0)

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
  const chips = strip(read('components/apps/AppChips.tsx'))
  check('dock: the row keeps "Add your own MCP"', /AddMcpModal/.test(chips) && /data-tray-own/.test(chips))
  check('dock: a spare chip is out of reach (no tab stop, hidden from readers)', /tabIndex=\{shown \? undefined : -1\}/.test(chips) && /aria-hidden=\{shown \? undefined : true\}/.test(chips))
  check('dock: no sign button or tx hook in the dock lane', !/useSendTransaction|useSignTypedData|useWriteContract|SendTxChain/.test(chips + dock))
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
