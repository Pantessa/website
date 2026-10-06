'use client'

// One-tap share for anything receipt-shaped: a settled tx turn, a done job,
// a DCA schedule, a guardian protection. One click mints (or reuses) the
// receipt permalink, copies it, and offers the pre-written X post — the
// aha moment leaves the app as a link that sells it. Owner-only: the server
// re-derives every number from the owned artifact, so this button can never
// publish a claim the chain didn't make.

import { useState } from 'react'
import { Check, Loader2, Share2 } from 'lucide-react'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import ShareActions from '@/components/ShareActions'

interface ShareInfo {
  url: string
  tweetHref: string
  headline?: string
  /** The pre-written post, link excluded (older servers omit it). */
  text?: string
}

export default function ShareReceiptButton({
  kind,
  refId,
  chatId,
  messageId,
  className,
  signInFirst = false,
}: {
  kind: 'tx' | 'job' | 'dca' | 'guardian' | 'spot-guard'
  refId?: string
  chatId?: string
  messageId?: string
  className?: string
  /** A connected wallet that has not signed in yet (the default on /markets,
   *  /t and /i: connect to act, sign in to keep) is offered the sign-in that
   *  makes the receipt mintable, instead of nothing. The caller re-renders
   *  with the real ids once the thread is kept. */
  signInFirst?: boolean
}) {
  const { address, walletAddress, signIn, signingIn } = useSession()
  const [busy, setBusy] = useState(false)
  const [shared, setShared] = useState<ShareInfo | null>(null)
  const [copied, setCopied] = useState(false)

  // No session (embed visitors, signed-out readers) → no share surface;
  // the POST would 401 and the receipt wouldn't be theirs to mint anyway.
  if (!address) {
    if (!signInFirst || !walletAddress) return null
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          void signIn()
        }}
        disabled={signingIn}
        data-share-lane="sign-in"
        className={cn(
          'inline-flex items-center gap-1 text-[10.5px] mono text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors disabled:opacity-60 [@media(hover:none)]:min-h-9',
          className,
        )}
        title="One wallet signature (nothing moves) keeps this chat, and makes its receipt shareable"
      >
        {signingIn ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <Share2 className="w-3 h-3" aria-hidden />}
        {signingIn ? 'waiting for your wallet' : 'sign in to share'}
      </button>
    )
  }

  // Signed in, but the turn's row is still being written: nothing to mint yet.
  if (kind === 'tx' && (!chatId || !messageId)) return null

  const share = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/share/receipts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, refId, chatId, messageId }),
      })
      if (!res.ok) return
      const data = (await res.json()) as ShareInfo
      setShared(data)
      try {
        await navigator.clipboard.writeText(data.url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        /* clipboard blocked — the X link still works */
      }
    } catch {
      /* network miss — the button stays tappable */
    } finally {
      setBusy(false)
    }
  }

  if (shared) {
    // The receipt exists: the phone's share sheet, copy, or the pre-written
    // post, all one tap from here (the link is already on the clipboard).
    return (
      <span className={cn('inline-flex flex-wrap items-center gap-2', className)} onClick={(e) => e.stopPropagation()} data-receipt-shared>
        <span className="inline-flex items-center gap-1 text-[10.5px] mono text-emerald-400">
          <Check className="w-3 h-3" aria-hidden />
          {copied ? 'link copied' : 'receipt ready'}
        </span>
        <ShareActions
          post={{ url: shared.url, title: shared.headline ?? 'A Pantessa receipt', text: shared.text ?? new URL(shared.tweetHref).searchParams.get('text') ?? '' }}
          viaFixed
          surface={`receipt-${kind}`}
        />
      </span>
    )
  }

  return (
    <button
      onClick={(e) => void share(e)}
      disabled={busy}
      className={cn(
        'inline-flex items-center gap-1 text-[10.5px] mono text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors disabled:opacity-60 [@media(hover:none)]:min-h-9',
        className,
      )}
      title="Mint a public receipt link — numbers only, your address truncated, revocable"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <Share2 className="w-3 h-3" aria-hidden />}
      share
    </button>
  )
}
