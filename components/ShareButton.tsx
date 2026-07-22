'use client'

import { useEffect, useRef, useState } from 'react'
import { Share2, Check, Copy, Loader2, Globe, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { isDbChatId } from '@/lib/chat-ids'
import { useSession } from '@/lib/session'

/**
 * Share control for the chat header. Only shown to the signed-in owner of a
 * persisted chat. Toggles the chat's public flag (PATCH /api/chats/[id]) and
 * surfaces the unguessable /p/<slug> share link to copy.
 */
export default function ShareButton() {
  const { address } = useSession()
  const { chats, currentChatId, setChatPublic } = useYeetfulStore()
  const chat = chats.find((c) => c.id === currentChatId)

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Only the signed-in owner of a real (persisted) chat can share it — a
  // local ephemeral chat has no row to flip public (its PATCH would 404).
  if (!address || !chat || !isDbChatId(chat.id)) return null

  const isPublic = !!chat.isPublic
  const shareUrl =
    chat.publicSlug && typeof window !== 'undefined'
      ? `${window.location.origin}/p/${chat.publicSlug}`
      : null

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
        onClick={() => setOpen((o) => !o)}
        title={isPublic ? 'Shared publicly' : 'Share this chat'}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] transition-colors',
          isPublic
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15'
            : 'bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)]'
        )}
      >
        {isPublic ? <Globe className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
        <span className="whitespace-nowrap">{isPublic ? 'Shared' : 'Share'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 z-20 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] shadow-xl shadow-black/40 p-3 space-y-3">
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
