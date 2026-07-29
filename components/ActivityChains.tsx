'use client'

// CHAINS BUILT — the thing that makes Yeetful different, finally visible.
// Almost nothing worth asking for is one transaction, so the system compiles
// multi-step chains: bridge → wait for settlement → buy; set leverage → open →
// arm the stop. Each row here is one real chain, drawn as its steps: a signing
// step, a settlement wait, an autonomous arm, in order, with what happened to
// each.
//
// PRIVACY: the API sends builder + kind + status + notional per step and
// nothing else — no job title, no wallet, no params, no artifact. Every label
// on screen is derived from the builder, so nothing a user typed can reach
// this component by construction. A chain shows its SHAPE; that's the point.

import { getProtocolMark } from '@/components/protocol-marks'
import { timeAgo } from '@/lib/dashboard-ui'

export interface ChainStep {
  kind: string
  status: string
  builder: string
  venue: string | null
  usd: number | null
}
export interface BuiltChain {
  status: string
  usd: number
  at: string
  steps: ChainStep[]
}

/** builder → what that step DOES, in the product's own words. */
const STEP_LABEL: Record<string, string> = {
  wait: 'wait for settlement',
  'native-cross-chain': 'bridge',
  'native-lifi-fund': 'fund across chains',
  'native-lifi-swap': 'stock swap',
  'native-swap': 'swap',
  'native-swap-uniswap': 'swap',
  'native-swap-cow': 'CoW order',
  'native-transfer': 'send',
  'native-lido': 'stake',
  'native-aave': 'Aave position',
  'native-aave-supply': 'Aave supply',
  'native-hl-exec': 'open position',
  'native-hl-guardian': 'arm the stop',
  'native-nft-transfer': 'send NFT',
  'native-nft-list': 'list NFT',
}

const KIND_TITLE: Record<string, string> = {
  sign: 'your wallet signs this step',
  wait: 'the runner waits for settlement',
  auto: 'runs under consent you already gave',
}

/** The three kinds are genuinely different promises — you sign, the runner
 *  waits, or a key you already granted acts — so each gets its own mark.
 *  Inline SVG rather than ✍/⏳/⚙: those render as colour emoji on most
 *  platforms, and a tan hand at 9px is a smudge, not a glyph. */
function KindMark({ kind }: { kind: string }) {
  return (
    <svg viewBox="0 0 12 12" className="chn__kindsvg" aria-hidden>
      {kind === 'sign' && <path d="M2 9.5 L7.4 3.2 M6.2 2 L9.4 5.2 M2 9.5 L4.2 8.8" />}
      {kind === 'wait' && (
        <>
          <circle cx="6" cy="6" r="4.2" />
          <path d="M6 3.4 V6 L7.8 7.2" />
        </>
      )}
      {kind === 'auto' && (
        <>
          <circle cx="6" cy="6" r="2" />
          <path d="M6 1.2 V2.6 M6 9.4 V10.8 M1.2 6 H2.6 M9.4 6 H10.8 M2.6 2.6 L3.6 3.6 M8.4 8.4 L9.4 9.4 M9.4 2.6 L8.4 3.6 M3.6 8.4 L2.6 9.4" />
        </>
      )}
    </svg>
  )
}

/** Job status → how the row reads. `waiting_signature` is the interesting one:
 *  a chain that is BUILT and sitting there is the product working, not a
 *  failure — the signature is the user's move, not ours. */
const CHAIN_STATE: Record<string, { label: string; cls: string }> = {
  done: { label: 'completed', cls: 'is-done' },
  waiting_signature: { label: 'awaiting signature', cls: 'is-wait' },
  waiting_settlement: { label: 'settling', cls: 'is-wait' },
  running: { label: 'running', cls: 'is-wait' },
  paused: { label: 'paused', cls: 'is-idle' },
  canceled: { label: 'canceled', cls: 'is-idle' },
  failed: { label: 'stopped', cls: 'is-fail' },
}

const fmtUsd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)

function StepMark({ venue }: { venue: string | null }) {
  const Mark = venue ? getProtocolMark(venue === 'near-intents' ? 'near' : venue) : null
  if (!Mark) return null
  return (
    <span className="chn__mark">
      <Mark size={13} />
    </span>
  )
}

export default function ActivityChains({ chains }: { chains: BuiltChain[] }) {
  if (!chains.length) {
    return (
      <p className="text-[13px] text-[color:var(--muted-2)] py-4">
        No multi-step chains yet — the first compiled job lights this up.
      </p>
    )
  }
  return (
    <div className="chn">
      {chains.map((c, i) => {
        const state = CHAIN_STATE[c.status] ?? { label: c.status, cls: 'is-idle' }
        const doneSteps = c.steps.filter((s) => s.status === 'done').length
        return (
          <div className={`chn__row ${state.cls}`} key={i}>
            <div className="chn__meta">
              <span className="chn__state mono">{state.label}</span>
              <span className="chn__count mono">
                {doneSteps}/{c.steps.length} steps
              </span>
            </div>

            <ol className="chn__steps">
              {c.steps.map((s, j) => (
                <li className={`chn__step is-${s.status}`} key={j}>
                  <span className="chn__node" title={KIND_TITLE[s.kind] ?? s.kind}>
                    <StepMark venue={s.venue} />
                    <b className="chn__kind" aria-hidden>
                      <KindMark kind={s.kind} />
                    </b>
                  </span>
                  <span className="chn__label">{STEP_LABEL[s.builder] ?? s.builder.replace(/^native-/, '')}</span>
                  {s.usd != null && s.usd > 0 && <span className="chn__usd mono">{fmtUsd(s.usd)}</span>}
                </li>
              ))}
            </ol>

            <div className="chn__tail">
              {c.usd > 0 && <span className="chn__total mono">{fmtUsd(c.usd)}</span>}
              <span className="chn__age mono">{timeAgo(c.at)}</span>
            </div>
          </div>
        )
      })}
      <p className="chn__legend mono">
        <span className="chn__leg">
          <b className="chn__kind"><KindMark kind="sign" /></b> your wallet signs
        </span>
        <span className="chn__leg">
          <b className="chn__kind"><KindMark kind="wait" /></b> the runner waits for settlement
        </span>
        <span className="chn__leg">
          <b className="chn__kind"><KindMark kind="auto" /></b> runs under consent already given
        </span>
        <span className="chn__legnote">shape only — never the ask</span>
      </p>
    </div>
  )
}
