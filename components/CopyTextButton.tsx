'use client'

// A compact "copy this text" button — for handing a generated prompt to the
// clipboard inline (e.g. the /health cockpit's per-MCP fix prompt). The text is
// passed from a server component so it stays in the SSR HTML.

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { analytics } from '@/lib/analytics'

export default function CopyTextButton({ text, label, event }: { text: string; label: string; event?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      if (event) analytics.promptCopied(event)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — no-op */
    }
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors"
      style={{ borderColor: copied ? 'var(--accent)' : 'var(--line)', color: copied ? 'var(--accent)' : 'var(--fg)' }}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  )
}
