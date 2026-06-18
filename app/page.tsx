'use client'

import { useEffect } from 'react'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import Hero from '@/components/Hero'
import ServerDirectory from '@/components/ServerDirectory'
import ActiveServerBar from '@/components/ActiveServerBar'
import Footer from '@/components/Footer'
import StayUpToDate from '@/components/StayUpToDate'

const STATIC_SERVERS: McpServer[] = CATALOG

const STEPS = [
  { n: '01', t: 'Pick your agents', d: 'Browse the directory and add inference and data agents to your runner — one at a time, as many as you need.' },
  { n: '02', t: 'Connect one wallet', d: 'A single USDC wallet on Base funds everything. No per-service keys, no plans, no invoices.' },
  { n: '03', t: 'Agents pay on their own', d: 'Each call settles over x402 — a 402 challenge, an instant micro-payment, a 200 response. Fully autonomous.' },
]

export default function HomePage() {
  // yeetful.com is always the brochure. Signed-in visitors are NOT redirected
  // to the dashboard (Stripe-style) — the nav surfaces a "Dashboard" button
  // instead, so the marketing page stays reachable at the apex.
  const { servers, setServers } = useYeetfulStore()

  useEffect(() => {
    fetch('/api/servers')
      .then((r) => r.json())
      .then((data: McpServer[]) => setServers(data.length > 0 ? data : STATIC_SERVERS))
      .catch(() => setServers(STATIC_SERVERS))
  }, [setServers])

  const displayServers = servers.length > 0 ? servers : STATIC_SERVERS

  return (
    <>
      <main className="x-main x-main--fluid">
        <Hero catalog={displayServers} />

        {/* Directory */}
        <ServerDirectory />

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

        <StayUpToDate />
      </main>

      <Footer />
      <ActiveServerBar />
    </>
  )
}
