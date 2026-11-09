// ─────────────────────────────────────────────────────────────────────────
//  WHO IS ACTING — the one reader of identity for the community layer.
//
//  Two proofs, two cookies, never a claim:
//    · yf_session  — the SIWE wallet session (lib/auth). Untouched here.
//    · pt_ident    — a provider identity (Telegram, Discord) that the
//                    provider itself signed: Telegram's HMAC over a Mini
//                    App's initData / the Login Widget's fields, or
//                    Discord's OAuth code exchange. Minted ONLY by the
//                    Telegram and Discord lanes' auth routes after they
//                    verified that proof; a JWT under SESSION_SECRET with
//                    its own audience so it can never be read as a wallet
//                    session (and a wallet session never as this).
//
//  A wallet session wins: when both cookies are present the actor is the
//  wallet, and the provider identity rides along (that request is the only
//  place an identity_links row may be written — both proofs in one request).
//  A provider identity with an identity_links row acts AS its wallet key, so
//  a member who joined from Telegram keeps one seat after connecting.
//
//  Server-only (next/headers).
// ─────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { providerKey, walletKey, type Actor, type IdentityProvider } from './spec'

export const IDENT_COOKIE = 'pt_ident'
const IDENT_AUDIENCE = 'pantessa:ident'
const IDENT_MAX_AGE = 60 * 60 * 24 * 30

export interface ProviderIdentity {
  p: IdentityProvider
  id: string
  name: string | null
  username: string | null
}

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (≥16 chars).')
  return new TextEncoder().encode(s)
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  // Provider names are shown as text nodes; control characters and bidi
  // overrides never reach a page or a bot message.
  const s = v.replace(/[\x00-\x1f\x7f‎‏‪-‮⁦-⁩]/g, '').trim().slice(0, max)
  return s || null
}

export function normalizeIdentity(raw: { p: unknown; id: unknown; name?: unknown; username?: unknown }): ProviderIdentity | null {
  if (raw.p !== 'tg' && raw.p !== 'dc') return null
  const id = typeof raw.id === 'number' ? String(Math.trunc(raw.id)) : typeof raw.id === 'string' ? raw.id : ''
  if (!(raw.p === 'tg' ? /^\d{1,20}$/ : /^\d{5,22}$/).test(id)) return null
  const username = clean(raw.username, 40)
  return { p: raw.p, id, name: clean(raw.name, 64), username: username && /^[A-Za-z0-9_.]{2,40}$/.test(username) ? username : null }
}

/** Mint the identity token. Call ONLY after verifying the provider's proof. */
export async function signIdentity(identity: ProviderIdentity): Promise<string> {
  return new SignJWT({ p: identity.p, id: identity.id, name: identity.name, username: identity.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(IDENT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret())
}

export async function verifyIdentityToken(token: string): Promise<ProviderIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: IDENT_AUDIENCE })
    return normalizeIdentity(payload as { p: unknown; id: unknown; name?: unknown; username?: unknown })
  } catch {
    return null
  }
}

/** Set the identity cookie. `embedded` = the page runs inside Telegram's
 *  in-app webview / an iframe, where a Lax cookie is dropped: SameSite=None
 *  (Secure) is the only one that survives there. */
export async function setIdentityCookie(identity: ProviderIdentity, opts: { embedded?: boolean } = {}): Promise<void> {
  const token = await signIdentity(identity)
  const prod = process.env.NODE_ENV === 'production'
  ;(await cookies()).set(IDENT_COOKIE, token, {
    httpOnly: true,
    secure: prod,
    sameSite: opts.embedded && prod ? 'none' : 'lax',
    path: '/',
    maxAge: IDENT_MAX_AGE,
  })
}

export async function clearIdentityCookie(): Promise<void> {
  ;(await cookies()).delete(IDENT_COOKIE)
}

export async function getProviderIdentity(): Promise<ProviderIdentity | null> {
  const token = (await cookies()).get(IDENT_COOKIE)?.value
  return token ? verifyIdentityToken(token) : null
}

/** The wallet an identity was linked to (both proofs once seen together). */
export async function linkedWallet(identity: ProviderIdentity): Promise<string | null> {
  const row = await prisma.identityLink.findUnique({ where: { provider_externalId: { provider: identity.p, externalId: identity.id } } }).catch(() => null)
  return row?.wallet ?? null
}

/**
 * The acting identity, or null for a stranger. Wallet session first; else
 * the provider identity (acting as its linked wallet's key when one exists).
 */
export async function getActor(): Promise<Actor | null> {
  const [wallet, identity] = await Promise.all([getSessionAddress().catch(() => null), getProviderIdentity().catch(() => null)])
  const provider = identity ? { p: identity.p, id: identity.id, name: identity.name, username: identity.username } : null
  if (wallet) return { key: walletKey(wallet), wallet, provider }
  if (!identity) return null
  const linked = await linkedWallet(identity)
  if (linked) return { key: walletKey(linked), wallet: linked, provider }
  return { key: providerKey(identity.p, identity.id), wallet: null, provider }
}

/**
 * Bind a provider identity to a wallet. Only ever called with BOTH proofs in
 * hand in one request (the SIWE session and the verified identity cookie).
 * First writer wins: an identity already linked to another wallet is left
 * alone (returns that wallet) — a link is never silently moved.
 */
export async function linkIdentityToWallet(identity: ProviderIdentity, wallet: string): Promise<string> {
  const w = wallet.toLowerCase()
  const existing = await linkedWallet(identity)
  if (existing) return existing
  await prisma.identityLink.create({ data: { provider: identity.p, externalId: identity.id, wallet: w } }).catch(() => null)
  return (await linkedWallet(identity)) ?? w
}
