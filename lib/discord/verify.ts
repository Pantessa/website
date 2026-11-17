// DISCORD INTERACTION SIGNATURE (lane DISCORD, 2026-11-09).
//
// Discord signs every interaction with Ed25519 over `timestamp + rawBody`
// (headers X-Signature-Ed25519 / X-Signature-Timestamp). The app's public key
// is 32 raw bytes in hex; node:crypto wants a KeyObject, so it is wrapped in
// the fixed SPKI DER prefix for Ed25519. No dependency. Pinned with a keypair
// the pin generates, a tampered body, a wrong timestamp and malformed hex.

import { createPublicKey, verify } from 'node:crypto'

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const HEX64 = /^[0-9a-fA-F]{64}$/
const HEX128 = /^[0-9a-fA-F]{128}$/
/** A signed request older (or newer) than this is refused: a captured request is not replayable. */
export const SIGNATURE_MAX_SKEW_S = 300

export function ed25519PublicKeyFromHex(hex: string) {
  if (!HEX64.test(hex)) return null
  try {
    return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' })
  } catch {
    return null
  }
}

export function verifyDiscordSignature(publicKeyHex: string, signatureHex: string | null | undefined, timestamp: string | null | undefined, rawBody: string, nowS: number = Math.floor(Date.now() / 1000)): boolean {
  if (typeof signatureHex !== 'string' || !HEX128.test(signatureHex)) return false
  if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp)) return false
  if (Math.abs(nowS - Number(timestamp)) > SIGNATURE_MAX_SKEW_S) return false
  const key = ed25519PublicKeyFromHex(publicKeyHex)
  if (!key) return false
  try {
    return verify(null, Buffer.from(timestamp + rawBody, 'utf8'), key, Buffer.from(signatureHex, 'hex'))
  } catch {
    return false
  }
}
