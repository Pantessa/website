// lib/inbox.ts — the wallet inbox (M5): flip the arrow.
//
// Today a human ASKS: they type an intent, Pantessa builds it, they sign. The
// inbox lets a human RECEIVE: a sender (an agent via broker_send, or another
// human) addresses an intent TO a wallet or handle, and it lands in that
// wallet's /inbox — one tap opens the same guarded /i runtime, and only the
// recipient's own signature moves anything. Senders bring receivers, which is
// the first viral loop this product has had.
//
// Reuses everything: an addressed intent IS an intent_link with `recipient`
// set (and allowWallets = [recipient] so the /i CTA targets them — the
// signature is still the only real gate). No new signing path, no new runtime.

import prisma from '@/lib/db'
import { cleanAsk, composeMcps, mintSlug, INTENT_SLUG_RE } from '@/lib/intent-links'
import { MANDATE_KIND_LABELS } from '@/lib/roster-client'
import { COUNTED_EVENT_WHERE } from '@/lib/link-receipt-verify'

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/
const HANDLE_RE = /^[a-z0-9-]{2,32}$/

export interface ResolvedRecipient {
  wallet: string
  /** The handle it resolved from, if the sender addressed by handle. */
  handle?: string
}

/** Resolve a recipient given a 0x address or a claimed /l handle. */
export async function resolveRecipient(raw: unknown): Promise<{ ok: true; recipient: ResolvedRecipient } | { ok: false; reason: string }> {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'A recipient (0x wallet or a claimed handle) is required.' }
  const v = raw.trim()
  if (WALLET_RE.test(v)) return { ok: true, recipient: { wallet: v.toLowerCase() } }
  const handle = v.replace(/^@/, '').toLowerCase()
  if (!HANDLE_RE.test(handle)) return { ok: false, reason: `"${v.slice(0, 40)}" is neither a 0x wallet nor a valid handle.` }
  const row = await prisma.creatorHandle.findUnique({ where: { handle }, select: { creator: true } })
  if (!row) return { ok: false, reason: `No wallet is claimed for handle "${handle}".` }
  return { ok: true, recipient: { wallet: row.creator.toLowerCase(), handle } }
}

export interface SentIntent {
  slug: string
  url: string
  inboxUrl: string
  recipient: string
  handle?: string
  ask: string
}

/** Address an intent to a recipient: mint an intent_link with recipient +
 *  allowWallets set. Returns the /i link and the recipient's inbox URL. */
export async function sendIntent(
  site: string,
  opts: { ask: string; recipientRaw: unknown; senderLabel?: string; mcps?: string[]; agent?: string; internal?: boolean; rosterSlotId?: string },
): Promise<SentIntent> {
  const ask = cleanAsk(opts.ask)
  if (!ask || ask.length < 3) throw new Error('The intent must be a plain sentence (amounts included).')
  const r = await resolveRecipient(opts.recipientRaw)
  if (!r.ok) throw new Error(r.reason)
  const recipient = r.recipient.wallet

  const senderLabel = typeof opts.senderLabel === 'string' ? opts.senderLabel.replace(/\s+/g, ' ').trim().slice(0, 60) || null : null
  const mcps = (opts.mcps && opts.mcps.length ? opts.mcps : composeMcps(ask)).join(',') || null
  const agent = typeof opts.agent === 'string' ? opts.agent.trim().slice(0, 40) || null : null

  const slug = mintSlug()
  await prisma.intentLink.create({
    data: {
      id: slug,
      ask,
      variants: [ask],
      mcps,
      creator: null,
      agent,
      recipient,
      senderLabel,
      allowWallets: [recipient],
      // THE ROSTER (R2): a hired agent's proposal binds to its mandate slot
      // (badge on the card, fire-cascade revocation, build re-check).
      rosterSlotId: opts.rosterSlotId ?? null,
      // Our own harness/drill send (lib/internal-run.ts) — never an arrival.
      isInternal: opts.internal === true,
    },
  })

  return {
    slug,
    url: `${site}/i/${slug}`,
    inboxUrl: `${site}/inbox/${recipient}`,
    recipient,
    handle: r.recipient.handle,
    ask,
  }
}

export interface InboxItem {
  slug: string
  ask: string
  senderLabel: string | null
  agent: string | null
  createdAt: Date
  /** THE ROSTER (R2): present when the sender is a HIRED agent proposing
   *  under a mandate slot — the card wears the mandate, not just a byline.
   *  mandate is the CANONICAL grammar-constrained sentence (safe to render). */
  roster?: { slotId: string; kind: string; label: string; mandate: string; capUsd: number }
}

/** The unsigned intents addressed to a wallet — newest first. An item leaves
 *  the inbox once it is signed (server-truth: a 'signed' event on its slug) or
 *  is revoked/expired. */
export async function inboxFor(wallet: string): Promise<InboxItem[]> {
  if (!WALLET_RE.test(wallet)) return []
  const addr = wallet.toLowerCase()
  const links = await prisma.intentLink.findMany({
    where: {
      recipient: addr,
      revoked: false,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, ask: true, senderLabel: true, agent: true, createdAt: true, rosterSlotId: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  if (links.length === 0) return []

  // Drop anything already signed (server truth from the funnel events).
  // Only COUNTED signed events drop a card (receipt verification,
  // 2026-09-01): a spoofed beacon must not silently clear someone's inbox.
  const signed = await prisma.intentLinkEvent.findMany({
    where: { slug: { in: links.map((l) => l.id) }, kind: 'signed', ...COUNTED_EVENT_WHERE },
    select: { slug: true },
  })
  const signedSlugs = new Set(signed.map((s) => s.slug))

  // Slot badges for roster proposals — one query, joined in memory. The
  // MANDATE_KIND_LABELS mirror lives in roster-client (client-safe).
  const slotIds = [...new Set(links.map((l) => l.rosterSlotId).filter((s): s is string => !!s))]
  const slots = slotIds.length
    ? await prisma.rosterSlot
        .findMany({ where: { id: { in: slotIds } }, select: { id: true, mandateText: true, mandateKind: true, capUsd: true } })
        .catch(() => [])
    : []
  const KIND_LABELS: Record<string, string> = MANDATE_KIND_LABELS
  const slotById = new Map(slots.map((s) => [s.id, s]))

  return links
    .filter((l) => !signedSlugs.has(l.id))
    .map((l) => {
      const slot = l.rosterSlotId ? slotById.get(l.rosterSlotId) : undefined
      return {
        slug: l.id,
        ask: l.ask,
        senderLabel: l.senderLabel,
        agent: l.agent,
        createdAt: l.createdAt,
        ...(slot
          ? {
              roster: {
                slotId: slot.id,
                kind: slot.mandateKind,
                label: KIND_LABELS[slot.mandateKind] ?? slot.mandateKind,
                mandate: slot.mandateText.slice(0, 120),
                capUsd: slot.capUsd,
              },
            }
          : {}),
      }
    })
}

/** Pure guard so callers can validate a slug before hitting the DB. */
export function isInboxSlug(slug: string): boolean {
  return INTENT_SLUG_RE.test(slug)
}
