'use client'

// Home working-set section — the first-party FREE fleet (uniswap-free,
// snapshot-free, cow-free, hyperliquid-free) plus a bring-your-own tile.
// Fetches /api/servers for the live rows (reputation, autoCallable) and
// falls back to the static fleet; the paid x402 catalog stays on /servers
// behind the directory link.

import { useEffect } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import { FREE_FLEET_SLUGS, FREE_FLEET_FALLBACK } from '@/lib/free-fleet'
import McpServerCard from '@/components/McpServerCard'

// Static fallback: the free fleet leads, the x402 catalog follows — so the
// store never regresses to a paid-only list when /api/servers is down.
const STATIC: McpServer[] = [...FREE_FLEET_FALLBACK, ...CATALOG]

export default function SwitchboardServers() {
  const { servers, setServers } = useYeetfulStore()

  useEffect(() => {
    if (servers.length > 0) return
    fetch('/api/servers')
      .then((r) => r.json())
      .then((data: McpServer[]) => setServers(data.length > 0 ? data : STATIC))
      .catch(() => setServers(STATIC))
  }, [servers.length, setServers])

  const all = servers.length > 0 ? servers : STATIC
  const bySlug = new Map(all.map((s) => [s.slug, s]))
  // The canonical fleet, in order — per-slug fallback so a missing DB row
  // still renders a card.
  const fleet = FREE_FLEET_SLUGS.map(
    (slug) => bySlug.get(slug) ?? FREE_FLEET_FALLBACK.find((f) => f.slug === slug)!,
  )

  return (
    <section className="swsrv">
      <div className="swsrv__head">
        <div>
          <span className="swsrv__eyebrow mono">THE WORKING SET</span>
          <h2 className="swsrv__h2">Start from MCPs that <span className="x-grad">already work.</span></h2>
        </div>
        <Link href="/servers" className="swsrv__all mono">
          Browse the full directory →
        </Link>
      </div>
      <p className="swsrv__sub">
        Our free first-party fleet — swaps, governance, MEV-protected orders, live positions —
        is non-gated, rate-limited, and proven in the live chat. Select a couple, ask for a swap
        or a vote, then bring your own MCP alongside.
      </p>
      <div className="x-grid">
        {fleet.map((s) => (
          <McpServerCard key={s.slug} server={s} />
        ))}
        <Link href="/servers/add" className="card card--byo">
          <div className="card__top">
            <div className="card__id">
              <div className="card__tile">
                <Plus width={20} height={20} strokeWidth={2} />
              </div>
              <div className="card__name">
                <h3>Your MCP</h3>
                <span className="card__cat mono">BRING YOUR OWN</span>
              </div>
            </div>
          </div>
          <p className="card__desc">
            Paste a URL — we discover the tools, grade routability, and your MCP joins the set
            right next to ours.
          </p>
          <div className="card__foot">
            <span className="card__more mono">Add your MCP →</span>
          </div>
        </Link>
      </div>
    </section>
  )
}
