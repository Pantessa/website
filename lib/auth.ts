// ─────────────────────────────────────────────────────────────────────────
//  Wallet auth (Sign-In With Ethereum) + session cookies.
//
//  Flow: client gets a nonce → wallet signs an EIP-4361 message → we verify the
//  signature recovers to the claimed address (EOA or smart-wallet via the
//  public client) → we mint an httpOnly JWT session cookie. After that the
//  address is trusted server-side and never taken from the client again — the
//  anti-spoofing guarantee behind private chats (and, later, MCP approvals).
// ─────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import { generateSiweNonce, parseSiweMessage, verifySiweMessage } from 'viem/siwe'

export const SESSION_COOKIE = 'yf_session'
export const NONCE_COOKIE = 'yf_siwe_nonce'
const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days
const NONCE_MAX_AGE = 60 * 10 // 10 minutes

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) {
    throw new Error('SESSION_SECRET must be set (≥16 chars) to use wallet auth.')
  }
  return new TextEncoder().encode(s)
}

// For verifySiweMessage — supports EOAs and (via ERC-1271/6492) smart wallets.
export const publicClient = createPublicClient({ chain: base, transport: http() })

export { generateSiweNonce, parseSiweMessage, verifySiweMessage }

// ── Session JWT ────────────────────────────────────────────────────────────

export async function signSession(address: string): Promise<string> {
  return new SignJWT({ address: address.toLowerCase() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret())
}

async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    return typeof payload.address === 'string' ? payload.address : null
  } catch {
    return null
  }
}

/** Lowercased, SIWE-verified wallet address from the session cookie, or null. */
export async function getSessionAddress(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const addr = await verifySessionToken(token)
  return addr ? addr.toLowerCase() : null
}

export async function setSessionCookie(address: string): Promise<void> {
  const token = await signSession(address)
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
}

export async function clearSessionCookie(): Promise<void> {
  ;(await cookies()).delete(SESSION_COOKIE)
}

// ── SIWE nonce (stateless: stored in a short-lived httpOnly cookie) ──────────

export async function issueNonce(): Promise<string> {
  const nonce = generateSiweNonce()
  ;(await cookies()).set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: NONCE_MAX_AGE,
  })
  return nonce
}

export async function readNonce(): Promise<string | null> {
  return (await cookies()).get(NONCE_COOKIE)?.value ?? null
}

export async function clearNonce(): Promise<void> {
  ;(await cookies()).delete(NONCE_COOKIE)
}
