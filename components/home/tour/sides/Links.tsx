'use client'

// THE TOUR · LINKS — the split, worked out (squad landing, 2026-11-10; lane
// SIDES-A). Three steps in one frame, joined by real arithmetic:
//
//   1. one sentence, with a size the visitor picks (the order ticket's own
//      composer writes it: ./a/mini-market over lib/order-ticket);
//   2. the link it becomes — a SPECIMEN card, tagged EXAMPLE, never a live
//      address and never a link;
//   3. who gets what when readers sign it: the link fee on what they signed
//      and the creator's part of that fee, from the snapshot's fee line
//      (`data.fees`, which is lib/fees read on the server — ./a/split). No
//      rate is typed in this file. With no fee line the step says it in
//      words and draws no number.
//
// What pays and what does not is said plainly under the frame, from
// lib/fees.ts NET_FEE_BPS_BY_BUILD_PATH and /docs/creator-earnings: swaps and
// stock buys carry the link fee; a perp pays from Hyperliquid's builder fee
// only when the order carries one; staking and lending are fee-free paths.
// Minting needs a sign-in (POST /api/intent-links answers 401 without a
// session); opening a link needs only a wallet.

import { useState } from 'react'
import { meta } from '@/lib/home-tour/links'
import { tourJourney } from '@/lib/home-tour'
import { useTour } from '../context'
import { TourPanel } from '../Panel'
import { Seg } from './a/Seg'
import { MINI_SIZES, miniMarkets, miniTicket, splitAtAmount } from './a/mini-market'
import { LINK_DEFAULT_READERS, LINK_READER_CHOICES, fmtRoundUsd, fmtSplitUsd, linkSplit, shareWords } from './a/split'
import './a/kit.css'
import './links.css'

/** The sentence the specimen link carries: a stock buy, the first worked
 *  example on /docs/creator-earnings. */
const STOCK = miniMarkets(['AAPL'])[0]
const DEFAULT_USD = MINI_SIZES[1] ?? MINI_SIZES[0]
const J = (what: string) => tourJourney(meta.id, what)

export default function LinksSide() {
  const { data } = useTour()
  const [usd, setUsd] = useState(DEFAULT_USD)
  const [readers, setReaders] = useState(LINK_DEFAULT_READERS)
  const fees = data.fees
  const ticket = STOCK ? miniTicket(STOCK.pair, 'buy', usd, null) : null
  const ask = ticket?.ok ? ticket.ask : null
  if (!STOCK || !ask) return <TourPanel side={meta} />
  const parts = splitAtAmount(ask, usd)
  const split = fees ? linkSplit({ usd, readers, linkBps: fees.linkBps, creatorSplit: fees.creatorSplit }) : null
  const share = split ? shareWords(split.creatorShare) : 'half'

  return (
    <TourPanel side={meta} demoLabel="How a link pays, worked out">
      <div className="ta tlk" data-tour-mini="links" data-usd={usd} data-readers={readers}>
        <ol className="tlk__steps">
          <li className="tlk__step">
            <span className="tlk__n mono" aria-hidden>
              1
            </span>
            <div className="tlk__body">
              <p className="ta-eyebrow mono">You write one sentence</p>
              <p className="tlk__sentence" aria-live="polite">
                {parts ? (
                  <q>
                    {parts.before}
                    <b className="tlk__amt">{parts.amount}</b>
                    {parts.after}
                  </q>
                ) : (
                  <q>{ask}</q>
                )}
              </p>
              <div className="ta-field">
                <span className="ta-eyebrow mono">Size</span>
                <Seg label="The size the sentence carries, in dollars" value={usd} onChange={setUsd} options={MINI_SIZES.map((n) => ({ value: n, label: `$${n}`, say: `${n} dollars` }))} journey={(n) => J(`size ${n}`)} />
              </div>
            </div>
          </li>

          <li className="tlk__step">
            <span className="tlk__n mono" aria-hidden>
              2
            </span>
            <div className="tlk__body">
              <p className="ta-eyebrow mono">It becomes a link</p>
              <div className="tlk__card" data-specimen>
                <p className="tlk__cardhead">
                  <span className="tlk__url mono">pantessa.com/i/your-link</span>
                  <span className="ta-tag mono">Example</span>
                </p>
                <p className="tlk__cardask">{ask}</p>
                <p className="tlk__cardfoot">Whoever opens it connects their own wallet and signs. You never hold their money.</p>
              </div>
            </div>
          </li>

          <li className="tlk__step">
            <span className="tlk__n mono" aria-hidden>
              3
            </span>
            <div className="tlk__body">
              <p className="ta-eyebrow mono">Every fill pays you</p>
              <div className="ta-field">
                <span className="ta-eyebrow mono">If it is signed by</span>
                <Seg label="Readers who sign it" value={readers} onChange={setReaders} options={LINK_READER_CHOICES.map((n) => ({ value: n, label: n.toLocaleString('en-US'), say: `${n} ${n === 1 ? 'reader' : 'readers'}` }))} journey={(n) => J(`readers ${n}`)} />
                <span className="ta-eyebrow mono">{readers === 1 ? 'reader' : 'readers'}</span>
              </div>
              {split && fees ? (
                <div className="tlk__math" aria-live="polite" data-fee={split.feeUsd} data-creator={split.creatorUsd}>
                  <dl className="tlk__sums">
                    <div className="tlk__sum">
                      <dt>They sign</dt>
                      <dd className="mono">{fmtRoundUsd(split.volumeUsd)}</dd>
                    </div>
                    <div className="tlk__sum">
                      <dt>Link fee, {fees.linkPct}</dt>
                      <dd className="mono">{fmtSplitUsd(split.feeUsd)}</dd>
                    </div>
                    <div className="tlk__sum tlk__sum--you">
                      <dt>Yours, {share}</dt>
                      <dd className="mono">{fmtSplitUsd(split.creatorUsd)}</dd>
                    </div>
                  </dl>
                  <div className="tlk__bar" role="img" aria-label={`The link fee of ${fmtSplitUsd(split.feeUsd)}: ${fmtSplitUsd(split.creatorUsd)} to you, ${fmtSplitUsd(split.houseUsd)} to Pantessa`}>
                    <span className="tlk__part tlk__part--you" style={{ flexGrow: split.creatorShare }} />
                    <span className="tlk__part tlk__part--house" style={{ flexGrow: 1 - split.creatorShare }} />
                  </div>
                  <p className="tlk__legend mono">
                    <span className="tlk__key tlk__key--you">You {fmtSplitUsd(split.creatorUsd)}</span>
                    <span className="tlk__key tlk__key--house">Pantessa {fmtSplitUsd(split.houseUsd)}</span>
                  </p>
                  <p className="ta-note">Your part comes out of Pantessa&rsquo;s fee, never on top of it. On a Uniswap swap with a dollar side it arrives inside the reader&rsquo;s own transaction; anything else waits in your ledger.</p>
                </div>
              ) : (
                <p className="ta-note">Half of the link fee on every fill is yours.</p>
              )}
            </div>
          </li>
        </ol>

        <ul className="tlk__rules" aria-label="Which links pay">
          <li className="tlk__rule tlk__rule--pays">{fees ? `Swaps and stock buys carry the ${fees.linkPct} link fee. ${share === 'half' ? 'Half' : share} is yours.` : 'Swaps and stock buys carry the link fee. Half is yours.'}</li>
          <li className="tlk__rule tlk__rule--pays">A perp pays from Hyperliquid&rsquo;s builder fee, when the order carries one.</li>
          <li className="tlk__rule">Staking and lending carry no fee, so they pay no one.</li>
          <li className="tlk__rule">Minting a link needs a sign-in. Opening one needs only a wallet.</li>
        </ul>
      </div>
    </TourPanel>
  )
}
