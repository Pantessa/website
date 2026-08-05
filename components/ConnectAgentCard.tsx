'use client'

// "Connect an agent" — the copy-paste onboarding step once a key exists:
// a yeetful/agent snippet preloaded with the owner's grant id and ledger URL.
// The API key is ALWAYS the env placeholder, never a real secret (plaintext
// keys are unrecoverable after mint, and a dashboard re-render must never
// depend on having one). Pure presentational: all inputs via props.

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, Cable } from 'lucide-react'
import { SITE_URL } from '@/lib/site-url'

export interface ConnectAgentCardProps {
  /** The owner's active expense-account grant id (null = no grant yet). */
  grantId: string | null
  /** Whether the owner has at least one API key — the card hides until then. */
  hasKeys: boolean
  /** Hosted ledger base URL the SDK should report receipts to. */
  ledgerUrl?: string
}

export function agentSnippet(grantId: string, ledgerUrl: string): string {
  return `import { pantessa } from 'pantessa/agent'

const pay = yeetful({
  wallet, // a viem WalletClient (small funded burner)
  grant: {
    id: '${grantId}', // your expense account
    allow: ['tripadvisor.x402.paysponge.com'], // hosts this agent may pay
    perCallUsd: 0.05,
    perDayUsd: 5,
  },
  apiKey: process.env.YEETFUL_API_KEY, // yf_… — mint one above
  ledgerUrl: '${ledgerUrl}', // receipts land on this dashboard
})

const res = await pay('https://tripadvisor.x402.paysponge.com/api/v1/location/search?searchQuery=tokyo')`
}

export default function ConnectAgentCard({
  grantId,
  hasKeys,
  ledgerUrl = SITE_URL,
}: ConnectAgentCardProps) {
  const [copied, setCopied] = useState(false)
  const [idCopied, setIdCopied] = useState(false)
  if (!hasKeys || !grantId) return null

  const snippet = agentSnippet(grantId, ledgerUrl)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* snippet is selectable below */
    }
  }
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(grantId)
      setIdCopied(true)
      setTimeout(() => setIdCopied(false), 2000)
    } catch {
      /* the id is selectable in the row */
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Cable className="w-4 h-4 text-[color:var(--muted)]" />
          Connect an agent
          <span className="font-normal text-[color:var(--muted-2)]">
            — every call it makes lands in this ledger
          </span>
        </h2>
        <button
          onClick={copy}
          className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy snippet'}
        </button>
      </div>
      {/* The grant id as a standalone copyable value — the example-agent flow
          asks for it as YEETFUL_GRANT_ID in .env, where digging it out of the
          code snippet below is a papercut. */}
      <div className="mt-3 flex items-center gap-x-2 gap-y-1 flex-wrap">
        <span className="text-[11px] text-[color:var(--muted-2)]">
          Your expense account · <code className="mono">YEETFUL_GRANT_ID</code>
        </span>
        <button
          onClick={copyId}
          title="Copy your grant id"
          className="flex items-center gap-1.5 min-w-0 max-w-full max-lg:min-h-10 text-[11px] mono px-2.5 py-1 rounded-lg border border-[var(--line)] bg-black/40 text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors"
        >
          <span className="truncate">{grantId}</span>
          {idCopied ? (
            <Check className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5 flex-shrink-0" />
          )}
        </button>
      </div>
      <pre className="mt-3 text-[11px] leading-relaxed mono text-[color:var(--muted)] bg-black/40 border border-[var(--line)] rounded-xl p-3 overflow-x-auto select-all">
        {snippet}
      </pre>
      <p className="text-[11px] text-[color:var(--muted-2)] mt-2.5">
        <code className="mono">npm install pantessa</code> · set{' '}
        <code className="mono">YEETFUL_API_KEY</code>{' '}in your agent&apos;s env (mint above) ·{' '}
        <Link
          href="/docs"
          className="underline decoration-dotted underline-offset-2 hover:text-white transition-colors"
        >
          docs
        </Link>{' '}
        · full example:{' '}
        <a
          href="https://github.com/Yeetful/example-agent"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-white transition-colors"
        >
          Yeetful/example-agent
        </a>{' '}
        ·{' '}
        <a
          href="https://www.npmjs.com/package/pantessa"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-white transition-colors"
        >
          yeetful on npm
        </a>
      </p>
    </div>
  )
}
