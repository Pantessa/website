'use client'

// A styled, copyable code block — used for the Claude Code onboarding prompts.
// The text is passed as a prop from a server component so it stays in the SSR
// HTML (crawlable) and this stays a thin client shell.
//
// The <pre> carries its OWN baseline styling (border / surface / radius /
// padding) so it reads as a real code block anywhere — including the dashboard,
// where there's no ancestor prose/splash CSS to dress it. On the docs pages the
// higher-specificity `.docs__prose pre` / `.splash__path pre` rules still win,
// so those surfaces look exactly as before.
//
// Pass `maxHeightClassName` (e.g. "max-h-56") to cap the height and scroll a
// long prompt inside the block instead of letting it run down the page.

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { analytics } from '@/lib/analytics'

export default function CopyBlock({
  text,
  label,
  maxHeightClassName,
}: {
  text: string
  label: string
  maxHeightClassName?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      analytics.promptCopied(label)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the block is select-all as a fallback */
    }
  }
  return (
    <div className="relative min-w-0">
      <button
        onClick={copy}
        aria-label={copied ? 'Copied' : label}
        className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 max-lg:min-h-10 rounded-lg bg-white text-zinc-950 shadow-md ring-1 ring-black/10 hover:bg-zinc-200 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copied' : label}
      </button>
      {/* pt-12 keeps the first line clear of the floating button; the docs prose
          rules override padding on those pages so they're unaffected. */}
      <pre
        className={`mono select-all overflow-x-auto max-w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-4 pb-4 pt-12 text-[12px] leading-relaxed text-[color:var(--muted)] ${
          maxHeightClassName ? `${maxHeightClassName} overflow-y-auto` : ''
        }`}
      >
        <code>{text}</code>
      </pre>
    </div>
  )
}
