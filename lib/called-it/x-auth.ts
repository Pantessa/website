// "Verify with X": the account itself proves its handle (OAuth 2.0 with
// PKCE), which is the only thing that makes a plot "verified".
//
// Lane AUTH (squad called-it, 2026-11-11). Every other lane reads identity
// through getXIdentity and links through xAuthStartHref; those names and
// XIdentity are the contract and never change shape.
//
// The flow (routes under app/api/x/auth/**, the logic here so it is pinned):
//   start    → a short-lived signed cookie `pt_x_flow` (state + verifier +
//              next + the redirect URI), then 302 to X's authorize page.
//   callback → state checked in constant time, the code exchanged ONCE for
//              an access token, `users/me` read ONCE with it, the token
//              revoked best-effort and dropped. Nothing of X's (code, token,
//              raw body) reaches the database, a cookie, a log line, an error
//              or a response. What is kept is the public profile: user id,
//              handle, name, avatar.
//   identity → `pt_x`, its own cookie (NOT pt_ident, NOT the wallet session),
//              a JWT under SESSION_SECRET with its own audience, httpOnly,
//              SameSite=Lax, 30 days.
//
// This is a HANDLE PROOF, not an account sign-in: it never asks for a wallet
// and never goes through the unified sign-in modal.
//
// Fake mode (XCALLS_FAKE=1, never when VERCEL_ENV is production): start with
// `as=<handle>` seats that handle without leaving the site. A fake identity
// is signed under a DIFFERENT audience and is refused whenever fake mode is
// off, so a cookie minted on a preview can never be replayed on production.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { ENV, normalizeHandle, type XProfile } from './spec'

export interface XIdentity {
  xUserId: string
  /** Lowercase, no @. */
  handle: string
  name: string
  avatarUrl: string | null
  /** When X confirmed it (ms). */
  at: number
}

// ── Names and limits ────────────────────────────────────────────────────

export const X_IDENTITY_COOKIE = 'pt_x'
export const X_FLOW_COOKIE = 'pt_x_flow'
/** The flow cookie only rides to the start and callback routes. */
export const X_FLOW_COOKIE_PATH = '/api/x/auth'
export const X_IDENTITY_MAX_AGE_S = 60 * 60 * 24 * 30
export const X_FLOW_MAX_AGE_S = 60 * 10
const AUD_IDENTITY = 'pantessa:x'
const AUD_IDENTITY_FAKE = 'pantessa:x-fake'
const AUD_FLOW = 'pantessa:x-flow'

export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token'
export const X_REVOKE_URL = 'https://api.x.com/2/oauth2/revoke'
export const X_ME_URL = 'https://api.x.com/2/users/me?user.fields=profile_image_url,public_metrics,verified'
export const X_SCOPES = 'users.read tweet.read'
export const X_CALLBACK_PATH = '/api/x/auth/callback'
export const X_START_PATH = '/api/x/auth/start'

/** The production origin X has on file. */
export const X_AUTH_PROD_ORIGIN = 'https://www.pantessa.com'
/** Where a `next` that is not a safe path lands. */
export const NEXT_FALLBACK = '/x'
export const NEXT_MAX = 300

/** What the button and the callback tell a returning visitor (`?xauth=`). */
export type XAuthNote = 'denied' | 'failed' | 'unavailable'

// ── Where a "Verify with X" button goes ─────────────────────────────────

/** Where a "Verify with X" button goes. `next` is a path on this site to return to. */
export function xAuthStartHref(next: string): string {
  return `${X_START_PATH}?next=${encodeURIComponent(next)}`
}

// ── The `next` rule ─────────────────────────────────────────────────────

/**
 * A path on this site, or `/x`. Starts with exactly one `/`, no `//`, no
 * backslash, no scheme, no control character, at most 300 characters. The
 * same checks run on the value decoded once more, so `/%2f%2fevil.example`
 * and `/%5cevil` are refused too.
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== 'string') return NEXT_FALLBACK
  const s = raw
  if (!s || s.length > NEXT_MAX) return NEXT_FALLBACK
  const bad = (v: string): boolean => {
    if (!v.startsWith('/')) return true
    if (v.startsWith('//')) return true
    if (v.includes('//')) return true
    if (v.includes('\\')) return true
    if (/[\x00-\x1f\x7f]/.test(v)) return true
    // A scheme before the first slash cannot happen once it starts with "/",
    // but a resolver must agree the result stays on this origin.
    try {
      const u = new URL(v, 'https://next.invalid')
      if (u.origin !== 'https://next.invalid') return true
    } catch {
      return true
    }
    return false
  }
  if (bad(s)) return NEXT_FALLBACK
  let decoded = s
  try {
    decoded = decodeURIComponent(s)
  } catch {
    return NEXT_FALLBACK
  }
  if (bad(decoded)) return NEXT_FALLBACK
  return s
}

/** `next` with `?xauth=<note>` added (path, search and hash kept). */
export function withAuthNote(next: string, note: XAuthNote): string {
  const safe = safeNext(next)
  const u = new URL(safe, 'https://next.invalid')
  u.searchParams.set('xauth', note)
  return `${u.pathname}${u.search}${u.hash}`
}

// ── Which origins X has on file ─────────────────────────────────────────

/**
 * True only for the origins whose callback URL is registered on the X app:
 * the production origin, and http://localhost or http://127.0.0.1 on any
 * port (X matches the callback exactly, so the owner registers the ports in
 * use). Previews, the apex and anything else are false.
 */
export function isAllowedAuthOrigin(origin: unknown): boolean {
  if (typeof origin !== 'string') return false
  let u: URL
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  if (u.origin !== origin.replace(/\/+$/, '')) return false
  if (u.origin === X_AUTH_PROD_ORIGIN) return true
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
  return false
}

/** Fake sign-in is on: the harness and local servers only, never production. */
export function xFakeMode(): boolean {
  return process.env[ENV.fake] === '1' && process.env.VERCEL_ENV !== 'production'
}

export function xClientId(): string | null {
  const v = (process.env[ENV.oauthClientId] ?? '').trim()
  return v || null
}

function xClientSecret(): string | null {
  const v = (process.env[ENV.oauthClientSecret] ?? '').trim()
  return v || null
}

/** Can "Verify with X" complete on a page served from `origin`? */
export function xAuthAvailable(origin: string): boolean {
  if (xFakeMode()) return true
  if (!xClientId()) return false
  return isAllowedAuthOrigin(origin)
}

/** This site's own callback on an allowed origin, or null. Never from a header that was not checked. */
export function redirectUriFor(origin: string): string | null {
  return isAllowedAuthOrigin(origin) ? `${origin.replace(/\/+$/, '')}${X_CALLBACK_PATH}` : null
}

// ── PKCE and state ──────────────────────────────────────────────────────

const b64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** S256 code challenge for a verifier (RFC 7636 §4.2). */
export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier, 'ascii').digest())
}

/** A fresh PKCE pair: a 43-character verifier from 32 random bytes and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: pkceChallenge(verifier) }
}

export function newState(): string {
  return b64url(randomBytes(24))
}

/** Constant-time equality (both sides hashed first, so length leaks nothing). Empty never matches. */
export function stateMatches(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb) && a.length === b.length
}

export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: X_SCOPES,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  })
  return `${X_AUTHORIZE_URL}?${q.toString()}`
}

/** The token exchange's request. Public client: `client_id` in the body. Confidential: HTTP Basic. */
export function tokenRequest(p: { code: string; redirectUri: string; verifier: string; clientId: string; clientSecret?: string | null }): { headers: Record<string, string>; body: string } {
  const form = new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier })
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (p.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(p.clientId)}:${encodeURIComponent(p.clientSecret)}`).toString('base64')}`
  else form.set('client_id', p.clientId)
  return { headers, body: form.toString() }
}

// ── Signing ─────────────────────────────────────────────────────────────

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (16+ chars).')
  return new TextEncoder().encode(s)
}

const AVATAR_HOSTS = new Set(['pbs.twimg.com', 'abs.twimg.com'])

/** An avatar is kept only on X's own image hosts, over https. */
export function cleanAvatar(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 400) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || !AVATAR_HOSTS.has(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}

const cleanText = (v: unknown, max: number): string => {
  if (typeof v !== 'string') return ''
  // Shown as text nodes; control characters and bidi overrides never reach a page.
  return v.replace(/[\x00-\x1f\x7f‎‏‪-‮⁦-⁩]/g, '').trim().slice(0, max)
}

const USER_ID_RE = /^[A-Za-z0-9_-]{1,40}$/

/** The one shape check for an identity, on the way in and on the way out. */
export function normalizeXIdentity(raw: { xUserId?: unknown; handle?: unknown; name?: unknown; avatarUrl?: unknown; at?: unknown }): XIdentity | null {
  const handle = normalizeHandle(raw.handle)
  const xUserId = typeof raw.xUserId === 'string' && USER_ID_RE.test(raw.xUserId) ? raw.xUserId : null
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at > 0 ? Math.trunc(raw.at) : null
  if (!handle || !xUserId || at === null) return null
  return { xUserId, handle, name: cleanText(raw.name, 64) || `@${handle}`, avatarUrl: cleanAvatar(raw.avatarUrl), at }
}

/** Mint the identity token. Call ONLY after X confirmed the account (or in fake mode). `expiresAt` (epoch seconds) is for pins. */
export async function signXIdentity(identity: XIdentity, opts: { fake?: boolean; expiresAt?: number } = {}): Promise<string> {
  const id = normalizeXIdentity(identity)
  if (!id) throw new Error('Not an X identity.')
  return new SignJWT({ uid: id.xUserId, h: id.handle, n: id.name, a: id.avatarUrl, at: id.at })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(opts.fake ? AUD_IDENTITY_FAKE : AUD_IDENTITY)
    .setIssuedAt()
    .setExpirationTime(opts.expiresAt ?? '30d')
    .sign(secret())
}

/** A token's identity, or null (tampered, expired, the wrong audience, or a fake one while fake mode is off). */
export async function verifyXIdentityToken(token: unknown): Promise<XIdentity | null> {
  if (typeof token !== 'string' || !token || token.length > 2000) return null
  const audiences = xFakeMode() ? [AUD_IDENTITY, AUD_IDENTITY_FAKE] : [AUD_IDENTITY]
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: audiences, algorithms: ['HS256'] })
    return normalizeXIdentity({ xUserId: payload.uid, handle: payload.h, name: payload.n, avatarUrl: payload.a, at: payload.at })
  } catch {
    return null
  }
}

/** The X account this browser proved, or null. Server only (reads a signed httpOnly cookie). */
export async function getXIdentity(): Promise<XIdentity | null> {
  try {
    const { cookies } = await import('next/headers')
    const token = (await cookies()).get(X_IDENTITY_COOKIE)?.value
    return token ? await verifyXIdentityToken(token) : null
  } catch {
    return null
  }
}

/** Cookie options for the identity (the route sets it on its own response). */
export function identityCookieOptions(): { httpOnly: true; secure: boolean; sameSite: 'lax'; path: '/'; maxAge: number } {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: X_IDENTITY_MAX_AGE_S }
}

export function flowCookieOptions(): { httpOnly: true; secure: boolean; sameSite: 'lax'; path: string; maxAge: number } {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: X_FLOW_COOKIE_PATH, maxAge: X_FLOW_MAX_AGE_S }
}

export interface XFlow {
  state: string
  verifier: string
  next: string
  redirectUri: string
}

export async function signFlow(flow: XFlow): Promise<string> {
  return new SignJWT({ s: flow.state, v: flow.verifier, n: safeNext(flow.next), r: flow.redirectUri })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUD_FLOW)
    .setIssuedAt()
    .setExpirationTime(`${X_FLOW_MAX_AGE_S}s`)
    .sign(secret())
}

export async function verifyFlow(token: unknown): Promise<XFlow | null> {
  if (typeof token !== 'string' || !token || token.length > 2000) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: AUD_FLOW, algorithms: ['HS256'] })
    const { s, v, n, r } = payload as Record<string, unknown>
    if (typeof s !== 'string' || typeof v !== 'string' || typeof r !== 'string') return null
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(v)) return null
    return { state: s, verifier: v, next: safeNext(n), redirectUri: r }
  } catch {
    return null
  }
}

// ── Start ───────────────────────────────────────────────────────────────

export type StartResult =
  /** Leave for X (302); set the flow cookie. */
  | { kind: 'x'; location: string; flowToken: string }
  /** Fake mode: the identity is seated here (303 to next). */
  | { kind: 'seated'; location: string; identityToken: string; identity: XIdentity }
  /** Cannot complete here: go somewhere that can, or back with a note (303). */
  | { kind: 'away'; location: string }

export interface ClaimDeps {
  saveProfile: (profile: XProfile & { isProtected?: boolean }) => Promise<void>
  claimHandle: (handle: string, xUserId: string, profile?: Partial<XProfile>) => Promise<void>
}

export interface Logger {
  warn: (...args: unknown[]) => void
}

/** Write the claim (the only thing that makes a record "verified"). Returns false when the store refused. */
export async function claimIdentity(identity: XIdentity, extra: { followers: number | null; blue: boolean }, deps: ClaimDeps, log: Logger = console): Promise<boolean> {
  const profile: XProfile = { handle: identity.handle, name: identity.name, avatarUrl: identity.avatarUrl, followers: extra.followers, blue: extra.blue, xUserId: identity.xUserId }
  try {
    await deps.saveProfile({ ...profile, isProtected: false })
    await deps.claimHandle(identity.handle, identity.xUserId, profile)
    return true
  } catch (e) {
    // Our own store's words only; nothing of X's is in scope here.
    log.warn('[x/auth] the claim was not written:', e instanceof Error ? e.message.slice(0, 160) : 'unknown error')
    return false
  }
}

export async function startXAuth(p: { origin: string; next: unknown; as?: unknown; deps: ClaimDeps; log?: Logger; nowMs?: number }): Promise<StartResult> {
  const next = safeNext(p.next)
  if (xFakeMode()) {
    // The harness and the UI lanes: seat a handle without leaving the site.
    // With no `as`, the fixture handle (so a pressed button works in a drive).
    const handle = normalizeHandle(p.as ?? 'pantessa_test')
    if (!handle) return { kind: 'away', location: withAuthNote(next, 'failed') }
    const identity: XIdentity = { xUserId: `fake-${handle}`, handle, name: handle === 'pantessa_test' ? 'Fixture Desk' : `@${handle}`, avatarUrl: null, at: p.nowMs ?? Date.now() }
    // A store failure never breaks a fake sign-in (the store may not be built in this tree).
    await claimIdentity(identity, { followers: null, blue: false }, p.deps, p.log)
    return { kind: 'seated', location: next, identityToken: await signXIdentity(identity, { fake: true }), identity }
  }
  // Outside fake mode `as` is ignored entirely.
  const clientId = xClientId()
  if (!clientId) return { kind: 'away', location: withAuthNote(next, 'unavailable') }
  const redirectUri = redirectUriFor(p.origin)
  if (!redirectUri) return { kind: 'away', location: `${X_AUTH_PROD_ORIGIN}${xAuthStartHref(next)}` }
  const { verifier, challenge } = pkcePair()
  const state = newState()
  return { kind: 'x', location: authorizeUrl({ clientId, redirectUri, state, challenge }), flowToken: await signFlow({ state, verifier, next, redirectUri }) }
}

// ── Callback ────────────────────────────────────────────────────────────

export type CallbackResult = { kind: 'seated'; location: string; identityToken: string; identity: XIdentity } | { kind: 'away'; location: string }

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const TIMEOUT_MS = 6000

/** X's `users/me` answer → the identity and the two public numbers we keep. */
export function identityFromMe(body: unknown, nowMs: number): { identity: XIdentity; followers: number | null; blue: boolean } | null {
  const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : null
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const avatar = typeof d.profile_image_url === 'string' ? d.profile_image_url.replace(/_normal(\.[a-z]+)$/i, '_400x400$1') : null
  const identity = normalizeXIdentity({ xUserId: d.id, handle: d.username, name: d.name, avatarUrl: avatar, at: nowMs })
  if (!identity || !/^\d{1,25}$/.test(identity.xUserId)) return null
  const pm = d.public_metrics && typeof d.public_metrics === 'object' ? (d.public_metrics as Record<string, unknown>) : null
  const followers = pm && typeof pm.followers_count === 'number' && Number.isFinite(pm.followers_count) ? Math.max(0, Math.trunc(pm.followers_count)) : null
  return { identity, followers, blue: d.verified === true }
}

/**
 * The callback, end to end, with its world handed in (fetch, the store, the
 * logger) so the pins can prove the tokens go nowhere. The two X tokens (the
 * code and the access token) are local variables of this function; they are
 * sent to X and to nobody else, and the access token is revoked before the
 * function returns.
 */
export async function completeXAuth(p: {
  params: URLSearchParams
  flowToken: string | undefined
  origin: string
  deps: ClaimDeps
  fetchImpl?: FetchLike
  log?: Logger
  nowMs?: number
}): Promise<CallbackResult> {
  const log = p.log ?? console
  const doFetch: FetchLike = p.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: 'no-store' }))
  const flow = await verifyFlow(p.flowToken)
  const next = flow?.next ?? NEXT_FALLBACK
  if (!flow) return { kind: 'away', location: withAuthNote(NEXT_FALLBACK, 'failed') }
  const err = p.params.get('error')
  if (err) return { kind: 'away', location: withAuthNote(next, err === 'access_denied' ? 'denied' : 'failed') }
  if (!stateMatches(p.params.get('state'), flow.state)) return { kind: 'away', location: withAuthNote(next, 'failed') }
  const code = p.params.get('code')
  if (!code || code.length > 2000) return { kind: 'away', location: withAuthNote(next, 'failed') }
  const clientId = xClientId()
  const redirectUri = redirectUriFor(p.origin)
  // The URI the code was issued for must be this site's own, on an allowed origin, unchanged.
  if (!clientId || !redirectUri || redirectUri !== flow.redirectUri) return { kind: 'away', location: withAuthNote(next, 'failed') }
  const clientSecret = xClientSecret()

  let access: string | null = null
  try {
    const req = tokenRequest({ code, redirectUri, verifier: flow.verifier, clientId, clientSecret })
    const tr = await doFetch(X_TOKEN_URL, { method: 'POST', headers: req.headers, body: req.body, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!tr.ok) {
      log.warn('[x/auth] the token exchange answered', tr.status)
      return { kind: 'away', location: withAuthNote(next, 'failed') }
    }
    const tb = (await tr.json().catch(() => null)) as { access_token?: unknown } | null
    access = tb && typeof tb.access_token === 'string' && tb.access_token ? tb.access_token : null
    if (!access) {
      log.warn('[x/auth] the token exchange answered without a token')
      return { kind: 'away', location: withAuthNote(next, 'failed') }
    }
    const mr = await doFetch(X_ME_URL, { method: 'GET', headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!mr.ok) {
      log.warn('[x/auth] users/me answered', mr.status)
      return { kind: 'away', location: withAuthNote(next, 'failed') }
    }
    const me = identityFromMe(await mr.json().catch(() => null), p.nowMs ?? Date.now())
    if (!me) {
      log.warn('[x/auth] users/me answered a shape we do not read')
      return { kind: 'away', location: withAuthNote(next, 'failed') }
    }
    // Real mode: no claim row, no "verified". The cookie and the record must never disagree.
    const claimed = await claimIdentity(me.identity, { followers: me.followers, blue: me.blue }, p.deps, log)
    if (!claimed) return { kind: 'away', location: withAuthNote(next, 'failed') }
    return { kind: 'seated', location: next, identityToken: await signXIdentity(me.identity), identity: me.identity }
  } catch (e) {
    // A network error's name only (a timeout, a reset); never a body or a URL with a code in it.
    log.warn('[x/auth] the round trip with X failed:', e instanceof Error ? e.name : 'unknown')
    return { kind: 'away', location: withAuthNote(next, 'failed') }
  } finally {
    if (access) {
      // Revoke and drop. Best-effort: a failure here changes nothing we keep.
      const form = new URLSearchParams({ token: access, token_type_hint: 'access_token' })
      const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
      if (clientSecret && clientId) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`
      else if (clientId) form.set('client_id', clientId)
      await doFetch(X_REVOKE_URL, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(3000) }).catch(() => null)
      access = null
    }
  }
}
