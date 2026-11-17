'use client'

// THE TOUR · COMMUNITY (squad landing, 2026-11-10; lane SIDES-B).
//
// "A call with a receipt." Two states, both honest:
//
//   • the snapshot HAS public posts (data.community.latest, fenced by lane
//     DATA: never an internal or harness row) → up to three real ones, each
//     a link to its own page, with the dollars the chain says moved when the
//     post carries proof;
//   • it has none (today's state) → THE ANATOMY of a trade post: one
//     specimen card, tagged EXAMPLE, whose lines are composed by the real
//     card's own functions (./b/specimen.ts → lib/community/proof-words), and
//     three numbered callouts that say what each part does and does not mean,
//     in the words of app/docs/community "What verified on-chain means".
//
// What the proof line is true of (lib/community/proof.ts header): the
// author's wallet sent the transaction and its balance of a dollar stable or
// ETH changed by that much, net, against another asset. The market and the
// side are the AUTHOR'S TAG. The panel never says "bought" under the mark.
// No Telegram, no Discord: no bot exists on prod.

import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import LandingLink from '@/components/home/LandingLink'
import { fmtProofDollars } from '@/lib/community/proof-words'
import { tourJourney, type TourCommunityPost } from '@/lib/home-tour'
import { meta } from '@/lib/home-tour/community'
import { TourPanel } from '../Panel'
import { useTour } from '../context'
import { fmtAge } from './b/rules'
import { ANATOMY, PROOF_LIMIT, specimenLines } from './b/specimen'
import './b/shared.css'
import './community.css'

const KIND_WORD: Record<TourCommunityPost['kind'], string> = { idea: 'Chart idea', link: 'Link', video: 'Video', trade: 'Trade' }
const MAX_POSTS = 3

export default function CommunitySide() {
  const { data } = useTour()
  const { rooms, postsWeek, latest } = data.community
  const posts = latest.slice(0, MAX_POSTS)
  // A post's age is read after mount: the page is static, the clock is not.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [])

  return (
    <TourPanel side={meta} demoLabel={posts.length ? 'The community’s latest public posts' : 'The anatomy of a trade post with proof'}>
      {posts.length ? (
        <div className="sb-cm" data-cm="posts">
          <p className="sb-cm__head">
            <span className="sb-tag mono">From the feed</span>
            {rooms > 0 && postsWeek > 0 && (
              <span className="sb-pill mono">
                {rooms.toLocaleString('en-US')} rooms · {postsWeek.toLocaleString('en-US')} posts this week
              </span>
            )}
          </p>
          <ul className="sb-cm__posts">
            {posts.map((p) => (
              <li key={p.href}>
                <LandingLink href={p.href} prefetch={false} className="sb-cm__post" data-journey={tourJourney(meta.id, `post ${p.kind}`)}>
                  <span className="sb-cm__postmeta mono">
                    {KIND_WORD[p.kind]}
                    {p.symbol ? ` · ${p.symbol}` : ''}
                    {p.room ? ` · ${p.room}` : ''}
                  </span>
                  <span className="sb-cm__posttitle">{p.kind === 'trade' ? `“${p.title}”` : p.title}</span>
                  {p.movedUsd != null && p.movedUsd > 0 && (
                    <span className="sb-cm__fact">
                      <ShieldCheck aria-hidden />
                      Verified on-chain: this wallet moved {fmtProofDollars(p.movedUsd)}
                    </span>
                  )}
                  <span className="sb-cm__postfoot mono">
                    {p.score.toLocaleString('en-US')} {p.score === 1 ? 'point' : 'points'}
                    {now != null ? ` · ${fmtAge(now - p.at)}` : ''}
                  </span>
                </LandingLink>
              </li>
            ))}
          </ul>
          <p className="sb-note">On a trade post the dollars are read from the chain. The market, the side and the title are the author’s own words.</p>
        </div>
      ) : (
        <Anatomy />
      )}
    </TourPanel>
  )
}

/** One specimen trade post, taken apart. */
function Anatomy() {
  const lines = specimenLines()
  return (
    <div className="sb-cm" data-cm="anatomy">
      <p className="sb-cm__head">
        <span className="sb-tag mono">A trade post, taken apart</span>
        <span className="sb-example mono" data-example>
          Example
        </span>
      </p>
      <div className="sb-cm__card" role="group" aria-label="An example trade post">
        <p className="sb-cm__cardmeta mono">
          <span>Trade</span>
          <span className="sb-cm__room">
            <i className="sb-cm__n" aria-hidden>
              3
            </i>
            {lines.room}
          </span>
        </p>
        <p className="sb-cm__fact sb-cm__fact--box">
          <i className="sb-cm__n" aria-hidden>
            1
          </i>
          <ShieldCheck aria-hidden />
          <span>{lines.fact}</span>
        </p>
        <div className="sb-cm__words">
          <i className="sb-cm__n" aria-hidden>
            2
          </i>
          <p>
            {lines.tag && <span className="sb-cm__tagline">{lines.tag}</span>}
            {lines.said && <span className="sb-cm__said">{lines.said}</span>}
          </p>
        </div>
      </div>
      <ol className="sb-cm__legend">
        {ANATOMY.map((a, i) => (
          <li key={a.id} className="sb-cm__part" data-part={a.id}>
            <i className="sb-cm__n" aria-hidden>
              {i + 1}
            </i>
            <p>
              <b>{a.name}.</b>{' '}
              {a.what}
            </p>
          </li>
        ))}
      </ol>
      <p className="sb-note">{PROOF_LIMIT}</p>
    </div>
  )
}
