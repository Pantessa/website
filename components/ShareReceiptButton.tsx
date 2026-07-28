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

interface ShareInfo {
  url: string
  tweetHref: string
}

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export default function ShareReceiptButton({
  kind,
  refId,
  chatId,
  messageId,
  className,
}: {
  kind: 'tx' | 'job' | 'dca' | 'guardian' | 'spot-guard'
  refId?: string
  chatId?: string
  messageId?: string
  className?: string
}) {
  const { address } = useSession()
  const [busy, setBusy] = useState(false)
  const [shared, setShared] = useState<ShareInfo | null>(null)
  const [copied, setCopied] = useState(false)

  // No session (embed visitors, signed-out readers) → no share surface;
  // the POST would 401 and the receipt wouldn't be theirs to mint anyway.
  if (!address) return null

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
    return (
      <span className={cn('inline-flex items-center gap-2', className)} onClick={(e) => e.stopPropagation()}>
        <span className="inline-flex items-center gap-1 text-[10.5px] mono text-emerald-400">
          <Check className="w-3 h-3" aria-hidden />
          {copied ? 'link copied' : 'link ready'}
        </span>
        <a
          href={shared.tweetHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10.5px] mono text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
          title="Post it — the receipt link and copy are pre-written"
        >
          <XMark />
          post
        </a>
      </span>
    )
  }

  return (
    <button
      onClick={(e) => void share(e)}
      disabled={busy}
      className={cn(
        'inline-flex items-center gap-1 text-[10.5px] mono text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors disabled:opacity-60',
        className,
      )}
      title="Mint a public receipt link — numbers only, your address truncated, revocable"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <Share2 className="w-3 h-3" aria-hidden />}
      share
    </button>
  )
}
