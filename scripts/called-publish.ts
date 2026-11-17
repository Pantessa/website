// Publish ONE scanned record after a person has read it (squad called-gtm, review B2).
//
//   DATABASE_URL=... npx tsx scripts/called-publish.ts <handle> <symbol>            (dry run: the default)
//   DATABASE_URL=... npx tsx scripts/called-publish.ts <handle> <symbol> --apply    (lists it)
//
// The outreach batch (scripts/called-batch-scan.ts) scans as INTERNAL runs: the record can be opened by address
// but is on no list and no board. This script is how a pair becomes public, one at a time, by hand.
//
// DRY RUN (default): prints the record's tally (its own headline), its best call and its strongest miss (the
// same size), the record's address, and how many finished scans of the pair are internal / public. Nothing is
// written. READ EVERY CALL ON THE RECORD PAGE before --apply: the misses are what a subject objects to.
//
// --apply: sets is_internal = false on that pair's FINISHED scans (status 'done', never a free finish's lease) in
// the database of DATABASE_URL. It prints the database host first and refuses any host that is not the TEST one
// unless --host-ok=<host> names it (the fence of scripts/run-ddl.ts). Only Nate runs it on production.
import { SITE_URL } from '../lib/site-url'

export interface PublishArgs {
  handle: string
  symbol: string
  apply: boolean
  hostOk: string | null
}

/** Pure: the command line. A bad handle or market is an error, never a guess. */
export function parsePublishArgs(argv: readonly string[]): PublishArgs | { error: string } {
  const usage = 'usage: tsx scripts/called-publish.ts <handle> <symbol> [--apply] [--host-ok=<host>]'
  const pos = argv.filter((a) => !a.startsWith('--'))
  if (pos.length !== 2) return { error: usage }
  const handle = pos[0].replace(/^@/, '').toLowerCase()
  const symbol = pos[1].toUpperCase()
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) return { error: `${pos[0]}: not an X handle (1 to 15 letters, numbers or underscores). ${usage}` }
  if (!/^[A-Z0-9.:_-]{1,20}$/.test(symbol)) return { error: `${pos[1]}: not a market. ${usage}` }
  return { handle, symbol, apply: argv.includes('--apply'), hostOk: argv.find((a) => a.startsWith('--host-ok='))?.slice('--host-ok='.length) ?? null }
}

function hostOf(url: string): string {
  try {
    return new URL(url.replace(/^"|"$/g, '')).host
  } catch {
    return ''
  }
}

async function main() {
  const args = parsePublishArgs(process.argv.slice(2))
  if ('error' in args) throw new Error(args.error)
  const host = hostOf(process.env.DATABASE_URL ?? '')
  if (!host) throw new Error('DATABASE_URL is not set (pass it inline; prisma reads .env, not .env.local)')
  const isTest = /^ep-tiny-butterfly/.test(host)
  console.log(`host: ${host}${isTest ? ' (TEST)' : ''}  ${args.apply ? 'APPLY' : 'dry run (nothing is written)'}`)
  if (!isTest && args.hostOk !== host) throw new Error(`not the TEST host. Re-run with --host-ok=${host} if this database is meant.`)

  const { defaultRecordDeps, readRecord } = await import('../lib/called-it/record')
  const { bestCallOf, callHref } = await import('../lib/called-it/gtm')
  const { worstCallOf } = await import('../lib/called-it/board')
  const { moveLine, recordHref, VERDICT_WORDS } = await import('../lib/called-it/spec')
  const { FINISH_PROVIDER } = await import('../lib/called-it/store')
  const { default: prisma } = await import('../lib/db')

  const answer = await readRecord({ handle: args.handle, symbol: args.symbol }, { ...defaultRecordDeps(), refreshGone: undefined })
  const body = answer.body
  if (body.status !== 'ready') throw new Error(`@${args.handle} on ${args.symbol}: no record to publish (${body.status}${'reason' in body && body.reason ? `: ${body.reason}` : ''}).`)
  const rec = body.record
  if (!rec.scanned) throw new Error(`@${rec.handle} on ${rec.symbol}: no finished scan, only pasted posts. Nothing to publish.`)

  const where = { handle: rec.handle, symbol: rec.symbol, status: 'done', OR: [{ provider: null }, { provider: { not: FINISH_PROVIDER } }] }
  const internal = await prisma.xScan.count({ where: { ...where, isInternal: true } })
  const listedAlready = await prisma.xScan.count({ where: { ...where, isInternal: false } })

  const scanned = rec.calls.filter((c) => c.origin === 'scan')
  const best = bestCallOf(scanned)
  const worst = worstCallOf(scanned)
  const line = (label: string, c: (typeof scanned)[number] | null) =>
    c ? `${label}: ${VERDICT_WORDS[c.verdict]}, ${new Date(c.postedAt).toISOString().slice(0, 10)}, ${moveLine(c)}\n    "${c.quote || c.text}"\n    ${c.url ?? '(no post on X)'}` : `${label}: none`
  console.log(`\n${rec.words.headline}`)
  console.log(line('Best call', best))
  console.log(line('Their strongest miss', worst))
  console.log(`\nRecord: ${SITE_URL}${recordHref(rec.handle, rec.symbol)}  (read every call there before publishing)`)
  if (best) console.log(`Outreach link: ${SITE_URL}${callHref(rec.handle, rec.symbol, best.postId)}`)
  console.log(`Finished scans: ${internal} internal, ${listedAlready} public.`)

  if (!args.apply) {
    console.log(internal ? `Dry run: nothing was written. --apply sets is_internal = false on the ${internal} internal finished scan(s).` : 'Dry run: nothing was written. Nothing to publish: no internal finished scan.')
    return
  }
  const done = await prisma.xScan.updateMany({ where: { ...where, isInternal: true }, data: { isInternal: false } })
  console.log(`Published: ${done.count} finished scan(s) of @${rec.handle} on ${rec.symbol} are public now. The board's five-minute cache may hold the old list that long.`)
}

if (process.argv[1]?.endsWith('called-publish.ts')) {
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
