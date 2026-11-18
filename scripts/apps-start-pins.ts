// Pins for THE APPS PAGE'S FIRST RUN (2026-11-18; lib/apps-start,
// components/apps/AppsStart, useAppsStart). Pure: no server, no chain, no DB.
// Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/apps-start-pins.ts
import { readFileSync } from 'node:fs'
import { START_APPS, START_FREE_ASKS, START_FUNDED_ASKS, startCells, startPhase, startRows, startSuggestions } from '../lib/apps-start'
import { fundCheckoutHref } from '../lib/funding-arrival'

type Check = (name: string, ok: boolean, extra?: string) => void
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

export function appsStartPins(check: Check) {
  const at = (o: Partial<Parameters<typeof startPhase>[0]>) =>
    startPhase({ read: { empty: true }, ready: true, totalUsd: null, needs: 0, hidden: false, landed: false, ...o })
  check('apps start: an empty wallet with a quiet page gets the first run', at({}) === 'start')
  check('apps start: a failed wallet read, or one that finds money, never shows it', at({ read: null }) === 'off' && at({ read: { empty: false } }) === 'off')
  check('apps start: money an open app reports, or anything that needs the user, turns it off (the wallet read does not cover venue accounts)',
    at({ totalUsd: 40 }) === 'off' && at({ needs: 1 }) === 'off')
  check('apps start: nothing is claimed until both reads settle', at({ read: undefined }) === 'deciding' && at({ ready: false }) === 'deciding')
  check('apps start: a funded wallet does not wait on the page scan', at({ read: { empty: false }, ready: false }) === 'off')
  check('apps start: hidden stays hidden, but a landed purchase still says so', at({ hidden: true }) === 'off' && at({ hidden: true, landed: true, read: { empty: false } }) === 'start')

  const servers = [
    { slug: 'uniswap-paid', name: 'Uniswap Pro' },
    { slug: 'uniswap-free', name: 'Uniswap' },
    { slug: 'snapshot-free', name: 'Snapshot DAO' },
  ]
  const rows = startRows(servers)
  check('apps start: a family answers with its free listing, and an unlisted app drops its row',
    rows.free.map((r) => r.server.slug).join() === 'uniswap-free,snapshot-free' && rows.funded.map((r) => r.server.slug).join() === 'uniswap-free')
  const sug = startSuggestions(rows, ['snapshot-free'])
  check('apps start: chat suggestions are free asks from open apps only', sug.length === 1 && sug[0].label === 'Find popular DAOs')
  check('apps start: no free ask moves money', START_FREE_ASKS.every((a) => !/\b(buy|swap|supply|deposit|lend|sell)\b/i.test(a.prompt)))
  check('apps start: every funded ask names a size', START_FUNDED_ASKS.every((a) => /\$?\d/.test(a.prompt)))

  // The board (2026-11-18, Nate: "a bit boring when a user does not have funds").
  const cells = startCells(servers)
  check('apps start: the board is one cell per listed app, free asks first, money asks marked; an unlisted app has no cell',
    cells.map((c) => c.family).join() === 'uniswap,snapshot' && cells[0].server.slug === 'uniswap-free' &&
      cells[0].asks.map((a) => `${a.label}:${a.funded}`).join() === 'Price of ETH:false,Swap $10 of ETH to USDC:true')
  const families = new Set(START_APPS.map((a) => a.family))
  check('apps start: every ask has a cell to sit in, and no app is on the board twice',
    [...START_FREE_ASKS, ...START_FUNDED_ASKS].every((a) => families.has(a.family)) && families.size === START_APPS.length)

  // The wait's way back (Nate: "there is no way to try it again ... they lost the stripe connection process").
  const href = (checkoutUrl?: string) => fundCheckoutHref({ checkoutUrl })
  check('card wait: the stored checkout comes back only as an https link on Stripe\'s own hosts',
    href('https://crypto.link.com?session_hash=abc') === 'https://crypto.link.com/?session_hash=abc' && href('https://checkout.stripe.com/c/x') !== null &&
      href(undefined) === null && href('http://crypto.link.com/x') === null && href('javascript:alert(1)') === null &&
      href('https://crypto.link.com.evil.example/x') === null && href('https://evil.example/?u=crypto.link.com') === null &&
      href('https://user:pw@crypto.link.com/x') === null && href('https://notlink.com/x') === null)
  const door = code('lib/onramp-client.ts')
  const cardHook = code('lib/use-card-fund.ts')
  check('card wait (wired): the door hands back the checkout it opened, the wait keeps it, and the hook only ever offers the checked link',
    door.includes('return { ok: true, url: data.url }') && cardHook.includes('checkoutUrl: res.url') && cardHook.includes('checkoutHref: fundCheckoutHref(wait)') &&
      code('components/ClarifyChips.tsx').includes('checkoutUrl: res.url'))

  const start = code('components/apps/AppsStart.tsx')
  check('card wait (wired): the wait on the Apps page has two real buttons (the same checkout again, and start over), and the rail\'s door offers the same',
    start.includes('href={checkout}') && start.includes('rel="noopener noreferrer"') && /className=\{`apg-btn[^`]*`\} onClick=\{fund\.startOver\}/.test(start) &&
      !start.includes('apg-start__link" onClick={fund.startOver}') && code('components/markets/watchlist/FundWallet.tsx').includes('href={checkoutHref}'))
  check('apps start (wired): the board draws the cells, a price only when a quote answered, and every ask still goes to the chat with its app',
    start.includes('cells.map((c) =>') && start.includes('useQuotes(symbols)') && start.includes('{live && cell.quote && (') && start.includes('onAsk(a.prompt, cell.server.slug)'))
  check('apps start (wired): the screen builds and signs nothing; its buy is the shared card door',
    !/SendTx|SignOrder|useSendTransaction|useSignTypedData|writeContract|startOnrampSession/.test(start) && start.includes('fund.buy(eth)'))
  const hook = code('components/apps/useAppsStart.ts')
  check('apps start (wired): emptiness comes from the shared holdings read, and a landing re-reads past the caches',
    hook.includes("from '@/lib/held-read'") && hook.includes('readHeld(address, 0, true)') && hook.includes('onLanded: recheck'))
  for (const f of ['components/apps/AppsPage.tsx', 'components/apps/AppsPhone.tsx']) {
    const src = code(f)
    check(`apps start (wired): ${f} mounts it, gives it the headline, and keeps the apps' sections under it`,
      src.includes('<AppsStart') && src.includes('starting ? start.headline : headline') && src.includes('<mod.Section'))
  }
}

if (process.argv[1] && /apps-start-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  appsStartPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
