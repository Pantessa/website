'use client'

// The /sign interstitial — trust-critical surface, zero winks. Shows the ask
// an external agent prepared, states the guardrail contract in plain words,
// and hands into /chat with the ask PREFILLED (never auto-sent; the human
// reads it and presses send, then signs). The ask is treated as untrusted
// text: length-capped, control chars stripped, rendered inert, and rebuilt
// from scratch by the native guarded layers on the other side of the click —
// this page never accepts or forwards calldata, addresses, or artifacts.

import Link from 'next/link'
import { ShieldCheck, ArrowRight } from 'lucide-react'
import { YeetfulMark } from '@/components/Logo'

const ASK_MAX = 400
const SLUG_RE = /^[a-z0-9-]{1,64}$/

/** Untrusted-input hygiene: cap length, strip control chars, collapse runs. */
function cleanAsk(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ASK_MAX)
}

const CONTRACT = [
  {
    title: 'The agent wrote a sentence, not a transaction.',
    body: 'This link carries only the ask above. Yeetful rebuilds it from scratch with deterministic builders — no AI wrote the calldata, and nothing an agent puts in a link can execute by itself.',
  },
  {
    title: 'Every build is guarded, priced, and receipted.',
    body: 'Pinned contracts, fail-closed checks, spend caps. If a check fails you get a refusal, not a worse trade. Every signed move lands as a receipt.',
  },
  {
    title: 'Your wallet is the only thing that can sign.',
    body: 'Yeetful holds no keys and no funds. Review what gets built, then sign it — or close this tab and nothing happens.',
  },
]

export default function SignHandoff({ ask, mcps, agent }: { ask: string; mcps: string; agent: string }) {
  const cleanedAsk = cleanAsk(ask)
  const cleanedAgent = cleanAsk(agent).slice(0, 40)
  const slugs = mcps
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SLUG_RE.test(s))
    .slice(0, 6)

  const chatHref = cleanedAsk
    ? `/chat?${slugs.length ? `mcps=${slugs.join(',')}&` : ''}prompt=${encodeURIComponent(cleanedAsk)}`
    : '/chat'

  return (
    <main className="min-h-[calc(100vh-4rem)] max-w-xl mx-auto px-4 py-12 flex flex-col">
      <div className="flex items-center gap-2 mb-8">
        <YeetfulMark size={18} />
        <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
          Agent handoff · review &amp; sign
        </span>
      </div>

      {cleanedAsk ? (
        <>
          <p className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
            {cleanedAgent ? `${cleanedAgent} prepared this ask` : 'An agent prepared this ask'}
          </p>
          <blockquote className="text-xl leading-snug font-medium text-[color:var(--fg)] border-l-2 border-[var(--accent)] pl-4 mb-8">
            &ldquo;{cleanedAsk}&rdquo;
          </blockquote>

          <ul className="space-y-4 mb-9">
            {CONTRACT.map((c) => (
              <li key={c.title} className="flex gap-3">
                <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
                <div>
                  <p className="text-sm font-semibold text-[color:var(--fg)]">{c.title}</p>
                  <p className="text-[13px] leading-relaxed text-[color:var(--muted)]">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <Link
            href={chatHref}
            className="btn btn--solid inline-flex items-center justify-center gap-2 self-start"
          >
            Review &amp; build <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="text-[12px] text-[color:var(--muted-2)] mt-3">
            The ask lands prefilled in the chat — nothing sends, builds, or moves until you act.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold text-[color:var(--fg)] mb-2">Nothing to review</h1>
          <p className="text-sm text-[color:var(--muted)] mb-6 max-w-md">
            This page expects a link from an agent carrying an ask, like{' '}
            <code className="mono text-[12px]">/sign?ask=Buy%20%2412%20of%20AAPL</code>. If you landed
            here by hand, the chat is the front door.
          </p>
          <Link href="/chat" className="btn btn--ghost self-start">
            Open the chat
          </Link>
        </>
      )}
    </main>
  )
}
