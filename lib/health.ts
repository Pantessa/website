import prisma from '@/lib/db'

/**
 * Endpoint liveness, harvested by the FREE x402 probe harness
 * (scripts/harness-probe.ts → harness_results). This is a HEALTH signal
 * (reachability), kept deliberately separate from reputation (which is earned
 * from real PAID calls + ratings). A green dot here means "answered an x402
 * challenge", not "delivered good data".
 */

export type HealthState = 'live' | 'needs' | 'down'

export interface EndpointHealth {
  method: string
  url: string
  status: string // raw probe status (alive_402_priced, http_4xx, …)
  state: HealthState
  priceUsd: number | null
  latencyMs: number | null
  probedAt: string
}

export interface ServiceHealth {
  live: number
  needs: number
  down: number
  total: number
  probedAt: string | null // most recent probe across the service
  endpoints: EndpointHealth[]
}

function toState(status: string): HealthState {
  if (status.startsWith('alive_')) return 'live' // answered an x402 challenge
  if (status === 'http_4xx') return 'needs' // reachable but needs params/auth
  return 'down' // unreachable / 5xx / timeout
}

type Row = {
  slug: string
  method: string
  url: string
  status: string
  price_usd: number | null
  latency_ms: number | null
  probed_at: Date
}

/**
 * Latest probe per endpoint, grouped by service slug. Returns an empty map if
 * the DB is off or the harness_results table hasn't been created yet — callers
 * render a neutral "—" in that case.
 */
export async function getHealthByService(): Promise<Map<string, ServiceHealth>> {
  const map = new Map<string, ServiceHealth>()
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return map
  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT s.slug AS slug, h.method, h.url, h.status, h.price_usd, h.latency_ms, h.probed_at
      FROM (
        SELECT DISTINCT ON (endpoint_id) endpoint_id, method, url, status, price_usd, latency_ms, probed_at
        FROM harness_results
        ORDER BY endpoint_id, probed_at DESC
      ) h
      JOIN mcp_endpoints e ON e.id = h.endpoint_id
      JOIN mcp_servers s ON s.id = e.server_id
      ORDER BY s.slug, h.status, h.url
    `
    for (const r of rows) {
      const state = toState(r.status)
      let sh = map.get(r.slug)
      if (!sh) {
        sh = { live: 0, needs: 0, down: 0, total: 0, probedAt: null, endpoints: [] }
        map.set(r.slug, sh)
      }
      sh.total++
      sh[state]++
      const probedAt = (r.probed_at instanceof Date ? r.probed_at : new Date(r.probed_at)).toISOString()
      if (!sh.probedAt || probedAt > sh.probedAt) sh.probedAt = probedAt
      sh.endpoints.push({
        method: r.method,
        url: r.url,
        status: r.status,
        state,
        priceUsd: r.price_usd != null ? Number(r.price_usd) : null,
        latencyMs: r.latency_ms != null ? Number(r.latency_ms) : null,
        probedAt,
      })
    }
  } catch {
    // table missing / db unavailable — return what we have (possibly empty)
  }
  return map
}
