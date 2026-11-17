// Read-only probe of the called-it sources (squad called-it, lane SOURCE).
//
//   npx tsx scripts/called-probe.ts [postId]                   the keyless read of one post (free)
//   npx tsx scripts/called-probe.ts --handle=<h> --spend [--terms=a,b]
//        with X_BEARER_TOKEN set: ONE full-archive search capped at 10 posts
//        ($0.05, no profile read) and the shape of what came back.
//
// Never spends without --spend. Writes nothing anywhere. The bearer is never printed.
import { readPostByIdWith, syndicationToken, syndicationUrl } from '../lib/called-it/source/by-id'
import { XApiError, XApiSource, buildSearchQueries } from '../lib/called-it/source/x-api'
import { snowflakeMs } from '../lib/called-it/spec'

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
const val = (name: string) => flag(name)?.split('=').slice(1).join('=') || null

async function main(): Promise<void> {
  const id = args.find((a) => /^\d{5,20}$/.test(a)) ?? '1585341984679469056'
  const t0 = Date.now()
  const r = await readPostByIdWith(id)
  const sf = snowflakeMs(id)
  console.log(`keyless read of ${id} (token ${syndicationToken(id)}, ${Date.now() - t0} ms)`)
  console.log(`  ${syndicationUrl(id)}`)
  console.log(`  id clock: ${sf === null ? 'none (pre-2010 id)' : new Date(sf).toISOString()}`)
  console.log(JSON.stringify(r, null, 2))

  const handle = val('handle')
  if (!flag('spend')) {
    if (handle) console.log(`\n--handle given without --spend: nothing sent to X. Queries it would send:\n${buildSearchQueries(handle, (val('terms') ?? '$BTC,#BTC,bitcoin').split(',')).join('\n')}`)
    return
  }
  const bearer = process.env.X_BEARER_TOKEN?.trim()
  if (!bearer) {
    console.log('\n--spend asked, but X_BEARER_TOKEN is not set: nothing sent to X.')
    return
  }
  if (!handle) {
    console.log('\n--spend needs --handle=<h>: nothing sent to X.')
    return
  }
  const src = new XApiSource({ bearer })
  const now = Date.now()
  try {
    const res = await src.search({ handle: handle.replace(/^@/, '').toLowerCase(), terms: (val('terms') ?? '$BTC,#BTC,bitcoin').split(','), fromMs: now - 365 * 86_400_000, toMs: now, cap: 10 })
    console.log(`\nsearch: ${res.readCount} read, ${res.posts.length} kept, $${res.costUsd.toFixed(3)}, truncated ${res.truncated}`)
    for (const p of res.posts) console.log(`  ${p.id} ${new Date(p.postedAt).toISOString()} likes=${p.likes} reply=${p.isReply} ${JSON.stringify(p.text.slice(0, 100))}`)
  } catch (e) {
    console.log(`\nsearch failed: ${e instanceof XApiError ? `${e.kind} ${e.status ?? ''} ${e.message}` : 'unexpected error'}`)
  }
}

main().catch(() => {
  console.log('probe failed')
  process.exit(1)
})
