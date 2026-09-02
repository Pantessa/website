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
import { Check, Copy, ExternalLink, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { useSession } from '@/lib/session'
import { useIntentLinks, type LinkRow } from '@/lib/intent-links-ui'
import { dismissOnboarding, onboardingDismissed, useOnboardingStatus, type OnboardingStatus } from '@/lib/onboarding'
import MintLinkModal from '@/components/MintLinkModal'
import CreatorPageModal from '@/components/CreatorPageModal'
import { LivePill } from '@/components/LivePill'

// One CTA look for every journey step — accent-based so both themes hold
// (the done-state emerald sweep is #597 Lane U territory; don't add to it).
const CTA_CLASS =
  "inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-lg border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] text-[color:var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] transition-colors disabled:opacity-50"

/** The links-first journey, compressed for 248px: five dots, the next step,
 *  one CTA — wired to act IN PLACE (mint opens the modal, share copies your
 *  newest link) instead of routing through the dashboard. Same status + same
 *  dismiss key as the dashboard checklist: done anywhere is done everywhere,
 *  dismissed anywhere is dismissed everywhere. */
function JourneyStrip({
  status,
  live,
  onMint,
  onCopyNewest,
  copiedNewest,
  onDismiss,
  onBoard,
}: {
  status: OnboardingStatus
  live: LinkRow[]
  onMint: () => void
  onCopyNewest: () => void
  copiedNewest: boolean
  onDismiss: () => void
  /** Opens the /links board in the chat's MAIN screen — the rail sits on
   *  the chat surface, so the board is one view-flip away, not a navigation. */
  onBoard: () => void
}) {
  const steps: Array<{ key: keyof OnboardingStatus; label: string; cta: React.ReactNode }> = [
    {
      key: 'minted',
      label: 'Mint your first link',
      cta: (
        <button onClick={onMint} className={CTA_CLASS}>
          Mint a link →
        </button>
      ),
    },
    {
      key: 'opened',
      label: 'Share it — someone opening it ticks this',
      cta: (
        <button onClick={onCopyNewest} disabled={live.length === 0} className={CTA_CLASS}>
          {copiedNewest ? 'Copied — go post it' : 'Copy your link →'}
        </button>
      ),
    },
    {
      key: 'connected',
      label: 'Watch the funnel — a visitor connects',
      cta: (
        <Link href="/dashboard/links" className={CTA_CLASS}>
          Open the funnel →
        </Link>
      ),
    },
    {
      key: 'converted',
      label: 'First conversion — someone signs through it',
      cta: (
        <button onClick={onBoard} className={CTA_CLASS}>
          See the board →
        </button>
      ),
    },
    {
      key: 'claimed',
      label: 'Claim your earnings',
      cta: (
        <Link href="/dashboard/links" className={CTA_CLASS}>
          Claim →
        </Link>
      ),
    },
  ]
  const completed = steps.filter((s) => status[s.key]).length
  const next = steps.find((s) => !status[s.key])
  if (!next) return null

  return (
    <div className="mx-3 mb-2 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-[color:var(--fg)]">First link → first payout</span>
        <span className="mono text-[10px] text-[color:var(--muted-2)]">{completed}/5</span>
        <button
          onClick={onDismiss}
          aria-label="Dismiss the getting-started journey"
          className="ml-auto -mr-1 p-0.5 rounded text-[color:var(--muted-2)] hover:text-white transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1" aria-hidden>
        {steps.map((s) => (
          <span
            key={s.key}
            className={cn('h-1 flex-1 rounded-full', status[s.key] ? 'bg-[var(--accent)]' : 'bg-[color-mix(in_srgb,var(--fg)_12%,transparent)]')}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-[color:var(--muted-2)]">{next.label}</p>
      <div className="mt-1">{next.cta}</div>
    </div>
  )
}

function SignedInLinks({ activeSlugs }: { activeSlugs: string[] }) {
  const { setMainView } = useYeetfulStore()
  const { links, earnings, reload, updatedAt } = useIntentLinks()
  const { status, refresh: refreshStatus } = useOnboardingStatus()
  const [journeyDismissed, setJourneyDismissed] = useState(true)
  const [mintOpen, setMintOpen] = useState(false)
  const [pageOpen, setPageOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [handle, setHandle] = useState<string | null>(null)

  const fetchHandle = () => {
    void fetch('/api/intent-links/handle', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { handle: string | null } | null) => setHandle(d?.handle ?? null))
      .catch(() => {})
  }
  useEffect(() => {
    setJourneyDismissed(onboardingDismissed())
    fetchHandle()
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

      {status && !journeyDismissed && (
        <JourneyStrip
          status={status}
          live={live}
          onMint={() => setMintOpen(true)}
          onCopyNewest={() => live[0] && copy(live[0].slug)}
          copiedNewest={!!live[0] && copied === live[0].slug}
          onDismiss={() => {
            dismissOnboarding()
            setJourneyDismissed(true)
          }}
          onBoard={() => setMainView('links')}
        />
      )}

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
          // The page build happens IN PLACE too — the modal is the same
          // CreatorPagePanel the dashboard composes (claim + brand + OG
          // preview), not a navigation away from the conversation.
          <button
            type="button"
            onClick={() => setPageOpen(true)}
            className="block w-full text-left text-[11px] text-[color:var(--muted)] hover:text-white transition-colors"
            title="Claim /l/your-name — every link you mint on one shareable page"
          >
            Name your page → one branded page for every link
          </button>
        )}
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/dashboard/links"
            className="block text-[10px] text-[color:var(--muted-2)] hover:text-[color:var(--muted)] transition-colors"
          >
            Funnels, branding{earnings && earnings.totalEarnedUsd > 0 ? ', earnings' : ''} → Intent links
          </Link>
          {/* the funnel re-reads itself every 30s while visible */}
          {links && links.length > 0 && <LivePill updatedAt={updatedAt} className="flex-shrink-0" />}
        </div>
      </div>

      <MintLinkModal
        open={mintOpen}
        onClose={() => setMintOpen(false)}
        onMinted={() => {
          reload()
          refreshStatus()
        }}
        initialMcps={activeSlugs}
      />
      <CreatorPageModal
        open={pageOpen}
        onClose={() => {
          setPageOpen(false)
          // The panel manages its own claim state — re-read the handle so a
          // just-claimed page shows in the footer the moment the modal closes.
          fetchHandle()
        }}
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
