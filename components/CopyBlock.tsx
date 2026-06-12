'use client'

// A <pre> with a copy button — used for the Claude Code onboarding prompt.
// The text itself is passed as a prop from a server component, so the
// content stays in the SSR HTML (crawlable) and this stays a dumb shell.

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { analytics } from '@/lib/analytics'

export default function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      analytics.promptCopied(label)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* the block below is select-all */
    }
  }
  return (
    <div className="relative">
      <button
        onClick={copy}
        className="absolute right-3 top-3 z-10 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 max-lg:min-h-10 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copied' : label}
      </button>
      <pre className="select-all">
        <code>{text}</code>
      </pre>
    </div>
  )
}
