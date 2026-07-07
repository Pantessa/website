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
import { Check, Copy, Globe, Plus, Trash2 } from 'lucide-react'
import { Card, CardTitle, SkeletonCard, timeAgo } from '@/lib/dashboard-ui'
import { useToast } from '@/lib/toast'
import Button from '@/components/Button'
import { SDK_PKG, SDK_MIN, SDK_EMBED_ESM } from '@/lib/sdk'

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

const DEFAULT_MCPS = "['uniswap-free', 'snapshot-free']"

function snippetFor(key: string): string {
  return `import { mountYeetfulChat } from 'yeetful/embed'

mountYeetfulChat({
  mode: 'bubble',
  key: '${key}',
  mcps: ${DEFAULT_MCPS},
  wallet: 'auto', // the host page's wallet signs
})`
}

/** The copy-paste "Install with Claude" prompt — hand it to Claude Code (or
 * any coding agent) inside the host app's repo and it does the whole
 * integration. Self-contained on purpose: key, CSP note, verify step. */
function claudePromptFor(key: string): string {
  return `Install the Yeetful embeddable chat (an agent that composes MCPs — swaps, DAO votes, live data — and signs with the user's own wallet) into this app.

1. Install the SDK: \`npm i ${SDK_PKG}\` (needs ${SDK_PKG} >= ${SDK_MIN}).
2. Mount it once wherever the app initializes client-side:

   import { mountYeetfulChat } from 'yeetful/embed'

   mountYeetfulChat({
     mode: 'bubble',            // or 'inline' with { container }
     key: '${key}',  // public embed key — attributes usage to our account
     mcps: ${DEFAULT_MCPS},  // swap for slugs from https://www.yeetful.com/servers
     wallet: 'auto',            // bridges the page's connected wallet; signatures pop in the user's own wallet
   })

   No bundler? Use a module script instead:
   <script type="module">
     import { mountYeetfulChat } from '${SDK_EMBED_ESM}'
     mountYeetfulChat({ mode: 'bubble', key: '${key}', mcps: ${DEFAULT_MCPS}, wallet: 'auto' })
   </script>

3. If the app ships a Content-Security-Policy, add https://www.yeetful.com to frame-src (the chat runs in an iframe on that origin).
4. Do not move the key to an env secret — it is a publishable identifier, safe in page source.
5. Verify: run the app, open the chat bubble, and ask "what is WETH trading at?" — the answer should include a $0 receipt line. Docs: https://www.yeetful.com/docs/embed`
}

function CopyButton({ text, label, solid }: { text: string; label: string; solid?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant={solid ? 'primary' : 'secondary'}
      icon={copied ? Check : Copy}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
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
          <CardTitle serif eyebrow="EMBED YEETFUL — THE 2-MINUTE INSTALL">
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
              Put the full Yeetful chat — compose MCPs, guardrails, receipts, signing with the
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

            {/* install block — Claude prompt first (the easy path), raw snippet second */}
            <div className="mt-4 rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[color:var(--line)] flex-wrap">
                <span className="mono text-[11px] tracking-wider text-[color:var(--muted-2)]">
                  INSTALL WITH CLAUDE — PASTE THIS INTO CLAUDE CODE IN YOUR APP&rsquo;S REPO
                </span>
                <span className="flex items-center gap-2">
                  <CopyButton solid text={claudePromptFor(primary.key)} label="Copy Claude prompt" />
                  <CopyButton text={snippetFor(primary.key)} label="Copy snippet" />
                </span>
              </div>
              <pre className="px-4 py-3 mono text-[12px] leading-relaxed text-[color:var(--muted)] overflow-x-auto max-h-44">
                {claudePromptFor(primary.key)}
              </pre>
            </div>
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
