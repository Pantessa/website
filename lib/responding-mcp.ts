// Which MCP produced a given assistant turn? There's no single field for it,
// so we read it back from the turn's receipts (meta.receipts[]) — each receipt
// carries the server's display `name` and its `endpoint` host. We match that
// back to the client's server catalog so the chat avatar can show the
// responding MCP's brand mark instead of a generic robot. A pure-inference
// turn (no tool call) has no receipts → returns null → caller falls back.

import type { McpServer } from '@/lib/store'
import { getProtocolMark, type Mark } from '@/components/protocol-marks'

interface ReceiptLike {
  name?: string
  endpoint?: string
  ok?: boolean
  slug?: string
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  return url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase() || null
}

/** The receipts recorded for an assistant turn, newest-shape-tolerant. */
export function receiptsOf(meta: unknown): ReceiptLike[] {
  const r = (meta as { receipts?: unknown } | undefined)?.receipts
  return Array.isArray(r) ? (r as ReceiptLike[]) : []
}

/**
 * Resolve the MCP that answered an assistant turn to a catalog server, so the
 * caller can render its brand mark. Prefers a settled call; matches by explicit
 * slug (present on not-approved blocks), then exact display name, then host.
 * Returns null when the turn used no MCP or the server isn't in the catalog.
 */
function resolveReceipt(r: ReceiptLike, servers: McpServer[]): McpServer | null {
  if (r.slug) {
    const s = servers.find((s) => s.slug === r.slug)
    if (s) return s
  }
  if (r.name) {
    const s = servers.find((s) => s.name === r.name)
    if (s) return s
  }
  if (r.endpoint) {
    const host = hostOf(r.endpoint)
    if (host) {
      const s = servers.find((s) => hostOf(s.endpoint) === host)
      if (s) return s
    }
  }
  return null
}

/**
 * Every MCP that took part in an assistant turn, in receipt order (settled
 * calls first), deduped — a multi-MCP turn (swap quote + proposal read) gets
 * its avatars stacked like coins. Inference-engine receipts ("Pantessa ·
 * House") aren't catalog servers, so they drop out naturally. A turn with no
 * resolvable receipts falls back to `fallback` (the active working set): when
 * you're talking TO an agent, its mark shows even on a pure-inference turn.
 */
export function respondingServers(
  meta: unknown,
  servers: McpServer[],
  fallback: McpServer[] = [],
): McpServer[] {
  const receipts = receiptsOf(meta)
  const ordered = [
    ...receipts.filter((r) => r && r.ok !== false && r.name),
    ...receipts.filter((r) => r && r.ok === false && r.name),
  ]
  const out: McpServer[] = []
  for (const r of ordered) {
    const s = resolveReceipt(r, servers)
    if (s && !out.some((o) => o.slug === s.slug)) out.push(s)
  }
  if (out.length > 0) return out
  return fallback
}

/**
 * Catalog-free variant for surfaces without the client store (the server-
 * rendered public share page): resolve a vendored protocol mark straight from
 * the primary receipt's display name. Only the hand-vendored DeFi marks
 * (Uniswap / CoW / Snapshot) resolve; everything else returns null.
 */
export function respondingMark(meta: unknown): Mark | null {
  const receipts = receiptsOf(meta)
  const primary =
    receipts.find((r) => r && r.ok !== false && r.name) ??
    receipts.find((r) => r && r.name)
  return primary?.name ? getProtocolMark(primary.name) : null
}
