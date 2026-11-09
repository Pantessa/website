'use client'

// Up / score / down on a post (squad community, lane FEED, 2026-11-09).
// Optimistic: the arrow lights and the score moves on the tap, the server's
// answer (POST /api/posts/[id]/vote → { score, myVote }) replaces both. The
// same arrow again clears the vote.
//
// A vote needs a PROVEN identity (a wallet session, or Telegram's / Discord's
// signature), never a wallet connection and never a signature of its own. A
// stranger's tap comes back 401 { needsIdentity: true }: the tap is undone,
// the vote is HELD, the unified sign-in door opens in place (useIdentityDoor,
// rule 6) and the vote is cast when a session lands. The held vote is also
// written to sessionStorage, so the Google lane's full-page return finds it.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useSession } from '@/lib/session'
import { HELD_VOTE_KEY, fmtScore, heldVoteRecord, nextVote, optimisticScore, takeHeldVote, type Vote } from './feed-rules'
import { useIdentityDoor } from './useIdentityDoor'
import './community.css'

export interface VoteButtonsProps {
  postId: string
  /** null = the list that served this row carries no score (it shows once a vote answers). */
  score: number | null
  myVote?: Vote
  /** 'col' stacks (the feed's left column), 'row' sits in a line (a foot row, a phone). */
  layout?: 'col' | 'row' | 'auto'
  onVoted?: (next: { score: number; myVote: Vote }) => void
}

const clearHeld = () => {
  try {
    window.sessionStorage.removeItem(HELD_VOTE_KEY)
  } catch {
    // storage blocked: nothing was written either
  }
}

export default function VoteButtons({ postId, score: score0, myVote: vote0 = 0, layout = 'auto', onVoted }: VoteButtonsProps) {
  const { address } = useSession()
  const [score, setScore] = useState<number | null>(score0)
  const [vote, setVote] = useState<Vote>(vote0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const { hold, door, waiting } = useIdentityDoor({ onDropped: clearHeld })

  // The list re-read (a new sort, a refresh): the server's row is the truth.
  useEffect(() => {
    setScore(score0)
    setVote(vote0)
  }, [postId, score0, vote0])

  const state = useRef({ score, vote })
  useEffect(() => {
    state.current = { score, vote }
  })

  const cast = useCallback(
    async (to: Vote) => {
      const from = state.current.vote
      const before = state.current.score
      setBusy(true)
      setNote(null)
      setVote(to)
      setScore(before === null ? null : optimisticScore(before, from, to))
      const undo = () => {
        setVote(from)
        setScore(before)
      }
      try {
        const r = await fetch(`/api/posts/${postId}/vote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: to }) })
        const d = (await r.json().catch(() => ({}))) as { score?: number; myVote?: Vote; error?: string; needsIdentity?: boolean }
        if (r.status === 401) {
          undo()
          try {
            window.sessionStorage.setItem(HELD_VOTE_KEY, heldVoteRecord(postId, to, Date.now()))
          } catch {
            // storage blocked: the vote is still held in memory for this page
          }
          hold(() => void cast(to))
          return
        }
        if (!r.ok || typeof d.score !== 'number') {
          undo()
          setNote(typeof d.error === 'string' && d.error.length < 160 ? d.error : 'That vote did not count. Try again in a moment.')
          return
        }
        clearHeld()
        const mine: Vote = d.myVote === 1 || d.myVote === -1 ? d.myVote : 0
        setScore(d.score)
        setVote(mine)
        onVoted?.({ score: d.score, myVote: mine })
      } catch {
        undo()
        setNote('That vote did not count. Try again in a moment.')
      } finally {
        setBusy(false)
      }
    },
    [postId, hold, onVoted],
  )

  // The Google lane reloads the page: a vote held before the redirect is cast
  // once the session is back (fresh for ten minutes, this post only).
  const resumed = useRef(false)
  useEffect(() => {
    if (!address || resumed.current) return
    resumed.current = true
    let raw: string | null = null
    try {
      raw = window.sessionStorage.getItem(HELD_VOTE_KEY)
    } catch {
      return
    }
    const heldVote = takeHeldVote(raw, postId, Date.now())
    if (heldVote === null || waiting) return
    clearHeld()
    void cast(heldVote)
  }, [address, postId, cast, waiting])

  const tap = (dir: 1 | -1) => {
    if (busy) return
    void cast(nextVote(vote, dir))
  }

  return (
    <div className="cmy-vote" data-layout={layout} data-vote={vote} role="group" aria-label="Vote on this post">
      <button type="button" className="cmy-vote__btn cmy-vote__btn--up" aria-pressed={vote === 1} aria-label="Upvote" title="Upvote" disabled={busy} onClick={() => tap(1)} data-journey="Vote up">
        <ChevronUp aria-hidden />
      </button>
      <span className="cmy-vote__score" aria-live="polite" aria-label={score === null ? 'Score not loaded' : `Score ${score}`}>
        {score === null ? '·' : fmtScore(score)}
      </span>
      <button type="button" className="cmy-vote__btn cmy-vote__btn--down" aria-pressed={vote === -1} aria-label="Downvote" title="Downvote" disabled={busy} onClick={() => tap(-1)} data-journey="Vote down">
        <ChevronDown aria-hidden />
      </button>
      {note && (
        <span className="cmy-vote__note" role="status">
          {note}
        </span>
      )}
      {door}
    </div>
  )
}
