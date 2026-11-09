'use client'

// YOUR INVITE LINK — shown the moment a visitor is a member (squad community,
// lane GROUP). This is where the room asks for the share, so it is one tap:
// Copy, Telegram, X, or the phone's own share sheet. The reason is plain and
// true: a join that carried the link is counted next to the member's name on
// the board. It does not pay. The money rule is the one the product already
// has (a link a member mints pays that member the creator share), and the
// panel says exactly that and promises nothing new.

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Send, Share2 } from 'lucide-react'
import { BOARD_LIMIT, useRoom } from './Room'
import { inviteLine, inviteRank, inviteUrl, ordinal, telegramShareHref, xShareHref } from './room-logic'

export default function InvitePanel() {
  const { slug, room, me, boards, loadBoard, focused } = useRoom()
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const [canShare, setCanShare] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setOrigin(window.location.origin)
    setCanShare(typeof navigator.share === 'function')
  }, [])

  const uses = me?.invite.uses ?? 0
  // Where the member stands is read off the public board, and only once
  // there is a place to report.
  useEffect(() => {
    if (uses > 0) loadBoard('invites')
  }, [uses, loadBoard])

  if (!room || !me) return null
  const url = inviteUrl(slug, me.invite, origin)
  const text = inviteLine(room.name)
  const board = boards.invites
  const rank = Array.isArray(board) ? inviteRank(uses, board, BOARD_LIMIT) : null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // No clipboard permission: select the field so a manual copy is one keystroke.
      fieldRef.current?.select()
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  const share = () => {
    void navigator.share({ title: room.name, text, url }).catch(() => undefined)
  }

  return (
    <section id="room-invite" className={`grp-invite${focused === 'invite' ? ' is-focused' : ''}`} aria-labelledby="room-invite-h" data-invite-panel>
      <div className="grp-invite__head">
        <h2 id="room-invite-h" className="grp-card__title">
          Your invite link
        </h2>
        <p className="grp-invite__count" data-invite-uses={uses}>
          {uses > 0 ? (
            <>
              You brought <strong>{uses.toLocaleString('en-US')}</strong>
              {rank && (rank.capped ? `. Outside the top ${BOARD_LIMIT} so far.` : `. ${ordinal(rank.place)} in this room.`)}
            </>
          ) : (
            'You have not brought anyone yet.'
          )}
        </p>
      </div>
      <div className="grp-invite__row">
        <input ref={fieldRef} className="grp-invite__url" readOnly value={url} aria-label="Your invite link" onFocus={(e) => e.currentTarget.select()} data-invite-url />
        <button type="button" className="grp-btn grp-btn--accent" onClick={copy} data-journey="Room: copy invite link" data-invite-copy>
          {copied ? <Check width={14} height={14} aria-hidden /> : <Copy width={14} height={14} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a className="grp-btn" href={telegramShareHref(url, text)} target="_blank" rel="noopener noreferrer" data-journey="Room: share invite to Telegram" data-share="telegram">
          <Send width={14} height={14} aria-hidden />
          Telegram
        </a>
        <a className="grp-btn" href={xShareHref(url, text)} target="_blank" rel="noopener noreferrer" data-journey="Room: share invite to X" data-share="x">
          <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden fill="currentColor">
            <path d="M18.9 2H22l-7.3 8.3L23 22h-6.8l-5.3-6.9L4.8 22H1.7l7.8-8.9L0 2h7l4.8 6.3L18.9 2zm-1.2 18h1.9L6.4 3.9H4.4L17.7 20z" />
          </svg>
          Post
        </a>
        {canShare && (
          <button type="button" className="grp-btn" onClick={share} data-journey="Room: share invite" data-share="native">
            <Share2 width={14} height={14} aria-hidden />
            More
          </button>
        )}
      </div>
      <p className="grp-invite__why">
        Anyone who opens this link joins {room.name} in one tap, and the join is counted next to your name on the board. Invites are not paid. A link you mint in a post still pays you the creator share when someone trades through it.
      </p>
    </section>
  )
}
