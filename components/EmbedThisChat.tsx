'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Code2, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/session'
import {
  DEFAULT_EMBED_MCPS,
  MAX_EMBED_MCPS,
  embedClaudePrompt,
  embedSnippet,
} from '@/lib/embed-snippets'

/**
 * "Embed this chat" — chat-toolbar popover proving the point that the chat
 * the user is looking at drops into any site. Carries the CURRENT active
 * MCP set into a copy-paste Claude Code prompt (and a raw snippet). Shown to
 * everyone incl. guests — keyless embeds work; a signed-in user's primary
 * embed key is baked in so their copied embeds attribute + report analytics.
 */
export default function EmbedThisChat({ slugs }: { slugs: string[] }) {
  const { address } = useSession()
  const [open, setOpen] = useState(false)
  const [embedKey, setEmbedKey] = useState<string | null>(null)
  const [keyChecked, setKeyChecked] = useState(false)
  const [copied, setCopied] = useState<'prompt' | 'snippet' | null>(null)
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

  // First open while signed in: reuse the primary embed key so the copied
  // prompt attributes usage (lights up /dashboard/embeds). Guests skip this —
  // keyless prompts still work.
  useEffect(() => {
    if (!open || !address || keyChecked) return
    fetch('/api/embed-keys', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ keys: { key: string }[] }>) : null))
      .then((d) => setEmbedKey(d?.keys?.[0]?.key ?? null))
      .catch(() => {})
      .finally(() => setKeyChecked(true))
  }, [open, address, keyChecked])

  const usingDefaults = slugs.length === 0
  const effective = (usingDefaults ? DEFAULT_EMBED_MCPS : slugs).slice(0, MAX_EMBED_MCPS)
  const trimmed = slugs.length > MAX_EMBED_MCPS

  const copy = (kind: 'prompt' | 'snippet') => {
    const text =
      kind === 'prompt' ? embedClaudePrompt(embedKey, effective) : embedSnippet(embedKey, effective)
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(kind)
        setTimeout(() => setCopied(null), 1600)
      })
      .catch(() => {
        /* clipboard blocked — user can select from the snippet preview */
      })
  }

  return (
    <div className="relative flex-shrink-0" ref={popRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Embed this chat on your own site"
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] transition-colors',
          open
            ? 'bg-[var(--surf-2)] border-white/30 text-white'
            : 'bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)]'
        )}
      >
        <Code2 className="w-3.5 h-3.5" />
        <span className="whitespace-nowrap hidden sm:inline">Embed</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[21rem] max-w-[calc(100vw-24px)] z-20 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] shadow-xl shadow-black/40 p-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-white">Embed this chat</p>
            <p className="text-[11px] text-[color:var(--muted-2)] mt-0.5 leading-snug">
              This exact chat — your MCP set included — drops into any site. Paste the prompt into
              Claude Code in your app&rsquo;s repo and it does the whole install.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {effective.map((s) => (
              <span
                key={s}
                className="mono text-[10.5px] px-1.5 py-0.5 rounded-md border border-[var(--line)] bg-black/40 text-[color:var(--muted)]"
              >
                {s}
              </span>
            ))}
            {usingDefaults && (
              <span className="text-[10.5px] text-[color:var(--muted-2)]">
                no MCPs selected — starter set
              </span>
            )}
            {trimmed && (
              <span className="text-[10.5px] text-[color:var(--muted-2)]">
                first {MAX_EMBED_MCPS} — embeds cap there
              </span>
            )}
          </div>

          <pre className="mono text-[10.5px] leading-relaxed text-[color:var(--muted)] rounded-lg border border-[var(--line)] bg-black/40 px-2.5 py-2 overflow-x-auto max-h-32 overflow-y-auto">
            {embedSnippet(embedKey, effective)}
          </pre>

          <div className="flex items-center gap-2">
            <button
              onClick={() => copy('prompt')}
              className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15 transition-colors"
            >
              {copied === 'prompt' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'prompt' ? 'Copied' : 'Copy Claude Code prompt'}
            </button>
            <button
              onClick={() => copy('snippet')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-[var(--line)] bg-[var(--surf-2)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors"
            >
              {copied === 'snippet' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              Snippet
            </button>
          </div>

          <p className="text-[10.5px] text-[color:var(--muted-2)] leading-snug">
            {embedKey ? (
              <>
                Attributed to your key <span className="mono text-[color:var(--accent)]">{embedKey}</span>{' '}
                — turns report to{' '}
                <Link href="/dashboard/embeds" className="underline underline-offset-2 decoration-dotted hover:text-white">
                  embed analytics
                </Link>
                .
              </>
            ) : address ? (
              <>
                Works keyless.{' '}
                <Link href="/dashboard" className="underline underline-offset-2 decoration-dotted hover:text-white">
                  Mint an embed key
                </Link>{' '}
                to attribute usage + get analytics.
              </>
            ) : (
              <>Works keyless — sign in to mint a key for usage analytics.</>
            )}{' '}
            <Link href="/docs/embed" className="underline underline-offset-2 decoration-dotted hover:text-white">
              Docs
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
