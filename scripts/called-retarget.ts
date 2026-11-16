// Read the TARGET of calls labeled before 2026-11-16 (Called it, target
// judging). A call that names a level ("$5B is a clear magnet") is judged on
// the level, but labels written before targets were read carry none, so they
// stay on the 30-day close until this runs.
//
// It re-asks the labeler about the posts already labeled as calls (stance
// bull/bear, conviction >= 2, no target yet; harness labels skipped) and
// writes ONLY the `target` column, and only where the new answer takes the
// same side as the stored label. Stance, conviction and quote are never
// touched. No X read: the posts are cached. Cost: one small-model call per 30
// posts.
//
//   DATABASE_URL=... npx tsx scripts/called-retarget.ts [--handle=h] [--symbol=S] [--apply]
//
// Without --apply it prints what it would write and writes nothing.
import { PrismaClient } from '@prisma/client'
import { labelPosts, FAKE_LABEL_MODELS } from '../lib/called-it/classify'
import { MIN_CALL_CONVICTION, type XPost } from '../lib/called-it/spec'

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const apply = process.argv.includes('--apply')
const onlyHandle = arg('handle')?.toLowerCase()
const onlySymbol = arg('symbol')?.toUpperCase()

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set (pass it inline)')
  console.log(`host: ${new URL(url).hostname}${apply ? '  (APPLY)' : '  (dry run)'}`)
  const prisma = new PrismaClient()
  const rows = await prisma.$queryRaw<{ post_id: string; symbol: string; stance: string; model: string | null; handle: string; text: string; posted_at: Date; is_reply: boolean }[]>`
    SELECT c.post_id, c.symbol, c.stance, c.model, p.handle, p.text, p.posted_at, p.is_reply
    FROM x_calls c JOIN x_posts p ON p.post_id = c.post_id
    WHERE c.stance IN ('bull', 'bear') AND c.conviction >= ${MIN_CALL_CONVICTION} AND c.target IS NULL AND p.gone_at IS NULL`
  const todo = rows.filter((r) => !(r.model && FAKE_LABEL_MODELS.has(r.model)) && (!onlyHandle || r.handle === onlyHandle) && (!onlySymbol || r.symbol === onlySymbol))
  const groups = new Map<string, typeof todo>()
  for (const r of todo) groups.set(`${r.handle}|${r.symbol}`, [...(groups.get(`${r.handle}|${r.symbol}`) ?? []), r])
  console.log(`${todo.length} calls with no target read, in ${groups.size} records`)
  let found = 0
  for (const [key, list] of groups) {
    const [handle, symbol] = key.split('|')
    const posts: XPost[] = list.map((r) => ({ id: r.post_id, handle, text: r.text, postedAt: r.posted_at.getTime(), likes: null, replies: null, reposts: null, isReply: r.is_reply, source: 'x-api' }))
    const res = await labelPosts(posts, symbol)
    for (const { postId, label } of res.labels) {
      const was = list.find((r) => r.post_id === postId)!
      if (!label.target || label.stance !== was.stance) continue
      found++
      console.log(`  @${handle} ${symbol} ${postId}: ${JSON.stringify(label.target)}`)
      if (apply) await prisma.$executeRaw`UPDATE x_calls SET target = ${label.target} WHERE post_id = ${postId} AND symbol = ${symbol} AND target IS NULL`
    }
    if (res.unlabeled.length) console.log(`  @${handle} ${symbol}: ${res.unlabeled.length} posts got no answer (try again)`)
  }
  console.log(`${found} targets ${apply ? 'written' : 'found (nothing written)'}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
