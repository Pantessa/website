// Pins for squad community, lane CORE (2026-11-09). The lane owns this
// file and fills it; the harness (scripts/test-api.ts) already calls both
// exports, so a lane never edits test-api.ts or package.json.
//   npx tsx scripts/community-core-pins.ts            (npm run pins:community-core)
//   BASE=http://localhost:PORT npx tsx scripts/community-core-pins.ts --served

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSiweMessage } from 'viem/siwe'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { validatePostDraft } from '../lib/chart-posts'
import { hotRank, RESERVED_COMMUNITY_SLUGS } from '../lib/community/spec'
import { checkName, checkSlug, checkSymbols, decodeCursor, encodeCursor, higherRole, memberLabel, parseVote, voteDelta } from '../lib/community/rules'
import { fillLabel, proofSide, safeTxUrl } from '../lib/community/proof'

type Check = (name: string, ok: boolean, extra?: string) => void

/** Pure pins: no server, no network, no DB. */
export function communityCorePins(check: Check): void {
  const s = (v: unknown) => checkSlug(v)
  const good = s(' Good-Room ')
  check(
    'community core: slug rule — lowercased + trimmed, 3–32 chars, no leading/trailing/double dash, reserved words refused',
    good.ok && good.value === 'good-room' && !s('ab').ok && !s('-room').ok && !s('room-').ok && !s('a--b').ok && !s('a'.repeat(33)).ok && s('a'.repeat(32)).ok && !s('admin').ok && !s('pantessa').ok && [...RESERVED_COMMUNITY_SLUGS].every((r) => !s(r).ok) && !s(42).ok,
  )
  const nm = checkName('  ETH\n  traders ')
  const syms = checkSymbols(['eth', 'ETH', 'aapl'])
  check(
    'community core: name is one cleaned line; symbols chart (fail closed), dedupe, stables refused',
    nm.ok && nm.value === 'ETH traders' && !checkName('x').ok && syms.ok && syms.value.join(',') === 'ETH,AAPL' && !checkSymbols(['USDC']).ok && !checkSymbols('ETH').ok,
  )
  const now = Date.UTC(2026, 10, 9)
  check(
    'community core: hotRank — more votes rank higher at the same age; a newer post beats an older one at the same score; a downvoted post sinks; 10 votes ≈ 12.5h of age',
    hotRank(10, now) > hotRank(1, now) && hotRank(0, now + 60_000) > hotRank(0, now) && hotRank(-5, now) < hotRank(0, now) && hotRank(10, now) > hotRank(0, now + 12 * 3_600_000) && hotRank(10, now) < hotRank(0, now + 13 * 3_600_000),
  )
  check(
    'community core: votes — only 1 / 0 / -1 parse; the score moves by next − prev',
    parseVote(1) === 1 && parseVote(0) === 0 && parseVote(-1) === -1 && parseVote(2) === null && parseVote('1') === null && voteDelta(0, 1) === 1 && voteDelta(1, -1) === -2 && voteDelta(-1, 0) === 1 && voteDelta(1, 1) === 0,
  )
  const vid = validatePostDraft({ kind: 'video', community: 'my-room', title: 'Watch this', mediaUrl: 'https://youtu.be/dQw4w9WgXcQ?t=42&utm=x' })
  const vidBad = validatePostDraft({ kind: 'video', community: 'my-room', title: 'Watch this', mediaUrl: 'https://evil.example/watch?v=dQw4w9WgXcQ' })
  const vidHttp = validatePostDraft({ kind: 'video', community: 'my-room', title: 'Watch this', mediaUrl: 'http://youtu.be/dQw4w9WgXcQ' })
  const roomLink = validatePostDraft({ kind: 'link', community: 'my-room', symbol: '', title: 'a read', linkUrl: 'https://example.com/a' })
  const bareLink = validatePostDraft({ kind: 'link', symbol: '', title: 'a read', linkUrl: 'https://example.com/a' })
  const trade = validatePostDraft({ kind: 'trade', community: 'my-room', proofTurnId: 'abcdefgh1234' })
  const tradeNoProof = validatePostDraft({ kind: 'trade', community: 'my-room', symbol: 'ETH' })
  const ideaNoSym = validatePostDraft({ kind: 'idea', community: 'my-room', title: 'no market' })
  const mediaOnIdea = validatePostDraft({ symbol: 'ETH', title: 'an idea', mediaUrl: 'https://youtu.be/dQw4w9WgXcQ' })
  const badRoom = validatePostDraft({ symbol: 'ETH', title: 'an idea', community: 'Not A Slug!' })
  const badKind = validatePostDraft({ symbol: 'ETH', title: 'an idea', kind: 'poll' })
  check(
    'community core: drafts — a video stores the REBUILT watch URL (allowlisted https host only); a room link/video may skip the symbol, a bare one may not; a trade needs proofTurnId; an idea needs a symbol; mediaUrl only on a video; a bad room slug / kind refused',
    vid.ok && vid.draft.mediaUrl === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' && vid.draft.symbol === '' && vid.draft.community === 'my-room' &&
      !vidBad.ok && !vidHttp.ok && roomLink.ok && roomLink.draft.symbol === '' && !bareLink.ok &&
      trade.ok && trade.draft.proofTurnId === 'abcdefgh1234' && trade.draft.showSize === true && !tradeNoProof.ok && /proofTurnId/.test(tradeNoProof.ok ? '' : tradeNoProof.reason) &&
      !ideaNoSym.ok && !mediaOnIdea.ok && !badRoom.ok && !badKind.ok,
  )
  const tgId = '987654321'
  check(
    'community core: member labels — @handle, else a short wallet, else the provider name, never a raw Telegram / Discord id (an all-digits name reads generic)',
    memberLabel({ wallet: '0x' + 'ab'.repeat(20), handle: 'nate', source: 'site' }) === '@nate' &&
      memberLabel({ wallet: '0x' + 'ab'.repeat(20), source: 'site' }) === '0xabab…abab' &&
      memberLabel({ wallet: null, displayName: 'Ana\u0007 K', source: 'telegram' }) === 'Ana K' &&
      memberLabel({ wallet: null, displayName: tgId, source: 'telegram' }) === 'A Telegram member' &&
      memberLabel({ wallet: null, displayName: null, source: 'discord' }) === 'A Discord member' &&
      !memberLabel({ wallet: null, displayName: null, source: 'telegram' }).includes(tgId),
  )
  const off = encodeCursor({ o: 25 })
  const key = encodeCursor({ t: 1_762_000_000_000, id: 'abc123def0' })
  const dk = decodeCursor(key)
  check(
    'community core: feed cursor round-trips (offset + keyset); garbage, a huge offset and a bad id decode to null',
    JSON.stringify(decodeCursor(off)) === '{"o":25}' && !!dk && 't' in dk && dk.id === 'abc123def0' && decodeCursor('not-base64!!') === null && decodeCursor(encodeCursor({ o: 99_999 })) === null && decodeCursor(Buffer.from('{"t":1,"id":"X; DROP"}').toString('base64url')) === null && decodeCursor(null) === null,
  )
  check(
    'community core: roles merge to the higher; proof side reads the tag (an HL perp build is long/short); a tx link must be https; the fill label is plain words',
    higherRole('member', 'owner') === 'owner' && higherRole('mod', 'member') === 'mod' &&
      proofSide(['buy:ETH'], 'native-swap-uniswap') === 'buy' && proofSide(['sell:HYPE'], 'native-hl-exec') === 'short' && proofSide([], null) === null &&
      safeTxUrl('https://basescan.org/tx/0x1') !== null && safeTxUrl('javascript:alert(1)') === null && safeTxUrl('http://basescan.org/tx/0x1') === null &&
      fillLabel({ symbols: ['buy:ETH'], side: 'buy', sizeUsd: 25, chain: 'Base' }) === 'Bought $25 of ETH on Base' &&
      fillLabel({ symbols: ['sell:AAPL'], side: 'sell', sizeUsd: null, chain: null }) === 'Sold AAPL',
  )
}

// ── served ───────────────────────────────────────────────────────────────

/** The main checkout's convention: the worktree's .env.local carries the TEST DB + the burner. tsx does not load it. */
function loadEnvLocal() {
  if (process.env.DATABASE_URL && process.env.PRIVATE_KEY && process.env.SESSION_SECRET) return
  try {
    const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m || process.env[m[1]] !== undefined) continue
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    }
  } catch {
    /* the harness already has its env */
  }
}

function cookieOf(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

async function signIn(base: string, account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await fetch(`${base}/api/auth/nonce`, { cache: 'no-store' })
  const nonceCookie = cookieOf(nonceRes, 'yf_siwe_nonce')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(base).host, nonce, uri: base, version: '1' })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = cookieOf(res, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${res.status})`)
  return session
}

const INTERNAL = { 'x-yf-internal-run': '1' }
/** The harness's fetch belt stamps every request internal unless this header asks it not to (it strips it). */
const ORGANIC = { 'x-yf-organic-probe': '1' }

/** Served pins: against a running `next start` (BASE) on the standard harness belt + the TEST DB.
 *  Every row written carries the internal-run header and is cleaned up. */
export async function communityCorePinsServed(check: Check, base: string): Promise<void> {
  loadEnvLocal()
  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    check('community core (served): the burner PRIVATE_KEY is in the env', false, 'not set')
    return
  }
  const { default: prisma } = await import('../lib/db')
  const { signIdentity } = await import('../lib/community/identity')
  const A = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  const B = privateKeyToAccount(generatePrivateKey())
  const a = A.address.toLowerCase()
  const b = B.address.toLowerCase()
  const slug = `t-core-${Date.now().toString(36)}`
  const tgId = String(9_000_000_000 + Math.floor(Math.random() * 999_999_999))
  const fixtureIds: string[] = []
  const J = (cookie?: string | null, extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', ...INTERNAL, ...(cookie ? { cookie } : {}), ...extra })

  type Json = Record<string, unknown> & { error?: string }
  const call = async (method: string, path: string, opts: { cookie?: string | null; body?: unknown; organic?: boolean } = {}) => {
    const headers: Record<string, string> = opts.organic ? { 'content-type': 'application/json', ...ORGANIC, ...(opts.cookie ? { cookie: opts.cookie } : {}) } : J(opts.cookie)
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), cache: 'no-store' })
    let json: Json = {}
    try {
      json = (await res.json()) as Json
    } catch {
      /* not json */
    }
    return { status: res.status, json, cc: res.headers.get('cache-control') ?? '' }
  }

  try {
    const sa = await signIn(base, A)
    const sb = await signIn(base, B)

    // ── rooms ──
    const noAuth = await call('POST', '/api/communities', { body: { slug, name: 'Core pin room' } })
    const reserved = await call('POST', '/api/communities', { cookie: sa, body: { slug: 'admin', name: 'Core pin room' } })
    const created = await call('POST', '/api/communities', { cookie: sa, body: { slug, name: 'Core pin room', about: 'pins', symbols: ['eth'] } })
    const taken = await call('POST', '/api/communities', { cookie: sa, body: { slug, name: 'Again' } })
    const c = created.json.community as { slug: string; members: number; symbols: string[]; ownerLabel: string } | undefined
    check(
      'community core (served): POST /api/communities — 401 signed out, 400 reserved by name, 201 with the owner seated (members 1), 409 taken',
      noAuth.status === 401 && reserved.status === 400 && /reserved/.test(reserved.json.error ?? '') && created.status === 201 && c?.slug === slug && c.members === 1 && c.symbols.join() === 'ETH' && taken.status === 409,
      `${noAuth.status}/${reserved.status}/${created.status}/${taken.status}`,
    )
    const list = await call('GET', '/api/communities?sort=new&limit=100', { organic: true })
    const bySlug = await call('GET', `/api/communities/${slug}`, { cookie: sa })
    const meA = bySlug.json.me as { role: string; invite: { code: string; url: string; uses: number } } | null
    check(
      'community core (served): the public directory never lists the internal room; the by-slug read does, with my own seat (owner + invite) and no-store',
      list.status === 200 && Array.isArray(list.json.communities) && !(list.json.communities as { slug: string }[]).some((x) => x.slug === slug) &&
        bySlug.status === 200 && meA?.role === 'owner' && /^[a-z0-9]{8}$/.test(meA.invite.code) && meA.invite.url.endsWith(`/g/${slug}?via=${meA.invite.code}`) && /no-store/.test(bySlug.cc),
    )
    const patch = await call('PATCH', `/api/communities/${slug}`, { cookie: sb, body: { name: 'hijack' } })
    const patchOk = await call('PATCH', `/api/communities/${slug}`, { cookie: sa, body: { about: 'edited' } })
    check('community core (served): PATCH — a non-owner 403, the owner edits', patch.status === 403 && patchOk.status === 200 && (patchOk.json.community as { about: string })?.about === 'edited', `${patch.status}/${patchOk.status}`)

    // ── join / invite / leave ──
    const strangerJoin = await call('POST', `/api/communities/${slug}/join`, { body: {} })
    const j1 = await call('POST', `/api/communities/${slug}/join`, { cookie: sb, body: { via: meA?.invite.code } })
    const j2 = await call('POST', `/api/communities/${slug}/join`, { cookie: sb, body: { via: meA?.invite.code } })
    const ownJoin = await call('POST', `/api/communities/${slug}/join`, { cookie: sa, body: { via: meA?.invite.code } })
    check(
      'community core (served): join — a stranger 401 needsIdentity; the first join seats (joined true, members 2), the second is a no-op (joined false, members 2); the owner re-joining is a no-op',
      strangerJoin.status === 401 && strangerJoin.json.needsIdentity === true && j1.status === 200 && j1.json.joined === true && (j1.json.community as { members: number })?.members === 2 &&
        j2.json.joined === false && (j2.json.community as { members: number })?.members === 2 && ownJoin.json.joined === false && (j1.json.me as { role: string })?.role === 'member',
      `${strangerJoin.status}/${j1.status}`,
    )
    const members = await call('GET', `/api/communities/${slug}/members?sort=invites`)
    const ms = (members.json.members ?? []) as { label: string; role: string; invited: number; verifiedTrades: number }[]
    const reread = await call('GET', `/api/communities/${slug}`, { cookie: sa })
    check(
      "community core (served): the invite is credited — the owner's row reads invited 1 and leads the board, uses = 1; labels are short wallets",
      ms.length === 2 && ms[0].role === 'owner' && ms[0].invited === 1 && ms[1].invited === 0 && ms.every((m) => /^0x[a-f0-9]{4}…[a-f0-9]{4}$|^@/.test(m.label)) && (reread.json.me as { invite: { uses: number } })?.invite.uses === 1,
      JSON.stringify(ms).slice(0, 200),
    )
    const ownerLeave = await call('DELETE', `/api/communities/${slug}/join`, { cookie: sa })
    const bLeave = await call('DELETE', `/api/communities/${slug}/join`, { cookie: sb })
    const bLeave2 = await call('DELETE', `/api/communities/${slug}/join`, { cookie: sb })
    const afterLeave = await call('GET', `/api/communities/${slug}`)
    check(
      'community core (served): leave — the owner 409; a member leaves (members 1); leaving twice is left:false',
      ownerLeave.status === 409 && bLeave.json.left === true && bLeave2.json.left === false && (afterLeave.json.community as { members: number })?.members === 1 && afterLeave.json.me === null,
      `${ownerLeave.status}/${bLeave.status}`,
    )

    // ── posts in the room ──
    const link = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'link', symbol: '', title: 'A read on ETH flows', linkUrl: 'https://example.com/core-pin' } })
    const video = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'video', title: 'Chart walk', mediaUrl: 'https://youtu.be/dQw4w9WgXcQ?t=9' } })
    const badVideo = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'video', title: 'Chart walk', mediaUrl: 'https://evil.example/v/1' } })
    const notMember = await call('POST', '/api/posts', { cookie: sb, body: { community: slug, kind: 'link', title: 'spam', linkUrl: 'https://example.com/spam' } })
    const noRoom = await call('POST', '/api/posts', { cookie: sa, body: { community: 't-core-nope', kind: 'link', title: 'x y z', linkUrl: 'https://example.com/x' } })
    const lp = link.json.post as { id: string; kind: string; community: { slug: string } | null; symbol: string; score: number; myVote: number } | undefined
    const vp = video.json.post as { id: string; kind: string; mediaUrl: string; video: { host: string; embedUrl: string } | null } | undefined
    check(
      'community core (served): room posts — a link with no symbol and a video (REBUILT url, embed derived) are created as FeedPosts; a foreign video host 400; a non-member 403 needsJoin; an unknown room 404',
      link.status === 201 && lp?.kind === 'link' && lp.community?.slug === slug && lp.symbol === '' && lp.score === 0 && lp.myVote === 0 &&
        video.status === 201 && vp?.kind === 'video' && vp.mediaUrl === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' && vp.video?.host === 'youtube' && vp.video.embedUrl === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' &&
        badVideo.status === 400 && notMember.status === 403 && notMember.json.needsJoin === true && noRoom.status === 404,
      `${link.status}/${video.status}/${badVideo.status}/${notMember.status}/${noRoom.status} ${link.json.error ?? ''}`,
    )

    // ── votes ──
    if (lp && vp) {
      const v = (cookie: string | null, value: unknown, organic = false) => call('POST', `/api/posts/${lp.id}/vote`, { cookie, body: { value }, organic })
      const s1 = await v(sb, 1)
      const s2 = await v(sa, 1)
      const s3 = await v(sb, 0)
      const s4 = await v(sb, -1)
      const s5 = await v(sb, 1)
      const again = await v(sb, 1)
      const bad = await v(sb, 2)
      const stranger = await v(null, 1)
      const organic = await v(sb, 1, true)
      check(
        'community core (served): votes — one per actor, score = the sum (1, 2, 1, 0, 2, re-vote 2); 2 is 400; a stranger 401; an internal post from a non-internal run is 404',
        s1.json.score === 1 && s2.json.score === 2 && s3.json.score === 1 && s3.json.myVote === 0 && s4.json.score === 0 && s4.json.myVote === -1 && s5.json.score === 2 && again.json.score === 2 && bad.status === 400 && stranger.status === 401 && organic.status === 404,
        [s1, s2, s3, s4, s5, again].map((x) => x.json.score).join(',') + ` ${bad.status}/${stranger.status}/${organic.status}`,
      )

      // ── feed ──
      const f = (q: string, cookie: string | null = sa) => call('GET', `/api/feed?community=${slug}&${q}`, { cookie })
      const fNew = await f('sort=new&limit=1')
      const fNew2 = await f(`sort=new&limit=1&cursor=${encodeURIComponent(String(fNew.json.next ?? ''))}`)
      const fHot = await f('sort=hot')
      const fTop = await f('sort=top&window=day')
      const fKind = await f('kind=video&sort=new')
      const ids = (r: { json: Json }) => ((r.json.posts ?? []) as { id: string }[]).map((p) => p.id)
      const hotFirst = (fHot.json.posts as { id: string; myVote: number }[] | undefined)?.[0]
      const publicFeed = await call('GET', '/api/feed?sort=new&limit=100', { organic: true })
      check(
        'community core (served): feed — new pages by cursor (video, then link); hot puts the 2-vote link above the newer video; top ranks by score; kind filters; myVote is mine; the public feed never shows internal posts',
        ids(fNew).join() === vp.id && typeof fNew.json.next === 'string' && ids(fNew2).join() === lp.id && ids(fHot)[0] === lp.id && hotFirst?.myVote === 1 &&
          ids(fTop).join() === `${lp.id},${vp.id}` && ids(fKind).join() === vp.id && !ids(publicFeed).some((id) => id === lp.id || id === vp.id) && /no-store/.test(fNew.cc),
        `${ids(fNew)}|${ids(fNew2)}|${ids(fHot)}|${ids(fTop)}`,
      )
      const one = await call('GET', `/api/posts/${vp.id}`, { cookie: sa })
      const onePost = one.json.post as { kind: string; mediaUrl: string; commentList: unknown[]; score: number } | undefined
      check('community core (served): GET /api/posts/<id> answers the FeedPost fields + commentList', one.status === 200 && onePost?.kind === 'video' && onePost.mediaUrl.startsWith('https://www.youtube.com/') && Array.isArray(onePost.commentList))
    }

    // ── trade proof ──
    const tx = `https://basescan.org/tx/0x${'c0'.repeat(32)}`
    const mk = async (wallet: string, verification: string | null) => {
      const row = await prisma.embedTurn.create({
        data: { embedKeyId: 'first-party', origin: 'http://localhost', sessionId: `harness-core-${slug}`, outcome: 'signed', walletAddress: wallet, verification, txUrl: tx, valueUsd: 25, chain: 'base', symbols: ['buy:ETH'], buildPath: 'native-swap-uniswap', isInternal: true },
        select: { id: true },
      })
      fixtureIds.push(row.id)
      return row.id
    }
    const mine = await mk(a, 'verified')
    const theirs = await mk(b, 'verified')
    const unverified = await mk(a, 'unverified')
    const fills = await call('GET', '/api/me/fills?symbol=ETH&limit=50', { cookie: sa })
    const myFill = ((fills.json.fills ?? []) as { turnId: string; label: string }[]).find((x) => x.turnId === mine)
    const tradeOk = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: mine } })
    const tradeHidden = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: mine, showSize: false, title: 'Added here' } })
    const tradeTheirs = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: theirs } })
    const tradeUnver = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: unverified } })
    const tradeWrongSym = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: mine, symbol: 'AAPL' } })
    const tp = tradeOk.json.post as { kind: string; symbol: string; title: string; proof: { sizeUsd: number | null; side: string; chain: string; txUrl: string; verification: string; turnId: string } | null } | undefined
    const th = tradeHidden.json.post as { proof: { sizeUsd: number | null } | null; title: string } | undefined
    check(
      "community core (served): trade proof — my verified fill is in /api/me/fills with its plain-words label; a trade post derives symbol, title and the proof from MY row (size shown or hidden); another wallet's row, an unverified row and a mismatched symbol are refused",
      !!myFill && myFill.label === 'Bought $25 of ETH on Base' && !((fills.json.fills ?? []) as { turnId: string }[]).some((x) => x.turnId === unverified || x.turnId === theirs) &&
        tradeOk.status === 201 && tp?.kind === 'trade' && tp.symbol === 'ETH' && tp.title === 'Bought $25 of ETH on Base' && tp.proof?.sizeUsd === 25 && tp.proof.side === 'buy' && tp.proof.chain === 'Base' && tp.proof.txUrl === tx && tp.proof.verification === 'verified' && tp.proof.turnId === mine &&
        tradeHidden.status === 201 && th?.proof?.sizeUsd === null && th.title === 'Added here' &&
        tradeTheirs.status === 400 && tradeUnver.status === 400 && tradeWrongSym.status === 400,
      `${fills.status} ${tradeOk.status}/${tradeHidden.status}/${tradeTheirs.status}/${tradeUnver.status}/${tradeWrongSym.status} ${tradeOk.json.error ?? ''}`,
    )
    const organicTrade = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: mine }, organic: true })
    check('community core (served): an internal receipt row is no proof outside an internal run', organicTrade.status === 400, String(organicTrade.status))

    // ── identity ──
    const strangerId = await call('GET', '/api/me/identity')
    const meId = await call('GET', '/api/me/identity', { cookie: sa })
    check(
      'community core (served): /api/me/identity — a stranger is all null and []; a wallet session reads its key and its rooms',
      strangerId.json.wallet === null && strangerId.json.provider === null && strangerId.json.key === null && Array.isArray(strangerId.json.communities) && (strangerId.json.communities as unknown[]).length === 0 &&
        meId.json.wallet === a && meId.json.key === `w:${a}` && ((meId.json.communities ?? []) as { slug: string }[]).some((x) => x.slug === slug),
    )
    const token = await signIdentity({ p: 'tg', id: tgId, name: tgId, username: null })
    const tg = `pt_ident=${token}`
    const tgMe = await call('GET', '/api/me/identity', { cookie: tg })
    const tgJoin = await call('POST', `/api/communities/${slug}/join`, { cookie: tg, body: {} })
    const tgMembers = await call('GET', `/api/communities/${slug}/members?sort=new`)
    const tgVote = lpId(link) ? await call('POST', `/api/posts/${lpId(link)}/vote`, { cookie: tg, body: { value: 1 } }) : null
    check(
      'community core (served): a Telegram identity (pt_ident) acts with no wallet — key tg:…, provider without the id, joins (members 2), votes; the board label never shows the raw id',
      tgMe.json.key === `tg:${tgId}` && tgMe.json.wallet === null && (tgMe.json.provider as { p: string } | null)?.p === 'tg' && !JSON.stringify(tgMe.json.provider).includes(tgId) &&
        tgJoin.json.joined === true && (tgJoin.json.community as { members: number })?.members === 2 &&
        !JSON.stringify(tgMembers.json).includes(tgId) && ((tgMembers.json.members ?? []) as { label: string }[]).some((m) => m.label === 'A Telegram member') && tgVote?.json.score === 3,
      `${tgMe.json.key} ${tgJoin.status} ${tgVote?.json.score}`,
    )
    const linkNoIdent = await call('POST', '/api/me/identity/link', { cookie: sa })
    const linkNoWallet = await call('POST', '/api/me/identity/link', { cookie: tg })
    const linked = await call('POST', '/api/me/identity/link', { cookie: `${sa}; ${tg}` })
    const afterLink = await call('GET', `/api/communities/${slug}`, { cookie: tg })
    const tgAfter = await call('GET', '/api/me/identity', { cookie: tg })
    const scoreAfter = lpId(link) ? await call('GET', `/api/posts/${lpId(link)}`) : null
    check(
      "community core (served): link — needs BOTH proofs (401 without either); then the identity acts as the wallet and its seat merges into the owner's (members 1, role owner); its vote merges too (score 2)",
      linkNoIdent.status === 401 && linkNoWallet.status === 401 && linked.status === 200 && linked.json.linked === true && linked.json.wallet === a && linked.json.moved === 1 &&
        tgAfter.json.key === `w:${a}` && (afterLink.json.community as { members: number })?.members === 1 && (afterLink.json.me as { role: string } | null)?.role === 'owner' &&
        (scoreAfter?.json.post as { score: number } | undefined)?.score === 2,
      `${linkNoIdent.status}/${linkNoWallet.status}/${linked.status} moved=${linked.json.moved} members=${(afterLink.json.community as { members: number })?.members}`,
    )
  } catch (e) {
    check('community core (served): ran to the end', false, e instanceof Error ? e.message : String(e))
  } finally {
    try {
      const posts = await prisma.chartPost.findMany({ where: { communitySlug: slug }, select: { id: true } })
      const postIds = posts.map((p) => p.id)
      await prisma.postVote.deleteMany({ where: { postId: { in: postIds } } })
      await prisma.chartPost.deleteMany({ where: { id: { in: postIds } } })
      await prisma.communityMember.deleteMany({ where: { communitySlug: slug } })
      await prisma.communityInvite.deleteMany({ where: { communitySlug: slug } })
      await prisma.communityChannel.deleteMany({ where: { communitySlug: slug } })
      await prisma.channelLinkCode.deleteMany({ where: { communitySlug: slug } })
      await prisma.community.deleteMany({ where: { slug } })
      await prisma.identityLink.deleteMany({ where: { provider: 'tg', externalId: tgId } })
      if (fixtureIds.length) await prisma.embedTurn.deleteMany({ where: { id: { in: fixtureIds } } })
      const left = (await prisma.community.count({ where: { slug } })) + (await prisma.communityMember.count({ where: { communitySlug: slug } })) + (await prisma.chartPost.count({ where: { communitySlug: slug } }))
      check('community core (served): cleanup — every row this run wrote is gone', left === 0, `left=${left}`)
    } catch (e) {
      check('community core (served): cleanup', false, e instanceof Error ? e.message : String(e))
    }
  }

  function lpId(r: { json: Json }): string | null {
    return ((r.json.post as { id?: string } | undefined)?.id as string | undefined) ?? null
  }
}

if (process.argv[1]?.endsWith('community-core-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => communityCorePins(check))
    .then(() => (served ? communityCorePinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : '\nall green')
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
