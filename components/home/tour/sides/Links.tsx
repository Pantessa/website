'use client'

// THE TOUR · LINKS — the split, worked out (squad landing, 2026-11-10; lane
// SIDES-A). Three steps in one frame, joined by real arithmetic:
//
//   1. one sentence, with a size the visitor picks: a swap with a dollar
//      side on Base (./a/mini-market linkSwapAsk — a Uniswap swap, where the
//      link fee and the creator's half inside the reader's own transaction
//      are certain; round 3: a stock buy could settle through the fallback
//      venue at the ordinary fee, which the calculator did not say);
//   2. the link it becomes — a SPECIMEN card, tagged EXAMPLE, never a live
//      address and never a link;
//   3. who gets what when readers sign it: the link fee on what they signed
//      and the creator's part of that fee, from the snapshot's fee line
//      (`data.fees`, which is lib/fees read on the server — ./a/split). No
//      rate is typed in this file. With no fee line the step says it in
//      words and draws no number.
//
// What pays and what does not is said once, in the words beside the frame
// (lib/home-tour/links.ts facts, from lib/fees.ts NET_FEE_BPS_BY_BUILD_PATH
// and /docs/creator-earnings: swaps and stock buys carry the link fee;
// staking and lending are fee-free paths; minting needs a sign-in — POST
// /api/intent-links answers 401 without a session). The frame itself is the
// three steps and nothing else (round 2: it stood 800px tall with a rules
// list that repeated the facts and a card that repeated the body).

import { useState } from 'react'
import { meta } from '@/lib/home-tour/links'
import { tourJourney } from '@/lib/home-tour'
import { useTour } from '../context'
import { TourPanel } from '../Panel'
import { Seg } from './a/Seg'
import { MINI_SIZES, linkSwapAsk, splitAtAmount } from './a/mini-market'
import { LINK_DEFAULT_READERS, LINK_READER_CHOICES, fmtRoundUsd, fmtSplitUsd, linkSplit, shareWords } from './a/split'
import './a/kit.css'
import './links.css'

const DEFAULT_USD = MINI_SIZES[1] ?? MINI_SIZES[0]
const J = (what: string) => tourJourney(meta.id, what)

export default function LinksSide() {
  const { data } = useTour()
  const [usd, setUsd] = useState(DEFAULT_USD)
  const [readers, setReaders] = useState(LINK_DEFAULT_READERS)
  const fees = data.fees
  // The sentence the specimen link carries: a swap with a dollar side (./a/mini-market).
  const ask = linkSwapAsk(usd)
  const parts = splitAtAmount(ask, usd)
  const split = fees ? linkSplit({ usd, readers, linkBps: fees.linkBps, creatorSplit: fees.creatorSplit }) : null
  const share = split ? shareWords(split.creatorShare) : ''

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
                <Seg label="The size the sentence carries, in dollars" value={usd} onChange={setUsd} options={MINI_SIZES.map((n) => ({ value: n, label: `$${n}` }))} journey={(n) => J(`size ${n}`)} />
              </div>
            </div>
          </li>

          <li className="tlk__step">
            <span className="tlk__n mono" aria-hidden>
              2
            </span>
            <div className="tlk__body">
              <p className="tlk__lab">
                <span className="ta-eyebrow mono">It becomes a link</span>
                <span className="ta-tag mono">Example</span>
              </p>
              <p className="tlk__card" data-specimen>
                <span className="tlk__url mono">pantessa.com/i/your-link</span>
                <span className="tlk__cardask">{ask}</span>
              </p>
            </div>
          </li>

          <li className="tlk__step">
            <span className="tlk__n mono" aria-hidden>
              3
            </span>
            <div className="tlk__body">
              <p className="ta-eyebrow mono">A swap pays you</p>
              <div className="ta-field">
                <span className="ta-eyebrow mono">Readers who sign it</span>
                <Seg label="Readers who sign it" value={readers} onChange={setReaders} options={LINK_READER_CHOICES.map((n) => ({ value: n, label: n.toLocaleString('en-US'), say: `${n.toLocaleString('en-US')} ${n === 1 ? 'reader' : 'readers'}` }))} journey={(n) => J(`readers ${n}`)} />
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
                  <p className="ta-note">It comes out of Pantessa&rsquo;s fee, never on top of it. On a Uniswap swap with a dollar side it lands inside the reader&rsquo;s own transaction; otherwise it waits in your ledger.</p>
                </div>
              ) : (
                <p className="ta-note">Half of the link fee on a swap through it is yours.</p>
              )}
            </div>
          </li>
        </ol>

      </div>
    </TourPanel>
  )
}
