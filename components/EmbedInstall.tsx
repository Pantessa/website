'use client'

// THE embed-install surface — one component for every place the app hands out
// the embed code (docs landing, /docs/embed, dashboard EmbedsPanel, the chat
// toolbar's "Embed this chat" popover). The snippet + Claude-prompt STRINGS
// come from lib/embed-snippets; this owns how they're presented and copied.
// As the embed system matures, update here (and the string builders) and every
// surface follows.
//
// `embedKey` is a PUBLIC yfe_ key (publishable — safe in page source);
// omit it and the keyless variant renders. `variant="compact"` is the tight
// popover fit; default "full" is the card used on docs + dashboard.

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { analytics } from '@/lib/analytics'
import { DEFAULT_EMBED_MCPS, embedClaudePrompt, embedSnippet } from '@/lib/embed-snippets'

export default function EmbedInstall({
  embedKey = null,
  mcps = DEFAULT_EMBED_MCPS,
  variant = 'full',
  className,
}: {
  embedKey?: string | null
  mcps?: string[]
  variant?: 'full' | 'compact'
  className?: string
}) {
  const [copied, setCopied] = useState<'prompt' | 'snippet' | null>(null)
  const compact = variant === 'compact'

  const copy = (kind: 'prompt' | 'snippet') => {
    const text = kind === 'prompt' ? embedClaudePrompt(embedKey, mcps) : embedSnippet(embedKey, mcps)
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        analytics.promptCopied(kind === 'prompt' ? 'embed-claude-prompt' : 'embed-snippet')
        setCopied(kind)
        setTimeout(() => setCopied(null), 1600)
      })
      .catch(() => {
        /* clipboard blocked — the snippet <pre> is select-all as a fallback */
      })
  }

  return (
    <div
      className={cn(
        'eminstall min-w-0 rounded-xl border border-[var(--line)] bg-[color:var(--bg)] overflow-hidden',
        className
      )}
    >
      {!compact && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--line)]">
          <span className="mono text-[11px] tracking-wider text-[color:var(--muted-2)]">
            THE INSTALL — FIVE LINES, ANY SITE
          </span>
          <span className="mono text-[11px] text-[color:var(--muted-2)] whitespace-nowrap">
            npm i yeetful
          </span>
        </div>
      )}

      <pre
        className={cn(
          'mono select-all overflow-x-auto text-[color:var(--muted)] leading-relaxed m-0',
          compact ? 'text-[10.5px] px-2.5 py-2 max-h-32 overflow-y-auto' : 'text-[12.5px] px-4 py-3.5'
        )}
      >
        <code>{embedSnippet(embedKey, mcps)}</code>
      </pre>

      <div
        className={cn(
          'flex flex-wrap items-center gap-2 border-t border-[var(--line)]',
          compact ? 'px-2.5 py-2' : 'px-4 py-3'
        )}
      >
        <button
          onClick={() => copy('prompt')}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
            'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15',
            compact ? 'flex-1 px-2.5 py-1.5 text-[11px]' : 'px-3.5 py-2 text-[12.5px]'
          )}
        >
          {copied === 'prompt' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied === 'prompt' ? 'Copied' : 'Copy Claude Code prompt'}
        </button>
        <button
          onClick={() => copy('snippet')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surf-2)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors',
            compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3.5 py-2 text-[12.5px]'
          )}
        >
          {copied === 'snippet' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied === 'snippet' ? 'Copied' : 'Snippet'}
        </button>
      </div>

      {!compact && (
        <p className="px-4 pb-3.5 -mt-0.5 text-[12px] leading-snug text-[color:var(--muted-2)]">
          The Claude prompt is the whole integration — paste it into Claude Code in your app&rsquo;s
          repo and it installs the SDK, mounts the chat, patches your CSP, and verifies.{' '}
          {embedKey ? (
            <>
              Attributed to your key <span className="mono text-[color:var(--accent)]">{embedKey}</span>.
            </>
          ) : (
            <>Works keyless — a publishable key adds usage analytics later.</>
          )}
        </p>
      )}
    </div>
  )
}
