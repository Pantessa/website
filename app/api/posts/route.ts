import { NextRequest, NextResponse, after } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isInternalRun } from '@/lib/internal-run'
import { clientIpFrom } from '@/lib/turn-limits'
import { normalizeChartSymbol } from '@/lib/charts'
import { parseChartState } from '@/lib/chart-state'
import {
  bumpAndCheckPostWrite,
  createPost,
  listPosts,
  primaryAsk,
  scrapeLinkTitle,
  validatePostDraft,
  writeLimitReply,
  type PostKind,
  type PostSort,
} from '@/lib/chart-posts'
import { mintPostLink } from './mint-link'
import { chartPairFor } from '@/lib/charts'
import { getCommunity, getFeedPost, roleOf } from '@/lib/community/store'
import { REFUSE_NOT_YOURS, fillLabel, resolveTradeProof } from '@/lib/community/proof'
import { fanoutPost } from '@/lib/community/fanout'
import { walletKey, type PublicCommunity, type TradeProof } from '@/lib/community/spec'

// /api/posts — the symbol page's forum.
//
// GET  ?symbol=AAPL&sort=new|executed&limit=30&kind=idea|link
//      Public, connect-only can read. Fenced is_internal:false (#699 class);
//      an internal-run caller may pass internal=1 to read its OWN harness
//      rows back — never a public default.
// POST { symbol, kind?, title, body?, chartState?, linkUrl?, forkOf?, mint? }
//      SIWE-gated (a session cookie — the signature proves the wallet; a
//      connect-only wallet can read, not write). Per-wallet + per-IP hourly
//      fences. Text is plain text, chartState is strict-parsed and ≤32KB,
//      a link post's URL is https/public-host only. `mint: true` mints the
//      chart's primary action as an intent link through the existing
//      /api/intent-links door in the same request (the creator kickback
//      follows the author); a mint refusal never loses the post — it comes
//      back as `mintError` beside the created row.
//      `forkOf` copies the parent's chart state when none is supplied
//      ("Copy these lines to my chart") and records lineage.
//      Squad community (2026-11-09): `community` puts the post in a room
//      (the author must already be a MEMBER — 403 `needsJoin`); `kind:
//      'video'` + `mediaUrl` stores the REBUILT watch URL; `kind: 'trade'` +
//      `proofTurnId` (+ `showSize`) re-derives the proof from the author's
//      own receipt-verified fill. The answer is the feed's FeedPost; a room
//      post is announced to its linked chats after the response.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const symbol = normalizeChartSymbol(q.get('symbol') ?? '')
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
  const sort: PostSort = q.get('sort') === 'executed' ? 'executed' : 'new'
  const kindParam = q.get('kind')
  const kind: PostKind | undefined = kindParam === 'link' || kindParam === 'idea' ? kindParam : undefined
  const limit = Number(q.get('limit') ?? 30)
  const includeInternal = q.get('internal') === '1' && isInternalRun(req.headers)
  const posts = await listPosts(symbol, { sort, kind, limit: Number.isFinite(limit) ? limit : 30, includeInternal })
  if (!posts) return NextResponse.json({ error: `No live chart for ${symbol}, so no board either.` }, { status: 400 })
  return NextResponse.json({ symbol, sort, posts }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const author = await getSessionAddress().catch(() => null)
  if (!author) return NextResponse.json({ error: 'Sign in to post — one free signature.' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const verdict = validatePostDraft(body)
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 400 })
  const draft = verdict.draft
  const internal = isInternalRun(req.headers, body)

  // A room post: the room must exist and the author must sit in it.
  let room: PublicCommunity | null = null
  if (draft.community) {
    room = await getCommunity(draft.community)
    if (!room) return NextResponse.json({ error: 'No such room.' }, { status: 404 })
    if (!(await roleOf(room.slug, walletKey(author)))) return NextResponse.json({ error: `Join /g/${room.slug} to post in it.`, needsJoin: true }, { status: 403 })
  }

  // A trade post: the proof is re-derived from the author's own verified row.
  let proof: TradeProof | null = null
  if (draft.kind === 'trade') {
    // S1 + S2: only the hash and the chain come from the row; the chain is
    // READ now (what this wallet moved), fail closed on no answer.
    const r = draft.proofTurnId
      ? await resolveTradeProof(author, draft.proofTurnId, { showSize: draft.showSize, includeInternal: internal })
      : ({ ok: false, status: 400, reason: REFUSE_NOT_YOURS } as const)
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
    proof = r.proof
    const traded = proof.symbols.map((t) => t.split(':')[1]).filter((x): x is string => !!x)
    if (!draft.symbol) {
      const first = traded.map((t) => chartPairFor(t)?.symbol).find((x): x is string => !!x)
      if (!first) return NextResponse.json({ error: 'That fill names no charted market. Add the symbol.' }, { status: 400 })
      draft.symbol = first
    } else if (traded.length && !traded.some((t) => chartPairFor(t)?.symbol === draft.symbol)) {
      return NextResponse.json({ error: `That fill is a ${traded.join(' / ')} trade, not ${draft.symbol}.` }, { status: 400 })
    }
    if (draft.title.length < 3) draft.title = fillLabel(proof)
  }

  // Fork: the parent must exist and be readable by this caller (an internal
  // row is only forkable from an internal run — never a way to surface it).
  if (draft.forkOf) {
    const parent = await prisma.chartPost.findUnique({ where: { id: draft.forkOf } })
    if (!parent || (parent.isInternal && !internal)) return NextResponse.json({ error: 'forkOf names a post that does not exist.' }, { status: 404 })
    if (parent.symbol !== draft.symbol) return NextResponse.json({ error: `That post is about ${parent.symbol}, not ${draft.symbol}.` }, { status: 400 })
    if (!draft.chartState) {
      const parentState = parseChartState(parent.chartState)
      if (!parentState) return NextResponse.json({ error: 'That post has no chart to copy.' }, { status: 400 })
      draft.chartState = parentState
    }
    if (!draft.title) draft.title = `Fork of ${parent.title}`.slice(0, 120)
  }

  // A pinned link without a typed title gets the page's own — fenced fetch,
  // landed host re-checked; if that fails the poster must type one.
  if (draft.kind === 'link' && draft.title.length < 3) {
    const scraped = draft.linkUrl ? await scrapeLinkTitle(draft.linkUrl) : null
    if (!scraped) return NextResponse.json({ error: 'Could not read a title from that page — add one.' }, { status: 400 })
    draft.title = scraped
  }

  const tripped = await bumpAndCheckPostWrite(clientIpFrom(req.headers), author, 'post')
  if (tripped) return NextResponse.json({ error: writeLimitReply(tripped, 'post'), rateGate: tripped }, { status: 429 })

  const created = await createPost(author, draft, internal, { proof })

  // "Post = executable idea": mint the primary action now when asked.
  let mint: { slug: string; url: string } | null = null
  let mintError: string | null = null
  const ask = primaryAsk(created.chartState)
  const wantMint = typeof body === 'object' && body !== null && (body as { mint?: unknown }).mint === true
  if (wantMint && ask) {
    const r = await mintPostLink(req, created.id, ask)
    if (r.ok) mint = { slug: r.slug, url: r.url }
    else mintError = r.error
  } else if (wantMint && !ask) {
    mintError = 'This chart has no action to mint — add a line with a Buy/Sell/Stop/DCA action first.'
  }

  const feedPost = await getFeedPost(created.id, walletKey(author))
  const post = feedPost ?? created
  if (room && feedPost && !internal) {
    const r = room
    after(() => fanoutPost(feedPost, r).then(() => undefined))
  }

  return NextResponse.json(
    {
      post: mint ? { ...post, linkSlug: mint.slug } : post,
      ...(mint ? { link: mint } : {}),
      ...(mintError ? { mintError } : {}),
      ...(internal ? { internal: true } : {}),
    },
    { status: 201 },
  )
}
