'use client'

// The interactive hero for /switchboard — the live routing animation plus the
// copy column and CTAs (wallet connect / dashboard). Split out as a client
// component so the page itself can stay a SERVER component and export SEO
// metadata + JSON-LD (S1).

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import SwitchboardWeb from '@/components/SwitchboardWeb'
import CreateAccountButton from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'

export default function SwitchboardHero() {
  const router = useRouter()
  const { openConnectModal } = useConnectModal()
  const { isConnected } = useAccount()
  // Wallet state is client-only — mount-gate the CTA swap to stay hydration-safe.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const showCreate = mounted && cdpEnabled && !isConnected
  const proofRoutedRef = useRef<HTMLSpanElement>(null)
  const proofSavedRef = useRef<HTMLSpanElement>(null)

  return (
    <section className="heroweb">
      <SwitchboardWeb proofRoutedRef={proofRoutedRef} proofSavedRef={proofSavedRef} />
      <div className="heroweb__stage">
        <div className="heroweb__copy">
          <div className="heroweb__eyebrow mono">
            MCP routing engine <span>·</span> USDC on Base <span>·</span> <b>x402</b>
          </div>
          <h1 className="heroweb__h1">
            <span className="heroweb__grad">Reason</span>{' '}
            <span className="heroweb__grad heroweb__em">Router</span>
            <br />
            <span className="heroweb__grad">for Paid Agents.</span>
          </h1>
          <p className="heroweb__lede">
            <strong>One key</strong>, every model and data source. Router sends each request —{' '}
            <span className="heroweb__nokey">LLM inference or live data</span> — to the{' '}
            <strong>best-priced MCP under your cap</strong>; your agent pays per call in USDC.
          </p>
          <div className="heroweb__ctas">
            {showCreate && (
              <CreateAccountButton className="btn btn--solid" label="Create an account" />
            )}
            <button
              className={showCreate ? 'btn btn--ghost' : 'btn btn--solid'}
              onClick={() => (isConnected ? router.push('/dashboard') : openConnectModal?.())}
            >
              {isConnected ? 'Open dashboard' : 'Try a route'}
            </button>
            <Link className="btn btn--ghost" href="/docs">
              Connect an agent
            </Link>
          </div>
          <div className="heroweb__proof mono">
            <div className="heroweb__pitem">
              <div className="heroweb__pnum">73</div>
              <div className="heroweb__plbl">routes · 26 callable</div>
            </div>
            <div className="heroweb__psep" />
            <div className="heroweb__pitem">
              <div className="heroweb__pnum">
                <span className="heroweb__pu">$</span>
                <span ref={proofRoutedRef}>0.00</span>
              </div>
              <div className="heroweb__plbl">routed · one key</div>
            </div>
            <div className="heroweb__psep" />
            <div className="heroweb__pitem">
              <div className="heroweb__pnum">
                <span className="heroweb__pu">$</span>
                <span ref={proofSavedRef}>0.000</span>
              </div>
              <div className="heroweb__plbl">saved · cheaper pick</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
