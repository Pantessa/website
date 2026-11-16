// Scan a list of X accounts, one market each, for the outreach desk (squad called-gtm, lane OUTREACH).
//
//   DATABASE_URL=... npx tsx scripts/called-batch-scan.ts <handles.csv>                       (dry run: the default)
//   DATABASE_URL=... npx tsx scripts/called-batch-scan.ts <handles.csv> --apply --max-usd=5   (spends real money on X)
//
// The CSV is `handle,symbol` (more columns are ignored; a `handle` header line and `#` lines are skipped).
//
// DRY RUN (default): per pair, whether it is already scanned on the database in DATABASE_URL, the most a scan
// can cost (budget maxScanCostUsd), and the total. Nothing is read from X, nothing is written.
//
// --apply --max-usd=<N>: runs the MISSING scans one at a time through the SAME function the scan route uses
// (lib/called-it/scan runScan), as a PUBLIC (non-internal) run with its own requester, `ip:outreach-batch`.
// It stops before the total of worst cases could pass --max-usd. The house's own daily caps
// (lib/called-it/budget, decided under the scan lock) still apply to every scan; a refusal stops the batch.
// NOTE: `ip:` is a guest requester, and a guest gets XCALLS_GUEST_SCANS free scans a day (0 unless set), so an
// --apply run needs XCALLS_GUEST_SCANS=<n> in THIS process's environment, and the house's free pool
// (XCALLS_DAILY_USD_CAP, $5 a day) bounds it too. Only Nate runs --apply: it is his money.
//
// It prints the database host first and refuses any host that is not the TEST one unless --host-ok=<host>
// names it (the fence of scripts/run-ddl.ts).
import { readFileSync } from 'node:fs'

export const BATCH_REQUESTER = 'ip:outreach-batch'

export interface BatchArgs {
  file: string | null
  apply: boolean
  maxUsd: number | null
  hostOk: string | null
}

/** Pure: the command line. `--apply` without a positive `--max-usd` is an error, never a default. */
export function parseBatchArgs(argv: readonly string[]): BatchArgs | { error: string } {
  const val = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null
  const file = argv.find((a) => !a.startsWith('--')) ?? null
  const apply = argv.includes('--apply')
  const raw = val('max-usd')
  const maxUsd = raw !== null && /^\d+(\.\d+)?$/.test(raw) && Number(raw) > 0 ? Number(raw) : null
  if (!file) return { error: 'usage: tsx scripts/called-batch-scan.ts <handles.csv> [--apply --max-usd=<N>] [--host-ok=<host>]' }
  if (apply && maxUsd === null) return { error: '--apply needs --max-usd=<dollars> (a positive number): the most this batch may spend on X.' }
  if (raw !== null && maxUsd === null) return { error: '--max-usd must be a positive number of dollars.' }
  return { file, apply, maxUsd, hostOk: val('host-ok') }
}

/** Pure: `handle,symbol` rows from a CSV, cleaned and de-duplicated. Bad rows come back with the reason. */
export function parseBatchCsv(text: string): { pairs: { handle: string; symbol: string }[]; bad: string[] } {
  const pairs: { handle: string; symbol: string }[] = []
  const bad: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim()
    if (!l || l.startsWith('#')) continue
    const [h, s] = l.split(',').map((c) => c.trim())
    if (h?.toLowerCase() === 'handle') continue
    const handle = (h ?? '').replace(/^@/, '').toLowerCase()
    const symbol = (s ?? '').toUpperCase()
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
      bad.push(`${l}: not an X handle (1 to 15 letters, numbers or underscores)`)
      continue
    }
    if (!/^[A-Z0-9.:_-]{1,20}$/.test(symbol)) {
      bad.push(`${l}: no market`)
      continue
    }
    const key = `${handle}|${symbol}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ handle, symbol })
  }
  return { pairs, bad }
}

/** Pure: how many of the missing scans fit under the batch's cap, each at its worst case. */
export function scansThatFit(missing: number, worstUsd: number, maxUsd: number): number {
  if (worstUsd <= 0) return missing
  return Math.min(missing, Math.floor((maxUsd + 1e-9) / worstUsd))
}

function hostOf(url: string): string {
  try {
    return new URL(url.replace(/^"|"$/g, '')).host
  } catch {
    return ''
  }
}

async function main() {
  const args = parseBatchArgs(process.argv.slice(2))
  if ('error' in args) throw new Error(args.error)
  const host = hostOf(process.env.DATABASE_URL ?? '')
  if (!host) throw new Error('DATABASE_URL is not set (pass it inline; prisma reads .env, not .env.local)')
  const isTest = /^ep-tiny-butterfly/.test(host)
  console.log(`host: ${host}${isTest ? ' (TEST)' : ''}  ${args.apply ? `APPLY, at most $${args.maxUsd!.toFixed(2)}` : 'dry run (nothing is read from X, nothing is written)'}`)
  if (!isTest && args.hostOk !== host) throw new Error(`not the TEST host. Re-run with --host-ok=${host} if this database is meant.`)

  const { pairs, bad } = parseBatchCsv(readFileSync(args.file!, 'utf8'))
  for (const b of bad) console.log(`  skip  ${b}`)
  // Imported here so a bad command line fails before the database is touched.
  const Store = await import('../lib/called-it/store')
  const { maxScanCostUsd, scanPostCap, dailyUsdCap } = await import('../lib/called-it/budget')
  const worst = maxScanCostUsd(scanPostCap())
  const missing: { handle: string; symbol: string }[] = []
  for (const p of pairs) {
    const last = await Store.latestScan(p.handle, p.symbol)
    const state = !last ? 'not scanned' : last.status === 'done' ? `scanned ${new Date(last.finishedAt ?? last.startedAt).toISOString().slice(0, 10)} (${last.callsFound ?? 0} calls)` : `last scan ${last.status}`
    const need = !last || last.status !== 'done'
    if (need) missing.push(p)
    console.log(`  ${need ? 'SCAN' : 'have'}  @${p.handle.padEnd(15)} ${p.symbol.padEnd(8)} ${state}${need ? `  at most $${worst.toFixed(2)}` : ''}`)
  }
  const total = Math.round(missing.length * worst * 100) / 100
  const spent = await Store.spentTodayUsd()
  console.log(`\n${pairs.length} pairs, ${missing.length} to scan, at most $${total.toFixed(2)} on X (${scanPostCap()} posts a scan, $${worst.toFixed(2)} each at worst).`)
  console.log(`House free pool today: $${spent.toFixed(2)} spent of $${dailyUsdCap().toFixed(2)}; every scan is still decided against it under the scan lock.`)
  if (!args.apply) {
    if (args.maxUsd !== null) console.log(`Under --max-usd=${args.maxUsd}: ${scansThatFit(missing.length, worst, args.maxUsd)} of ${missing.length} would run.`)
    console.log('Dry run: nothing was read from X and nothing was written. --apply --max-usd=<N> runs it (Nate only).')
    return
  }

  const fit = scansThatFit(missing.length, worst, args.maxUsd!)
  if (!process.env.X_BEARER_TOKEN) throw new Error('X_BEARER_TOKEN is not set: no scan can read X.')
  const { runScan } = await import('../lib/called-it/scan')
  let budgetLeft = args.maxUsd!
  for (const p of missing.slice(0, fit)) {
    if (budgetLeft + 1e-9 < worst) break
    const outcome = await runScan({ handle: p.handle, symbol: p.symbol, requester: BATCH_REQUESTER, internal: false })
    if (outcome.kind === 'refused') {
      console.log(`  STOP  @${p.handle} ${p.symbol}: ${outcome.body.reason}`)
      break
    }
    if (outcome.kind === 'joined') {
      console.log(`  join  @${p.handle} ${p.symbol}: a scan is already running`)
      continue
    }
    const row = outcome.scanId ? await Store.getScan(outcome.scanId) : null
    const cost = row?.costUsd ?? worst
    budgetLeft -= cost
    console.log(`  done  @${p.handle} ${p.symbol}: ${row?.note ?? 'done'} ($${cost.toFixed(3)})`)
  }
  if (fit < missing.length) console.log(`${missing.length - fit} pairs left: they would pass --max-usd.`)
  console.log(`Spent at most $${(args.maxUsd! - budgetLeft).toFixed(2)} of $${args.maxUsd!.toFixed(2)}.`)
}

if (process.argv[1]?.endsWith('called-batch-scan.ts')) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exitCode = 1
    })
    .finally(async () => {
      try {
        const { default: prisma } = await import('../lib/db')
        await prisma.$disconnect()
      } catch {
        /* never connected */
      }
    })
}
