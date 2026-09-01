import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, Link2, ShieldCheck } from 'lucide-react'
import { YeetfulMark } from '@/components/Logo'
import Footer from '@/components/Footer'
import prisma from '@/lib/db'
import { chainById } from '@/lib/chains'
import { factsOf, maskAddressTokens, receiptTryHref, receiptTweetHref, shortWallet, txLinesOf } from '@/lib/share-receipts'

// /r/<id> — a receipt permalink: ONE receipt-shaped thing (a settled turn, a
// done job, a DCA schedule, a guardian protection), public because its owner
// tapped share on it. The page is the ad: the numbers, the guardrail line,
// and a "Do this yourself" handoff with the exact ask prefilled. Content is
// the share-time snapshot — nothing live about the owner leaks.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

async function getReceipt(slug: string) {
  try {
    const r = await prisma.shareReceipt.findUnique({ where: { id: slug } })
    if (!r || r.revoked) return null
    // Read-time mask covers receipts minted before write-time masking
    // existed — a pasted 0x address in the ask must never render in full.
    return { ...r, ask: r.ask ? maskAddressTokens(r.ask) : r.ask }
  } catch {
    return null
  }
}

const KIND_LABEL: Record<string, string> = {
  tx: 'Signed transaction',
  job: 'Completed job',
  dca: 'Recurring buy',
  guardian: 'Guardian protection',
}

export async function generateMetadata({ params }: Params) {
  const { slug } = await params
  const r = await getReceipt(slug)
  if (!r) return { title: 'Receipt · Pantessa', robots: { index: false, follow: false } }
  const title = `${r.headline} · Pantessa receipt`
  const description = r.standing
    ? 'A standing order, set up in one sentence. It runs whether anyone is at the keyboard or not — guarded, receipted, killable.'
    : 'Built, guarded, and signed from one chat ask. The wallet that shared this stayed the only signer.'
  return {
    title,
    description,
    openGraph: { title, description, siteName: 'Pantessa', type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: false, follow: false },
  }
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export default async function ReceiptPage({ params }: Params) {
  const { slug } = await params
  const receipt = await getReceipt(slug)
  if (!receipt) notFound()

  const facts = factsOf(receipt.facts)
  const txs = txLinesOf(receipt.txs)
  const tryHref = receiptTryHref(receipt)
  const tweetHref = receiptTweetHref(receipt)
  const when = receipt.createdAt.toISOString().slice(0, 10)

  return (
    <>
      <div className="min-h-[calc(100vh-4rem)] max-w-xl mx-auto px-4 py-10">
        {/* kicker */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
            {KIND_LABEL[receipt.kind] ?? 'Receipt'} · shared by its owner
          </span>
          {receipt.standing && (
            <span className="mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border border-[color:color-mix(in_srgb,var(--done)_40%,transparent)] text-[color:var(--done)]">
              runs unattended
            </span>
          )}
        </div>

        {/* the receipt */}
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] overflow-hidden">
          {/* A finished run wears the same progress object as a running one —
              full and quiet. */}
          <div className="yprog yprog--full rounded-none" aria-hidden>
            <div className="yprog__fill" />
          </div>
          <div className="px-5 pt-5 pb-4 border-b border-dashed border-[var(--line-2)]">
            <h1 className="text-2xl font-semibold text-[color:var(--fg)] leading-snug">{receipt.headline}</h1>
            {receipt.ask && (
              <p className="mt-2 text-sm text-[color:var(--muted)] italic">“{receipt.ask}”</p>
            )}
          </div>

          <div className="px-5 py-4 space-y-2">
            {facts.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 text-[13px]">
                <span className="mono uppercase tracking-wide text-[11px] text-[color:var(--muted-2)] flex-shrink-0">{f.label}</span>
                <span className="text-[color:var(--fg)] text-right">{f.value}</span>
              </div>
            ))}
            {facts.length === 0 && (
              <p className="text-[13px] text-[color:var(--muted-2)]">Every step guarded, signed, and receipted.</p>
            )}
          </div>

          {txs.length > 0 && (
            <div className="px-5 pb-4 space-y-1">
              {txs.map((tx) => {
                const chain = chainById(tx.chainId)
                return (
                  <div key={tx.hash} className="flex items-center gap-1.5 text-[11px] mono text-[color:var(--muted-2)] min-w-0">
                    <span className="text-[color:var(--done)] flex-shrink-0">✓</span>
                    {tx.title && <span className="text-[color:var(--muted)] truncate">{tx.title}</span>}
                    <a
                      href={`${chain?.explorerTx ?? 'https://basescan.org/tx/'}${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)] transition-colors"
                      title={`View on ${chain?.name ?? 'the block explorer'}`}
                    >
                      {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
                      <ExternalLink className="w-3 h-3" aria-hidden />
                    </a>
                    {chain && <span className="flex-shrink-0">{chain.name}</span>}
                  </div>
                )
              })}
            </div>
          )}

          {/* the trust line — money surface, zero winks */}
          <div className="px-5 py-3 bg-[color:color-mix(in_srgb,var(--fg)_3%,transparent)] border-t border-[var(--line)] flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--muted)]">
              <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--done)] flex-shrink-0" aria-hidden />
              Deterministic build · fail-closed guards · only {shortWallet(receipt.wallet)} could sign
            </span>
            <span className="mono text-[10px] text-[color:var(--muted-2)] flex-shrink-0">{when}</span>
          </div>
        </div>

        {/* handoff — the whole point of the page */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href={tryHref}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)] text-black text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <YeetfulMark size={13} />
            <span>{receipt.ask ? 'Do this yourself' : 'Try Pantessa'}</span>
          </Link>
          {receipt.ask && (
            <p className="text-[11px] text-[color:var(--muted-2)] text-center">
              Opens the chat with this exact ask prefilled. Nothing sends, nothing signs, until you say so.
            </p>
          )}
          <div className="flex items-center gap-2">
            <a
              href={tweetHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--line)] bg-[var(--surf-1)] text-[color:var(--fg)] text-xs font-semibold hover:bg-[var(--surf-2)] transition-colors"
            >
              <XMark />
              <span>Share</span>
            </a>
            {/* Receipt → link: the viewer mints their OWN copy of this ask as
                an intent link (/dashboard/links prefill — sign-in gated there,
                minted under the viewer's wallet, never the sharer's). */}
            {receipt.ask && (
              <Link
                href={`/dashboard/links?ask=${encodeURIComponent(receipt.ask)}`}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--line)] bg-[var(--surf-1)] text-[color:var(--fg)] text-xs font-semibold hover:bg-[var(--surf-2)] transition-colors"
                title="Your own copy of this ask, as a one-tap link you can share"
              >
                <Link2 className="w-3.5 h-3.5" aria-hidden />
                <span>Mint this as a link</span>
              </Link>
            )}
          </div>
          <p className="mt-3 text-[11px] text-[color:var(--muted-2)] text-center mono">
            Pantessa — the non-custodial back office for autonomous money.
          </p>
        </div>
      </div>
      <Footer />
    </>
  )
}
