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
export function respondingServer(meta: unknown, servers: McpServer[]): McpServer | null {
  const receipts = receiptsOf(meta)
  if (receipts.length === 0) return null
  const primary =
    receipts.find((r) => r && r.ok !== false && r.name) ??
    receipts.find((r) => r && r.name)
  if (!primary) return null

  if (primary.slug) {
    const s = servers.find((s) => s.slug === primary.slug)
    if (s) return s
  }
  if (primary.name) {
    const s = servers.find((s) => s.name === primary.name)
    if (s) return s
  }
  if (primary.endpoint) {
    const host = hostOf(primary.endpoint)
    if (host) {
      const s = servers.find((s) => hostOf(s.endpoint) === host)
      if (s) return s
    }
  }
  return null
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
