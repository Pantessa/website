'use client'

import Link from 'next/link'
import type { McpServer } from '@/lib/store'
import RunnerDemo from '@/components/RunnerDemo'
import SettlementRail from '@/components/SettlementRail'

function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const y = el.getBoundingClientRect().top + window.scrollY - 80
  window.scrollTo({ top: y, behavior: 'smooth' })
}

/** Hero — "manifesto" layout over the Settlement Rail field: every filament
 * is an agent's API call; the rail is the payment rail; the accent pulse is a
 * settlement. Copy left, live x402 Runner right, real settled-volume meter. */
export default function Hero({ agents, catalog }: { agents: McpServer[]; catalog: McpServer[] }) {
  return (
    <section className="hero hero--manifesto">
      <SettlementRail />
      <div className="hero__left">
        <div className="hero__eyebrow mono">AGENTIC PAYMENTS · USDC ON BASE</div>
        <h1 className="hero__h1">
          Quantum Agent
          <br />
          Expense Accounts.
        </h1>
        <p className="hero__sub">
          Per-call USDC payments for the agents in your stack — budgets, allowlists, receipts. You
          set the terms. They handle the spending.
        </p>
        <div className="hero__ctas">
          <button className="btn btn--solid" onClick={() => scrollToId('directory')}>
            Browse agents
          </button>
          <Link className="btn btn--ghost" href="/activity">
            Watch it live
          </Link>
        </div>
      </div>
      <div className="hero__right">
        <RunnerDemo agents={agents} catalog={catalog} />
      </div>
    </section>
  )
}
