// Server-side data helpers for the public share page (/p/[slug]) and its
// social card (opengraph-image). One place resolves the chat, its jobs
// (money moved), and the MCP set that powered it — so the page header, the
// per-turn avatars, the "Try Pantessa" handoff link, and the OG image all
// tell the same story.

import prisma from '@/lib/db'
import type { McpServer } from '@/lib/store'
import { receiptsOf } from '@/lib/responding-mcp'
import { viaIdOf } from '@/lib/share-receipts'
import type { SharedJob } from '@/components/SharedJobLog'

export async function getSharedChat(slug: string) {
  try {
    const chat = await prisma.chat.findUnique({
      where: { publicSlug: slug },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!chat || !chat.isPublic) return null
    return chat
  } catch {
    return null
  }
}

/** The job a message compiled, when its meta says so. */
export function jobIdOf(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const id = (meta as { jobId?: unknown }).jobId
  return typeof id === 'string' && id ? id : null
}

/** Jobs referenced by this chat's messages — each carries its full persisted
 * step log (artifacts, guard reports, settlement results), so the shared page
 * can show the execution story without any live polling session. */
export async function getJobs(messages: Array<{ meta: unknown }>): Promise<Map<string, SharedJob>> {
  const ids = [...new Set(messages.map((m) => jobIdOf(m.meta)).filter((id): id is string => !!id))]
  if (ids.length === 0) return new Map()
  try {
    const jobs = await prisma.job.findMany({
      where: { id: { in: ids } },
      include: { steps: { orderBy: { seq: 'asc' } } },
    })
    return new Map(jobs.map((j) => [j.id, j]))
  } catch {
    return new Map()
  }
}

/** Signed notional USD across the chat's completed jobs — the number the
 *  share card leads with. */
export function moneyMovedOf(jobs: Map<string, SharedJob>): number {
  return [...jobs.values()]
    .filter((j) => j.status === 'done')
    .reduce((sum, j) => sum + (j.valueUsd ?? 0), 0)
}

type ServerRow = {
  id: string
  slug: string
  name: string
  category: string
  endpoint: string | null
  iconSlug: string | null
  logoUrl: string | null
  color: string | null
  websiteUrl: string | null
}

const SERVER_SELECT = {
  id: true,
  slug: true,
  name: true,
  category: true,
  endpoint: true,
  iconSlug: true,
  logoUrl: true,
  color: true,
  websiteUrl: true,
} as const

// Just enough of the client McpServer shape for BrandIcon + the receipt
// resolver — the share page never needs pricing/wiring fields.
function toServer(r: ServerRow): McpServer {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: '',
    category: r.category,
    websiteUrl: r.websiteUrl,
    color: r.color,
    endpoint: r.endpoint,
    iconSlug: r.iconSlug,
    logoUrl: r.logoUrl,
  }
}

export interface SharedChatServers {
  /** The chat's working set (activeServerIds resolved, order preserved) plus
   *  any servers named by receipts — the catalog the avatar resolver runs
   *  against. */
  catalog: McpServer[]
  /** The working set with internal `yeetful-tool-*` utilities hidden — the
   *  agents worth headlining (header chips, avatar fallback, OG medallions). */
  display: McpServer[]
  /** Deep link that reopens /chat with this chat's full MCP set enabled and
   *  the opening ask prefilled — the "Run this chat yourself" handoff. Falls
   *  back to bare /chat. */
  tryHref: string
}

/** Longest opening ask we'll carry in the handoff URL. Past this it's a paste,
 *  not an ask: the link turns unshareable and ChatWorkspace would cut it at
 *  2000 chars anyway. Drop it rather than prefill half a sentence. */
const TRY_PROMPT_MAX = 400

/**
 * The ask that opened the chat — the first user turn, verbatim. "Run this chat
 * yourself" should land on the same sentence the share page opens with, not an
 * empty composer. ?prompt= only PREFILLS (ChatWorkspace never auto-sends), so a
 * shared link can't fire someone else's money action.
 */
export function firstUserPromptOf(messages: Array<{ role: string; content: string }>): string | null {
  const first = messages.find((m) => m.role === 'user')?.content.trim()
  if (!first || first.length > TRY_PROMPT_MAX) return null
  return first
}

/** How much of the ask fits in the tweet. Fixed copy (~47 chars) + this +
 *  X's 23-char t.co link leaves comfortable headroom under the 280 budget
 *  even with double-weight characters in the ask. */
const TWEET_PROMPT_MAX = 180

/**
 * X share intent for a shared chat. The tweet leads with the chat's own
 * opening ask — the "lazy transaction" the page proves — quoted verbatim so
 * every share carries a runnable example, then tags @yeetful_ai. Unlike the
 * ?prompt= handoff, an over-long ask is truncated here rather than dropped:
 * a tweet with most of the sentence still sells the page.
 */
export function shareTweetHrefOf(slug: string, messages: Array<{ role: string; content: string }>, via?: string): string {
  const raw = messages.find((m) => m.role === 'user')?.content.trim()
  const ask = raw
    ? raw.length > TWEET_PROMPT_MAX
      ? `${raw.slice(0, TWEET_PROMPT_MAX - 1).trimEnd()}…`
      : raw
    : null
  const text = ask
    ? `Lazy transactions are here!\n\n"${ask}" on @yeetful_ai`
    : 'Lazy transactions are here! Watch a real guarded run on @yeetful_ai'
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.yeetful.com'
  // The shared URL carries the sharer's short id so arrivals attribute back
  // to the share (the id is a one-way hash — never the wallet).
  const params = new URLSearchParams({ text, url: `${site}/p/${slug}${via ? `?via=${via}` : ''}` })
  return `https://twitter.com/intent/tweet?${params.toString()}`
}

/**
 * Resolve the MCP set behind a shared chat. `activeServerIds` historically
 * holds ids or slugs, so we match both; receipt display names are included in
 * the lookup so a turn answered by an MCP outside the saved set still gets
 * its mark.
 */
export async function getChatServers(chat: {
  activeServerIds: string[]
  ownerAddress?: string
  messages: Array<{ role: string; content: string; meta: unknown }>
}): Promise<SharedChatServers> {
  const idsOrSlugs = chat.activeServerIds.filter(Boolean)
  const receiptNames = [
    ...new Set(
      chat.messages
        .flatMap((m) => receiptsOf(m.meta))
        .flatMap((r) => [r.name, r.slug])
        .filter((v): v is string => !!v),
    ),
  ]
  let rows: ServerRow[] = []
  try {
    rows = await prisma.mcpServer.findMany({
      where: {
        OR: [
          ...(idsOrSlugs.length ? [{ id: { in: idsOrSlugs } }, { slug: { in: idsOrSlugs } }] : []),
          ...(receiptNames.length ? [{ name: { in: receiptNames } }, { slug: { in: receiptNames } }] : []),
        ],
      },
      select: SERVER_SELECT,
    })
  } catch {
    rows = []
  }
  const byKey = new Map(rows.flatMap((r) => [[r.id, r] as const, [r.slug, r] as const]))
  // Working set first, in saved order; then any receipt-only servers.
  const active = idsOrSlugs
    .map((key) => byKey.get(key))
    .filter((r): r is ServerRow => !!r)
  const extras = rows.filter((r) => !active.some((a) => a.id === r.id))
  const catalog = [...active, ...extras].map(toServer)
  const display = active.filter((r) => !r.slug.startsWith('yeetful-tool-')).map(toServer)
  // Same shape as the landing/onboarding deep links: a bare comma between
  // slugs, the ask percent-encoded. Both read back through URLSearchParams.
  const trySlugs = active.map((r) => r.slug)
  const prompt = firstUserPromptOf(chat.messages)
  const parts = [
    ...(trySlugs.length ? [`mcps=${trySlugs.join(',')}`] : []),
    ...(prompt ? [`prompt=${encodeURIComponent(prompt)}`] : []),
    // Attribution rides the handoff too: whoever runs this chat themselves
    // arrived via the owner's share (via = one-way hash, never the wallet).
    ...(chat.ownerAddress ? [`via=${viaIdOf(chat.ownerAddress)}`] : []),
  ]
  const tryHref = parts.length ? `/chat?${parts.join('&')}` : '/chat'
  return { catalog, display, tryHref }
}
