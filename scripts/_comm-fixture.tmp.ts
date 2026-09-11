// TEMP (never committed): seed PUBLIC fixture posts for the COMM screenshots,
// print a session JWT for the author, or clean everything up.
import prisma from '@/lib/db'
import { signSession } from '@/lib/auth'

const A = '0x1111000000000000000000000000000000000a11'
const B = '0x2222000000000000000000000000000000000b22'
const SLUG = 'commfixaapl'

async function seed() {
  await cleanup()
  await prisma.creatorHandle.create({ data: { handle: 'chartfox', creator: A } })
  await prisma.intentLink.create({ data: { id: SLUG, ask: 'Buy $10 of AAPL', mcps: 'robinhood-free', creator: A, isInternal: false } })
  await prisma.intentLinkEvent.createMany({
    data: [
      { slug: SLUG, kind: 'signed', wallet: B, valueUsd: 10, verification: 'attested', isInternal: false },
      { slug: SLUG, kind: 'signed', wallet: '0x3333000000000000000000000000000000000c33', valueUsd: 25, verification: 'verified', isInternal: false },
    ],
  })
  const state = {
    v: 1,
    symbol: 'AAPL',
    tf: '1d',
    lines: [
      { id: 'sup', kind: 'h', price: 224.5, label: 'support · buy here', action: { kind: 'buy', ask: 'Buy $10 of AAPL' } },
      { id: 'res', kind: 'zone', p1: 241, p2: 246, label: 'supply zone · trim', action: { kind: 'sell', ask: 'Sell $10 of AAPL' } },
      { id: 'stop', kind: 'h', price: 216, label: 'stop', action: { kind: 'stop', ask: 'Sell all my AAPL if it drops to $216' } },
      { id: 'n1', kind: 'note', t: 1757437200, price: 232, text: 'iPhone event' },
    ],
  }
  const p1 = await prisma.chartPost.create({
    data: {
      id: 'commfix0001',
      symbol: 'AAPL',
      author: A,
      kind: 'idea',
      title: 'AAPL: buy the post-event dip at 224, trim into 241–246',
      body: 'Every September the event is sell-the-news and every October it recovers. The 224 shelf held three times in August. I am bidding there and trimming into the 241–246 supply zone. Stop under 216 — if that breaks the whole structure is wrong.\n\nNot advice. The line is the order; you sign it.',
      chartState: state as object,
      linkSlug: SLUG,
      isInternal: false,
      createdAt: new Date(Date.now() - 3 * 3600_000),
    },
  })
  await prisma.chartPost.create({
    data: {
      id: 'commfix0002',
      symbol: 'AAPL',
      author: B,
      kind: 'idea',
      title: 'Fork of AAPL: buy the post-event dip at 224, trim into 241–246',
      body: 'Same levels, but I DCA the bid instead of one buy.',
      chartState: { ...state, lines: [{ ...state.lines[0], action: { kind: 'dca', ask: 'DCA $10 into AAPL weekly' } }, state.lines[1]] } as object,
      forkOf: p1.id,
      isInternal: false,
      createdAt: new Date(Date.now() - 40 * 60_000),
    },
  })
  await prisma.chartPost.create({
    data: {
      id: 'commfix0003',
      symbol: 'AAPL',
      author: B,
      kind: 'link',
      title: "Apple's iPhone Duo event: what the tape did last five years",
      body: '',
      linkUrl: 'https://www.investopedia.com/apple-iphone-event-stock-reaction',
      isInternal: false,
      createdAt: new Date(Date.now() - 26 * 3600_000),
    },
  })
  await prisma.chartPostComment.createMany({
    data: [
      { id: 'commfixc001', postId: p1.id, author: B, body: 'Took the 224 bid via the link. Stop is a bit wide for me — 219 instead.', isInternal: false },
      { id: 'commfixc002', postId: p1.id, author: A, body: '219 is inside the August wick; 216 is under it. Your call.', isInternal: false },
    ],
  })
  console.log('seeded; jwt for A:', await signSession(A))
}

async function cleanup() {
  await prisma.chartPost.deleteMany({ where: { author: { in: [A, B] } } })
  await prisma.intentLinkEvent.deleteMany({ where: { slug: SLUG } })
  await prisma.intentLink.deleteMany({ where: { id: SLUG } })
  await prisma.creatorHandle.deleteMany({ where: { creator: A } })
}

const mode = process.argv[2]
;(mode === 'cleanup' ? cleanup() : seed()).then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
