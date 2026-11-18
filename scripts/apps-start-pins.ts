// Pins for THE APPS PAGE'S FIRST RUN (2026-11-18; lib/apps-start,
// components/apps/AppsStart, useAppsStart). Pure: no server, no chain, no DB.
// Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/apps-start-pins.ts
import { readFileSync } from 'node:fs'
import { START_FREE_ASKS, START_FUNDED_ASKS, startPhase, startRows, startSuggestions } from '../lib/apps-start'

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

  const start = code('components/apps/AppsStart.tsx')
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
