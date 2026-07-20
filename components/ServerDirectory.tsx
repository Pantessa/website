'use client'

// The MCP directory — search + category filter over the server grid.
// FREE-FIRST: the free (non-gated) MCPs are the default view, first-party
// fleet on top; the paid x402 catalog sits behind the flip switch. Shared by
// the marketing home page (under the hero) and the dashboard's Servers
// section (no hero). Self-contained: fetches /api/servers and falls back to
// the static catalog, so it can drop into any shell.

import { useEffect, useState } from 'react'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import { FREE_FLEET_FALLBACK, fleetRank } from '@/lib/free-fleet'
import McpServerCard from '@/components/McpServerCard'
import NetworkPulse from '@/components/NetworkPulse'

const ALL = 'All'
const STATIC_SERVERS: McpServer[] = [...FREE_FLEET_FALLBACK, ...CATALOG]

export default function ServerDirectory({ initialCategory = ALL }: { initialCategory?: string }) {
  const { servers, setServers, activeServerIds } = useYeetfulStore()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState(initialCategory)
  const [onlyCallable, setOnlyCallable] = useState(false)
  // Pricing filter: ON (default) shows the free (non-gated) MCPs — the
  // working set leads; flip OFF for the paid (x402-gated) directory.
  // `gated === false` marks a free row. A ?category= deep link targets the
  // paid catalog (that's where the category breadth lives), so it opens there.
  const [freeOnly, setFreeOnly] = useState(initialCategory === ALL)

  useEffect(() => {
    fetch('/api/servers')
      .then((r) => r.json())
      .then((data: McpServer[]) => setServers(data.length > 0 ? data : STATIC_SERVERS))
      .catch(() => setServers(STATIC_SERVERS))
  }, [setServers])

  const displayServers = servers.length > 0 ? servers : STATIC_SERVERS

  // Pills + counts describe the CURRENT pricing view (free or paid), so the
  // free view doesn't offer paid-only categories that filter to nothing.
  const inView = displayServers.filter((s) => (freeOnly ? s.gated === false : s.gated !== false))
  const cats = [ALL, ...Array.from(new Set(inView.map((s) => s.category))).sort()]
  const filtered = displayServers
    .filter((s) => {
      const q = search.toLowerCase().trim()
      const mS =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      const mC = cat === ALL || s.category === cat
      const mCall = !onlyCallable || s.callable || s.autoCallable
      // Default (free) view shows only non-gated rows; the paid view hides them.
      const mFree = freeOnly ? s.gated === false : s.gated !== false
      return mS && mC && mCall && mFree
    })
    // Free view: the first-party fleet leads, in fleet order (stable sort
    // keeps the API's order for everything else).
    .sort((a, b) => (freeOnly ? fleetRank(a.slug) - fleetRank(b.slug) : 0))

  const callableCount = inView.filter((s) => s.callable || s.autoCallable).length
  const freeCount = displayServers.filter((s) => s.gated === false).length

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
            placeholder="Search MCPs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {/* Free ⇄ Paid flip switch. Default = the free MCPs (the working
            set); flip for the paid (x402-gated) directory. */}
        <button
          role="switch"
          aria-checked={!freeOnly}
          aria-label="Show the paid directory"
          onClick={() => {
            setFreeOnly((v) => !v)
            setCat(ALL) // the views have disjoint category sets
          }}
          title={freeOnly ? 'Showing free MCPs — flip for the paid directory (agents pay per call)' : 'Showing the paid directory — flip back for free MCPs'}
          className="dir__pricing"
        >
          <span className={`dir__pricinglbl ${freeOnly ? 'is-on' : ''}`}>
            Free <span className="pill__n mono">{freeCount}</span>
          </span>
          <span className="dir__pricingtrack" data-on={!freeOnly || undefined}>
            <span className="dir__pricingknob" />
          </span>
          <span className={`dir__pricinglbl ${!freeOnly ? 'is-on' : ''}`}>Paid</span>
        </button>

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
