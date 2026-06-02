'use client'

import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import type { McpServer } from '@/lib/store'
import RunnerDemo from '@/components/RunnerDemo'

function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const y = el.getBoundingClientRect().top + window.scrollY - 80
  window.scrollTo({ top: y, behavior: 'smooth' })
}

/** Hero — "manifesto" layout: headline left, live x402 Runner right. */
export default function Hero({ agents, catalog }: { agents: McpServer[]; catalog: McpServer[] }) {
  const { openConnectModal } = useConnectModal()
  const { isConnected } = useAccount()

  return (
    <section className="hero hero--manifesto">
      <div className="hero__left">
        <div className="hero__eyebrow mono">THE x402 STANDARD · PAY-PER-CALL · USDC ON BASE</div>
        <h1 className="hero__h1">
          Stack agents.
          <br />
          Pay <span className="hero__em">per call</span>.
        </h1>
        <p className="hero__sub">
          Pick your x402 agents, connect one wallet, and let them pay for every service they need —
          autonomously, per call, with no API keys and no subscriptions.
        </p>
        <div className="hero__ctas">
          <button className="btn btn--solid" onClick={() => scrollToId('directory')}>
            Browse agents
          </button>
          {!isConnected && (
            <button className="btn btn--ghost" onClick={() => openConnectModal?.()}>
              Connect Wallet
            </button>
          )}
        </div>
      </div>
      <div className="hero__right">
        <RunnerDemo agents={agents} catalog={catalog} />
      </div>
    </section>
  )
}
