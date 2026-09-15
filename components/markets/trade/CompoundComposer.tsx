'use client'

// CompoundComposer (MK2/EXEC) — pick 2–4 legs (bridge → buy → stake ·
// deposit → 2x long → guardian stop · fund → buy a stock) and emit ONE
// compound ask joined with ", then" that the jobs compiler turns into a
// single signed job. The leg grammar is lib/symbol-venues composeCompound
// (pure; every emitted compound is pinned to compile to exactly its legs
// plus the settlement waits). The preview lists the steps before anything
// is sent; Send hands the sentence to the page's act door (connect to act —
// the wallet signature is the gate).

import { useMemo, useState } from 'react'
import type { ChartPair } from '@/lib/charts'
import {
  SPOT_CHAINS,
  composeCompound,
  compoundLegKindsFor,
  compoundPresets,
  type CompoundLegKind,
} from '@/lib/symbol-venues'
import './trade.css'

const LEG_LABEL: Record<CompoundLegKind, string> = {
  fund: 'Bridge in',
  buy: 'Buy',
  stake: 'Stake on Lido',
  supply: 'Supply on Aave',
  deposit: 'Deposit to HL',
  long: 'Long',
  short: 'Short',
  protect: 'Guardian stop',
}
const AMOUNTS = [25, 50, 100, 250] as const
const LEVS = [1, 2, 3, 5] as const

export default function CompoundComposer({ symbol, pair, onAsk }: { symbol: string; pair: ChartPair; onAsk: (ask: string) => void }) {
  const available = useMemo(() => compoundLegKindsFor(symbol, pair), [symbol, pair])
  const presets = useMemo(() => compoundPresets(symbol, pair), [symbol, pair])
  const [kinds, setKinds] = useState<CompoundLegKind[]>(() => presets[0]?.kinds ?? available.slice(0, 2))
  const [usd, setUsd] = useState<number>(50)
  const [leverage, setLeverage] = useState<number>(1)
  const [originChainId, setOriginChainId] = useState<number | undefined>(undefined)
  const [chainId, setChainId] = useState<number | undefined>(undefined)

  const plan = useMemo(() => composeCompound(symbol, pair, kinds, { usd, leverage, originChainId, chainId }), [symbol, pair, kinds, usd, leverage, originChainId, chainId])
  const toggle = (k: CompoundLegKind) =>
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      // long and short are exclusive
      if (k === 'long') next.delete('short')
      if (k === 'short') next.delete('long')
      return available.filter((x) => next.has(x))
    })

  if (available.length === 0) {
    return (
      <section className="mkt-card mkt-compound" aria-label="Compound ask">
        <header className="mkt-card__head">
          <h2 className="mkt-card__title">Chain it</h2>
        </header>
        <p className="mkt-card__note">No chainable legs for {pair.symbol} yet — the single routes above still send.</p>
      </section>
    )
  }

  const wantsPerp = kinds.includes('long') || kinds.includes('short') || kinds.includes('deposit')
  const wantsChain = kinds.includes('buy') || kinds.includes('fund')
  const isStock = pair.source === 'robinhood'
  const stepNo = { n: 0 }

  return (
    <section className="mkt-card mkt-compound" aria-label={`Chain ${symbol} across dapps`} data-legs={plan.legs.length} data-steps={plan.expectedSteps}>
      <header className="mkt-card__head">
        <div>
          <h2 className="mkt-card__title">Chain it — one signed job</h2>
          <span className="mkt-card__eyebrow mono">PICK LEGS · PREVIEW THE STEPS · SIGN EACH AS IT COMES DUE</span>
        </div>
      </header>

      {presets.length > 0 && (
        <div className="mkt-compound__presets" role="group" aria-label="Ready-made shapes">
          {presets.map((p) => (
            <button key={p.label} type="button" className={`mkt-order__preset ${p.kinds.join() === kinds.join() ? 'is-on' : ''}`} onClick={() => setKinds(p.kinds)}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="mkt-compound__legs" role="group" aria-label="Legs">
        {available.map((k) => (
          <button key={k} type="button" className={`mkt-compound__leg ${kinds.includes(k) ? 'is-on' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => toggle(k)}>
            {LEG_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="mkt-compound__opts">
        <div className="mkt-compound__opt">
          <span className="mkt-order__k mono">SIZE</span>
          <div className="mkt-order__presets">
            {AMOUNTS.map((a) => (
              <button key={a} type="button" className={`mkt-order__preset ${usd === a ? 'is-on' : ''}`} onClick={() => setUsd(a)}>
                ${a}
              </button>
            ))}
          </div>
        </div>
        {wantsPerp && (
          <div className="mkt-compound__opt">
            <span className="mkt-order__k mono">LEV</span>
            <div className="mkt-order__presets">
              {LEVS.map((l) => (
                <button key={l} type="button" className={`mkt-order__preset ${leverage === l ? 'is-on' : ''}`} onClick={() => setLeverage(l)}>
                  {l}x
                </button>
              ))}
            </div>
          </div>
        )}
        {wantsChain && !isStock && (
          <div className="mkt-compound__opt">
            <span className="mkt-order__k mono">ON</span>
            <div className="mkt-order__presets">
              {SPOT_CHAINS.map((c) => (
                <button key={c.id} type="button" className={`mkt-order__preset ${(chainId ?? plan.legs.find((l) => l.kind === 'buy')?.segment.endsWith(c.word)) === c.id || plan.legs.some((l) => l.kind === 'buy' && l.segment.endsWith(`on ${c.word}`)) ? 'is-on' : ''}`} onClick={() => setChainId(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {kinds.includes('fund') && (
          <div className="mkt-compound__opt">
            <span className="mkt-order__k mono">FROM</span>
            <div className="mkt-order__presets">
              {SPOT_CHAINS.filter((c) => isStock || c.id !== (chainId ?? 0)).map((c) => (
                <button key={c.id} type="button" className={`mkt-order__preset ${plan.legs.some((l) => l.kind === 'fund' && l.segment.includes(`from ${c.word}`)) ? 'is-on' : ''}`} onClick={() => setOriginChainId(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {plan.legs.length === 0 ? (
        <p className="mkt-card__note">Pick at least one leg that can follow the others — a Guardian stop needs a long, a stake needs ETH.</p>
      ) : (
        <ol className="mkt-compound__plan" aria-label="Steps">
          {plan.legs.map((l) => (
            <li key={l.kind} className="mkt-compound__step" data-leg={l.kind}>
              <span className="mkt-compound__n mono">{++stepNo.n}</span>
              <div>
                <div className="mkt-compound__step-label">{l.label}</div>
                <div className="mkt-compound__step-seg mono">“{l.segment}”</div>
                <div className="mkt-compound__step-hint">{l.hint}{l.wait ? ' The job waits for settlement before the next step.' : ''}</div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mkt-compound__ask">
        <p className="mkt-compound__sentence" data-ask={plan.ask}>
          {plan.legs.length > 0 ? <>&ldquo;{plan.ask}&rdquo;</> : <span className="mkt-card__note">Nothing to send yet.</span>}
        </p>
        <button type="button" className="mkt-compound__send" disabled={plan.legs.length === 0} onClick={() => onAsk(plan.ask)}>
          {plan.legs.length > 1 ? `Build the ${plan.expectedSteps}-step job` : 'Send it'}
        </button>
        <p className="mkt-card__note">
          {plan.legs.length > 1
            ? 'One job, one card: every step is built fresh when it comes due and your wallet signs each one. Cancel any time before a step is signed.'
            : 'A single leg sends as its own guarded build.'}
        </p>
      </div>
    </section>
  )
}
