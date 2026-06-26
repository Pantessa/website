'use client'

// The interactive hero for /switchboard — the live routing animation plus the
// copy column and CTAs (wallet connect / dashboard). Split out as a client
// component so the page itself can stay a SERVER component and export SEO
// metadata + JSON-LD (S1).

import { useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import SwitchboardWeb from '@/components/SwitchboardWeb'
import { EXAMPLE_PROMPTS } from '@/lib/examples'

export default function SwitchboardHero() {
  const router = useRouter()
  const { isConnected } = useAccount()
  const { connectAndSignIn } = useSession()
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
            <span className="heroweb__em">Router</span>
            <br />
            <span className="heroweb__grad">for Paid Agents.</span>
          </h1>
          <p className="heroweb__lede">
            <strong>One key</strong>, every model and data source. Router sends each request —{' '}
            <span className="heroweb__nokey">LLM inference or live data</span> — to the{' '}
            <strong>best-priced MCP under your cap</strong>; your agent pays per call in USDC.
          </p>
          <div className="heroweb__ctas">
            <button
              className="btn btn--solid"
              onClick={() => (isConnected ? router.push('/dashboard') : connectAndSignIn('/dashboard'))}
            >
              {isConnected ? 'Open dashboard' : 'Try a route'}
            </button>
            <Link className="btn btn--ghost" href="/docs">
              Connect an agent
            </Link>
          </div>

          {/* One-tap example asks → open chat prefilled with the prompt + the
              mapped agent toggled (?try + ?q handled in ChatInterface). Turns
              curiosity into a first routed call. */}
          <div className="heroweb__examples">
            <span className="heroweb__examplbl mono">Try</span>
            {EXAMPLE_PROMPTS.map((ex) => (
              <Link
                key={ex.label}
                href={
                  ex.slug
                    ? `/chat?try=${ex.slug}&q=${encodeURIComponent(ex.prompt)}`
                    : `/chat?q=${encodeURIComponent(ex.prompt)}`
                }
                className="heroweb__examplechip"
                title={ex.prompt}
              >
                {ex.label}
              </Link>
            ))}
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
