// Pins for squad called-it, lane AUTH (2026-11-11). This lane owns this file:
// the pure half runs anywhere, the served half against a built server.
// Wired into test-api by the contract commit; the lane only adds checks here.
//   npx tsx scripts/called-auth-pins.ts                    (npm run pins:called-auth)
//   BASE=http://localhost:PORT npx tsx scripts/called-auth-pins.ts
//
// The served half expects a server started with XCALLS_FAKE=1 (the harness
// belt). Against a server WITHOUT it, set CALLED_AUTH_SERVER=real: the same
// requests then prove `as=` does nothing.
//
// The pins send their own Cookie headers (no shared jar): localhost cookies
// leak across ports, so nothing here trusts a browser's.
import { readFileSync } from 'node:fs'
import {
  NEXT_FALLBACK,
  X_AUTHORIZE_URL,
  X_AUTH_PROD_ORIGIN,
  X_IDENTITY_COOKIE,
  X_ME_URL,
  X_REVOKE_URL,
  X_TOKEN_URL,
  authorizeUrl,
  cleanAvatar,
  completeXAuth,
  identityFromMe,
  isAllowedAuthOrigin,
  pkceChallenge,
  pkcePair,
  safeNext,
  signFlow,
  signXIdentity,
  startXAuth,
  stateMatches,
  tokenRequest,
  verifyFlow,
  verifyXIdentityToken,
  withAuthNote,
  xAuthStartHref,
  type ClaimDeps,
  type XIdentity,
} from '../lib/called-it/x-auth'

type Check = (name: string, ok: boolean, extra?: string) => void
/** Read before the async half may set a pin-only secret: a cross-server check needs the server's real one. */
const HAD_SECRET = !!process.env.SESSION_SECRET

const read = (p: string): string => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}
/** Source without comments, so a header that names a thing is not counted as using it. */
const code = (p: string): string => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ── Pure, synchronous ───────────────────────────────────────────────────

export function calledAuthPins(check: Check): void {
  // PKCE: RFC 7636 appendix B.
  check('x auth: PKCE S256 matches RFC 7636 appendix B', pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  const a = pkcePair()
  const b = pkcePair()
  check('x auth: a fresh verifier is 43 unreserved characters and differs each time', /^[A-Za-z0-9_-]{43}$/.test(a.verifier) && a.verifier !== b.verifier && a.challenge === pkceChallenge(a.verifier))

  // State.
  check('x auth: state matches itself', stateMatches('abcDEF123_-', 'abcDEF123_-'))
  check('x auth: state mismatch is refused (same length, other length, empty, non-string)', !stateMatches('abcDEF123_-', 'abcDEF123_+') && !stateMatches('abc', 'abcd') && !stateMatches('', '') && !stateMatches(null, 'x') && !stateMatches('x', undefined))
  const lib = code('lib/called-it/x-auth.ts')
  check('x auth: the state check is constant time (timingSafeEqual over hashes)', /timingSafeEqual\(\s*ha\s*,\s*hb\s*\)/.test(lib))

  // The next rule.
  const nextCases: [unknown, string][] = [
    ['/x/pantessa_test/BTC', '/x/pantessa_test/BTC'],
    ['/t/BTC?x=cz&side=bear', '/t/BTC?x=cz&side=bear'],
    ['/', '/'],
    ['//evil.example', NEXT_FALLBACK],
    ['//evil.example/x', NEXT_FALLBACK],
    ['/\\evil', NEXT_FALLBACK],
    ['/\\/evil.example', NEXT_FALLBACK],
    ['https://evil.example', NEXT_FALLBACK],
    ['javascript:alert(1)', NEXT_FALLBACK],
    ['/%2f%2fevil.example', NEXT_FALLBACK],
    ['/%2F%2Fevil.example', NEXT_FALLBACK],
    ['/%5cevil.example', NEXT_FALLBACK],
    ['/ok/%2f%2fevil', NEXT_FALLBACK],
    ['/%E0%A4%A', NEXT_FALLBACK],
    ['/a\nb', NEXT_FALLBACK],
    ['evil.example', NEXT_FALLBACK],
    ['', NEXT_FALLBACK],
    [null, NEXT_FALLBACK],
    [42, NEXT_FALLBACK],
    ['/' + 'a'.repeat(299), '/' + 'a'.repeat(299)],
    ['/' + 'a'.repeat(300), NEXT_FALLBACK],
  ]
  const badNext = nextCases.filter(([inp, want]) => safeNext(inp) !== want).map(([inp]) => JSON.stringify(inp))
  check(`x auth: next rule (${nextCases.length} cases: //, backslash, scheme, %2f%2f, %5c, control, length)`, badNext.length === 0, badNext.join(', '))
  check('x auth: a returning note keeps the path, query and hash', withAuthNote('/t/BTC?x=cz#calls', 'denied') === '/t/BTC?x=cz&xauth=denied#calls' && withAuthNote('//evil', 'failed') === '/x?xauth=failed')
  check('x auth: the start href encodes next', xAuthStartHref('/t/BTC?x=a&side=bull') === '/api/x/auth/start?next=%2Ft%2FBTC%3Fx%3Da%26side%3Dbull')

  // Origins X has on file.
  const okOrigins = ['https://www.pantessa.com', 'http://localhost:4503', 'http://localhost', 'http://127.0.0.1:3000']
  const noOrigins = ['https://pantessa.com', 'http://www.pantessa.com', 'https://www.pantessa.com.evil.example', 'https://website-git-feat-x-nate.vercel.app', 'http://localhost.evil.example', 'https://localhost:4503', 'http://localhost:4503/path', 'null', '', 'https://evil.example']
  check('x auth: allowed origins = production + localhost only', okOrigins.every(isAllowedAuthOrigin) && !noOrigins.some(isAllowedAuthOrigin), [...okOrigins.filter((o) => !isAllowedAuthOrigin(o)), ...noOrigins.filter(isAllowedAuthOrigin)].join(', '))
  check('x auth: the production origin is www', X_AUTH_PROD_ORIGIN === 'https://www.pantessa.com')

  // The authorize URL.
  const au = new URL(authorizeUrl({ clientId: 'cid', redirectUri: 'https://www.pantessa.com/api/x/auth/callback', state: 'st', challenge: 'ch' }))
  check('x auth: the scope is space-separated as %20', authorizeUrl({ clientId: 'cid', redirectUri: 'R', state: 'st', challenge: 'ch' }).includes('scope=users.read%20tweet.read'))
  check(
    'x auth: authorize URL carries every PKCE parameter',
    `${au.origin}${au.pathname}` === X_AUTHORIZE_URL &&
      au.searchParams.get('response_type') === 'code' &&
      au.searchParams.get('client_id') === 'cid' &&
      au.searchParams.get('redirect_uri') === 'https://www.pantessa.com/api/x/auth/callback' &&
      au.searchParams.get('scope') === 'users.read tweet.read' &&
      au.searchParams.get('state') === 'st' &&
      au.searchParams.get('code_challenge') === 'ch' &&
      au.searchParams.get('code_challenge_method') === 'S256',
  )

  // The token request, both client types.
  const pub = tokenRequest({ code: 'C', redirectUri: 'R', verifier: 'V', clientId: 'cid' })
  const pubForm = new URLSearchParams(pub.body)
  check('x auth: public client sends client_id in the body, no Authorization', pubForm.get('client_id') === 'cid' && pubForm.get('grant_type') === 'authorization_code' && pubForm.get('code_verifier') === 'V' && !pub.headers.authorization)
  const conf = tokenRequest({ code: 'C', redirectUri: 'R', verifier: 'V', clientId: 'cid', clientSecret: 's3' })
  check('x auth: confidential client sends HTTP Basic', conf.headers.authorization === `Basic ${Buffer.from('cid:s3').toString('base64')}` && !new URLSearchParams(conf.body).has('client_id'))

  // users/me mapping.
  const me = identityFromMe({ data: { id: '1349149096909668363', username: 'Pin_Desk', name: 'Pin‮ Desk', profile_image_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg', public_metrics: { followers_count: 42 }, verified: true } }, 1000)
  check('x auth: users/me maps to a lowercase handle, a clean name, a big avatar', !!me && me.identity.handle === 'pin_desk' && me.identity.name === 'Pin Desk' && me.identity.avatarUrl === 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg' && me.followers === 42 && me.blue === true && me.identity.at === 1000)
  check('x auth: users/me with a foreign avatar host keeps no avatar', identityFromMe({ data: { id: '12345', username: 'a', name: 'A', profile_image_url: 'https://evil.example/a.jpg' } }, 1)?.identity.avatarUrl === null)
  check('x auth: users/me without an id or a handle is no identity', identityFromMe({ data: { username: 'a' } }, 1) === null && identityFromMe({ data: { id: '1', username: 'not a handle' } }, 1) === null && identityFromMe({ errors: [] }, 1) === null && identityFromMe(null, 1) === null)
  check('x auth: avatars only from X image hosts over https', cleanAvatar('https://abs.twimg.com/a.png') !== null && cleanAvatar('http://pbs.twimg.com/a.png') === null && cleanAvatar('https://pbs.twimg.com.evil.example/a.png') === null)

  // Source fences.
  const comp = code('components/called/VerifyWithX.tsx')
  check('x auth: the button never imports the server module at runtime', !comp.split('\n').some((l) => /^\s*import\s+(?!type\b)/.test(l) && /['"]@\/lib\/called-it\/x-auth['"]/.test(l)) && /import type \{ XIdentity \} from '@\/lib\/called-it\/x-auth'/.test(comp))
  check('x auth: the button is a handle proof, never the unified sign-in or a wallet', !/CreateAccountButton|openConnectModal|connectAndSignIn|useAccount|wagmi/.test(comp))
  check('x auth: the button\'s start address = xAuthStartHref', /\/api\/x\/auth\/start\?next=\$\{encodeURIComponent\(next\)\}/.test(comp) && xAuthStartHref('/q') === `/api/x/auth/start?next=${encodeURIComponent('/q')}`)
  check('x auth: the button keeps the contract props', /next\?: string/.test(comp) && /variant\?: 'button' \| 'line'/.test(comp) && /className\?: string/.test(comp))
  const routes = ['app/api/x/auth/start/route.ts', 'app/api/x/auth/callback/route.ts', 'app/api/x/auth/signout/route.ts', 'app/api/x/me/route.ts'].map((p) => [p, code(p)] as const)
  const extraExports = routes.flatMap(([p, src]) => [...src.matchAll(/export\s+(?:async\s+)?(?:const|function|let)\s+(\w+)/g)].map((m) => m[1]).filter((n) => !['GET', 'POST', 'runtime', 'dynamic'].includes(n)).map((n) => `${p}:${n}`))
  check('x auth: route files export only handlers and Next config', routes.every(([, s]) => s.length > 0) && extraExports.length === 0, extraExports.join(', '))
  check('x auth: no route or the lib writes X tokens to the database', !routes.some(([, s]) => /prisma|@\/lib\/db/.test(s)) && !/prisma|@\/lib\/db/.test(lib))
  check('x auth: the signout route checks the origin', /sameOrigin\(req\.headers\)/.test(routes[2][1]))
  check('x auth: the callback answers no-referrer (the code is in its URL)', /'referrer-policy': 'no-referrer'/.test(routes[1][1]))
  check('x auth: fake mode is off on production', /process\.env\[ENV\.fake\] === '1' && process\.env\.VERCEL_ENV !== 'production'/.test(lib))
}

// ── Pure, asynchronous (signing, the flow with its world mocked) ────────

interface Captured {
  fetches: { url: string; method: string; headers: Record<string, string>; body?: string }[]
  logs: string[]
  deps: unknown[]
}

function world(opts: { tokenStatus?: number; meStatus?: number; claimThrows?: boolean; token: string; meBody?: unknown }): { cap: Captured; deps: ClaimDeps; fetchImpl: Parameters<typeof completeXAuth>[0]['fetchImpl']; log: { warn: (...a: unknown[]) => void } } {
  const cap: Captured = { fetches: [], logs: [], deps: [] }
  const deps: ClaimDeps = {
    saveProfile: async (p) => {
      cap.deps.push(['saveProfile', p])
      if (opts.claimThrows) throw new Error('lib/called-it/store: not built yet (lane SOURCE)')
    },
    claimHandle: async (h, id, p) => {
      cap.deps.push(['claimHandle', h, id, p])
    },
  }
  const fetchImpl: Parameters<typeof completeXAuth>[0]['fetchImpl'] = async (url, init) => {
    cap.fetches.push({ url, method: init.method, headers: init.headers, body: init.body })
    const json = (v: unknown, status = 200) => ({ ok: status < 300, status, json: async () => v })
    if (url === X_TOKEN_URL) return json(opts.tokenStatus && opts.tokenStatus >= 300 ? { error: 'invalid_request', error_description: `bad ${opts.token}` } : { token_type: 'bearer', access_token: opts.token, scope: 'users.read tweet.read', expires_in: 7200 }, opts.tokenStatus ?? 200)
    if (url === X_ME_URL) return json(opts.meBody ?? { data: { id: '987654321', username: 'Pin_Desk', name: 'Pin Desk', profile_image_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg', public_metrics: { followers_count: 7 }, verified: false } }, opts.meStatus ?? 200)
    if (url === X_REVOKE_URL) return json({ revoked: true })
    return json({}, 404)
  }
  const log = { warn: (...a: unknown[]) => cap.logs.push(a.map(String).join(' ')) }
  return { cap, deps, fetchImpl, log }
}

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  try {
    return await fn()
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

const decodePayload = (jwt: string): string => {
  try {
    return Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')
  } catch {
    return ''
  }
}

export async function calledAuthPinsAsync(check: Check): Promise<void> {
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'called-auth-pins-only-secret-0123456789'
  const id: XIdentity = { xUserId: '987654321', handle: 'pin_desk', name: 'Pin Desk', avatarUrl: null, at: 1_700_000_000_000 }

  await withEnv({ XCALLS_FAKE: undefined, VERCEL_ENV: undefined }, async () => {
    const tok = await signXIdentity(id)
    check('x auth: a signed identity reads back', JSON.stringify(await verifyXIdentityToken(tok)) === JSON.stringify(id))
    const [h, p, s] = tok.split('.')
    const flipped = (x: string) => (x[0] === 'A' ? 'B' : 'A') + x.slice(1)
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(decodePayload(tok)), h: 'elonmusk' })).toString('base64url')
    check('x auth: a tampered cookie is no identity (payload, signature, handle swap, junk)', (await verifyXIdentityToken(`${h}.${flipped(p)}.${s}`)) === null && (await verifyXIdentityToken(`${h}.${p}.${flipped(s)}`)) === null && (await verifyXIdentityToken(`${h}.${forged}.${s}`)) === null && (await verifyXIdentityToken('junk')) === null && (await verifyXIdentityToken(undefined)) === null)
    const expired = await signXIdentity(id, { expiresAt: Math.floor(Date.now() / 1000) - 10 })
    check('x auth: an expired cookie is no identity', (await verifyXIdentityToken(expired)) === null)
    const fakeTok = await signXIdentity(id, { fake: true })
    check('x auth: a fake identity is refused while fake mode is off (no preview replay on prod)', (await verifyXIdentityToken(fakeTok)) === null)
    await withEnv({ XCALLS_FAKE: '1' }, async () => check('x auth: a fake identity reads in fake mode', (await verifyXIdentityToken(fakeTok))?.handle === 'pin_desk'))
    await withEnv({ XCALLS_FAKE: '1', VERCEL_ENV: 'production' }, async () => check('x auth: XCALLS_FAKE on production does nothing', (await verifyXIdentityToken(fakeTok)) === null))
    await withEnv({ SESSION_SECRET: 'another-secret-entirely-0123456789' }, async () => check('x auth: a cookie under another secret is no identity', (await verifyXIdentityToken(tok)) === null))
    const flow = await signFlow({ state: 'S', verifier: pkcePair().verifier, next: '/t/BTC', redirectUri: 'http://localhost:4503/api/x/auth/callback' })
    check('x auth: the flow cookie and the identity cookie never stand in for each other', (await verifyXIdentityToken(flow)) === null && (await verifyFlow(tok)) === null && (await verifyFlow(flow))?.next === '/t/BTC')
    const badNextFlow = await signFlow({ state: 'S', verifier: pkcePair().verifier, next: '//evil.example', redirectUri: 'R' })
    check('x auth: the flow cookie keeps only a safe next', (await verifyFlow(badNextFlow))?.next === '/x')
  })

  // The callback, end to end, its world mocked. The tokens must go to X and nowhere else.
  const TOKEN = 'XAT-pin-SECRET-access-token-6f1d'
  const CODE = 'XCODE-pin-SECRET-code-91aa'
  const origin = 'http://localhost:4503'
  const redirectUri = `${origin}/api/x/auth/callback`
  await withEnv({ XCALLS_FAKE: undefined, VERCEL_ENV: undefined, X_OAUTH_CLIENT_ID: 'pin-client', X_OAUTH_CLIENT_SECRET: undefined }, async () => {
    const verifier = pkcePair().verifier
    const flowToken = await signFlow({ state: 'state-pin-1', verifier, next: '/x/pin_desk/BTC', redirectUri })
    const params = (q: Record<string, string>) => new URLSearchParams(q)

    const w = world({ token: TOKEN })
    const consoleLines: string[] = []
    const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info }
    for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => consoleLines.push(a.map(String).join(' '))
    let r: Awaited<ReturnType<typeof completeXAuth>>
    try {
      r = await completeXAuth({ params: params({ code: CODE, state: 'state-pin-1' }), flowToken, origin, deps: w.deps, fetchImpl: w.fetchImpl, log: w.log, nowMs: 5 })
    } finally {
      Object.assign(console, orig)
    }
    check('x auth (callback, mocked): seats the identity and returns to next', r.kind === 'seated' && r.location === '/x/pin_desk/BTC' && r.identity.handle === 'pin_desk' && r.identity.xUserId === '987654321')
    const tokReq = w.cap.fetches.find((f) => f.url === X_TOKEN_URL)
    const form = new URLSearchParams(tokReq?.body ?? '')
    check('x auth (callback, mocked): the code is exchanged once with the verifier and this site\'s callback', w.cap.fetches.filter((f) => f.url === X_TOKEN_URL).length === 1 && form.get('code') === CODE && form.get('code_verifier') === verifier && form.get('redirect_uri') === redirectUri && form.get('client_id') === 'pin-client')
    const meReq = w.cap.fetches.find((f) => f.url === X_ME_URL)
    check('x auth (callback, mocked): users/me is read once with the token', w.cap.fetches.filter((f) => f.url === X_ME_URL).length === 1 && meReq?.headers.authorization === `Bearer ${TOKEN}`)
    check('x auth (callback, mocked): the token is revoked after use', w.cap.fetches.some((f) => f.url === X_REVOKE_URL && new URLSearchParams(f.body ?? '').get('token') === TOKEN))
    check('x auth (callback, mocked): every request goes to api.x.com', w.cap.fetches.every((f) => new URL(f.url).host === 'api.x.com'))
    check('x auth (callback, mocked): the claim is written with the X user id', JSON.stringify(w.cap.deps) === JSON.stringify([['saveProfile', { handle: 'pin_desk', name: 'Pin Desk', avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg', followers: 7, blue: false, xUserId: '987654321', isProtected: false }], ['claimHandle', 'pin_desk', '987654321', { handle: 'pin_desk', name: 'Pin Desk', avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg', followers: 7, blue: false, xUserId: '987654321' }]]))
    const outward = JSON.stringify([w.cap.deps, w.cap.logs, consoleLines, r, r.kind === 'seated' ? decodePayload(r.identityToken) : ''])
    check('x auth (callback, mocked): no token or code reaches the store, a log, the cookie or the answer', !outward.includes(TOKEN) && !outward.includes(CODE))

    const w2 = world({ token: TOKEN })
    const r2 = await completeXAuth({ params: params({ code: CODE, state: 'state-pin-2' }), flowToken, origin, deps: w2.deps, fetchImpl: w2.fetchImpl, log: w2.log })
    check('x auth (callback, mocked): a state mismatch is refused before X is called', r2.kind === 'away' && r2.location === '/x/pin_desk/BTC?xauth=failed' && w2.cap.fetches.length === 0 && w2.cap.deps.length === 0)

    const w3 = world({ token: TOKEN })
    const r3 = await completeXAuth({ params: params({ error: 'access_denied', state: 'state-pin-1' }), flowToken, origin, deps: w3.deps, fetchImpl: w3.fetchImpl, log: w3.log })
    check('x auth (callback, mocked): a refusal at X returns with "denied"', r3.kind === 'away' && r3.location === '/x/pin_desk/BTC?xauth=denied' && w3.cap.fetches.length === 0)

    const w4 = world({ token: TOKEN })
    const r4 = await completeXAuth({ params: params({ code: CODE, state: 'state-pin-1' }), flowToken: undefined, origin, deps: w4.deps, fetchImpl: w4.fetchImpl, log: w4.log })
    check('x auth (callback, mocked): no flow cookie → /x with a note, X never called', r4.kind === 'away' && r4.location === '/x?xauth=failed' && w4.cap.fetches.length === 0)

    const w5 = world({ token: TOKEN })
    const r5 = await completeXAuth({ params: params({ code: CODE, state: 'state-pin-1' }), flowToken, origin: 'http://127.0.0.1:4503', deps: w5.deps, fetchImpl: w5.fetchImpl, log: w5.log })
    check('x auth (callback, mocked): a callback on another origin than the flow\'s is refused', r5.kind === 'away' && w5.cap.fetches.length === 0)

    const w6 = world({ token: TOKEN, tokenStatus: 400 })
    const r6 = await completeXAuth({ params: params({ code: CODE, state: 'state-pin-1' }), flowToken, origin, deps: w6.deps, fetchImpl: w6.fetchImpl, log: w6.log })
    check('x auth (callback, mocked): a refused exchange logs the status only', r6.kind === 'away' && r6.location.endsWith('xauth=failed') && w6.cap.logs.join('|').includes('400') && !JSON.stringify(w6.cap.logs).includes(TOKEN) && !JSON.stringify(w6.cap.logs).includes(CODE) && !JSON.stringify(w6.cap.logs).includes('invalid_request'))

    const w7 = world({ token: TOKEN, claimThrows: true })
    const r7 = await completeXAuth({ params: params({ code: CODE, state: 'state-pin-1' }), flowToken, origin, deps: w7.deps, fetchImpl: w7.fetchImpl, log: w7.log })
    check('x auth (callback, mocked): a store failure on a REAL sign-in seats nothing (cookie and record never disagree), token still revoked', r7.kind === 'away' && r7.location.endsWith('xauth=failed') && w7.cap.fetches.some((f) => f.url === X_REVOKE_URL) && !JSON.stringify(w7.cap.logs).includes(TOKEN))

    const w8 = world({ token: TOKEN, meStatus: 403 })
    const r8 = await completeXAuth({ params: params({ code: CODE, state: 'state-pin-1' }), flowToken, origin, deps: w8.deps, fetchImpl: w8.fetchImpl, log: w8.log })
    check('x auth (callback, mocked): users/me refused → no identity, token revoked', r8.kind === 'away' && w8.cap.deps.length === 0 && w8.cap.fetches.some((f) => f.url === X_REVOKE_URL))

    await withEnv({ X_OAUTH_CLIENT_SECRET: 'pin-secret' }, async () => {
      const w9 = world({ token: TOKEN })
      const r9 = await completeXAuth({ params: params({ code: CODE, state: 'state-pin-1' }), flowToken, origin, deps: w9.deps, fetchImpl: w9.fetchImpl, log: w9.log })
      const t9 = w9.cap.fetches.find((f) => f.url === X_TOKEN_URL)
      check('x auth (callback, mocked): with X_OAUTH_CLIENT_SECRET the exchange uses HTTP Basic', r9.kind === 'seated' && t9?.headers.authorization === `Basic ${Buffer.from('pin-client:pin-secret').toString('base64')}` && !new URLSearchParams(t9?.body ?? '').has('client_id'))
    })

    // Start, outside fake mode: `as` does nothing.
    const ws = world({ token: TOKEN })
    const s1 = await startXAuth({ origin, next: '/x/pin_desk/BTC', as: 'pin_desk', deps: ws.deps })
    const s1u = s1.kind === 'x' ? new URL(s1.location) : null
    const s1flow = s1.kind === 'x' ? await verifyFlow(s1.flowToken) : null
    check('x auth (start): outside fake mode `as` is ignored and the browser goes to X', s1.kind === 'x' && ws.cap.deps.length === 0 && !!s1u && `${s1u.origin}${s1u.pathname}` === X_AUTHORIZE_URL && s1u.searchParams.get('redirect_uri') === redirectUri && s1u.searchParams.get('code_challenge') === (s1flow ? pkceChallenge(s1flow.verifier) : '') && s1u.searchParams.get('state') === s1flow?.state && s1flow?.next === '/x/pin_desk/BTC')
    const s2 = await startXAuth({ origin: 'https://website-git-x-nate.vercel.app', next: '/x', deps: ws.deps })
    check('x auth (start): a preview host is sent to production, never given a redirect URI of its own', s2.kind === 'away' && s2.location === `${X_AUTH_PROD_ORIGIN}/api/x/auth/start?next=%2Fx`)
    await withEnv({ X_OAUTH_CLIENT_ID: undefined }, async () => {
      const s3 = await startXAuth({ origin, next: '/t/BTC', deps: ws.deps })
      check('x auth (start): no client id → back with "unavailable"', s3.kind === 'away' && s3.location === '/t/BTC?xauth=unavailable')
    })
  })

  // Fake mode: a store failure never breaks the sign-in.
  await withEnv({ XCALLS_FAKE: '1', VERCEL_ENV: undefined }, async () => {
    const w = world({ token: TOKEN, claimThrows: true })
    const s = await startXAuth({ origin, next: '//evil.example', as: '@Pantessa_Pin', deps: w.deps, log: w.log })
    check('x auth (fake): `as` seats the handle, next stays safe, a store failure does not break it', s.kind === 'seated' && s.location === '/x' && s.identity.handle === 'pantessa_pin' && s.identity.xUserId === 'fake-pantessa_pin' && (await verifyXIdentityToken(s.identityToken))?.handle === 'pantessa_pin')
    const s2 = await startXAuth({ origin, next: '/x', as: 'not a handle!', deps: w.deps, log: w.log })
    check('x auth (fake): a garbage `as` seats nothing', s2.kind === 'away')
  })
  await withEnv({ XCALLS_FAKE: '1', VERCEL_ENV: 'production', X_OAUTH_CLIENT_ID: 'pin-client' }, async () => {
    const w = world({ token: TOKEN })
    const s = await startXAuth({ origin: X_AUTH_PROD_ORIGIN, next: '/x', as: 'elonmusk', deps: w.deps })
    check('x auth (fake): XCALLS_FAKE on production seats nothing', s.kind === 'x' && w.cap.deps.length === 0)
  })
}

// ── Served ──────────────────────────────────────────────────────────────

const setCookieOf = (res: Response, name: string): string | null => {
  const all = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
  return all.find((c) => c.startsWith(`${name}=`)) ?? null
}
const cookieValue = (setCookie: string | null): string => (setCookie ? setCookie.split(';')[0].split('=').slice(1).join('=') : '')

export async function calledAuthPinsServed(check: Check, BASE: string): Promise<void> {
  await calledAuthPinsAsync(check)
  const real = process.env.CALLED_AUTH_SERVER === 'real'
  const get = (path: string, cookie?: string) => fetch(`${BASE}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })

  const me0 = await get('/api/x/me')
  const me0b = (await me0.json().catch(() => null)) as { identity: unknown; available: unknown } | null
  check('x auth (served): /api/x/me with no cookie → no identity', me0.status === 200 && me0b?.identity === null && typeof me0b?.available === 'boolean')

  if (real) {
    // A server WITHOUT XCALLS_FAKE: `as=` must do nothing.
    const s = await get('/api/x/auth/start?next=%2Fx%2Fpantessa_pin%2FBTC&as=pantessa_pin')
    const loc = s.headers.get('location') ?? ''
    check('x auth (served, real): `as=` seats nothing without XCALLS_FAKE', !setCookieOf(s, X_IDENTITY_COOKIE) && (loc.startsWith(X_AUTHORIZE_URL) || loc.includes('xauth=unavailable') || loc.startsWith(X_AUTH_PROD_ORIGIN)), `${s.status} ${loc.slice(0, 80)}`)
    if (loc.startsWith(X_AUTHORIZE_URL)) {
      const flowSet = setCookieOf(s, 'pt_x_flow') ?? ''
      const u = new URL(loc)
      check('x auth (served, real): start 302s to X with PKCE S256 and this site\'s callback, flow cookie httpOnly on /api/x/auth', s.status === 302 && u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('redirect_uri') === `${new URL(BASE).origin}/api/x/auth/callback` && /HttpOnly/i.test(flowSet) && /Path=\/api\/x\/auth/i.test(flowSet) && /SameSite=lax/i.test(flowSet))
      const cb = await get(`/api/x/auth/callback?code=pin&state=not-the-state`, `pt_x_flow=${cookieValue(flowSet)}`)
      check('x auth (served, real): a callback with the wrong state seats nothing', cb.status === 303 && (cb.headers.get('location') ?? '').endsWith('xauth=failed') && !setCookieOf(cb, X_IDENTITY_COOKIE))
    }
    const fakeTok = await (async () => {
      if (!HAD_SECRET) return null
      return withEnv({ XCALLS_FAKE: '1', VERCEL_ENV: undefined }, () => signXIdentity({ xUserId: 'fake-pantessa_pin', handle: 'pantessa_pin', name: 'x', avatarUrl: null, at: Date.now() }, { fake: true }))
    })()
    if (fakeTok) {
      const m = (await (await get('/api/x/me', `${X_IDENTITY_COOKIE}=${fakeTok}`)).json()) as { identity: unknown }
      check('x auth (served, real): a fake-mode cookie is refused by a real server', m.identity === null)
    }
    return
  }

  // Fake server: the flow end to end.
  const s = await get('/api/x/auth/start?next=%2Fx%2Fpantessa_pin%2FBTC&as=pantessa_pin')
  const set = setCookieOf(s, X_IDENTITY_COOKIE)
  check('x auth (served): fake start seats the handle and 303s to next', s.status === 303 && s.headers.get('location') === '/x/pantessa_pin/BTC' && !!set, `${s.status} ${s.headers.get('location')}`)
  check('x auth (served): the identity cookie is httpOnly, SameSite=Lax, path /, 30 days', !!set && /HttpOnly/i.test(set) && /SameSite=lax/i.test(set) && /Path=\/(;|$)/.test(set) && /Max-Age=2592000/.test(set))
  const tok = cookieValue(set)
  const me1 = (await (await get('/api/x/me', `${X_IDENTITY_COOKIE}=${tok}`)).json()) as { identity: XIdentity | null; available: boolean }
  check('x auth (served): /api/x/me reads the seated handle', me1.identity?.handle === 'pantessa_pin' && me1.identity?.xUserId === 'fake-pantessa_pin' && me1.available === true)
  const [h, p, sg] = tok.split('.')
  const me2 = (await (await get('/api/x/me', `${X_IDENTITY_COOKIE}=${h}.${p}.${(sg?.[0] === 'A' ? 'B' : 'A') + (sg ?? '').slice(1)}`)).json()) as { identity: unknown }
  check('x auth (served): a tampered cookie is no identity', me2.identity === null)
  const nexts = ['//evil.example', '/\\evil', 'https://evil.example', '/%2f%2fevil.example']
  const locs = await Promise.all(nexts.map(async (n) => (await get(`/api/x/auth/start?next=${encodeURIComponent(n)}&as=pantessa_pin`)).headers.get('location')))
  check('x auth (served): an unsafe next lands on /x', locs.every((l) => l === '/x'), locs.join(', '))
  const cb = await get('/api/x/auth/callback?code=pin&state=pin')
  check('x auth (served): a callback with no flow cookie seats nothing', cb.status === 303 && cb.headers.get('location') === '/x?xauth=failed' && !setCookieOf(cb, X_IDENTITY_COOKIE))
  const so1 = await fetch(`${BASE}/api/x/auth/signout`, { method: 'POST', headers: { cookie: `${X_IDENTITY_COOKIE}=${tok}`, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })
  check('x auth (served): a cross-site sign out is refused', so1.status === 403 && !setCookieOf(so1, X_IDENTITY_COOKIE))
  const so2 = await fetch(`${BASE}/api/x/auth/signout`, { method: 'POST', headers: { cookie: `${X_IDENTITY_COOKIE}=${tok}`, origin: new URL(BASE).origin } })
  const cleared = setCookieOf(so2, X_IDENTITY_COOKIE) ?? ''
  check('x auth (served): sign out clears the cookie', so2.status === 200 && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cleared))

  // The claim row and the verified record: these wait on lanes SOURCE (store) and JUDGE (record).
  const storeBuilt = !read('lib/called-it/store.ts').includes('not built yet (lane SOURCE)')
  const dbUrl = process.env.DATABASE_URL ?? ''
  if (!storeBuilt) {
    console.log('ℹ️  x auth (served): claim row + verified record skipped: lib/called-it/store.ts is still the stub (waits on SOURCE)')
    return
  }
  if (!dbUrl || dbUrl.includes('ep-wild-credit')) {
    console.log('ℹ️  x auth (served): claim row skipped: no TEST DATABASE_URL in this process (never the prod DB)')
    return
  }
  const { default: prisma } = await import('../lib/db')
  const row = await prisma.xHandle.findUnique({ where: { handle: 'pantessa_pin' } }).catch(() => null)
  check('x auth (served): the fake sign-in wrote the claim row', row?.claimedXUserId === 'fake-pantessa_pin' && !!row?.claimedAt)
  const judgeLanded = !read('lib/called-it/record.ts').includes('CONTRACT BASELINE')
  if (!judgeLanded) {
    console.log('ℹ️  x auth (served): verified record skipped: lib/called-it/record.ts is still the baseline (waits on JUDGE)')
    return
  }
  // The fixture is the one handle with a ready record. Claim it, read it, then put the claim back.
  const before = await prisma.xHandle.findUnique({ where: { handle: 'pantessa_test' } }).catch(() => null)
  try {
    await get('/api/x/auth/start?next=%2Fx&as=pantessa_test')
    const rec = (await (await get('/api/x/record?handle=pantessa_test&sym=BTC')).json()) as { status: string; record?: { verified: unknown; words: { standing: string } } }
    check('x auth (served): a signed-in handle\'s record reads verified', rec.status === 'ready' && !!rec.record?.verified && /^Verified\./.test(rec.record?.words.standing ?? ''), JSON.stringify(rec).slice(0, 160))
  } finally {
    await prisma.xHandle.update({ where: { handle: 'pantessa_test' }, data: { claimedXUserId: before?.claimedXUserId ?? null, claimedAt: before?.claimedAt ?? null } }).catch(() => null)
  }
}

if (process.argv[1]?.endsWith('called-auth-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledAuthPins(check)
    if (process.env.BASE) await calledAuthPinsServed(check, process.env.BASE)
    else await calledAuthPinsAsync(check)
    console.log(failed ? `\n${failed} of ${n} called-it auth pins failed` : `\nall ${n} called-it auth pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
