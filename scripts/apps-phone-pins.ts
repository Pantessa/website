// Pins for the apps page's "phone" lane (squad apps-page, 2026-11-17). The
// lane that owns this file adds its checks inside the function below; the
// harness already calls it (scripts/test-api.ts), so no lane edits the
// harness. Pure where possible: no server, no chain, no DB.
// Runnable alone:  npx tsx scripts/apps-phone-pins.ts

import fs from 'node:fs'
import path from 'node:path'
import { askBarSubmit, PHONE_SUGGESTION_CAP, phoneLayoutFor, phoneSuggestions } from '../lib/apps-phone'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
/** Source with comments removed (block, JSX block and line comments), so a
 *  pin reads what the code does, never what a comment says. */
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

/** The text of the JSX element that opens at `start` (`<div …>` … its
 *  matching `</div>`), counting nested divs. */
function divSpan(src: string, start: number): string {
  const re = /<div\b|<\/div>/g
  re.lastIndex = start
  let depth = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    depth += m[0] === '</div>' ? -1 : 1
    if (depth === 0) return src.slice(start, m.index + m[0].length)
  }
  return src.slice(start)
}

export function appsPhonePins(check: Check) {
  // ── The phone's density mapping (pure) ────────────────────────────────────
  const L = (n: number) => phoneLayoutFor(n)
  check('apps phone: no app is the empty page', L(0).layout === 'empty' && L(0).section === null)
  check('apps phone: one app is shown in full', L(1).layout === 'full' && L(1).section === 'full')
  check('apps phone: two and three apps STACK side sections (never columns)', [2, 3].every((n) => L(n).layout === 'stack' && L(n).section === 'side'))
  check('apps phone: four or more apps are one line each', [4, 5, 12].every((n) => L(n).layout === 'lines' && L(n).section === 'line'))
  check('apps phone: the phone follows the desktop density rule', [0, 1, 2, 3, 4, 9].every((n) => L(n).density === (n === 0 ? 'empty' : n === 1 ? 'full' : n <= 3 ? 'side' : 'lines')))

  // ── The ask bar's suggestions and submit (pure) ───────────────────────────
  const p = (label: string, prompt = label) => ({ label, prompt })
  const sugs = phoneSuggestions([p('A', 'Swap $50 of ETH to USDC'), p('A again', 'Swap $50 of ETH to USDC'), p('B'), p('C')])
  check('apps phone: at most two suggestions above the ask bar, deduped by sentence', PHONE_SUGGESTION_CAP === 2 && sugs.length === 2 && sugs[0].label === 'A' && sugs[1].label === 'B', JSON.stringify(sugs))
  check('apps phone: no suggestions when the apps offer none', phoneSuggestions([]).length === 0)
  check('apps phone: a sentence on the bar runs in the chat', JSON.stringify(askBarSubmit('  What is my biggest position? ')) === JSON.stringify({ kind: 'send', text: 'What is my biggest position?' }))
  check('apps phone: an empty bar only opens the conversation', askBarSubmit('   ').kind === 'open')

  // ── No wallet: the same page (2026-11-19) ─────────────────────────────────
  const screens = code('components/phone/PhoneScreens.tsx')
  const appsScreen = screens.slice(screens.indexOf('function AppsScreen'), screens.indexOf('export default function PhoneScreens'))
  check(
    'apps phone: the APPS screen is the apps page signed in or not (no wallet no longer drops to the plain list)',
    /return <AppsPhone address=\{address\} title=\{PHONE_SCREEN_TITLES\.apps\} \/>/.test(appsScreen) && !/AppsRailTab flat/.test(appsScreen),
  )
  check("apps phone: the screens' switch renders the APPS screen through AppsScreen", /case 'apps':\s*return <AppsScreen \/>/.test(screens))

  // ── The ask bar lives OUTSIDE the screen's one scroller ───────────────────
  const phone = code('components/apps/AppsPhone.tsx')
  const scrollAt = phone.search(/<div\s+ref=\{scrollerRef\}\s+data-app-scroll=""/)
  const scroller = scrollAt >= 0 ? divSpan(phone, scrollAt) : ''
  const panel = phone.slice(phone.indexOf('<section data-phone-panel="apps"'), phone.indexOf('</section>'))
  check('apps phone: the screen has ONE scroller (data-app-scroll)', scrollAt >= 0 && (phone.match(/data-app-scroll/g) ?? []).length === 1)
  check('apps phone: the ask bar is not inside the scroller', scroller.length > 0 && !/<PhoneAskBar\b|data-apps-askbar/.test(scroller))
  check('apps phone: the ask bar is a row of the panel, after the scroller', panel.indexOf('<PhoneAskBar') > panel.indexOf(scroller.slice(0, 40)) && panel.includes('<PhoneAskBar'))
  check('apps phone: a send goes to the conversation', /sendAsk\(text, opts\)\s*setPhoneScreen\('chat'\)/.test(phone))
  check('apps phone: sections render only through SECTIONS[family]', /SECTIONS\[family\]/.test(phone) && !/from '@\/components\/apps\/sections\/[a-z]+'/.test(phone))
  check('apps phone: nothing on the page builds or signs', !/useSendTransaction|useSignTypedData|useSignMessage|useWriteContract|sendTransaction|signTypedData/.test(phone))

  // ── The conversation runs the page's ask on a phone too ───────────────────
  const ws = code('components/ChatWorkspace.tsx')
  check('apps phone: ChatWorkspace feeds the apps ask to the chat below lg', /const injected = \(appsView \|\| isNarrow\) && appsAsk &&/.test(ws))

  // ── The stylesheet: own prefix, the bar a flex row that never scrolls ─────
  const css = read('components/apps/apps-phone.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = css.match(/(^|\})\s*([^{}@]+)\{/g) ?? []
  check(
    'apps phone: every rule in apps-phone.css is scoped by the apgm- prefix',
    selectors.every((sel) => /\.apgm/.test(sel)),
    selectors.filter((sel) => !/\.apgm/.test(sel)).join(' | '),
  )
  check('apps phone: the ask bar does not shrink and is not positioned over the content', /\.apgm-ask \{[^}]*flex: none/.test(css) && !/\.apgm-ask \{[^}]*position:\s*(fixed|absolute|sticky)/.test(css))
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /apps-phone-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  appsPhonePins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
