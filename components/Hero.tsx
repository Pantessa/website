'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import type { McpServer } from '@/lib/store'
import PaymentWeb from '@/components/PaymentWeb'

/** Hero — "Agent Expense Accounts" over the animated payment web: one agent
 * wallet reaching any MCP server per call; emerald beams settle, over-cap
 * beams hit the budget guardrail and bounce back red. Copy column left, live
 * x402-runner HUD bottom-right; the proof row's settled/blocked dollars are
 * driven by the same simulation the network animates. */
export default function Hero({ catalog }: { catalog: McpServer[] }) {
  const router = useRouter()
  const { openConnectModal } = useConnectModal()
  const { isConnected } = useAccount()
  const proofSpentRef = useRef<HTMLSpanElement>(null)
  const proofBlockedRef = useRef<HTMLSpanElement>(null)

  return (
    <section className="heroweb">
      <PaymentWeb proofSpentRef={proofSpentRef} proofBlockedRef={proofBlockedRef} />
      <div className="heroweb__stage">
        <div className="heroweb__copy">
          <div className="heroweb__eyebrow mono">
            Agentic payments <span>·</span> USDC on Base <span>·</span> <b>x402</b>
          </div>
          <h1 className="heroweb__h1">
            <span className="heroweb__grad">Agent </span>
            <span className="heroweb__grad heroweb__em">Expense</span>
            <br />
            <span className="heroweb__dim">Accounts.</span>
          </h1>
          <p className="heroweb__lede">
            A spending account for every agent — fund it in USDC, set hard budgets and allowlists,
            and let it pay <strong>any MCP server</strong> per call,{' '}
            <span className="heroweb__nokey">no API key</span>. Productive agents settle instantly;
            overspenders hit the cap and bounce.
          </p>
          <div className="heroweb__ctas">
            <button
              className="btn btn--solid"
              onClick={() => (isConnected ? router.push('/dashboard') : openConnectModal?.())}
            >
              Try Now
            </button>
            <Link className="btn btn--ghost" href="/developers">
              Connect Agent
            </Link>
          </div>
          <div className="heroweb__proof mono">
            <div className="heroweb__pitem">
              <div className="heroweb__pnum">{catalog.length || 71}</div>
              <div className="heroweb__plbl">servers reachable</div>
            </div>
            <div className="heroweb__psep" />
            <div className="heroweb__pitem">
              <div className="heroweb__pnum">
                <span className="heroweb__pu">$</span>
                <span ref={proofSpentRef}>0.00</span>
              </div>
              <div className="heroweb__plbl">settled · no keys</div>
            </div>
            <div className="heroweb__psep" />
            <div className="heroweb__pitem">
              <div className="heroweb__pnum heroweb__pnum--red">
                $<span ref={proofBlockedRef}>0.00</span>
              </div>
              <div className="heroweb__plbl">over-cap · auto-blocked</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
