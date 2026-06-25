'use client'

// The x402 agent directory — search + category filter over the server grid.
// Shared by the marketing home page (under the hero) and the dashboard's
// Servers section (no hero). Self-contained: fetches /api/servers and falls
// back to the static catalog, so it can drop into any shell.

import { useEffect, useState } from 'react'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import McpServerCard from '@/components/McpServerCard'
import NetworkPulse from '@/components/NetworkPulse'

const ALL = 'All'
const STATIC_SERVERS: McpServer[] = CATALOG

export default function ServerDirectory({ initialCategory = ALL }: { initialCategory?: string }) {
  const { servers, setServers, activeServerIds } = useYeetfulStore()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState(initialCategory)
  const [onlyCallable, setOnlyCallable] = useState(false)

  useEffect(() => {
    fetch('/api/servers')
      .then((r) => r.json())
      .then((data: McpServer[]) => setServers(data.length > 0 ? data : STATIC_SERVERS))
      .catch(() => setServers(STATIC_SERVERS))
  }, [setServers])

  const displayServers = servers.length > 0 ? servers : STATIC_SERVERS

  const cats = [ALL, ...Array.from(new Set(displayServers.map((s) => s.category))).sort()]
  const filtered = displayServers.filter((s) => {
    const q = search.toLowerCase().trim()
    const mS =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    const mC = cat === ALL || s.category === cat
    const mCall = !onlyCallable || s.callable || s.autoCallable
    return mS && mC && mCall
  })

  const callableCount = displayServers.filter((s) => s.callable || s.autoCallable).length

  return (
    <div className="dir" id="directory">
      <div className="dir__statbar">
        <div className="dir__stat">
          <span className="dir__statnum mono">{displayServers.length}</span>
          <span className="dir__statlbl">agents available</span>
        </div>
        <span className="dir__sep">/</span>
        <div className="dir__stat">
          <span className="dir__statnum mono">{activeServerIds.length}</span>
          <span className="dir__statlbl">in your runner</span>
        </div>
        <NetworkPulse />
      </div>

      <div className="dir__controls">
        <div className="search">
          <svg className="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search__input"
            type="text"
            placeholder="Search x402 agents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="pills">
          {/* "Callable now" — surface the agents that work the moment you select
              them (wired or planner-auto-callable), so newcomers can try one. */}
          <button
            className={`pill ${onlyCallable ? 'is-on' : ''}`}
            onClick={() => setOnlyCallable((v) => !v)}
            title="Show only agents you can call right now"
          >
            Callable now
            <span className="pill__n mono">{callableCount}</span>
          </button>
          {cats.map((c) => (
            <button key={c} className={`pill ${cat === c ? 'is-on' : ''}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="dir__empty">
          <p>No agents match “{search}”.</p>
        </div>
      ) : (
        <div className="x-grid">
          {filtered.map((s) => (
            <McpServerCard key={s.id} server={s} />
          ))}
        </div>
      )}
    </div>
  )
}
