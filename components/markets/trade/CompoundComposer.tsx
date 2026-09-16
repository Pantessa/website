'use client'

// CompoundComposer (MK2/EXEC) — pick 2–4 legs (bridge → buy → stake ·
// deposit → 2x long → guardian stop · fund → buy a stock) and emit ONE
// compound ask joined with ", then" that the jobs compiler turns into a
// single signed job. The leg grammar is lib/symbol-venues composeCompound
// (pure; every emitted compound is pinned to compile to exactly its legs
// plus the settlement waits). The preview lists the steps before anything
// is sent; Send hands the sentence to the page's act door (connect to act —
// the wallet signature is the gate).
//
// The funding leg is per wallet (2026-09-16, the report the route table's
// Fund rows answered: "it shows 'Fund from Base' but the user does not have
// any tokens on base"). The FROM picker here offered Base / Ethereum /
// Arbitrum / Optimism to every visitor and always spent USDC, so a wallet
// with nothing on Base, or only ETH there, could build a job that walled at
// step 1. The connected wallet's legs come from
// GET /api/markets/routes/funding?for=compound (lib/fund-routes): only the
// chains that can fund this job, each spending the token the wallet holds
// there, the first one picked. With no wallet, nothing fundable, or the money
// already where the buy runs, the plan has no fund leg and its step says why.

import { useEffect, useMemo, useState } from 'react'
import type { ChartPair } from '@/lib/charts'
import { useSession } from '@/lib/session'
import {
  FUND_CHECKING_NOTE,
  FUND_CONNECT_NOTE,
  FUND_UNREAD_NOTE,
  SPOT_CHAINS,
  compoundFundDest,
  composeCompound,
  compoundLegKindsFor,
  compoundPresets,
  type CompoundLegKind,
  type FundLegsResponse,
  type FundRoutesState,
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

/** Where the funding leg stands: not asked for, no wallet to read, the read
 *  in flight, or what the read found (lib/fund-routes). */
type FundView = 'off' | 'no-wallet' | 'pending' | FundRoutesState

export default function CompoundComposer({ symbol, pair, onAsk }: { symbol: string; pair: ChartPair; onAsk: (ask: string) => void }) {
  const available = useMemo(() => compoundLegKindsFor(symbol, pair), [symbol, pair])
  const presets = useMemo(() => compoundPresets(symbol, pair), [symbol, pair])
  const [kinds, setKinds] = useState<CompoundLegKind[]>(() => presets[0]?.kinds ?? available.slice(0, 2))
  const [usd, setUsd] = useState<number>(50)
  const [leverage, setLeverage] = useState<number>(1)
  const [originChainId, setOriginChainId] = useState<number | undefined>(undefined)
  const [chainId, setChainId] = useState<number | undefined>(undefined)
  const isStock = pair.source === 'robinhood'

  // The connected wallet's funding legs, keyed by everything they were sized
  // for (wallet · symbol · size · the chain they land on · a buy after them),
  // so a switched wallet or a changed plan never sends another read's leg.
  const { walletAddress } = useSession()
  const fundDest = kinds.includes('fund') ? compoundFundDest(symbol, pair, kinds, chainId) : null
  const fundBuy = isStock || kinds.includes('buy')
  const fundBase = walletAddress && fundDest !== null ? `${walletAddress.toLowerCase()}|${pair.symbol}|${fundDest}|${fundBuy ? 1 : 0}|` : null
  const fundKey = fundBase ? `${fundBase}${usd}` : null
  const [fund, setFund] = useState<{ key: string; body: FundLegsResponse | null } | null>(null)
  const [fundTick, setFundTick] = useState(0)

  useEffect(() => {
    if (!fundKey || !walletAddress || fundDest === null) return
    let alive = true
    const qs = new URLSearchParams({ symbol: pair.symbol, amount: String(usd), address: walletAddress, for: 'compound' })
    if (!isStock) {
      qs.set('chain', String(fundDest))
      qs.set('buy', fundBuy ? '1' : '0')
    }
    fetch(`/api/markets/routes/funding?${qs}`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<FundLegsResponse>) : Promise.reject(new Error(String(res.status)))))
      .then((body) => {
        if (alive) setFund({ key: fundKey, body })
      })
      .catch(() => {
        if (alive) setFund({ key: fundKey, body: null })
      })
    return () => {
      alive = false
    }
  }, [fundKey, fundTick, walletAddress, fundDest, fundBuy, isStock, pair.symbol, usd])

  // Money moves between visits: re-read when the tab comes back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setFundTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const fundBody = fundKey && fund?.key === fundKey ? fund.body : null
  const fundView: FundView = fundDest === null ? 'off' : !walletAddress ? 'no-wallet' : fund?.key !== fundKey ? 'pending' : fundBody ? fundBody.state : 'unread'
  const legs = useMemo(() => fundBody?.legs ?? [], [fundBody])
  // While a new size is read, the same wallet's last chains stay on screen
  // (the picker doesn't blink); the plan never uses them.
  const shownLegs = fundView === 'pending' && fundBase && fund?.key.startsWith(fundBase) ? (fund.body?.legs ?? []) : legs
  const fundLeg = legs.find((l) => l.chainId === originChainId) ?? legs[0] ?? null
  const shownPick = shownLegs.find((l) => l.chainId === originChainId) ?? shownLegs[0] ?? null
  const fundNotes =
    fundView === 'off' ? [] : fundView === 'no-wallet' ? [FUND_CONNECT_NOTE] : fundView === 'pending' ? [FUND_CHECKING_NOTE] : fundBody ? fundBody.notes : [FUND_UNREAD_NOTE]

  const plan = useMemo(() => composeCompound(symbol, pair, kinds, { usd, leverage, chainId, fund: fundLeg }), [symbol, pair, kinds, usd, leverage, chainId, fundLeg])
  const fundInPlan = plan.legs.some((l) => l.kind === 'fund')
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
  const stepNo = { n: 0 }
  // The fund leg the plan left out still gets its row, saying why.
  const fundOff = fundView !== 'off' && !fundInPlan
  const checking = fundView === 'pending'
  const fundOffLabel =
    fundView === 'pending' ? 'Bridge in' : fundView === 'no-wallet' ? 'Bridge in — connect a wallet to pick a chain' : fundView === 'covered' ? 'Bridge in — not needed' : 'Bridge in — left out of the job'

  return (
    <section
      className="mkt-card mkt-compound"
      aria-label={`Chain ${symbol} across dapps`}
      data-legs={plan.legs.length}
      data-steps={plan.expectedSteps}
      data-fund-state={fundView}
    >
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
        {/* FROM lists only the chains THIS wallet can fund the job from. */}
        {shownLegs.length > 0 && (
          <div className="mkt-compound__opt" data-fund-origins={shownLegs.map((l) => l.chainId).join(',')}>
            <span className="mkt-order__k mono">FROM</span>
            <div className="mkt-order__presets" role="group" aria-label="Fund from">
              {shownLegs.map((l) => (
                <button
                  key={l.chainId}
                  type="button"
                  className={`mkt-order__preset ${shownPick?.chainId === l.chainId ? 'is-on' : ''}`}
                  aria-pressed={shownPick?.chainId === l.chainId}
                  data-origin={l.chainId}
                  data-token={l.token}
                  title={`${l.label}: ~$${l.usd} of ${l.token}`}
                  onClick={() => setOriginChainId(l.chainId)}
                >
                  {l.name}
                  {l.token !== 'USDC' ? ` · ${l.token}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {plan.legs.length === 0 && !fundOff ? (
        <p className="mkt-card__note">Pick at least one leg that can follow the others — a Guardian stop needs a long, a stake needs ETH.</p>
      ) : (
        <ol className="mkt-compound__plan" aria-label="Steps">
          {fundOff && (
            <li className="mkt-compound__step mkt-compound__step--off" data-leg="fund" data-fund-state={fundView}>
              <span className="mkt-compound__n mono" aria-hidden="true">
                {checking ? '…' : '–'}
              </span>
              <div>
                <div className="mkt-compound__step-label">{fundOffLabel}</div>
                <ul className="mkt-compound__fundnotes" aria-live="polite">
                  {fundNotes.map((n) => (
                    <li key={n} className="mkt-compound__step-hint">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          )}
          {plan.legs.map((l) => (
            <li
              key={l.kind}
              className="mkt-compound__step"
              data-leg={l.kind}
              data-origin={l.kind === 'fund' ? fundLeg?.chainId : undefined}
              data-token={l.kind === 'fund' ? fundLeg?.token : undefined}
            >
              <span className="mkt-compound__n mono">{++stepNo.n}</span>
              <div>
                <div className="mkt-compound__step-label">{l.label}</div>
                <div className="mkt-compound__step-seg mono">“{l.segment}”</div>
                {/* Every leg that settles names its own wait in its hint. */}
                <div className="mkt-compound__step-hint">{l.hint}</div>
                {l.kind === 'fund' && fundNotes.length > 0 && (
                  <ul className="mkt-compound__fundnotes" aria-live="polite">
                    {fundNotes.map((n) => (
                      <li key={n} className="mkt-compound__step-hint">
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mkt-compound__ask">
        <p className="mkt-compound__sentence" data-ask={plan.ask}>
          {plan.legs.length > 0 ? <>&ldquo;{plan.ask}&rdquo;</> : <span className="mkt-card__note">Nothing to send yet.</span>}
        </p>
        <button type="button" className="mkt-compound__send" disabled={plan.legs.length === 0 || checking} onClick={() => onAsk(plan.ask)}>
          {checking ? 'Checking your balances…' : plan.legs.length > 1 ? `Build the ${plan.expectedSteps}-step job` : 'Send it'}
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
