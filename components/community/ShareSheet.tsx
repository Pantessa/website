'use client'
// Lane FEED owns this file. Props are the squad contract: one share surface
// for a post or a room — X, Telegram, copy for Discord, the phone's own share.
//
// A button that opens a small popover (a bottom sheet on a phone):
//   · Post on X      the intent URL; text + link fit X's weighted 280 (a
//                    link counts 23), our name once inside the sentence
//   · Telegram       t.me/share/url, the link first so Telegram draws its card
//   · Copy link      the label says where it pastes (Discord, anywhere)
//   · Share…         the phone's own sheet, where the browser has one
// The text is plain ASCII (feed-rules asciiLine). A link to one of our pages
// carries the sharer's id (`?via=`): for a ROOM that is the member's own
// invite code, read from GET /api/communities/[slug] when they are a member,
// so a join that follows the link is credited to them; for a post it is the
// one-way wallet id every other share on the site carries (lib/share-posts).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Send, Share2 } from 'lucide-react'
import Sheet, { SHEET_ROW } from '@/components/mobile/Sheet'
import { PHONE_MQ } from '@/lib/phone-shell'
import { viaIdOfBrowser, withVia } from '@/lib/share-posts'
import { useSession } from '@/lib/session'
import { asciiLine, roomInviteUrl, roomSlugOfUrl, shareUrl, telegramShareHref, xShareHref } from './feed-rules'
import './community.css'

export interface ShareSheetProps {
  /** Absolute or in-app URL of the thing shared (the sheet makes it absolute). */
  url: string
  /** One plain-ASCII line that reads on its own in a chat. */
  text: string
  /** What is being shared, for the journey label. */
  what: 'post' | 'room' | 'invite'
  /** Button label; default "Share". */
  label?: string
}

const XGlyph = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

export default function ShareSheet({ url, text, what, label = 'Share' }: ShareSheetProps) {
  const { walletAddress } = useSession()
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(false)
  const [native, setNative] = useState(false)
  const [copied, setCopied] = useState(false)
  // The link as shared: absolute at once, the sharer's id added when it is known.
  const [link, setLink] = useState(() => shareUrl(url))
  const wrapRef = useRef<HTMLSpanElement>(null)
  const line = asciiLine(text)

  useEffect(() => {
    setLink(shareUrl(url))
  }, [url])

  // The sharer's id, resolved when the sheet opens (never on render: 25 cards
  // on a page would be 25 reads).
  useEffect(() => {
    if (!open) return
    let alive = true
    const base = shareUrl(url)
    const room = what === 'post' ? null : roomSlugOfUrl(url)
    if (room) {
      fetch(`/api/communities/${room}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { me?: { invite?: { code?: string } } | null } | null) => {
          const code = d?.me?.invite?.code
          if (alive && code) setLink(roomInviteUrl(room, code))
        })
        .catch(() => {
          // not a member, or the room is not answering: the plain room link stands
        })
    } else if (what === 'post' && walletAddress) {
      void viaIdOfBrowser(walletAddress).then((via) => {
        if (alive) setLink(withVia(base, via))
      })
    }
    return () => {
      alive = false
    }
  }, [open, url, what, walletAddress])

  const toggle = () => {
    if (!open) {
      setPhone(typeof window.matchMedia === 'function' && window.matchMedia(PHONE_MQ).matches)
      setNative(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
      setCopied(false)
    }
    setOpen((o) => !o)
  }
  const close = useCallback(() => setOpen(false), [])

  // The desktop popover closes on a click outside it and on Escape (the phone
  // sheet has its own: scrim, swipe, back).
  useEffect(() => {
    if (!open || phone) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, phone, close])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // the field below shows the link to copy by hand
    }
  }
  const shareNative = async () => {
    try {
      await navigator.share({ text: line, url: link })
      close()
    } catch {
      // dismissed
    }
  }

  const row = phone ? SHEET_ROW : 'cmy-share__row'
  const items = (
    <div className="cmy-share__list" role="menu" aria-label={`Share this ${what === 'post' ? 'post' : 'room'}`}>
      <a className={row} role="menuitem" href={xShareHref(line, link)} target="_blank" rel="noopener noreferrer" onClick={close} data-share="x" data-journey={`Share ${what} on X`}>
        <XGlyph />
        <span className="min-w-0">
          <span className="cmy-share__t">Post on X</span>
        </span>
      </a>
      <a className={row} role="menuitem" href={telegramShareHref(line, link)} target="_blank" rel="noopener noreferrer" onClick={close} data-share="telegram" data-journey={`Share ${what} on Telegram`}>
        <Send width={14} height={14} aria-hidden />
        <span className="min-w-0">
          <span className="cmy-share__t">Send on Telegram</span>
        </span>
      </a>
      <button type="button" className={row} role="menuitem" onClick={() => void copy()} data-share="copy" data-journey={`Copy ${what} link`}>
        {copied ? <Check width={14} height={14} aria-hidden /> : <Copy width={14} height={14} aria-hidden />}
        <span className="min-w-0">
          <span className="cmy-share__t">{copied ? 'Copied' : 'Copy link'}</span>
          <span className="cmy-share__s">Pastes into Discord and anywhere else</span>
        </span>
      </button>
      {native && (
        <button type="button" className={row} role="menuitem" onClick={() => void shareNative()} data-share="native" data-journey={`Share ${what} from the phone`}>
          <Share2 width={14} height={14} aria-hidden />
          <span className="min-w-0">
            <span className="cmy-share__t">More apps</span>
            <span className="cmy-share__s">Your phone&apos;s own share sheet</span>
          </span>
        </button>
      )}
      <input className="cmy-share__url" readOnly value={link} aria-label="The link" onFocus={(e) => e.currentTarget.select()} />
    </div>
  )

  return (
    <span className="cmy-share" ref={wrapRef} data-share-what={what}>
      <button type="button" className="cmy-share__btn" aria-haspopup={phone ? 'dialog' : 'menu'} aria-expanded={open} onClick={toggle} data-sheet-open="share" data-journey={`Open share ${what}`}>
        <Share2 width={13} height={13} aria-hidden /> {label}
      </button>
      {open && !phone && <div className="cmy-share__pop">{items}</div>}
      {/* Mounted only once a phone opened it: a feed holds 25 of these. */}
      {phone && (
        <Sheet id="share" open={open} onClose={close} title={what === 'post' ? 'Share this post' : 'Share this room'} size="auto" journey={`Share ${what}`}>
          <div className="p-2 pb-3">{items}</div>
        </Sheet>
      )}
    </span>
  )
}
