'use client'

// Dashboard Overview · the links-first headline card: your link economy at a
// glance — links live, opens, conversions, dollars moved, and what you've
// earned (half the 0.20% fee on fee-bearing conversions) — plus the links
// themselves as a paginated copy-paste table (newest first, one tap to put
// the full /i URL on the clipboard). Reads the same owner API as
// /dashboard/links, so the numbers can't drift. Fail-soft: any fetch
// problem renders the mint door alone rather than an error.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Check, Copy, Link2, Plus } from 'lucide-react'
import { Card } from '@/lib/dashboard-ui'
import { formatEarnedUsd } from '@/lib/fees'

interface LinksApi {
  links: {
    slug: string
    url: string
    ask: string
    revoked: boolean
    funnel: { open: number; connect: number; built: number; signed: number }
    signedUsd: number
    signsCount: number
  }[]
  earnings: {
    totalEarnedUsd: number
    /** Signed notional that took a fee-bearing route — the earnings base. */
    totalFeeBearingUsd: number
    claimedUsd: number
    claimableUsd: number
    minClaimUsd: number
  }
}

interface HandleApi {
  handle: string | null
  brand: { domain: string | null; name: string | null; logo: string | null; accent: string | null; bg: string | null } | null
}

/** Per-link share intent — the ask IS the tweet (dynamic OG wears the brand). */
const tweetLinkHref = (ask: string, url: string) =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(`“${ask}” — tap it, connect your wallet, done.`)}&url=${encodeURIComponent(`https://yeetful.com${url}`)}`

const usd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)

/** The one sentence that explains an honest zero — which routes pay a fee at
 *  all. Bridges (NEAR Intents), transfers, stakes and sales are fee-free by
 *  the conversions-not-movements rule, so they earn a creator nothing. */
const FEE_FREE_NOTE =
  'You keep half of the 0.20% fee on swaps and stock buys. Bridges, transfers, stakes and sales are fee-free — they move money but earn nothing.'

const PAGE_SIZE = 5

/** One row's copy button — flips to a check for a beat after copying the
 *  absolute /i URL (the whole point of the table: grab a link, paste it). */
function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="Copy the link URL"
      title="Copy the link URL"
      onClick={() => {
        const abs = `${window.location.origin}${url}`
        void navigator.clipboard?.writeText(abs).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="p-1 rounded-md text-[color:var(--muted-2)] hover:text-[color:var(--accent)] transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-[color:var(--accent)]" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

export default function LinksSummaryCard() {
  const [data, setData] = useState<LinksApi | null>(null)
  const [failed, setFailed] = useState(false)
  const [page, setPage] = useState(0)
  // null = still loading (render nothing yet); {handle: null} = unclaimed.
  const [me, setMe] = useState<HandleApi | null>(null)
  const [copiedPage, setCopiedPage] = useState(false)

  useEffect(() => {
    fetch('/api/intent-links', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: LinksApi) => setData(d))
      .catch(() => setFailed(true))
    fetch('/api/intent-links/handle', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((h: HandleApi) => setMe(h))
      .catch(() => setMe({ handle: null, brand: null }))
  }, [])

  // Hold until settled — a flash of zeros reads as "you have nothing".
  if (!data && !failed) return null

  const live = data?.links.filter((l) => !l.revoked) ?? []
  const opens = live.reduce((s, l) => s + l.funnel.open, 0)
  const signs = live.reduce((s, l) => s + l.signsCount, 0)
  const movedUsd = live.reduce((s, l) => s + l.signedUsd, 0)
  const earned = data?.earnings

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <Link2 className="w-4 h-4 text-[color:var(--accent)]" /> Your intent links
          </p>
          <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
            A sentence anyone can act on — you keep half of Yeetful&apos;s 0.20% fee on the
            conversions your links produce.{' '}
            <Link href="/dashboard/links" className="underline underline-offset-2 decoration-dotted hover:text-white">
              Open Intent links →
            </Link>
          </p>
        </div>
        <Link
          href={`/dashboard/links?ask=${encodeURIComponent('Buy $5 of AAPL')}`}
          className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 max-lg:min-h-11 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Mint a link
        </Link>
      </div>

      {/* Your public page — the /l storefront lived only inside Intent links;
          here it's one glance: the URL, the share, and the claim door. */}
      {me &&
        (me.handle ? (
          <div className="mt-4 flex items-center gap-2.5 flex-wrap rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--fg)_3%,transparent)] px-3 py-2.5">
            {me.brand?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.brand.logo} alt="" className="w-6 h-6 rounded-md object-contain flex-shrink-0" />
            ) : (
              <Link2 className="w-4 h-4 text-[color:var(--accent)] flex-shrink-0" />
            )}
            <Link href={`/l/${me.handle}`} className="mono text-[12.5px] text-[color:var(--accent)] hover:underline underline-offset-2">
              /l/{me.handle}
            </Link>
            <span className="text-[12px] text-[color:var(--muted-2)]">
              your public page{movedUsd > 0 ? ` · ${usd(movedUsd)} moved through it` : ''}
              {!me.brand && (
                <>
                  {' · '}
                  <Link href="/dashboard/links" className="underline underline-offset-2 decoration-dotted hover:text-white">
                    brand it with your site
                  </Link>
                </>
              )}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-label="Copy your page URL"
                title="Copy your page URL"
                onClick={() => {
                  void navigator.clipboard?.writeText(`https://yeetful.com/l/${me.handle}`).then(() => {
                    setCopiedPage(true)
                    setTimeout(() => setCopiedPage(false), 1500)
                  })
                }}
                className="p-1.5 rounded-md text-[color:var(--muted-2)] hover:text-[color:var(--accent)] transition-colors"
              >
                {copiedPage ? <Check className="w-3.5 h-3.5 text-[color:var(--accent)]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Links that move money — @${me.handle}`)}&url=${encodeURIComponent(`https://yeetful.com/l/${me.handle}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-[11px] px-2 py-1 rounded-md border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors"
              >
                tweet it
              </a>
            </span>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2.5 flex-wrap rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--fg)_3%,transparent)] px-3 py-2.5">
            <Link2 className="w-4 h-4 text-[color:var(--muted-2)] flex-shrink-0" />
            <span className="text-[12px] text-[color:var(--muted-2)]">
              Name a public page — <span className="mono">/l/your-name</span> — and every link you mint lives on it.
            </span>
            <Link
              href="/dashboard/links"
              className="ml-auto text-[12px] font-medium text-[color:var(--accent)] hover:underline underline-offset-2"
            >
              Claim your page →
            </Link>
          </div>
        ))}

      {(live.length > 0 || (earned && earned.totalEarnedUsd > 0)) && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(
            [
              { label: 'Links live', value: String(live.length) },
              { label: 'Opens', value: String(opens) },
              { label: 'Conversions', value: String(signs) },
              { label: 'Moved', value: usd(movedUsd) },
              {
                label: 'Earned',
                // Sub-cent precision on purpose: half of 20 bps on a $1 test
                // swap is $0.001, and "$0.00" would read as "the rail is
                // broken" on exactly the conversion you minted to prove it.
                value: formatEarnedUsd(earned?.totalEarnedUsd ?? 0),
                sub:
                  earned && earned.claimableUsd > 0
                    ? earned.claimableUsd >= earned.minClaimUsd
                      ? `${usd(earned.claimableUsd)} claimable`
                      : `claims open at $${earned.minClaimUsd}`
                    : // Money moved but none of it fee-bearing: say WHY, or a
                      // zero next to a conversion looks like a bug.
                      earned && earned.totalFeeBearingUsd <= 0 && movedUsd > 0
                      ? 'fee-free route'
                      : undefined,
                dim: !!earned && earned.claimableUsd <= 0,
                title: FEE_FREE_NOTE,
              },
            ] as const
          ).map((s) => (
            <div key={s.label} className="min-w-0" title={'title' in s ? s.title : undefined}>
              <p className="mono text-[18px] tabular-nums text-white truncate">{s.value}</p>
              <p className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)] mt-0.5">
                {s.label}
              </p>
              {'sub' in s && s.sub && (
                <p
                  className={`text-[10.5px] mt-0.5 ${'dim' in s && s.dim ? 'text-[color:var(--muted-2)]' : 'text-[color:var(--accent)]'}`}
                >
                  {s.sub}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* The links themselves, newest first — copy-paste central. Same funnel
          columns as /dashboard/links, slimmed to what matters at a glance. */}
      {live.length > 0 &&
        (() => {
          const pages = Math.max(1, Math.ceil(live.length / PAGE_SIZE))
          const cur = Math.min(page, pages - 1)
          const rows = live.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)
          return (
            <div className="mt-4 overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                    <th className="py-1.5 pr-3 font-medium">Link</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Opens</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Connects</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Signed</th>
                    <th className="py-1.5 pr-0 font-medium text-right">$ moved</th>
                  </tr>
                </thead>
                <tbody className="text-[color:var(--muted)]">
                  {rows.map((l) => (
                    <tr key={l.slug} className="border-t border-[var(--line)]">
                      <td className="py-2 pr-3 min-w-0">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <CopyLinkButton url={l.url} />
                          <a
                            href={tweetLinkHref(l.ask, l.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Tweet this link"
                            title="Tweet this link — the card wears your brand"
                            className="p-1 rounded-md text-[13px] leading-none text-[color:var(--muted-2)] hover:text-[color:var(--accent)] transition-colors flex-shrink-0"
                          >
                            𝕏
                          </a>
                          <Link
                            href={l.url}
                            className="mono text-[12px] text-[color:var(--accent)] hover:underline underline-offset-2 flex-shrink-0"
                          >
                            {l.url}
                          </Link>
                          <span className="text-[12.5px] text-[color:var(--fg)] truncate" title={l.ask}>
                            {l.ask}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right mono tabular-nums">{l.funnel.open}</td>
                      <td className="py-2 pr-3 text-right mono tabular-nums">{l.funnel.connect}</td>
                      <td className="py-2 pr-3 text-right mono tabular-nums text-white">{l.signsCount || '—'}</td>
                      <td className="py-2 pr-0 text-right mono tabular-nums text-white">
                        {l.signedUsd > 0 ? usd(l.signedUsd) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {live.length > PAGE_SIZE && (
                <div className="flex items-center justify-between gap-3 mt-2.5">
                  <span className="mono text-[11px] text-[color:var(--muted-2)] tabular-nums">
                    {cur * PAGE_SIZE + 1}–{Math.min(live.length, (cur + 1) * PAGE_SIZE)} of {live.length}
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage(Math.max(0, cur - 1))}
                      disabled={cur === 0}
                      className="px-3 py-1.5 text-xs mono rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white disabled:opacity-40 disabled:hover:text-[color:var(--muted)] transition-colors"
                    >
                      ← Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage(Math.min(pages - 1, cur + 1))}
                      disabled={cur >= pages - 1}
                      className="px-3 py-1.5 text-xs mono rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white disabled:opacity-40 disabled:hover:text-[color:var(--muted)] transition-colors"
                    >
                      Next →
                    </button>
                  </span>
                </div>
              )}
            </div>
          )
        })()}
    </Card>
  )
}
