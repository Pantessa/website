// ─────────────────────────────────────────────────────────────────────────
//  Server-side resolution of the chat working set.
//
//  The manual chat lane used to take `body.activeServers` — whole McpServer
//  objects, endpoint/callable/protocol/price included — from the CLIENT and
//  call what they said (SECURITY-AUDIT-2026-09-08 §A/§B: a caller could name
//  any URL as a callable inference or data server and the house key would
//  pay its 402; a pending/rejected custom row could be sent as callable).
//  The Auto-Router never trusted the client for this ("prices, endpoints,
//  and callability come from the DB, never from a client payload" —
//  lib/catalog.ts). Now the manual lane doesn't either: the client names
//  slugs, the directory supplies the rows, and only LIVE (approved) rows
//  resolve.
//
//  Direct-traffic exception: on a request that never crossed the platform
//  proxy (no platform-stamped client IP — local dev and the API harness, the
//  same contract lib/turn-limits.ts uses; there is no unstamped path to the
//  origin in prod) an off-directory row is kept as sent, so local mocks and
//  the harness's synthetic services keep working. Every kept row of that
//  kind is traced as such.
// ─────────────────────────────────────────────────────────────────────────

import { loadCatalog } from '@/lib/catalog'
import { clientIpFrom } from '@/lib/turn-limits'
import type { McpServer } from '@/lib/store'

export interface ResolvedActiveServers {
  servers: McpServer[]
  /** Client rows that named no live directory row and were dropped (slug or name). */
  dropped: string[]
  /** Off-directory rows kept verbatim under the direct-traffic exception. */
  keptUnresolved: string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export async function resolveActiveServers(raw: unknown, headers: Headers): Promise<ResolvedActiveServers> {
  const rows = Array.isArray(raw) ? raw.filter(isRecord) : []
  if (rows.length === 0) return { servers: [], dropped: [], keptUnresolved: [] }
  const catalog = await loadCatalog()
  const bySlug = new Map(catalog.map((s) => [s.slug, s]))
  const byId = new Map(catalog.map((s) => [s.id, s]))
  const direct = clientIpFrom(headers) === null
  const servers: McpServer[] = []
  const seen = new Set<string>()
  const dropped: string[] = []
  const keptUnresolved: string[] = []
  for (const r of rows) {
    const slug = typeof r.slug === 'string' ? r.slug : null
    const id = typeof r.id === 'string' ? r.id : null
    const hit = (slug && bySlug.get(slug)) || (id && byId.get(id)) || null
    if (hit) {
      if (seen.has(hit.slug)) continue
      seen.add(hit.slug)
      servers.push(hit)
      continue
    }
    const label = slug || (typeof r.name === 'string' ? r.name : null) || id || '(unnamed)'
    if (direct) {
      if (slug && seen.has(slug)) continue
      if (slug) seen.add(slug)
      servers.push(r as unknown as McpServer)
      keptUnresolved.push(label)
    } else {
      dropped.push(label)
    }
  }
  return { servers, dropped, keptUnresolved }
}
