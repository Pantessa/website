'use client'

// The call page's share row: the device's share sheet where there is one,
// the post on X (a plain link), and copy-link.

import { useEffect, useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'

export default function CallShareRow({ tweetHref, url, title }: { tweetHref: string; url: string; title?: string }) {
  const [copied, setCopied] = useState(false)
  // The phone's own share sheet (Messages, WhatsApp, Telegram, ...), where the browser has one.
  const [native, setNative] = useState(false)
  useEffect(() => {
    setNative(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])
  return (
    <div className="callpg__share" data-share="row" data-share-surface="c">
      {native && (
        <button
          type="button"
          className="mkt-share__btn"
          onClick={async () => {
            try {
              await navigator.share({ title: title ?? 'A chart call on Pantessa', text: title ? `${title} (time and price stamped)` : undefined, url })
            } catch {
              /* dismissed */
            }
          }}
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
        </button>
      )}
      <a className="mkt-share__btn mkt-share__btn--go" href={tweetHref} target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Post on X
      </a>
      <button
        type="button"
        className="mkt-share__btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
          } catch {
            /* the address bar has it */
          }
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}
