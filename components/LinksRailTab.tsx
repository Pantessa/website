'use client'

// The rail's Links tab — the creator's intent links where the work actually
// happens (the chat), not two navigations away on the dashboard. Mint opens
// the same MintLinkForm the dashboard composes (modal, pre-lit with the
// current working set); each row is the link + its funnel in one glance and
// COPIES on tap — sharing is the whole job of a link. Links are an account
// surface (#553: connect to act, sign in to KEEP), so the tab gates on the
// SIWE session and offers the sign-in, mirroring the Chats tab's door.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, ExternalLink, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { useSession } from '@/lib/session'
import { useIntentLinks } from '@/lib/intent-links-ui'
import MintLinkModal from '@/components/MintLinkModal'

function SignedInLinks({ activeSlugs }: { activeSlugs: string[] }) {
  const { links, earnings, reload } = useIntentLinks()
  const [mintOpen, setMintOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [handle, setHandle] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/intent-links/handle', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { handle: string | null } | null) => setHandle(d?.handle ?? null))
      .catch(() => {})
  }, [])

  const copy = (slug: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/i/${slug}`).then(() => {
      setCopied(slug)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  const live = (links ?? []).filter((l) => !l.revoked)

  return (
    <>
      <div className="px-3 pb-2">
        <button
          onClick={() => setMintOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-2 min-h-[44px] md:min-h-0 rounded-xl bg-[var(--surf-2)] border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-all text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Mint a link
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
        {links === null && (
          <p className="px-2 py-4 text-[11px] text-[color:var(--muted-2)]">Loading your links…</p>
        )}
        {links !== null && live.length === 0 && (
          <p className="px-3 py-4 text-xs text-[color:var(--muted-2)]">
            No links yet. One sentence — &ldquo;Buy $5 of AAPL&rdquo; — becomes a link anyone can
            act on. Mint your first above.
          </p>
        )}
        {live.map((l) => (
          <div
            key={l.slug}
            role="button"
            tabIndex={0}
            onClick={() => copy(l.slug)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                copy(l.slug)
              }
            }}
            title="Copy the link"
            className="group w-full px-2.5 py-2 rounded-xl cursor-pointer transition-all text-left text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-1)]"
          >
            <span className="flex items-center gap-1.5">
              <span className="mono text-[12px] text-[color:var(--accent)] truncate">/i/{l.slug}</span>
              {copied === l.slug ? (
                <Check className="w-3 h-3 flex-shrink-0 text-[color:var(--accent)]" />
              ) : (
                <Copy className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-70 transition-opacity" />
              )}
              {/* Open the live page — hover affordance; stopPropagation so
                  the row click stays "copy". */}
              <a
                href={`/i/${l.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open /i/${l.slug}`}
                title="Open the link"
                className="ml-auto flex-shrink-0 w-5 h-5 grid place-items-center rounded-md text-[color:var(--muted-2)] opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/5 transition-all"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </span>
            <span className="block text-[11px] truncate mt-0.5">{l.ask}</span>
            <span className="block mono text-[10px] text-[color:var(--muted-2)] mt-0.5">
              {l.funnel.open} opens · {l.funnel.signed} signed
              {l.signedUsd > 0 ? ` · $${l.signedUsd.toFixed(2)}` : ''}
            </span>
          </div>
        ))}
      </div>

      {/* The creator-page + funnel doors — the full studio stays on the
          dashboard; the rail is the daily glance. */}
      <div className="px-3 pb-3 pt-2 border-t border-[var(--line)] space-y-1.5">
        {handle ? (
          <a
            href={`/l/${handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block mono text-[11px] text-[color:var(--accent)] hover:underline truncate"
            title="Your public page"
          >
            /l/{handle} — your page
          </a>
        ) : (
          <Link
            href="/dashboard/links"
            className="block text-[11px] text-[color:var(--muted)] hover:text-white transition-colors"
            title="Claim /l/your-name — every link you mint on one shareable page"
          >
            Name your page → one branded page for every link
          </Link>
        )}
        <Link
          href="/dashboard/links"
          className="block text-[10px] text-[color:var(--muted-2)] hover:text-[color:var(--muted)] transition-colors"
        >
          Funnels, branding{earnings && earnings.totalEarnedUsd > 0 ? ', earnings' : ''} → Intent links
        </Link>
      </div>

      <MintLinkModal
        open={mintOpen}
        onClose={() => setMintOpen(false)}
        onMinted={reload}
        initialMcps={activeSlugs}
      />
    </>
  )
}

export default function LinksRailTab() {
  const { servers, activeServerIds } = useYeetfulStore()
  const { address, needsSignIn, signIn, signingIn } = useSession()

  // The modal's picker opens pre-lit with the current working set — the
  // same "the set that produced the aha" handoff the ?mcps= contract carries.
  const activeSlugs = activeServerIds
    .map((id) => servers.find((s) => s.id === id)?.slug)
    .filter((s): s is string => !!s)

  if (!address) {
    return (
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <div className="text-center py-6 px-3 space-y-3">
          <p className="text-xs text-[color:var(--muted-2)]">
            {needsSignIn
              ? 'Links live on your account — sign in to mint and track them.'
              : 'Connect a wallet and sign in — a link carries an ask anyone can act on, and its funnel reports to you.'}
          </p>
          {needsSignIn && (
            <button
              onClick={() => signIn()}
              disabled={signingIn}
              className="text-xs font-semibold text-white underline underline-offset-2 hover:text-zinc-300 disabled:opacity-60"
            >
              {signingIn ? 'Signing in…' : 'Sign in to mint links'}
            </button>
          )}
        </div>
      </div>
    )
  }

  return <SignedInLinks activeSlugs={activeSlugs} />
}
