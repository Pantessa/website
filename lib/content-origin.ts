// lib/content-origin.ts — the content-origin fence (SECURITY-AUDIT 2026-09-08
// §C / §E5). Pure; safe on client and server.
//
// Everything dangerous in this product is "content authored by a stranger":
// an intent link, an inbox card, a broker handoff, an embed host's injected
// prompt. The native builders are deterministic and guarded, so a stranger's
// sentence can only hurt by naming WHERE value goes — a raw 0x address or an
// ENS name in a send, a token typed as a contract address (a swap into the
// attacker's token is economically a transfer), or an NFT sale priced by
// someone who isn't the seller. This module is the one place that decides:
//
//   1. outboundToThirdParty(ask) — does this sentence route value to an
//      outside party? Computed SERVER-SIDE at mint / send / handoff and
//      stored on the intent_links row (`outbound_third_party`), re-derived at
//      read time for legacy rows and per-visit A/B phrasings, and applied by
//      the /i runtime AND the /embed prompt door: such an ask PREFILLS only —
//      a human presses send. (The verb-list `isTransferShaped` in
//      lib/intent-links stays as the /i belt; this is the braces.)
//   2. contentOriginOf(turn) — where a chat turn's sentence came from. A
//      turn that rides an intent link or an embed host is third-party
//      content; the route hardens a few builds on that origin alone:
//      raw-address token slots refuse by name, an NFT listing far below
//      floor blocks instead of warning.
//   3. recipientLineOf(guardrails) — the strongest disclosure the transfer
//      guard writes ("N USDC LEAVES your wallet to <full address>") had no
//      renderer; the card reads it from here and shows the address IN FULL.
//
// The fence is deliberately over-inclusive: a false positive costs one
// human tap on send; a false negative is a drained wallet.

import type { GuardrailReport } from '@/lib/tx-guardrails'

export const RAW_ADDRESS_RE = /0x[0-9a-fA-F]{40}/
const ENS_RE = /\b[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.eth\b/i
const TRANSFER_VERB_RE = /\b(send|transfer|pay|give|tip|donate|forward)\b/i
const TRANSFER_TARGET_RE = /\bto\s+(him|her|them|me|us|this address|that address|the address|wallet|my friend)\b/i
// An NFT SALE authored by someone else prices the seller's asset: "list",
// "sell" next to an NFT marker (nft / opensea / #id / collection).
const NFT_MARKER_RE = /\b(nfts?|opensea|seaport|collection|#\d{1,7})\b/i
const NFT_SELL_VERB_RE = /\b(sell|list|listing|accept (?:the )?offer)\b/i

export type OutboundReason = 'raw-address' | 'ens-name' | 'transfer-target' | 'nft-sale'

export interface OutboundVerdict {
  outbound: boolean
  reasons: OutboundReason[]
}

/** Does this sentence route value to an outside party? Over-inclusive on
 *  purpose (see the module header). Pure, deterministic, no I/O. */
export function outboundToThirdParty(ask: string): OutboundVerdict {
  const reasons: OutboundReason[] = []
  const a = ask ?? ''
  if (RAW_ADDRESS_RE.test(a)) reasons.push('raw-address')
  if (ENS_RE.test(a)) reasons.push('ens-name')
  if (TRANSFER_VERB_RE.test(a) && (TRANSFER_TARGET_RE.test(a) || /0x[0-9a-fA-F]{6,}/.test(a) || ENS_RE.test(a))) reasons.push('transfer-target')
  if (NFT_SELL_VERB_RE.test(a) && NFT_MARKER_RE.test(a)) reasons.push('nft-sale')
  return { outbound: reasons.length > 0, reasons: [...new Set(reasons)] }
}

/** The one-line reason a visitor reads when a link/inbox/embed ask is held
 *  to prefill. Names the SHAPE, never the address (the composer shows it). */
export function outboundHoldCopy(v: OutboundVerdict): string {
  if (!v.outbound) return ''
  const what = v.reasons.includes('nft-sale')
    ? 'sells one of your NFTs'
    : v.reasons.includes('raw-address') || v.reasons.includes('ens-name')
      ? 'names an outside address'
      : 'moves value to someone else'
  return `This ask ${what}, and it was written by someone other than you — nothing runs until you read it in the composer and press send yourself.`
}

/** Where a chat turn's sentence came from. `link` = an /i runtime turn
 *  (intentLinkSlug rides the body); `embed` = a turn inside a third-party
 *  host page (embedKey and/or embedOrigin ride the body); otherwise the
 *  first-party surfaces (/chat, the dashboard, the harness). Client-asserted,
 *  and that is fine: asserting an origin can only make a turn MORE
 *  restricted, and the fields are set by our own runtime code, never by the
 *  host page (a cross-origin iframe's fetch body is ours). */
export type ContentOrigin = 'link' | 'embed' | 'first-party'

export function contentOriginOf(body: { intentLinkSlug?: unknown; embedKey?: unknown; embedOrigin?: unknown } | null | undefined): ContentOrigin {
  if (!body) return 'first-party'
  if (typeof body.intentLinkSlug === 'string' && body.intentLinkSlug) return 'link'
  if ((typeof body.embedKey === 'string' && body.embedKey) || (typeof body.embedOrigin === 'string' && body.embedOrigin)) return 'embed'
  return 'first-party'
}

export function isThirdPartyOrigin(origin: ContentOrigin): boolean {
  return origin !== 'first-party'
}

/** A swap whose token slot is a raw contract address, arriving from a link
 *  or an embed: refuse by name. A stranger's "swap all my ETH for 0x…" is a
 *  transfer wearing a swap verb — the venue would happily fill it into a
 *  token only the author holds. First-party typing keeps the escape hatch
 *  (a user pasting an address they chose). Returns the refusal copy or null. */
export function rawAddressTokenRefusal(intent: { sellToken?: string; buyToken?: string }, origin: ContentOrigin): string | null {
  if (!isThirdPartyOrigin(origin)) return null
  const raw = [intent.sellToken, intent.buyToken].find((t) => !!t && RAW_ADDRESS_RE.test(t))
  if (!raw) return null
  const where = origin === 'link' ? 'This link' : 'This page'
  return (
    `🚫 ${where} asks for a swap into a token written as a contract address (${raw.slice(0, 6)}…${raw.slice(-4)}) instead of a name. ` +
    'A swap into an unnamed token is how a drained wallet looks from the inside, so Pantessa never builds one from a link or an embedded page. ' +
    'If you meant it, open pantessa.com/chat and type the ask yourself with the token’s name.'
  )
}

/** Third-party-authored NFT listings: a price far under floor is a BLOCK,
 *  not a warning. The seller didn't write the number. Pure — returns the
 *  report with the check re-leveled (and `ok` recomputed) or the same
 *  object when nothing changes. */
export function hardenReportForOrigin<T extends GuardrailReport>(report: T, origin: ContentOrigin): T {
  if (!isThirdPartyOrigin(origin)) return report
  let changed = false
  const checks = report.checks.map((c) => {
    if (c.id === 'floor-sanity' && c.level === 'warn' && !c.ok) {
      changed = true
      return { ...c, level: 'block' as const, note: `${c.note} Priced by someone other than you (an intent link / embedded page), so this listing is refused — list it yourself from pantessa.com/chat if the price is right.` }
    }
    return c
  })
  if (!changed) return report
  return { ...report, checks, ok: checks.every((c) => c.ok || c.level !== 'block') }
}

/** The transfer guard's full-address disclosure, for the sign card. Reads the
 *  `recipient` check's note (lib/transfer-exec) — the only line in the
 *  product that prints the recipient IN FULL. Null when the artifact isn't a
 *  transfer. */
export function recipientLineOf(guardrails: unknown): string | null {
  const checks = (guardrails as { checks?: Array<{ id?: unknown; note?: unknown }> } | null | undefined)?.checks
  if (!Array.isArray(checks)) return null
  const c = checks.find((x) => x && x.id === 'recipient' && typeof x.note === 'string')
  return c ? (c.note as string) : null
}

/** Every WARN-level guardrail note the sign card should print above its
 *  button (§E5 recipient line, §E6 self-signed cap pass, allowance notes…).
 *  The two "not gated" boilerplates stay quiet — they say nothing the user
 *  must read before signing. */
export function guardWarnLines(guardrails: unknown): string[] {
  const checks = (guardrails as { checks?: Array<{ id?: unknown; level?: unknown; note?: unknown }> } | null | undefined)?.checks
  if (!Array.isArray(checks)) return []
  return checks
    .filter((c) => c && c.level === 'warn' && typeof c.note === 'string' && c.note.trim())
    .map((c) => c.note as string)
    .filter((n) => !/^No spend policy on this wallet|^Spend policy is off/.test(n))
}

/** The /embed prompt door: a host-injected `prompt {send:true}` whose text
 *  routes value to an outside party is downgraded to a prefill. */
export function embedInjectionSend(text: string, requestedSend: boolean): boolean {
  if (!requestedSend) return false
  return !outboundToThirdParty(text).outbound
}
