'use client'

// Share anything — the one share control for public pages.
//
// Three ways out, the same everywhere:
//   · Share      the device's own sheet (Messages, WhatsApp, Telegram, X, …)
//                wherever the browser has one. On a phone this is the whole
//                job in one tap.
//   · Copy link  everywhere.
//   · Post on X  the pre-written post from lib/share-posts (the account comes
//                from lib/social; the link goes last so the card draws).
//
// The link carries the sharer's `via` id when a wallet is connected: a
// one-way hash of the address (the same id the server mints in
// lib/share-receipts viaIdOf), never the address itself.
//
// `row` lays the three out side by side (a page's share row); `pill` is one
// button for a crowded header: it opens the sheet where there is one, and a
// two-item menu where there is not.

import { useEffect, useRef, useState } from 'react'
import { Check, Link2, Share2 } from 'lucide-react'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import { postHref, viaIdOfBrowser, withVia, type SharePost } from '@/lib/share-posts'

function XMark() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

/** The connected wallet's share id (null until known, or with no wallet). */
export function useShareVia(): string | null {
  const { address, walletAddress } = useSession()
  const wallet = address ?? walletAddress ?? null
  const [via, setVia] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!wallet) {
      setVia(null)
      return
    }
    void viaIdOfBrowser(wallet).then((v) => {
      if (alive) setVia(v)
    })
    return () => {
      alive = false
    }
  }, [wallet])
  return via
}

const BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surf-1)] px-3.5 min-h-9 [@media(hover:none)]:min-h-11 text-[12.5px] font-semibold text-[color:var(--fg)] whitespace-nowrap transition-colors hover:border-[var(--line-2)] hover:bg-[var(--surf-2)]'
const BTN_LEAD = 'border-transparent bg-[var(--accent)] text-black hover:bg-[var(--accent)] hover:opacity-90'

export interface ShareActionsProps {
  post: SharePost
  variant?: 'row' | 'pill'
  /** The pill's word (default "Share"). */
  label?: string
  /** Make the first action the filled one (a page whose point is the share). */
  lead?: boolean
  /** The server already put the sharer's id on the link (owner-derived). */
  viaFixed?: boolean
  /** Where the share was pressed, for the journey log. */
  surface?: string
  className?: string
}

export default function ShareActions({ post, variant = 'row', label = 'Share', lead = false, viaFixed = false, surface, className }: ShareActionsProps) {
  const liveVia = useShareVia()
  const via = viaFixed ? null : liveVia
  const url = withVia(post.url, via)
  const [native, setNative] = useState(false)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setNative(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked: the address bar has it */
    }
  }

  const share = async () => {
    try {
      await navigator.share({ title: post.title, text: post.text, url })
    } catch (e) {
      // Dismissed is not a failure; anything else falls back to the copy.
      if ((e as { name?: string })?.name !== 'AbortError') void copy()
    }
  }

  const xHref = postHref(post, via)
  const data = { 'data-share': variant, ...(surface ? { 'data-share-surface': surface } : {}) }

  if (variant === 'pill') {
    return (
      <div ref={wrap} className={cn('relative inline-flex', className)} {...data}>
        <button
          type="button"
          className={cn(BTN, lead && BTN_LEAD)}
          aria-haspopup={native ? undefined : 'menu'}
          aria-expanded={native ? undefined : open}
          aria-label={`${label}: ${post.title}`}
          onClick={() => (native ? void share() : setOpen((o) => !o))}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Share2 className="h-3.5 w-3.5" aria-hidden />}
          <span>{copied ? 'Link copied' : label}</span>
        </button>
        {/* Always in the markup (hidden until opened) where there is no share
            sheet: the post's link is in the server HTML, for a reader with no
            script and for the pins that look for it. */}
        {!native && (
          <div role="menu" hidden={!open} className="absolute right-0 top-full z-30 mt-2 min-w-[168px] flex-col gap-1 rounded-xl [&:not([hidden])]:flex border border-[var(--line)] bg-[var(--surf-1)] p-1.5 shadow-xl shadow-black/30">
            <button
              type="button"
              role="menuitem"
              className="flex min-h-9 [@media(hover:none)]:min-h-11 items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] text-[color:var(--fg)] hover:bg-[var(--surf-2)]"
              onClick={() => {
                void copy()
                setOpen(false)
              }}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden /> Copy link
            </button>
            <a role="menuitem" href={xHref} target="_blank" rel="noopener noreferrer" className="flex min-h-9 [@media(hover:none)]:min-h-11 items-center gap-2 rounded-lg px-2.5 text-[12.5px] text-[color:var(--fg)] hover:bg-[var(--surf-2)]" onClick={() => setOpen(false)}>
              <XMark /> Post on X
            </a>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} {...data}>
      {native && (
        <button type="button" className={cn(BTN, lead && BTN_LEAD)} onClick={() => void share()} aria-label={`Share: ${post.title}`}>
          <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
        </button>
      )}
      <button type="button" className={cn(BTN, lead && !native && BTN_LEAD)} onClick={() => void copy()}>
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />} {copied ? 'Copied' : 'Copy link'}
      </button>
      <a className={BTN} href={xHref} target="_blank" rel="noopener noreferrer">
        <XMark /> Post on X
      </a>
    </div>
  )
}
