'use client'

// Home preview of the agent directory — two rows of MCP cards + a link to the
// full list at /servers. Reuses the directory card; fetches /api/servers and
// falls back to the static catalog. Callable agents lead.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import McpServerCard from '@/components/McpServerCard'
import Reveal from '@/components/Reveal'

const STATIC: McpServer[] = CATALOG
// Render the widest case (5-col × 2 rows); CSS trims to full rows as the grid
// drops columns: 10 (≥1800) → 8 (4-col) → 6 (≤1080, incl. phone).
const PREVIEW = 10

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
  const preview = [...all].sort((a, b) => Number(!!b.callable) - Number(!!a.callable)).slice(0, PREVIEW)
  const cats = ['All', ...Array.from(new Set(all.map((s) => s.category))).sort()]

  return (
    <section className="swsrv">
      <Reveal>
        <div className="swsrv__head">
          <div>
            <span className="swsrv__eyebrow mono">THE AGENTS</span>
            <h2 className="swsrv__h2">Every model and data source. One key.</h2>
          </div>
          <Link href="/servers" className="swmore mono">
            See all {all.length} servers <span className="swmore__arrow">→</span>
          </Link>
        </div>
      </Reveal>
      <Reveal delay={80}>
        <div className="pills swsrv__pills">
          {cats.map((c) => (
            <Link
              key={c}
              href={c === 'All' ? '/servers' : `/servers?category=${encodeURIComponent(c)}`}
              className="pill"
            >
              {c}
            </Link>
          ))}
        </div>
        <div className="x-grid">
          {preview.map((s) => (
            <McpServerCard key={s.id} server={s} />
          ))}
        </div>
      </Reveal>
    </section>
  )
}
