'use client'

import { useEffect, useState } from 'react'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import Hero from '@/components/Hero'
import McpServerCard from '@/components/McpServerCard'
import ActiveServerBar from '@/components/ActiveServerBar'
import NetworkPulse from '@/components/NetworkPulse'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import Footer from '@/components/Footer'

const ALL = 'All'
const STATIC_SERVERS: McpServer[] = CATALOG

const STEPS = [
  { n: '01', t: 'Pick your agents', d: 'Browse the directory and add inference and data agents to your runner — one at a time, as many as you need.' },
  { n: '02', t: 'Connect one wallet', d: 'A single USDC wallet on Base funds everything. No per-service keys, no plans, no invoices.' },
  { n: '03', t: 'Agents pay on their own', d: 'Each call settles over x402 — a 402 challenge, an instant micro-payment, a 200 response. Fully autonomous.' },
]

export default function HomePage() {
  const router = useRouter()
  const { address } = useSession()
  const { isConnected } = useAccount()

  // GitHub-style portal entry: a verified SIWE session lands on the
  // dashboard, not the marketing page. ?home=1 is the escape hatch (the
  // nav's Servers tab uses it when signed in). Wallet connection alone
  // never redirects (D4) — and neither does a session alone: an orphaned
  // cookie with no wallet behind it is being auto-signed-out by the
  // session provider, and redirecting first would strand the visitor on
  // the dashboard's connect gate.
  useEffect(() => {
    if (address && isConnected && !new URLSearchParams(window.location.search).has('home')) {
      router.replace('/dashboard')
    }
  }, [address, isConnected, router])

  const { servers, setServers, activeServerIds } = useYeetfulStore()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState(ALL)

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
    const mS = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    const mC = cat === ALL || s.category === cat
    return mS && mC
  })

  return (
    <>
      <main className="x-main x-main--fluid">
        <Hero catalog={displayServers} />

        {/* Directory */}
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

        {/* Explainer */}
        <section className="explain">
          <div className="explain__head">
            <span className="explain__eyebrow mono">HOW THE NEW ECONOMY RUNS</span>
            <h2 className="explain__h2">One wallet. Every agent. They settle the rest.</h2>
          </div>
          <div className="explain__steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <span className="step__n mono">{s.n}</span>
                <h3 className="step__t">{s.t}</h3>
                <p className="step__d">{s.d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
      <ActiveServerBar />
    </>
  )
}
