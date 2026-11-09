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
import { CROSS_SITE_REFUSAL, sameOrigin, sameOriginJson } from '../lib/community/origin'
import { impostorWord, labelWithSource } from '../lib/community/rules'
import { cleanText } from '../lib/chart-posts'
import { additiveRefusal } from './run-ddl'
import { checkName, checkSlug, checkSymbols, decodeCursor, encodeCursor, higherRole, memberLabel, parseVote, voteDelta } from '../lib/community/rules'
import { clampProofSize, decideProof, explorerTxFor, fillLabel, locateTx, proofSide, readOnChain, REFUSE_CHAIN_UNREAD, REFUSE_NOTHING_MOVED } from '../lib/community/proof'
import { proofFactLine, proofTagLine } from '../lib/community/proof-words'
import { shouldAnnounce, storedProof } from '../lib/community/store'

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
      memberLabel({ wallet: null, displayName: tgId, source: 'telegram' }) === 'Telegram member' &&
      memberLabel({ wallet: null, displayName: null, source: 'discord' }) === 'Discord member' &&
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
    'community core: roles merge to the higher; proof side reads the tag (an HL perp build is long/short)',
    higherRole('member', 'owner') === 'owner' && higherRole('mod', 'member') === 'mod' &&
      proofSide(['buy:ETH'], 'native-swap-uniswap') === 'buy' && proofSide(['sell:HYPE'], 'native-hl-exec') === 'short' && proofSide([], null) === null,
  )
  secfixProofPins(check)
  {
    const refused = ['pantessa-official', 'pantessahq', 'askpantessa', 'metamask-support', 'mods', 'pantessa-support', 'official-pantessa', 'yeetful-team', 'admin-team', 'support-desk', 'eth-supportdesk', 'verified-calls', 'coinbase-help', 'uni-swap-help', 'team', 'eth-mods', 'helpdesk-24', 'security-alerts', 'discord-calls', 'telegram-vip']
    const passed = ['uni-desk', 'modern-art', 'teamwork-fx', 'eth-swing', 'badminton-fx', 'model-traders', 'steady-stack', 'moderate-risk']
    const bad = refused.filter((x) => checkSlug(x).ok)
    const good = passed.filter((x) => !checkSlug(x).ok)
    check('S5 slugs: a slug CONTAINING a brand word, or an authority word as a whole segment / glued to one end, is refused by name; ordinary words that contain "mod" / "team" / "admin" in the middle pass', bad.length === 0 && good.length === 0 && /reads as an official or brand account/.test((checkSlug('pantessahq') as { reason: string }).reason ?? ''), `let through: ${bad.join(',')} | refused: ${good.join(',')}`)
    const names = ['Pantessa Official', 'Pantessa Support \u2705', 'P\u0430ntessa', 'PANTESSA', 'Pan Tessa', '\u200b\u200b', 'ETH desk \u2714', 'ETH calls \u{1F6E1}', 'Yeetful team', 'MetaMask Help', 'x\u200b']
    const okNames = ['ETH Swing Traders', 'Modern charts', 'Teamwork FX', 'Uni desk']
    const badN = names.filter((x) => checkName(x).ok)
    const goodN = okNames.filter((x) => !checkName(x).ok)
    check('S5 names: NFKC-folded, bidi / zero-width / C1 stripped (a right-to-left override name is stored as its plain letters); brand words (also in Cyrillic lookalikes, also spelled apart), authority words, check marks and badges refused; 2 visible characters required; ordinary names pass', badN.length === 0 && goodN.length === 0 && (checkName('\u202eassetnap ab') as { value?: string }).value === 'assetnap ab', `let through: ${badN.map((x) => JSON.stringify(x)).join(',')} | refused: ${goodN.join(',')}`)
    check('S5 cleanText: titles, bodies, comments and about text lose bidi overrides, isolates, zero-width characters and C1 controls (newlines kept)', cleanText('a\u202eb\u200bc\u2066d\u0085e\ufeff\nf', 50) === 'abcde\nf' && impostorWord('ok desk') === null)
    check(
      'S6 labels: a wallet-less member cannot pose as a claimed @handle, a wallet short form or an official account (generic word instead); leading @ and spaces never survive; alone ("invited by") a provider name carries its source',
      memberLabel({ wallet: null, displayName: '@pantessa', source: 'telegram' }) === 'Telegram member' &&
        memberLabel({ wallet: null, displayName: '@nate', source: 'telegram' }) === 'Telegram member' &&
        memberLabel({ wallet: null, displayName: ' \u200b@nate', source: 'discord' }) === 'Discord member' &&
        memberLabel({ wallet: null, displayName: '0x71C7…976F', source: 'telegram' }) === 'Telegram member' &&
        memberLabel({ wallet: null, displayName: 'Pantessa Support', source: 'discord' }) === 'Discord member' &&
        memberLabel({ wallet: null, displayName: 'Ana K', source: 'telegram' }) === 'Ana K' &&
        labelWithSource('Ana K', { wallet: null, source: 'telegram' }) === 'Ana K (Telegram)' && labelWithSource('Telegram member', { wallet: null, source: 'telegram' }) === 'Telegram member' &&
        labelWithSource('@nate', { wallet: '0x' + 'ab'.repeat(20), source: 'site' }) === '@nate',
    )
  }
  check(
    "S10 announce rule: a room announces only its owner's and mods' posts by default; 'members' widens it to every seat; no seat never announces",
    !shouldAnnounce('mods', 'member') && shouldAnnounce('mods', 'owner') && shouldAnnounce('mods', 'mod') && shouldAnnounce('members', 'member') && !shouldAnnounce('members', null) && !shouldAnnounce(null, 'member'),
  )
  {
    const route = readFileSync(join(process.cwd(), 'app/api/posts/route.ts'), 'utf8')
    check('S10 announce wiring: the post route gates fanoutPost behind shouldAnnounce(roomAnnounceFrom, the author\'s role) before after()', /&& shouldAnnounce\(await roomAnnounceFrom\(room\.slug\)\.catch\(\(\) => null\), authorRole\)\) \{\s*const r = room\s*after\(\(\) => fanoutPost/.test(route))
  }
  {
    const fan = readFileSync(join(process.cwd(), 'lib/community/fanout.ts'), 'utf8')
    check('S8 fan-out: deliveries go three at a time (FANOUT_CONCURRENCY = 3, sliced batches), never all of a room\'s chats at once', /export const FANOUT_CONCURRENCY = 3/.test(fan) && /channels\.slice\(i, i \+ FANOUT_CONCURRENCY\)/.test(fan) && !/channels\.map\(\(c\) => \(c\.platform/.test(fan))
  }
  {
    const bypass = [
      'ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS x text, DROP COLUMN title',
      'ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS x text, RENAME TO b',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS x text, ALTER COLUMN email DROP NOT NULL, DROP CONSTRAINT users_pkey',
      'CREATE TABLE IF NOT EXISTS copy AS SELECT * FROM api_keys',
      "ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS x text DEFAULT (query_to_xml('delete from api_keys', true, true, ''))",
      'ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS x text, ADD COLUMN y text',
      'TRUNCATE chart_posts',
    ]
    const fine = [
      "ALTER TABLE communities ADD COLUMN IF NOT EXISTS announce_from text NOT NULL DEFAULT 'mods'",
      'ALTER TABLE chart_posts ADD COLUMN IF NOT EXISTS a text, ADD COLUMN IF NOT EXISTS b integer NOT NULL DEFAULT 0',
      'CREATE INDEX IF NOT EXISTS community_members_slug ON community_members (community_slug)',
    ]
    const through = bypass.filter((x) => additiveRefusal(x) === null)
    const refusedFine = fine.filter((x) => additiveRefusal(x) !== null)
    check('S11 run-ddl: every ALTER clause must be ADD COLUMN IF NOT EXISTS; DROP / RENAME / ALTER COLUMN / AS SELECT / TRUNCATE and a DEFAULT that calls something are refused; plain additive DDL passes', through.length === 0 && refusedFine.length === 0, `through: ${through.join(' | ')} refused: ${refusedFine.join(' | ')}`)
  }
  const h = (o: Record<string, string>) => new Headers(o)
  check(
    'S7 origin rule: no Origin / same host passes; another host, a cross-site Sec-Fetch-Site, a malformed Origin refuse; a body write also needs application/json; one refusal text',
    sameOrigin(h({})) && sameOrigin(h({ origin: 'https://www.pantessa.com', host: 'www.pantessa.com' })) && sameOrigin(h({ 'sec-fetch-site': 'same-origin' })) &&
      !sameOrigin(h({ origin: 'https://evil.example', host: 'www.pantessa.com' })) && !sameOrigin(h({ 'sec-fetch-site': 'cross-site' })) && !sameOrigin(h({ 'sec-fetch-site': 'same-site' })) && !sameOrigin(h({ origin: 'null', host: 'www.pantessa.com' })) &&
      sameOriginJson(h({ 'content-type': 'application/json; charset=utf-8' })) && !sameOriginJson(h({ 'content-type': 'text/plain' })) && !sameOriginJson(h({})) &&
      CROSS_SITE_REFUSAL.error === 'This request did not come from Pantessa.',
  )
}

/** QA-SECURITY S1 + S2 (lane SECFIX): what a trade proof may show. Pure. */
export function secfixProofPins(check: Check): void {
  const H = `0x${'ab'.repeat(32)}`
  const row = (o: Partial<{ chain: string | null; txUrl: string | null; valueUsd: number | null }> = {}) => ({
    id: 'turnfixture01', symbols: ['buy:ETH'], valueUsd: 25, chain: 'base', txUrl: `https://basescan.org/tx/${H}`, buildPath: 'native-swap-uniswap', createdAt: new Date(1_762_000_000_000), ...o,
  })
  check(
    'S1 size clamp: the shown size is min(recorded, on-chain × 1.05); a recorded 999,999,999 on a $10 transaction shows $10.50; hidden = null; no recorded value = the chain figure',
    clampProofSize(999_999_999, 10, true) === 10.5 && clampProofSize(25, 24.9, true) === 25 && clampProofSize(25, 100, true) === 25 && clampProofSize(25, 10, false) === null && clampProofSize(null, 12.345, true) === 12.35 && clampProofSize(0, 7, true) === 7,
  )
  const nothing = decideProof(row(), { usd: null }, true)
  const zero = decideProof(row(), { usd: 0 }, true)
  const unread = decideProof(row(), 'error', true)
  const gone = decideProof(row(), 'gone', true)
  check(
    'S1 refusal: a null or zero on-chain read (the approve-only trick) is refused by name; no RPC answer refuses (fail closed, 503); a hash the chain does not know is refused',
    !nothing.ok && nothing.reason === REFUSE_NOTHING_MOVED && !zero.ok && zero.reason === REFUSE_NOTHING_MOVED && !unread.ok && unread.status === 503 && unread.reason === REFUSE_CHAIN_UNREAD && !gone.ok && /not on Base/.test(gone.reason),
  )
  const ok = decideProof(row({ valueUsd: 999_999_999, chain: '8453' }), { usd: 20 }, true)
  check(
    'S1 chain from the id: the chain NAME comes from the registry for the chain id (a stored "8453" reads Base), the hash from the link; the size is clamped to the chain',
    ok.ok && ok.proof.chainId === 8453 && ok.proof.chain === 'Base' && ok.proof.txHash === H && ok.proof.sizeUsd === 21 && ok.proof.verification === 'verified',
    ok.ok ? JSON.stringify(ok.proof) : ok.reason,
  )
  const evil = decideProof(row({ txUrl: `https://evil.example/claim?tx=${H}` }), { usd: 20 }, true)
  const noChain = decideProof(row({ chain: 'narnia', txUrl: `https://evil.example/claim?tx=${H}` }), { usd: 20 }, true)
  const noHash = decideProof(row({ txUrl: 'https://basescan.org/tx/0x1' }), { usd: 20 }, true)
  check(
    'S2 link rebuilt: a stored https://evil.example/claim?tx=0x… link is NEVER emitted — the proof carries the registry explorer rebuilt from chain + hash; no registry chain or no hash = no proof',
    evil.ok && evil.proof.txUrl === `https://basescan.org/tx/${H}` && !JSON.stringify(evil.proof).includes('evil.example') && !noChain.ok && !noHash.ok && locateTx({ chain: null, txUrl: `https://evil.example/x?tx=${H}` }) === null,
  )
  const good = ok.ok ? ok.proof : null
  check(
    'S2 storedProof: only a proof whose txUrl is exactly the rebuild of its own chainId + txHash reads back; a swapped host, an unknown chain and the pre-SECFIX shape read as none',
    !!good && storedProof(good)?.txUrl === explorerTxFor(8453, H) &&
      storedProof({ ...good, txUrl: `https://evil.example/claim?tx=${H}` }) === null &&
      storedProof({ ...good, chainId: 999_999 }) === null &&
      storedProof({ turnId: 't', symbols: ['buy:ETH'], side: 'buy', sizeUsd: 25, chain: 'Base', txUrl: `https://basescan.org/tx/${H}`, signedAt: 1, verification: 'verified' }) === null,
  )
  check(
    'S1 wording: "verified" sits only beside what the chain confirmed (this wallet moved $X on <chain>); the market + side are the author\'s tag; the default title says both apart',
    proofFactLine({ sizeUsd: 25, chain: 'Base' }) === 'Verified on-chain: this wallet moved $25.00 on Base' &&
      proofFactLine({ sizeUsd: null, chain: 'Base' }) === 'Verified on-chain: this wallet moved funds on Base' &&
      proofTagLine({ symbols: ['buy:ETH'], side: 'buy' }) === 'Tagged by the author: bought ETH' && proofTagLine({ symbols: [], side: null }) === null &&
      fillLabel({ symbols: ['buy:ETH'], side: 'buy', sizeUsd: 25, chain: 'Base' }) === 'Tagged by the author: bought ETH. Verified on-chain: this wallet moved $25.00 on Base.' &&
      !/verified/i.test(proofTagLine({ symbols: ['sell:AAPL'], side: 'sell' }) ?? ''),
  )
}

/** S1: the chain read's hard timeout + error classes (async; pure over an injected reader). */
export async function secfixProofReadPins(check: Check): Promise<void> {
  const slow = await readOnChain(() => new Promise((r) => setTimeout(() => r({ usd: 5 }), 500)), 8453, '0x', '0x', 50)
  const boom = await readOnChain(async () => { throw Object.assign(new Error('rpc down'), { name: 'HttpRequestError' }) }, 8453, '0x', '0x', 50)
  const gone = await readOnChain(async () => { throw Object.assign(new Error('no tx'), { name: 'TransactionNotFoundError' }) }, 8453, '0x', '0x', 50)
  const fine = await readOnChain(async () => ({ usd: 9 }), 8453, '0x', '0x', 50)
  check('S1 chain read: a read slower than the timeout is an error (fail closed); an RPC error is an error; an unknown tx is gone; an answer passes through', slow === 'error' && boom === 'error' && gone === 'gone' && typeof fine === 'object' && fine.usd === 9)
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
  await secfixProofReadPins(check)
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
  const s3Ids: string[] = []
  const s4Ids: string[] = []
  const J = (cookie?: string | null, extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', ...INTERNAL, ...(cookie ? { cookie } : {}), ...extra })

  type Json = Record<string, unknown> & { error?: string }
  const call = async (method: string, path: string, opts: { cookie?: string | null; body?: unknown; organic?: boolean; headers?: Record<string, string>; raw?: string } = {}) => {
    const headers: Record<string, string> = { ...(opts.organic ? { 'content-type': 'application/json', ...ORGANIC, ...(opts.cookie ? { cookie: opts.cookie } : {}) } : J(opts.cookie)), ...(opts.headers ?? {}) }
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)), cache: 'no-store' })
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

    // ── trade proof (QA-SECURITY S1 + S2) ──
    // The fixture hashes are not real transactions: every trade post through
    // the API must be REFUSED (the chain is read at post time and does not
    // know them). The positive path runs resolveTradeProof in-process with
    // the chain reader injected (a real mined tx is not available here).
    const hash = `0x${'c0'.repeat(32)}`
    const tx = `https://basescan.org/tx/${hash}`
    const mk = async (wallet: string, verification: string | null, o: { txUrl?: string; valueUsd?: number } = {}) => {
      const row = await prisma.embedTurn.create({
        data: { embedKeyId: 'first-party', origin: 'http://localhost', sessionId: `harness-core-${slug}`, outcome: 'signed', walletAddress: wallet, verification, txUrl: o.txUrl ?? tx, valueUsd: o.valueUsd ?? 25, chain: 'base', symbols: ['buy:ETH'], buildPath: 'native-swap-uniswap', isInternal: true },
        select: { id: true },
      })
      fixtureIds.push(row.id)
      return row.id
    }
    const mine = await mk(a, 'verified')
    const theirs = await mk(b, 'verified')
    const unverified = await mk(a, 'unverified')
    const evilRow = await mk(a, 'verified', { txUrl: `https://evil.example/claim?tx=${hash}`, valueUsd: 999_999_999 })
    const fills = await call('GET', '/api/me/fills?symbol=ETH&limit=50', { cookie: sa })
    const fillList = (fills.json.fills ?? []) as { turnId: string; label: string; txUrl: string; chain: string; chainId: number }[]
    const myFill = fillList.find((x) => x.turnId === mine)
    const evilFill = fillList.find((x) => x.turnId === evilRow)
    check(
      'S2 (served): /api/me/fills rebuilds every tx link from the registry — the evil.example row is offered only with basescan.org; the label is the author\'s tag + the chain, no size claimed; other wallets\' and unverified rows absent',
      !!myFill && myFill.label === 'Tagged by you: bought ETH · a transaction on Base' && myFill.txUrl === tx && myFill.chainId === 8453 &&
        !!evilFill && evilFill.txUrl === tx && !JSON.stringify(fills.json).includes('evil.example') &&
        !fillList.some((x) => x.turnId === unverified || x.turnId === theirs),
      `${fills.status} ${JSON.stringify(myFill ?? null).slice(0, 160)}`,
    )
    const tradeFake = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: mine } })
    const tradeEvil = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: evilRow, title: 'Bought $999,999,999 of ETH' } })
    const tradeTheirs = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: theirs } })
    const tradeUnver = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: unverified } })
    const refusedByChain = (r: { status: number; json: Json }) => (r.status === 400 && /not on Base|moved nothing/.test(r.json.error ?? '')) || (r.status === 503 && /Could not read that transaction/.test(r.json.error ?? ''))
    check(
      'S1 (served): a verified receipt row whose hash is not a real transaction is REFUSED as a trade post (the chain is read at post time); the evil.example row likewise; another wallet\'s and an unverified row are refused as not yours',
      refusedByChain(tradeFake) && refusedByChain(tradeEvil) && tradeTheirs.status === 400 && /not one of your verified trades/.test(tradeTheirs.json.error ?? '') && tradeUnver.status === 400,
      `${tradeFake.status} ${tradeFake.json.error ?? ''} | ${tradeEvil.status} ${tradeEvil.json.error ?? ''} | ${tradeTheirs.status}/${tradeUnver.status}`,
    )
    const organicTrade = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'trade', proofTurnId: mine }, organic: true })
    check('community core (served): an internal receipt row is no proof outside an internal run', organicTrade.status === 400 && /not one of your verified trades/.test(organicTrade.json.error ?? ''), String(organicTrade.status))
    {
      const { resolveTradeProof } = await import('../lib/community/proof')
      const seen: string[] = []
      const reader = async (chainId: number, h: string, w: string) => {
        seen.push(`${chainId}:${h}:${w}`)
        return { usd: 20 }
      }
      const pos = await resolveTradeProof(a, evilRow, { showSize: true, includeInternal: true, readNotional: reader })
      const hidden = await resolveTradeProof(a, mine, { showSize: false, includeInternal: true, readNotional: reader })
      const zero = await resolveTradeProof(a, mine, { showSize: true, includeInternal: true, readNotional: async () => ({ usd: null }) })
      const hang = await resolveTradeProof(a, mine, { showSize: true, includeInternal: true, readNotional: () => new Promise(() => {}), timeoutMs: 80 })
      const other = await resolveTradeProof(a, theirs, { showSize: true, includeInternal: true, readNotional: reader })
      check(
        'S1 (DB, injected chain reader): the positive path reads the chain for (8453, the row\'s hash, the author); a recorded $999,999,999 shows $21 (on-chain $20 × 1.05); the evil link becomes basescan; hidden size = null; a null read and a hung read are refused; another wallet\'s row never reaches the reader',
        pos.ok && pos.proof.sizeUsd === 21 && pos.proof.txUrl === tx && pos.proof.chain === 'Base' && seen[0] === `8453:${hash}:${a}` &&
          hidden.ok && hidden.proof.sizeUsd === null && !zero.ok && /moved nothing/.test(zero.reason) && !hang.ok && hang.status === 503 && !other.ok && seen.length === 2,
        pos.ok ? JSON.stringify(pos.proof).slice(0, 200) : pos.reason,
      )
    }

    // ── identity ──
    const strangerId = await call('GET', '/api/me/identity')
    const meId = await call('GET', '/api/me/identity', { cookie: sa })
    check(
      'community core (served): /api/me/identity — a stranger is all null and []; a wallet session reads its key and its rooms',
      strangerId.json.wallet === null && strangerId.json.provider === null && strangerId.json.key === null && Array.isArray(strangerId.json.communities) && (strangerId.json.communities as unknown[]).length === 0 &&
        meId.json.wallet === a && meId.json.key === `w:${a}` && ((meId.json.communities ?? []) as { slug: string }[]).some((x) => x.slug === slug),
    )
    const token = await signIdentity({ p: 'tg', id: tgId, name: 'Core Pin', username: null })
    const tg = `pt_ident=${token}`
    const tgMe = await call('GET', '/api/me/identity', { cookie: tg })
    const tgJoin = await call('POST', `/api/communities/${slug}/join`, { cookie: tg, body: {} })
    const tgMembers = await call('GET', `/api/communities/${slug}/members?sort=new`)
    const tgVote = lpId(link) ? await call('POST', `/api/posts/${lpId(link)}/vote`, { cookie: tg, body: { value: 1 } }) : null
    check(
      'community core (served): a Telegram identity (pt_ident) acts with no wallet — key tg:…, provider without the id, joins (members 2), votes; the board labels it by its Telegram name and never shows the raw id',
      tgMe.json.key === `tg:${tgId}` && tgMe.json.wallet === null && (tgMe.json.provider as { p: string } | null)?.p === 'tg' && !JSON.stringify(tgMe.json.provider).includes(tgId) &&
        tgJoin.json.joined === true && (tgJoin.json.community as { members: number })?.members === 2 &&
        !JSON.stringify(tgMembers.json).includes(tgId) && ((tgMembers.json.members ?? []) as { label: string }[]).some((m) => m.label === 'Core Pin') && tgVote?.json.score === 3,
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
    // ── S7: cross-site writes and who manages ──
    {
      const EVIL = { origin: 'https://evil.example' }
      const postId = lpId(link)
      const xVote = postId ? await call('POST', `/api/posts/${postId}/vote`, { cookie: sb, body: { value: -1 }, headers: EVIL }) : null
      const plainVote = postId ? await call('POST', `/api/posts/${postId}/vote`, { cookie: sb, raw: '{"value":-1}', headers: { 'content-type': 'text/plain' } }) : null
      const xJoin = await call('POST', `/api/communities/${slug}/join`, { cookie: sb, body: {}, headers: { 'sec-fetch-site': 'cross-site' } })
      const xLeave = await call('DELETE', `/api/communities/${slug}/join`, { cookie: sa, headers: EVIL })
      const xPost = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'link', title: 'x-site', linkUrl: 'https://example.com/x' }, headers: EVIL })
      const xRoom = await call('POST', '/api/communities', { cookie: sa, raw: JSON.stringify({ slug: `${slug}-x`, name: 'Cross' }), headers: { 'content-type': 'text/plain' } })
      const xPatch = await call('PATCH', `/api/communities/${slug}`, { cookie: sa, body: { about: 'x' }, headers: EVIL })
      const xLink = await call('POST', '/api/me/identity/link', { cookie: `${sa}; ${tg}`, headers: EVIL })
      const xComment = postId ? await call('POST', `/api/posts/${postId}/comments`, { cookie: sa, body: { body: 'x-site' }, headers: EVIL }) : null
      const sameSite = postId ? await call('POST', `/api/posts/${postId}/vote`, { cookie: sb, body: { value: 1 }, headers: { origin: base, 'sec-fetch-site': 'same-origin' } }) : null
      const refused = (r: { status: number; json: Json } | null) => !!r && r.status === 403 && r.json.error === 'This request did not come from Pantessa.'
      check(
        'S7 (served): every community write refuses a cross-site request (Origin of another host, Sec-Fetch-Site cross-site, or a non-JSON body) with 403 by name — vote, join, leave, post, open a room, PATCH, link, comment; our own page (same Origin) passes',
        refused(xVote) && refused(plainVote) && refused(xJoin) && refused(xLeave) && refused(xPost) && refused(xRoom) && refused(xPatch) && refused(xLink) && refused(xComment) && sameSite?.status === 200,
        [xVote, plainVote, xJoin, xLeave, xPost, xRoom, xPatch, xLink, xComment, sameSite].map((r) => r?.status).join('/'),
      )
      // The Telegram identity is now LINKED to A (the owner). Its cookie alone must not manage the room.
      const tgDiscord = await call('POST', `/api/communities/${slug}/discord`, { cookie: tg, body: { mintCode: true } })
      const tgDiscordDel = await call('DELETE', `/api/communities/${slug}/discord`, { cookie: tg })
      const tgTelegram = await call('POST', `/api/communities/${slug}/telegram`, { cookie: tg, body: {} })
      const ownerDel = await call('DELETE', `/api/communities/${slug}/discord`, { cookie: sa })
      check(
        "S7 (served): a provider identity cookie linked to the owner's wallet never manages the room — Discord link / unlink answer 401 (wallet session needed); Telegram mint is 401 when configured (503 by name while unset); the owner's wallet session gets past the check (404 no channel)",
        tgDiscord.status === 401 && tgDiscordDel.status === 401 && (tgTelegram.status === 401 || (tgTelegram.status === 503 && !!tgTelegram.json.unconfigured)) && ownerDel.status === 404,
        `${tgDiscord.status}/${tgDiscordDel.status}/${tgTelegram.status}/${ownerDel.status}`,
      )
    }
    // ── S3: overlapping votes keep score === SUM(post_votes) ──
    {
      const vid = (await prisma.chartPost.findFirst({ where: { communitySlug: slug, kind: 'video' }, select: { id: true } }))?.id
      if (!vid) check('S3 (served): a post to vote on', false, 'no video post')
      else {
        const base0 = 9_100_000_000 + Math.floor(Math.random() * 99_999_999)
        const voters = await Promise.all(Array.from({ length: 20 }, (_, i) => signIdentity({ p: 'tg', id: String(base0 + i), name: `Voter ${i}`, username: null })))
        s3Ids.push(...voters.map((_, i) => String(base0 + i)))
        const fire = (value: number, n = voters.length) => Promise.all(voters.slice(0, n).map((tok) => call('POST', `/api/posts/${vid}/vote`, { cookie: `pt_ident=${tok}`, body: { value } })))
        const read = async () => {
          const [{ sum }] = await prisma.$queryRaw<{ sum: number | null }[]>`SELECT COALESCE(SUM(value), 0)::int AS sum FROM post_votes WHERE post_id = ${vid}`
          const row = await prisma.chartPost.findUnique({ where: { id: vid }, select: { score: true } })
          return { sum: Number(sum), score: row?.score ?? NaN }
        }
        const up = await fire(1)
        const r1 = await read()
        const down = await fire(-1, 12)
        const r2 = await read()
        check(
          'S3 (served): 20 concurrent votes leave chart_posts.score === SUM(post_votes.value); flipping 12 of them at once to -1 still agrees (the post row is locked first in the vote transaction)',
          up.every((r) => r.status === 200) && down.every((r) => r.status === 200) && r1.score === r1.sum && r2.score === r2.sum && r2.sum === r1.sum - 24,
          `up ${r1.score}/${r1.sum} · flip ${r2.score}/${r2.sum}`,
        )
      }
    }
    // ── S10: the owner's brakes ──
    {
      const pub = await call('GET', `/api/communities/${slug}`)
      const ownerRead = await call('GET', `/api/communities/${slug}`, { cookie: sa })
      const badPatch = await call('PATCH', `/api/communities/${slug}`, { cookie: sa, body: { announceFrom: 'everyone' } })
      const bPatch = await call('PATCH', `/api/communities/${slug}`, { cookie: sb, body: { announceFrom: 'members' } })
      const widen = await call('PATCH', `/api/communities/${slug}`, { cookie: sa, body: { announceFrom: 'members' } })
      const ownerRead2 = await call('GET', `/api/communities/${slug}`, { cookie: sa })
      const narrow = await call('PATCH', `/api/communities/${slug}`, { cookie: sa, body: { announceFrom: 'mods' } })
      await call('POST', `/api/communities/${slug}/join`, { cookie: sb, body: {} })
      const bRead = await call('GET', `/api/communities/${slug}`, { cookie: sb })
      check(
        "S10 (served): announceFrom defaults to 'mods'; only the owner reads it (in `me`) and changes it ('members' / 'mods'; anything else 400, a member 403); it is never on the public room",
        (ownerRead.json.me as { announceFrom?: string } | null)?.announceFrom === 'mods' && !('announceFrom' in ((pub.json.community ?? {}) as object)) && pub.json.me === null &&
          badPatch.status === 400 && bPatch.status === 403 && widen.status === 200 && widen.json.announceFrom === 'members' && (ownerRead2.json.me as { announceFrom?: string } | null)?.announceFrom === 'members' &&
          narrow.json.announceFrom === 'mods' && (bRead.json.me as { role: string; announceFrom?: string } | null)?.role === 'member' && !('announceFrom' in ((bRead.json.me ?? {}) as object)),
        `${badPatch.status}/${bPatch.status}/${widen.status}/${narrow.status}`,
      )
      const bPost = await call('POST', '/api/posts', { cookie: sb, body: { community: slug, kind: 'link', title: 'Spam from a member', linkUrl: 'https://example.com/b-spam' } })
      const aPost = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'link', title: 'Owner post', linkUrl: 'https://example.com/a-own' } })
      const bId = lpId(bPost)
      const aId = lpId(aPost)
      if (bId && aId) await call('POST', `/api/posts/${bId}/comments`, { cookie: sa, body: { body: 'a reply' } })
      const bDelA = aId ? await call('DELETE', `/api/posts/${aId}`, { cookie: sb }) : null
      const strangerDel = bId ? await call('DELETE', `/api/posts/${bId}`) : null
      const xDel = bId ? await call('DELETE', `/api/posts/${bId}`, { cookie: sa, headers: { origin: 'https://evil.example' } }) : null
      const ownerDelB = bId ? await call('DELETE', `/api/posts/${bId}`, { cookie: sa }) : null
      const aDelOwn = aId ? await call('DELETE', `/api/posts/${aId}`, { cookie: sa }) : null
      const gone = bId ? await call('GET', `/api/posts/${bId}`) : null
      const leftover = bId ? (await prisma.chartPostComment.count({ where: { postId: bId } })) + (await prisma.postVote.count({ where: { postId: bId } })) : -1
      check(
        "S10 (served): DELETE /api/posts/<id> — a member cannot remove another's post (403), a stranger 401, cross-site 403; the room owner removes a member's post with its comments + votes (0 left, then 404); the author removes their own",
        bDelA?.status === 403 && strangerDel?.status === 401 && xDel?.status === 403 && ownerDelB?.status === 200 && ownerDelB.json.deleted === true && aDelOwn?.status === 200 && gone?.status === 404 && leftover === 0,
        [bDelA, strangerDel, xDel, ownerDelB, aDelOwn, gone].map((r) => r?.status).join('/') + ` left=${leftover}`,
      )
      const pubMembers = await call('GET', `/api/communities/${slug}/members?sort=new`)
      const strangerManage = await call('GET', `/api/communities/${slug}/members?manage=1`)
      const bManage = await call('GET', `/api/communities/${slug}/members?manage=1`, { cookie: sb })
      const aManage = await call('GET', `/api/communities/${slug}/members?manage=1`, { cookie: sa })
      type M = { label: string; role: string; ref?: string }
      const rows = (aManage.json.members ?? []) as M[]
      const ownerRef = rows.find((m) => m.role === 'owner')?.ref
      const bRef = rows.find((m) => m.role === 'member' && m.label.startsWith(b.slice(0, 6)))?.ref
      const keyLeak = JSON.stringify(aManage.json).includes(`w:${b}`)
      const removeOwner = await call('POST', `/api/communities/${slug}/members/remove`, { cookie: sa, body: { ref: ownerRef } })
      const removeBogus = await call('POST', `/api/communities/${slug}/members/remove`, { cookie: sa, body: { ref: 'A'.repeat(22) } })
      const removeKey = await call('POST', `/api/communities/${slug}/members/remove`, { cookie: sa, body: { ref: `w:${b}` } })
      const bRemovesOwner = await call('POST', `/api/communities/${slug}/members/remove`, { cookie: sb, body: { ref: ownerRef } })
      const before = (await call('GET', `/api/communities/${slug}`)).json.community as { members: number }
      const removeB = await call('POST', `/api/communities/${slug}/members/remove`, { cookie: sa, body: { ref: bRef } })
      const after = (await call('GET', `/api/communities/${slug}`)).json.community as { members: number }
      const bSeat = await call('GET', `/api/communities/${slug}`, { cookie: sb })
      check(
        "S10 (served): members — the public read carries no ref; ?manage=1 is 401 for a stranger, 403 for a member, and gives the owner an opaque ref per row (never a key); remove refuses the owner's seat, a bogus ref, a raw key and a member's attempt; the owner removes a member (members −1, their seat gone)",
        !((pubMembers.json.members ?? []) as M[]).some((m) => 'ref' in m) && strangerManage.status === 401 && bManage.status === 403 && aManage.status === 200 && /no-store/.test(aManage.cc) &&
          rows.every((m) => /^[A-Za-z0-9_-]{22}$/.test(m.ref ?? '')) && !keyLeak &&
          removeOwner.status === 403 && removeBogus.status === 404 && removeKey.status === 400 && bRemovesOwner.status === 403 &&
          removeB.status === 200 && removeB.json.removed === true && after.members === before.members - 1 && bSeat.json.me === null,
        `${strangerManage.status}/${bManage.status}/${aManage.status} rm ${removeOwner.status}/${removeBogus.status}/${removeKey.status}/${bRemovesOwner.status}/${removeB.status} ${before?.members}->${after?.members}`,
      )
    }
    // ── bugs (b) + (c): /c/<id> for every kind; an internal post counts its own replies ──
    {
      const { createPost } = await import('../lib/chart-posts')
      const { explorerTxFor } = await import('../lib/community/proof-words')
      const H = `0x${'d1'.repeat(32)}`
      const idea = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'idea', symbol: 'ETH', title: 'ETH holds the range low' } })
      const link2 = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'link', title: 'A read for /c', linkUrl: 'https://example.com/c-read' } })
      const video2 = await call('POST', '/api/posts', { cookie: sa, body: { community: slug, kind: 'video', title: 'A walk for /c', mediaUrl: 'https://youtu.be/dQw4w9WgXcQ' } })
      const proof = { turnId: 'turnpinfix01', chainId: 8453, txHash: H, symbols: ['buy:ETH'], side: 'buy' as const, sizeUsd: 25, chain: 'Base', txUrl: explorerTxFor(8453, H)!, signedAt: Date.now(), verification: 'verified' as const }
      const trade = await createPost(a, { symbol: 'ETH', kind: 'trade', title: 'Bought $5,000,000 of BTC at the low', body: '', chartState: null, linkUrl: null, forkOf: null, community: slug, mediaUrl: null, proofTurnId: 'turnpinfix01', showSize: true } as never, true, { proof })
      const ids = { idea: lpId(idea), link: lpId(link2), video: lpId(video2), trade: trade.id }
      const pages: Record<string, { status: number; html: string }> = {}
      for (const [k, id] of Object.entries(ids)) {
        const r = await fetch(`${base}/c/${id}`, { headers: INTERNAL, cache: 'no-store' })
        pages[k] = { status: r.status, html: await r.text() }
      }
      const th = pages.trade.html
      check(
        'bug (b) (served): /c/<id> answers 200 for one post of each kind (idea, link, video, trade) — the announcements\' Open link never 404s; the trade page prints the chain-confirmed line, the author\'s tag apart, the rebuilt basescan link',
        Object.values(pages).every((p) => p.status === 200) && th.includes('Verified on-chain: this wallet moved $25.00 on Base') && th.includes('Tagged by the author: bought ETH') && th.includes(`https://basescan.org/tx/${H}`),
        Object.entries(pages).map(([k, p]) => `${k}=${p.status}`).join(' '),
      )
      if (ids.link) await call('POST', `/api/posts/${ids.link}/comments`, { cookie: sa, body: { body: 'an internal reply' } })
      const feedNew = await call('GET', `/api/feed?community=${slug}&sort=new&limit=50`, { cookie: sa })
      const inFeed = ((feedNew.json.posts ?? []) as { id: string; comments: number }[]).find((p) => p.id === ids.link)
      const pubPost = await prisma.chartPost.create({ data: { id: `pinpub${Date.now().toString(36).slice(-6)}`, symbol: 'ETH', author: a, kind: 'link', title: 'public pin post', body: '', linkUrl: 'https://example.com/p', isInternal: false } })
      await prisma.chartPostComment.create({ data: { id: `pc${Date.now().toString(36)}`, postId: pubPost.id, author: a, body: 'harness reply', isInternal: true } })
      const { getFeedPost } = await import('../lib/community/store')
      const pubRead = await getFeedPost(pubPost.id)
      await prisma.chartPostComment.deleteMany({ where: { postId: pubPost.id } })
      await prisma.chartPost.deleteMany({ where: { id: pubPost.id } })
      check(
        "bug (c): an internal post's comment count includes its own internal replies (feed says 1, as its page shows); a public post never counts an internal reply (0)",
        inFeed?.comments === 1 && pubRead?.comments === 0,
        `internal=${inFeed?.comments} public=${pubRead?.comments}`,
      )
    }

    // ── S4: a speed bump per machine (a fake client IP: next start trusts x-real-ip locally; loopback is exempt) ──
    {
      const ip = () => ({ 'x-real-ip': `2001:db8::${Math.floor(Math.random() * 0xffffff).toString(16)}:${Date.now().toString(16).slice(-6)}` })
      const idBase = 9_300_000_000 + Math.floor(Math.random() * 99_999_999)
      const toks = await Promise.all(Array.from({ length: 33 }, (_, i) => signIdentity({ p: 'tg', id: String(idBase + i), name: `Joiner ${i}`, username: null })))
      s4Ids.push(...toks.map((_, i) => String(idBase + i)))
      const code = ((await call('GET', `/api/communities/${slug}`, { cookie: sa })).json.me as { invite: { code: string; uses: number } }).invite
      const ipCredit = ip()
      const c1 = await call('POST', `/api/communities/${slug}/join`, { cookie: `pt_ident=${toks[31]}`, body: { via: code.code }, headers: ipCredit })
      const c2 = await call('POST', `/api/communities/${slug}/join`, { cookie: `pt_ident=${toks[32]}`, body: { via: code.code }, headers: ipCredit })
      const usesAfter = ((await call('GET', `/api/communities/${slug}`, { cookie: sa })).json.me as { invite: { uses: number } }).invite.uses
      check(
        'S4 (served): an invite is credited at most once per IP per room per day — two joins through the same link from one network both get a seat, the inviter is credited once',
        c1.json.joined === true && c2.json.joined === true && usesAfter === code.uses + 1,
        `uses ${code.uses} -> ${usesAfter}`,
      )
      const ipJoin = ip()
      const joins = []
      for (const t of toks.slice(0, 31)) joins.push(await call('POST', `/api/communities/${slug}/join`, { cookie: `pt_ident=${t}`, body: {}, headers: ipJoin }))
      const okJoins = joins.filter((r) => r.status === 200).length
      check(
        'S4 (served): 30 joins an hour per IP — the 31st from one network is 429 by name (cj:i fence)',
        okJoins === 30 && joins[30].status === 429 && /Too many joins from this network/.test(joins[30].json.error ?? ''),
        `ok=${okJoins} last=${joins[30]?.status}`,
      )
      const ws = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())]
      const sess = await Promise.all(ws.map((w) => signIn(base, w)))
      const ipRoom = ip()
      const plan = [0, 0, 0, 1, 1, 2]
      const made = []
      for (let i = 0; i < plan.length; i++) made.push(await call('POST', '/api/communities', { cookie: sess[plan[i]], body: { slug: `${slug}-r${i}`, name: `Pin room ${i}` }, headers: ipRoom }))
      const wallet4 = await call('POST', '/api/communities', { cookie: sess[0], body: { slug: `${slug}-rw`, name: 'Pin room w' }, headers: ip() })
      check(
        'S4 (served): 5 rooms a day per IP — six fresh wallets-worth of rooms from one network: five 201, the sixth 429 by name; the per-wallet cap (3) still holds from another network',
        made.slice(0, 5).every((r) => r.status === 201) && made[5].status === 429 && made[5].json.rateGate === 'ip' && wallet4.status === 429 && wallet4.json.rateGate === 'wallet',
        made.map((r) => r.status).join('/') + ` wallet=${wallet4.status}`,
      )
    }

    // ── S8: link fences, the channel cap, stale codes ──
    {
      const C = privateKeyToAccount(generatePrivateKey())
      const sc = await signIn(base, C)
      const ipL = { 'x-real-ip': `2001:db8:1::${Math.floor(Math.random() * 0xffffff).toString(16)}` }
      const tries = []
      for (let i = 0; i < 11; i++) tries.push(await call('POST', `/api/communities/${slug}/discord`, { cookie: sc, body: { mintCode: true }, headers: ipL }))
      check(
        'S8 (served): the Discord link route is fenced — 10 an hour per wallet / network, the 11th is 429 before anything reaches Discord',
        tries.slice(0, 10).every((r) => r.status !== 429) && tries[10].status === 429 && !!tries[10].json.rateGate,
        tries.map((r) => r.status).join('/'),
      )
      const store = await import('../lib/community/store')
      for (let i = 0; i < 5; i++) await prisma.communityChannel.create({ data: { communitySlug: slug, platform: 'discord', externalId: `90000000000000000${i}`, title: `pin ${i}`, linkedBy: `w:${a}` } })
      const sixth = await store.linkChannel(slug, `w:${a}` as `w:${string}`, 'discord', { externalId: '900000000000000009', title: 'six' })
      const again = await store.linkChannel(slug, `w:${a}` as `w:${string}`, 'discord', { externalId: '900000000000000003', title: 'relinked' })
      const code = await store.mintLinkCode(slug, `w:${a}` as `w:${string}`, 'telegram')
      const redeemed = code.ok ? await store.redeemLinkCode(code.code, 'telegram', { externalId: '-100999', title: 'six via code' }) : null
      await prisma.channelLinkCode.create({ data: { code: 'ab'.repeat(8), communitySlug: slug, platform: 'telegram', createdBy: `w:${a}`, createdAt: new Date(Date.now() - 3_600_000) } })
      await store.mintLinkCode(slug, `w:${a}` as `w:${string}`, 'telegram')
      const stale = await prisma.channelLinkCode.count({ where: { code: 'ab'.repeat(8) } })
      check(
        'S8 (DB): a room links at most 5 chats — the sixth is refused by name (link and code alike), re-linking one it has is fine; minting a code deletes expired ones',
        !sixth.ok && sixth.status === 409 && /at most 5/.test(sixth.reason) && again.ok && !!redeemed && !redeemed.ok && redeemed.status === 409 && stale === 0,
        `${sixth.ok ? 'ok' : sixth.status} ${again.ok} ${redeemed && !redeemed.ok ? redeemed.status : 'ok'} stale=${stale}`,
      )
    }
  } catch (e) {
    check('community core (served): ran to the end', false, e instanceof Error ? e.message : String(e))
  } finally {
    try {
      const posts = await prisma.chartPost.findMany({ where: { communitySlug: { startsWith: slug } }, select: { id: true } })
      const postIds = posts.map((p) => p.id)
      await prisma.postVote.deleteMany({ where: { postId: { in: postIds } } })
      await prisma.chartPost.deleteMany({ where: { id: { in: postIds } } })
      await prisma.communityMember.deleteMany({ where: { communitySlug: { startsWith: slug } } })
      await prisma.communityInvite.deleteMany({ where: { communitySlug: { startsWith: slug } } })
      await prisma.communityChannel.deleteMany({ where: { communitySlug: { startsWith: slug } } })
      await prisma.channelLinkCode.deleteMany({ where: { communitySlug: { startsWith: slug } } })
      await prisma.community.deleteMany({ where: { slug: { startsWith: slug } } })
      await prisma.identityLink.deleteMany({ where: { provider: 'tg', externalId: tgId } })
      if (s4Ids.length) await prisma.postVote.deleteMany({ where: { voterKey: { in: s4Ids.map((i) => `tg:${i}`) } } })
      if (s3Ids.length) await prisma.postVote.deleteMany({ where: { voterKey: { in: s3Ids.map((i) => `tg:${i}`) } } })
      if (fixtureIds.length) await prisma.embedTurn.deleteMany({ where: { id: { in: fixtureIds } } })
      const left = (await prisma.community.count({ where: { slug: { startsWith: slug } } })) + (await prisma.communityMember.count({ where: { communitySlug: slug } })) + (await prisma.chartPost.count({ where: { communitySlug: slug } }))
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
