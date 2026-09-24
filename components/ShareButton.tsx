'use client'

import { useEffect, useRef, useState } from 'react'
import { Share2, Check, Copy, Loader2, Globe, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { isDbChatId } from '@/lib/chat-ids'
import { useSession } from '@/lib/session'
import { absoluteUrl } from '@/lib/site-url'
import Sheet from '@/components/mobile/Sheet'
import { usePhonePosture } from '@/components/chat/usePhonePosture'

/**
 * Share control for the chat header. Only shown to the signed-in owner of a
 * persisted chat. Toggles the chat's public flag (PATCH /api/chats/[id]) and
 * surfaces the unguessable /p/<slug> share link to copy.
 *
 * `signInLane` (the ask door on /markets + /t/<sym>, 2026-09-15): those
 * surfaces run on wallet connect alone (rule 6), so the thread is a LOCAL
 * chat with no row to share. A connected-but-not-signed-in wallet with a
 * thread gets the same Share pill; pressing it runs the SIWE round-trip in
 * place (no redirect — the door must stay open), the session's adoption
 * effect promotes the thread into the DB, and the popover opens itself
 * with the link. "Connect to act, sign in to KEEP" — sharing is keeping.
 */
export default function ShareButton({ signInLane = false }: { signInLane?: boolean } = {}) {
  const { address, walletAddress, signIn, signingIn } = useSession()
  const { chats, currentChatId, setChatPublic } = useYeetfulStore()
  const chat = chats.find((c) => c.id === currentChatId)

  const [open, setOpen] = useState(false)
  // A phone gets the ONE Sheet (squad mobile-native, CHAT r2): the public
  // switch and the link as 52px rows, closed by a tap outside, a swipe,
  // Escape or back. (Before: a 288px popover that ran 57px off the left edge
  // at 375, then a fixed panel with a 20px switch and a 14px copy glyph.) At
  // lg+ the anchored popover below is unchanged.
  const phone = usePhonePosture()
  const pillRef = useRef<HTMLButtonElement>(null)
  const openPopover = () => setOpen((o) => !o)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  // Set by the sign-in lane: once the thread is a DB chat under a session,
  // open the popover the person asked for.
  const [openOnceShareable, setOpenOnceShareable] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const shareable = !!address && !!chat && isDbChatId(chat.id)
  useEffect(() => {
    if (openOnceShareable && shareable) {
      setOpenOnceShareable(false)
      setOpen(true)
    }
  }, [openOnceShareable, shareable])

  // Close the popover on outside click (desktop: the Sheet owns a phone's
  // dismissals, and its portal sits outside popRef).
  useEffect(() => {
    if (!open || phone) return
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, phone])

  // Only the signed-in owner of a real (persisted) chat can share it — a
  // local ephemeral chat has no row to flip public (its PATCH would 404).
  if (!shareable) {
    // The sign-in lane: a connected wallet with a thread it hasn't kept yet.
    // No wallet / no thread → nothing (the runtime's own gate leads there).
    const hasThread = !!chat && chat.messages.some((m) => m.role === 'user')
    if (!signInLane || address || !walletAddress || !hasThread) return null
    return (
      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => {
            setOpenOnceShareable(true)
            void signIn()
          }}
          disabled={signingIn}
          title="Sign in to share this chat"
          aria-label="Sign in to share this chat"
          data-share-lane="sign-in"
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 max-lg:min-h-10 max-lg:px-3 rounded-lg border text-[11px] transition-colors disabled:opacity-60',
            'bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)]',
          )}
        >
          {signingIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
          <span className="whitespace-nowrap max-sm:hidden">{signingIn ? 'Signing in…' : 'Share'}</span>
        </button>
      </div>
    )
  }

  const isPublic = !!chat.isPublic
  const shareUrl =
    chat.publicSlug ? absoluteUrl(`/p/${chat.publicSlug}`) : null

  const toggle = async () => {
    setBusy(true)
    await setChatPublic(chat.id, !isPublic)
    setBusy(false)
  }

  const copy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <div className="relative flex-shrink-0" ref={popRef}>
      <button
        ref={pillRef}
        onClick={openPopover}
        title={isPublic ? 'Shared publicly' : 'Share this chat'}
        aria-label={isPublic ? 'Shared publicly' : 'Share this chat'}
        data-sheet-open="share"
        className={cn(
          // Phones: icon-only below sm (the word cost the toolbar's working-set
          // door its last 45px at 375) and a 40px target below lg.
          'flex items-center gap-1.5 px-2.5 py-1 max-lg:min-h-10 max-lg:px-3 rounded-lg border text-[11px] transition-colors',
          isPublic
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15'
            : 'bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)]'
        )}
      >
        {isPublic ? <Globe className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
        <span className="whitespace-nowrap max-sm:hidden">{isPublic ? 'Shared' : 'Share'}</span>
      </button>

      {phone && (
        <Sheet open={open} onClose={() => setOpen(false)} id="share" title="Share this chat">
          <div className="px-4 pb-3" data-share-sheet>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              onClick={toggle}
              disabled={busy}
              className="flex w-full min-h-[56px] items-center gap-3 py-2 text-left disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-[color:var(--fg)]">{isPublic ? 'Public link on' : 'Private chat'}</span>
                <span className="block text-[12.5px] leading-snug text-[color:var(--muted)]">
                  {isPublic ? 'Anyone with the link can view this chat (read-only).' : 'Only you can see it. Turn on a link to share it.'}
                </span>
              </span>
              {busy ? (
                <Loader2 className="w-5 h-5 animate-spin text-[color:var(--muted)]" />
              ) : (
                <span aria-hidden className={cn('relative h-[31px] w-[51px] flex-shrink-0 rounded-full transition-colors', isPublic ? 'bg-emerald-500' : 'bg-[var(--surf-2)] border border-[var(--line)]')}>
                  <span className={cn('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all', isPublic ? 'left-[22px]' : 'left-[2px]')} />
                </span>
              )}
            </button>
            {isPublic && shareUrl ? (
              <div className="mt-2 flex items-center gap-2 border-t border-[var(--line)] pt-3">
                <span className="min-w-0 flex-1 truncate mono text-[12.5px] text-[color:var(--muted)]">{shareUrl.replace(/^https?:\/\//, '')}</span>
                <button type="button" onClick={copy} aria-label="Copy share link" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--line-2)] px-4 text-[13px] font-medium text-[color:var(--fg)]">
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[color:var(--muted-2)]">
                <Lock className="w-3.5 h-3.5" /> Private to your wallet
              </div>
            )}
          </div>
        </Sheet>
      )}
      {open && !phone && (
        <div
          className="absolute right-0 top-full mt-2 w-72 z-20 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] shadow-xl shadow-black/40 p-3 space-y-3"
          data-share-popover
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">
                {isPublic ? 'Public link' : 'Private chat'}
              </p>
              <p className="text-[11px] text-[color:var(--muted-2)] mt-0.5 leading-snug">
                {isPublic
                  ? 'Anyone with the link can view this chat (read-only).'
                  : 'Only you can see this chat. Turn on a share link below.'}
              </p>
            </div>
            <button
              onClick={toggle}
              disabled={busy}
              role="switch"
              aria-checked={isPublic}
              className={cn(
                'mt-0.5 flex-shrink-0 w-9 h-5 rounded-full relative transition-colors disabled:opacity-60',
                isPublic ? 'bg-emerald-500' : 'bg-[var(--surf-2)] border border-[var(--line)]'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                  isPublic ? 'left-[18px]' : 'left-0.5'
                )}
              />
            </button>
          </div>

          {busy && (
            <div className="flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Updating…
            </div>
          )}

          {isPublic && shareUrl && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-black/40 px-2 py-1.5">
              <Globe className="w-3.5 h-3.5 text-[color:var(--muted-2)] flex-shrink-0" />
              <span className="flex-1 text-[11px] text-[color:var(--muted)] truncate mono">
                {shareUrl.replace(/^https?:\/\//, '')}
              </span>
              <button
                onClick={copy}
                className="flex-shrink-0 text-[color:var(--muted)] hover:text-white transition-colors"
                aria-label="Copy share link"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}

          {!isPublic && (
            <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--muted-2)]">
              <Lock className="w-3 h-3" /> Private to your wallet
            </div>
          )}
        </div>
      )}
    </div>
  )
}
