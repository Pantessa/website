'use client'

// THE TOUR · WALLET (squad landing, 2026-11-10; lane SIDES-B).
//
// "Every chain, one window." Three things, top to bottom:
//
//   1. the chains the app acts on, by their own marks (the snapshot's list,
//      or the registry when the snapshot is empty), in the order the wallet
//      page shows them (components/chain-marks CHAIN_MARK_ORDER);
//   2. a CONNECTED wallet sees the real thing, small: its address and its
//      biggest holdings (lib/use-held, the same read the Sell chips and the
//      YOU HOLD pill use; null = still reading, [] = nothing held). A
//      stranger sees one line saying what would be here. No connect button
//      of its own: the panel's door is the unified sign-in door (rule 6);
//   3. how a buy is funded from another chain, as three steps in the funding
//      layer's own terms (./b/funding.ts cites lib/funding-plan), with the
//      origin chains named from the registry. No count of signatures: it
//      depends on the source and the venue.

import { APP_CHAINS, chainById } from '@/lib/chains'
import { byChainMarkOrder, getChainMark } from '@/components/chain-marks'
import { meta } from '@/lib/home-tour/wallet'
import { useSession } from '@/lib/session'
import { useHeld } from '@/lib/use-held'
import { TourPanel } from '../Panel'
import { useTour } from '../context'
import { FUNDING_STEPS, fmtUnits, fmtUsd, listNames, shortAddress, topHoldings, totalUsd } from './b/funding'
import { FUND_FROM_CHAIN_IDS } from './b/rules'
import './b/shared.css'
import './wallet.css'

const MAX_HOLDINGS = 5

interface ChainFace {
  id: number
  key: string
  name: string
}

function faceOf(id: number, name?: string): ChainFace | null {
  const c = chainById(id)
  return c ? { id, key: c.key, name: name ?? c.name } : null
}

function Mark({ chainKey, size = 20 }: { chainKey: string; size?: number }) {
  const M = getChainMark(chainKey)
  return M ? <M size={size} /> : null
}

export default function WalletSide() {
  const { data } = useTour()
  const { walletAddress } = useSession()
  const held = useHeld()

  const chains = (data.chains.length ? data.chains : APP_CHAINS.map((c) => ({ id: c.id, name: c.name })))
    .map((c) => faceOf(c.id, c.name))
    .filter((c): c is ChainFace => c !== null)
    .sort(byChainMarkOrder)
  const origins = FUND_FROM_CHAIN_IDS.map((id) => faceOf(id)).filter((c): c is ChainFace => c !== null)
  const originNames = listNames(origins.map((c) => c.name))

  const top = held ? topHoldings(held, MAX_HOLDINGS) : []
  const total = held ? totalUsd(held) : null

  return (
    <TourPanel side={meta} demoLabel={walletAddress ? 'Your wallet across every chain' : 'Every chain in one window, and how a buy is funded from another chain'}>
      <div className="sb-wl" data-wl={walletAddress ? 'connected' : 'stranger'}>
        {/* ── 1 · the chains ── */}
        <div className="sb-wl__sec">
          <p className="sb-wl__head">
            <span className="sb-tag mono">One window</span>
            <span className="sb-pill mono">{chains.length} chains</span>
          </p>
          <ul className="sb-wl__chains">
            {chains.map((c) => (
              <li key={c.id} className="sb-wl__chain">
                <Mark chainKey={c.key} />
                <span>{c.name}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ── 2 · the wallet itself ── */}
        <div className="sb-wl__sec" data-wl-held={walletAddress ? (held == null ? 'reading' : held.length ? 'held' : 'empty') : 'none'}>
          {walletAddress ? (
            <>
              <p className="sb-wl__head">
                <span className="sb-tag mono">Your wallet</span>
                <span className="sb-pill mono" title={walletAddress}>
                  {shortAddress(walletAddress)}
                </span>
              </p>
              {held == null ? (
                <p className="sb-note">Reading what this wallet holds.</p>
              ) : held.length === 0 ? (
                <p className="sb-note">This wallet holds nothing on these chains yet.</p>
              ) : (
                <>
                  {total != null && (
                    <p className="sb-wl__total">
                      {fmtUsd(total)} <span className="mono">priced, across what it holds here</span>
                    </p>
                  )}
                  <ul className="sb-wl__held">
                    {top.map((h) => (
                      <li key={h.symbol} className="sb-wl__row">
                        <b className="sb-wl__sym">{h.symbol}</b>
                        <span className="sb-wl__units mono">{fmtUnits(h.amount)}</span>
                        <span className="sb-wl__on" aria-label={`on ${h.chains.join(', ')}`}>
                          {h.chainIds.map((id) => {
                            const f = faceOf(id)
                            return f ? <Mark key={id} chainKey={f.key} size={14} /> : null
                          })}
                        </span>
                        <span className="sb-wl__usd mono">{h.valueUsd != null && h.valueUsd > 0 ? fmtUsd(h.valueUsd) : 'not priced'}</span>
                      </li>
                    ))}
                  </ul>
                  {held.length > top.length && <p className="sb-note">And {held.length - top.length} more in the full view.</p>}
                </>
              )}
            </>
          ) : (
            <p className="sb-note">Sign in and this is your own wallet: what it holds on each chain, priced. Your wallet stays the only signer.</p>
          )}
        </div>

        {/* ── 3 · funded from another chain ── */}
        <div className="sb-wl__sec">
          <p className="sb-wl__head">
            <span className="sb-tag mono">When a buy is short</span>
            <span className="sb-wl__from" aria-label={`Funded from ${originNames}`}>
              {origins.map((c) => (
                <Mark key={c.id} chainKey={c.key} size={16} />
              ))}
            </span>
          </p>
          <ol className="sb-wl__steps">
            {FUNDING_STEPS.map((s, i) => (
              <li key={s.id} className="sb-wl__step" data-step={s.id}>
                <span className="sb-wl__n mono" aria-hidden>
                  {i + 1}
                </span>
                <p>
                  <b>{s.title}.</b>{' '}
                  {s.what.replace('{chains}', originNames)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </TourPanel>
  )
}
