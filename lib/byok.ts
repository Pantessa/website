// Bring your own key (pricing v2) — a user's OWN Anthropic API key runs their
// house answers and markets AI, unlimited, at their cost and none of ours.
//
// We hold a secret we did not hold before, so the rules are strict:
//   - encrypted at rest: AES-256-GCM, a fresh 96-bit nonce per write, under a
//     key derived from BYOK_KEY_SECRET — its OWN env, never SESSION_SECRET, so
//     rotating sessions never bricks keys and a session-secret leak never
//     opens them. No secret set = the feature is OFF (fail closed): nothing is
//     ever stored under a default.
//   - the plaintext exists in memory for the length of one request. It is
//     never logged, never echoed in an error or a beacon, never sent to the
//     client again after save — the UI gets `last4` and nothing else.
//   - the key rides an `x-api-key` HEADER, never a URL (viem-style error
//     printers dump URLs; the Alchemy bearer lesson from #768).
//   - validated before it is stored with `count_tokens` — a free endpoint, so
//     proving a key works costs its owner nothing.
//   - a refused key NEVER falls back to the house key (lib/house-model): that
//     is how we would end up paying for someone else's traffic.
//
// Pure helpers (format check, crypto round-trip, model allowlist) sit above
// the store so the API harness can pin them without a database.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const BYOK_PROVIDER = 'anthropic' as const

/** Synthesis models a BYOK owner may pick (their key, their bill). Planning
 *  always stays on the planner model the routing evals were tuned on. Opus
 *  and Fable are deliberately absent: a stranger's key should not be one
 *  toggle away from a 10× bill. */
export const BYOK_SYNTH_MODELS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest, the default' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — sharper answers, ~2× the cost' },
] as const
export type ByokSynthModel = (typeof BYOK_SYNTH_MODELS)[number]['id']
export function isByokSynthModel(v: unknown): v is ByokSynthModel {
  return BYOK_SYNTH_MODELS.some((m) => m.id === v)
}

/** Shape check only — the real proof is the count_tokens call. Anthropic keys
 *  are `sk-ant-…`; anything else (an OpenAI key, a pasted sentence, a wallet
 *  key!) is refused by name before it goes anywhere. */
export function looksLikeAnthropicKey(v: unknown): v is string {
  return typeof v === 'string' && /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(v.trim())
}

export function byokEnabled(): boolean {
  return (process.env.BYOK_KEY_SECRET ?? '').length >= 32
}

function cipherKey(): Buffer {
  const secret = process.env.BYOK_KEY_SECRET ?? ''
  if (secret.length < 32) throw new Error('BYOK_KEY_SECRET is not set')
  // A fixed-purpose hash, so the raw env string is never used as the key.
  return createHash('sha256').update(`pantessa-byok-v1:${secret}`).digest()
}

export interface SealedKey {
  ciphertext: string
  nonce: string
  tag: string
}

export function sealKey(plain: string): SealedKey {
  const nonce = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', cipherKey(), nonce)
  const ciphertext = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return { ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), tag: c.getAuthTag().toString('base64') }
}

/** Throws on a wrong secret or a tampered row (GCM auth) — callers treat a
 *  throw as "no key", never as a reason to reach for the house key silently. */
export function openKey(sealed: SealedKey): string {
  const d = createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(sealed.nonce, 'base64'))
  d.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(sealed.ciphertext, 'base64')), d.final()]).toString('utf8')
}

export type KeyCheck = { ok: true } | { ok: false; reason: string }

/** Prove a key works WITHOUT spending its owner's money: count_tokens is a
 *  free endpoint. 401/403 = a bad key; anything else upstream = we could not
 *  tell, and we say so rather than store an unproven key. */
export async function checkAnthropicKey(key: string): Promise<KeyCheck> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(12_000),
    })
    if (res.ok) return { ok: true }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'Anthropic refused that key. Check that it is copied whole and still active in the Anthropic Console.' }
    return { ok: false, reason: `Anthropic answered ${res.status} while checking the key, so it was not saved. Try again in a minute.` }
  } catch {
    return { ok: false, reason: 'Anthropic could not be reached to check the key, so it was not saved. Try again in a minute.' }
  }
}

// ── The store ───────────────────────────────────────────────────────────────

const norm = (a: string) => a.toLowerCase()

export interface InferenceKeyMeta {
  provider: typeof BYOK_PROVIDER
  last4: string
  synthModel: ByokSynthModel
  useForEmbeds: boolean
  lastError: string | null
  createdAt: string
  lastUsedAt: string | null
}

export async function getInferenceKeyMeta(owner: string): Promise<InferenceKeyMeta | null> {
  try {
    const { default: prisma } = await import('@/lib/db')
    const row = await prisma.inferenceKey.findUnique({ where: { ownerAddress_provider: { ownerAddress: norm(owner), provider: BYOK_PROVIDER } } })
    if (!row) return null
    return {
      provider: BYOK_PROVIDER,
      last4: row.last4,
      synthModel: isByokSynthModel(row.synthModel) ? row.synthModel : 'claude-haiku-4-5',
      useForEmbeds: row.useForEmbeds,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    }
  } catch {
    return null
  }
}

/** Store a key the caller has ALREADY proven with checkAnthropicKey. */
export async function saveInferenceKey(owner: string, plain: string, opts: { synthModel?: ByokSynthModel; useForEmbeds?: boolean } = {}): Promise<void> {
  const key = plain.trim()
  const sealed = sealKey(key)
  const { default: prisma } = await import('@/lib/db')
  const data = { ...sealed, last4: key.slice(-4), lastError: null, ...(opts.synthModel ? { synthModel: opts.synthModel } : {}), ...(opts.useForEmbeds !== undefined ? { useForEmbeds: opts.useForEmbeds } : {}) }
  await prisma.inferenceKey.upsert({
    where: { ownerAddress_provider: { ownerAddress: norm(owner), provider: BYOK_PROVIDER } },
    create: { ownerAddress: norm(owner), provider: BYOK_PROVIDER, ...data },
    update: data,
  })
}

export async function updateInferenceKeyPrefs(owner: string, prefs: { synthModel?: ByokSynthModel; useForEmbeds?: boolean }): Promise<boolean> {
  const { default: prisma } = await import('@/lib/db')
  const r = await prisma.inferenceKey.updateMany({ where: { ownerAddress: norm(owner), provider: BYOK_PROVIDER }, data: prefs })
  return r.count > 0
}

export async function deleteInferenceKey(owner: string): Promise<void> {
  const { default: prisma } = await import('@/lib/db')
  await prisma.inferenceKey.deleteMany({ where: { ownerAddress: norm(owner), provider: BYOK_PROVIDER } })
}

export interface ResolvedKey {
  apiKey: string
  synthModel: ByokSynthModel
}

/**
 * The key this owner's model calls run on, or null (= house key + the normal
 * meters). `forEmbed` is the host-pays lane: a host's key serves their embed
 * visitors ONLY when they opted in (`useForEmbeds`). Any failure — feature
 * off, no row, a row the current secret cannot open — is null, never a throw.
 */
export async function resolveInferenceKey(owner: string | null | undefined, opts: { forEmbed?: boolean } = {}): Promise<ResolvedKey | null> {
  if (!owner || !byokEnabled()) return null
  try {
    const { default: prisma } = await import('@/lib/db')
    const row = await prisma.inferenceKey.findUnique({ where: { ownerAddress_provider: { ownerAddress: norm(owner), provider: BYOK_PROVIDER } } })
    if (!row) return null
    if (opts.forEmbed && !row.useForEmbeds) return null
    const apiKey = openKey(row)
    // lastUsedAt is a courtesy for the settings page — at most one write per
    // ten minutes per owner, never awaited.
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 10 * 60_000) {
      void prisma.inferenceKey
        .updateMany({ where: { ownerAddress: norm(owner), provider: BYOK_PROVIDER }, data: { lastUsedAt: new Date() } })
        .catch(() => {})
    }
    return { apiKey, synthModel: isByokSynthModel(row.synthModel) ? row.synthModel : 'claude-haiku-4-5' }
  } catch {
    return null
  }
}

/** Remember that the owner's key was refused upstream, so Settings can say
 *  so. The status code only — never the key, never the response body. */
export function noteInferenceKeyFailure(owner: string, status: number): void {
  void (async () => {
    try {
      const { default: prisma } = await import('@/lib/db')
      await prisma.inferenceKey.updateMany({
        where: { ownerAddress: norm(owner), provider: BYOK_PROVIDER },
        data: { lastError: `Anthropic answered ${status} at ${new Date().toISOString()}` },
      })
    } catch {
      /* courtesy write */
    }
  })()
}
