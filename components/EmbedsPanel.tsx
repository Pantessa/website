'use client'

// Dashboard · the embed-first onboarding + "Your embeds" roster.
//
// No embed key yet → a three-step get-started card (mint key → paste the
// Claude install prompt or the snippet → pick MCPs). Key(s) minted → the
// install block carries the real key, and the roster lists every origin
// that has mounted the chat (rows appear the moment the first embedded
// prompt runs — the sight beacon + per-turn bumps in /api/chat feed it).
// Embed keys are PUBLIC (publishable-style), so showing them here is fine.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Globe, Plus, Trash2 } from 'lucide-react'
import { Card, CardTitle, SkeletonCard, timeAgo } from '@/lib/dashboard-ui'
import { useToast } from '@/lib/toast'
import Button from '@/components/Button'
// The shared install card (snippet + Claude-prompt copy) — lib/embed-snippets
// strings presented by components/EmbedInstall, same surface as the docs.
import EmbedInstall from '@/components/EmbedInstall'

interface EmbedSite {
  origin: string
  pageUrl: string | null
  turns: number
  firstSeen: string
  lastSeen: string
}
interface EmbedKeyRow {
  id: string
  key: string
  label: string
  createdAt: string
  sites: EmbedSite[]
}

export default function EmbedsPanel() {
  const { toast } = useToast()
  const [keys, setKeys] = useState<EmbedKeyRow[] | null>(null)
  const [minting, setMinting] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch('/api/embed-keys', { cache: 'no-store' })
    if (r.ok) setKeys(((await r.json()) as { keys: EmbedKeyRow[] }).keys)
  }, [])
  useEffect(() => void load(), [load])

  const mint = async () => {
    setMinting(true)
    try {
      const r = await fetch('/api/embed-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'My site' }),
      })
      if (r.ok) {
        await load()
        toast('Embed key created — paste the install prompt into Claude and you’re live.', 'success')
      } else {
        toast(`Couldn’t create the key (${r.status}).`, 'error')
      }
    } finally {
      setMinting(false)
    }
  }

  const revoke = async (id: string) => {
    const r = await fetch(`/api/embed-keys/${id}`, { method: 'DELETE' })
    if (r.ok) {
      await load()
      toast('Embed key revoked — embeds using it fall back to unattributed.', 'success')
    }
  }

  if (!keys) return <SkeletonCard className="mb-6" />

  const primary = keys[0]
  const sites = keys.flatMap((k) => k.sites)

  return (
    <div className="flex flex-col gap-4 mb-6 min-w-0">
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <CardTitle serif eyebrow="EMBED PANTESSA — THE 2-MINUTE INSTALL">
            One agent on your site
          </CardTitle>
          {primary && (
            <Button variant="secondary" icon={Plus} onClick={() => void mint()} loading={minting}>
              New key
            </Button>
          )}
        </div>

        {!primary ? (
          <div className="mt-3">
            <p className="text-[13.5px] leading-relaxed text-[color:var(--muted)] max-w-[70ch]">
              Put the full Pantessa chat — compose MCPs, guardrails, receipts, signing with the
              visitor&rsquo;s own wallet — on any site. Create a <strong className="text-white font-medium">public embed key</strong>{' '}
              (safe in page source), paste one prompt into Claude, and your embeds report back here
              with every site and every turn.
            </p>
            <div className="mt-4">
              <Button variant="primary" icon={Plus} onClick={() => void mint()} loading={minting}>
                Create your embed key
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* keys */}
            <ul className="mt-3 flex flex-col">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-3 py-2 border-b border-[color:var(--line)] last:border-0 text-[13px] min-w-0"
                >
                  <span className="min-w-0 flex items-baseline gap-2.5 flex-wrap">
                    <span className="mono text-[color:var(--accent)]">{k.key}</span>
                    <span className="text-[color:var(--muted-2)] truncate">{k.label}</span>
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="mono text-[11px] text-[color:var(--muted-2)]">
                      {k.sites.length} site{k.sites.length === 1 ? '' : 's'}
                    </span>
                    <button
                      className="p-1.5 rounded-md text-[color:var(--muted-2)] hover:text-red-400 transition-colors"
                      title="Revoke this key (embeds using it fall back to unattributed)"
                      onClick={() => void revoke(k.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            {/* the shared install card — the primary key baked in */}
            <EmbedInstall embedKey={primary.key} className="mt-4" />
            <p className="mt-2 text-[12.5px] text-[color:var(--muted-2)]">
              Then{' '}
              <Link href="/servers" className="underline underline-offset-2 decoration-dotted hover:text-white">
                pick the MCPs
              </Link>{' '}
              for your set, or{' '}
              <Link href="/servers/add" className="underline underline-offset-2 decoration-dotted hover:text-white">
                add your own MCP
              </Link>
              . Full contract in{' '}
              <Link href="/docs/embed" className="underline underline-offset-2 decoration-dotted hover:text-white">
                the embed docs
              </Link>
              .
            </p>
          </>
        )}
      </Card>

      {/* the roster — appears once a first mount/prompt has been sighted */}
      {primary && (
        <Card>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <CardTitle serif eyebrow="YOUR EMBEDS">
              Connected sites
            </CardTitle>
            <Link href="/dashboard/embeds" className="mono text-[12px] text-[color:var(--accent)] hover:underline underline-offset-2">
              Open analytics →
            </Link>
          </div>
          {sites.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted-2)] mt-2">
              Nothing sighted yet — this list fills in the moment your embed mounts and the first
              prompt runs.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {sites.map((s) => (
                <li
                  key={s.origin}
                  className="flex items-center justify-between gap-3 py-2 border-b border-[color:var(--line)] last:border-0 text-[13px] min-w-0"
                >
                  <span className="min-w-0 flex items-center gap-2.5">
                    <Globe className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--muted-2)]" />
                    <span className="min-w-0">
                      <a
                        href={s.pageUrl ?? s.origin}
                        target="_blank"
                        rel="noreferrer"
                        className="text-white hover:underline underline-offset-2 truncate block"
                        title={s.pageUrl ?? s.origin}
                      >
                        {s.origin.replace(/^https?:\/\//, '')}
                      </a>
                      {s.pageUrl && s.pageUrl !== s.origin && (
                        <span className="text-[11.5px] text-[color:var(--muted-2)] truncate block">{s.pageUrl}</span>
                      )}
                    </span>
                  </span>
                  <span className="mono text-[11.5px] text-[color:var(--muted-2)] whitespace-nowrap flex-shrink-0">
                    {s.turns} turn{s.turns === 1 ? '' : 's'} · {timeAgo(s.lastSeen)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
