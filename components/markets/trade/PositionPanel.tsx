'use client'

// PositionPanel (MK2/EXEC) — what THIS wallet holds in the symbol across
// venues: spot per chain, the Hyperliquid perp with live PnL, Aave
// supplied/borrowed, Lido stETH, DCA schedules, the Guardian stops — and
// the exits, each a chip that sends a parser's own sentence ("Sell all my
// ETH on Base", "Close my ETH long on Hyperliquid", "Withdraw all my ETH
// from Aave", "pause my ETH dca"…). Reads GET /api/markets/position by
// address (public, read-only — connect-to-act); a reader that didn't answer
// is NAMED, never rendered as zero. `positionSummary` is the header pill.

import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import type { ChartPair } from '@/lib/charts'
import { positionIsEmpty, positionSummary, type SymbolPosition } from '@/lib/symbol-position'
import './trade.css'

export { positionSummary, positionIsEmpty } from '@/lib/symbol-position'
export type { SymbolPosition } from '@/lib/symbol-position'

const POLL_MS = 60_000
const money = (n: number | null | undefined): string => (n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const units = (n: number): string => (n >= 10_000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n >= 10 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(3))
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default function PositionPanel({
  symbol,
  pair,
  address: addressProp,
  onAsk,
}: {
  symbol: string
  pair: ChartPair
  address?: string
  onAsk: (ask: string) => void
}) {
  const { address: connected } = useAccount()
  const address = addressProp ?? connected ?? null
  const [pos, setPos] = useState<SymbolPosition | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (!address) {
      setPos(null)
      setState('idle')
      return
    }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      if (!alive) return
      if (document.visibilityState === 'visible') {
        setState((s) => (s === 'ready' ? s : 'loading'))
        try {
          const res = await fetch(`/api/markets/position?symbol=${encodeURIComponent(pair.symbol)}&address=${address}`, { cache: 'no-store' })
          if (!res.ok) throw new Error(String(res.status))
          const body = (await res.json()) as SymbolPosition
          if (!alive) return
          setPos(body)
          setState('ready')
        } catch {
          if (!alive) return
          setState((s) => (s === 'ready' ? s : 'error'))
        }
      }
      timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [address, pair.symbol])

  const summary = useMemo(() => positionSummary(pos), [pos])
  const empty = positionIsEmpty(pos)

  return (
    <section className="mkt-card mkt-pos" aria-label={`Your ${symbol} position`} data-state={state} data-empty={empty ? '1' : '0'}>
      <header className="mkt-card__head">
        <div>
          <h2 className="mkt-card__title">Your {pair.symbol} across dapps</h2>
          <span className="mkt-card__eyebrow mono">{address ? `${short(address)} · READ-ONLY · ${pos ? 'LIVE' : 'READING'}` : 'CONNECT TO SEE WHAT YOU HOLD'}</span>
        </div>
        {summary && <span className="mkt-pos__pill mono">{summary}</span>}
      </header>

      {!address && <p className="mkt-card__note">No wallet connected. Looking needs none — any chip on this page opens the door, and the position reads the moment a wallet lands.</p>}
      {address && state === 'loading' && !pos && <p className="mkt-card__note mono">Reading {pair.symbol} across Base · Ethereum · Arbitrum · Optimism · Robinhood Chain · Hyperliquid · Aave · Lido…</p>}
      {address && state === 'error' && !pos && <p className="mkt-card__note">The position readers didn’t answer — nothing here is zero, it’s unread. Try again in a moment.</p>}

      {pos && empty && (
        <p className="mkt-card__note">
          Nothing in {pair.symbol} from this wallet yet — no spot, no perp, no Aave, no Lido, no schedule.{pos.failed.length ? ` (${pos.failed.join(', ')} didn’t answer.)` : ''} Every route above starts one.
        </p>
      )}

      {pos && !empty && (
        <div className="mkt-pos__grid">
          {pos.spot.length > 0 && (
            <div className="mkt-pos__block" data-block="spot">
              <div className="mkt-pos__k mono">SPOT</div>
              {pos.spot.map((h) => (
                <div key={`${h.chainId}:${h.symbol}`} className="mkt-pos__row">
                  <span className="mkt-pos__label">
                    {units(h.balance)} {h.symbol} <span className="mkt-pos__sub mono">on {h.chainName}</span>
                  </span>
                  <span className="mkt-pos__val mono">{money(h.valueUsd)}</span>
                </div>
              ))}
            </div>
          )}
          {pos.perp && (
            <div className="mkt-pos__block" data-block="perp">
              <div className="mkt-pos__k mono">HYPERLIQUID PERP</div>
              <div className="mkt-pos__row">
                <span className="mkt-pos__label">
                  {pos.perp.side} {pos.perp.leverage}x · {units(pos.perp.sizeUnits)} {pair.symbol}
                  <span className="mkt-pos__sub mono">
                    entry ${pos.perp.entryPx} · mark {pos.perp.markPx != null ? `$${pos.perp.markPx}` : '—'}
                    {pos.perp.liquidationPx != null ? ` · liq $${pos.perp.liquidationPx}` : ''}
                  </span>
                </span>
                <span className={`mkt-pos__val mono ${pos.perp.pnlUsd >= 0 ? 'is-pos' : 'is-neg'}`}>
                  {pos.perp.pnlUsd >= 0 ? '+' : '−'}
                  {money(Math.abs(pos.perp.pnlUsd))} PnL
                </span>
              </div>
              {pos.guardian.length > 0 && (
                <div className="mkt-pos__row">
                  <span className="mkt-pos__label">
                    Guardian {pos.guardian[0].kind === 'take_profit' ? 'take-profit' : 'stop'}{' '}
                    <span className="mkt-pos__sub mono">
                      {pos.guardian[0].triggerMode === 'price_move_pct' ? `${pos.guardian[0].triggerValue}% move` : `at $${pos.guardian[0].triggerValue}`} · {pos.guardian[0].status}
                    </span>
                  </span>
                  <span className="mkt-pos__val mono">{pos.guardian[0].status === 'active' ? 'watching' : pos.guardian[0].status}</span>
                </div>
              )}
            </div>
          )}
          {pos.lend && (
            <div className="mkt-pos__block" data-block="lend">
              <div className="mkt-pos__k mono">AAVE</div>
              {pos.lend.suppliedUsd != null && (
                <div className="mkt-pos__row">
                  <span className="mkt-pos__label">
                    supplied <span className="mkt-pos__sub mono">{pos.lend.suppliedLabel}</span>
                  </span>
                  <span className="mkt-pos__val mono is-pos">{money(pos.lend.suppliedUsd)}</span>
                </div>
              )}
              {pos.lend.borrowedUsd != null && (
                <div className="mkt-pos__row">
                  <span className="mkt-pos__label">
                    borrowed <span className="mkt-pos__sub mono">{pos.lend.borrowedLabel}{pos.lend.healthFactor != null ? ` · HF ${pos.lend.healthFactor.toFixed(2)}` : ''}</span>
                  </span>
                  <span className="mkt-pos__val mono is-neg">{money(pos.lend.borrowedUsd)}</span>
                </div>
              )}
            </div>
          )}
          {pos.stake && (
            <div className="mkt-pos__block" data-block="stake">
              <div className="mkt-pos__k mono">LIDO</div>
              <div className="mkt-pos__row">
                <span className="mkt-pos__label">
                  {pos.stake.stEth != null ? `${units(pos.stake.stEth)} stETH` : 'staked'}
                  {pos.stake.aprPct != null && <span className="mkt-pos__sub mono">earning ~{pos.stake.aprPct.toFixed(2)}% APR</span>}
                </span>
                <span className="mkt-pos__val mono is-pos">{money(pos.stake.usd)}</span>
              </div>
            </div>
          )}
          {(pos.dca.length > 0 || pos.spotGuard.length > 0) && (
            <div className="mkt-pos__block" data-block="standing">
              <div className="mkt-pos__k mono">STANDING</div>
              {pos.dca.map((d) => (
                <div key={d.id} className="mkt-pos__row">
                  <span className="mkt-pos__label">
                    DCA ${d.buyUsd} {d.cadence} <span className="mkt-pos__sub mono">{d.chainName} · {d.mode === 'auto' ? 'autopilot' : 'you sign each buy'}</span>
                  </span>
                  <span className="mkt-pos__val mono">{d.status}</span>
                </div>
              ))}
              {pos.spotGuard.map((g) => (
                <div key={g.id} className="mkt-pos__row">
                  <span className="mkt-pos__label">
                    Spot stop <span className="mkt-pos__sub mono">{g.amountHuman} {pair.symbol} · {g.triggerMode === 'price_move_pct' ? `−${g.triggerValue}%` : `at $${g.triggerValue}`}</span>
                  </span>
                  <span className="mkt-pos__val mono">{g.status === 'active' ? 'watching' : g.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {pos && pos.exits.length > 0 && (
        <div className="mkt-pos__exits">
          <span className="mkt-pos__k mono">EXITS · ONE CHIP EACH</span>
          <div className="mkt-pos__chips">
            {pos.exits.map((e) => (
              <button key={e.ask} type="button" className={`mkt-exec__chip mkt-exec__chip--${e.tone === 'sell' ? 'sell' : 'neutral'}`} title={e.ask} data-ask={e.ask} onClick={() => onAsk(e.ask)}>
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {pos && pos.failed.length > 0 && !empty && <p className="mkt-routes__foot mono">didn’t answer: {pos.failed.join(' · ')} — shown as unread, not zero</p>}
    </section>
  )
}
