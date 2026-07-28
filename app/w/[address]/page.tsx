import type { Metadata } from 'next'
import Link from 'next/link'
import { isAddress } from 'viem'
import Footer from '@/components/Footer'
import { walletSnapshotFor, type WalletSnapshot } from '@/lib/briefing-exec'
import { chartPairFor } from '@/lib/charts'

// /w/<address> — "run Yeetful on any wallet." A public, read-only briefing
// of what Yeetful notices in a wallet (public chain data only): open perp
// positions and whether visible protection exists, stranded/idle stables,
// HF drift, top holdings. Every suggestion links to /chat?prompt= — a URL
// never fires a turn (the prefill contract); the visitor runs the ask on
// THEIR wallet after connecting. The page is the demo; sharing it is the
// distribution loop.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ address: string }> }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const fmtUsd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { address } = await params
  if (!isAddress(address)) return { title: 'Wallet briefing — Yeetful' }
  const snap = await walletSnapshotFor(address).catch(() => null)
  const title = `What Yeetful noticed in ${short(address)} — wallet briefing`
  const description =
    snap && snap.needs > 0
      ? `${snap.needs} thing${snap.needs === 1 ? '' : 's'} need attention in this wallet — unprotected positions, stuck funds, idle stables. Yeetful builds the fix; only the owner's wallet can sign it.`
      : 'A live read of this wallet — positions, protection, idle funds. Run Yeetful on your own wallet: it notices, you sign.'
  return { title, description, openGraph: { title, description } }
}

function chipHref(prompt: string): string {
  return `/chat?prompt=${encodeURIComponent(prompt)}`
}

function BriefingRows({ snap }: { snap: WalletSnapshot }) {
  if (snap.rows.length === 0) {
    return (
      <p className="text-[13px] text-[color:var(--muted)]">
        Nothing needs attention in what we could read{snap.failed.length > 0 ? ` (couldn't check: ${snap.failed.join(', ')})` : ''} —
        no unprotected positions, no stuck funds. Quiet wallets are the goal.
      </p>
    )
  }
  return (
    <div className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
      {snap.rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[13.5px] font-medium">
                {r.chartSymbol && chartPairFor(r.chartSymbol) ? (
                  <Link href={`/t/${r.chartSymbol}`} className="hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </span>
              {r.value && (
                <span
                  className={`mono text-[11.5px] ${r.tone === 'neg' ? 'text-[color:var(--sell,#e5484d)]' : r.tone === 'pos' ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted)]'}`}
                >
                  {r.value}
                </span>
              )}
            </div>
            {r.sub && <p className="mt-0.5 text-[11.5px] text-[color:var(--muted)]">{r.sub}</p>}
          </div>
          {(r.actions ?? []).map((a) => (
            <Link
              key={a.label}
              href={chipHref(a.prompt)}
              className="rounded-lg border border-[var(--line-2)] px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--accent)] transition-colors hover:bg-[var(--surf-1)]"
              title={`Opens chat with “${a.prompt}” ready to send — runs on YOUR connected wallet`}
            >
              {a.label}
            </Link>
          ))}
        </div>
      ))}
    </div>
  )
}

export default async function WalletBriefingPage({ params }: Params) {
  const { address } = await params
  if (!isAddress(address)) {
    return (
      <>
        <main className="x-main px-4 py-16">
          <h1 className="font-serif text-2xl">That's not a wallet address.</h1>
          <p className="mt-2 text-[13px] text-[color:var(--muted)]">
            /w/ takes a 0x address — e.g. <span className="mono">/w/0x5Eaa…55a0</span>. ENS names are on the list.
          </p>
        </main>
        <Footer />
      </>
    )
  }

  const snap = await walletSnapshotFor(address).catch(() => null)
  const holdings = (snap?.portfolio?.holdings ?? []).slice(0, 6)

  return (
    <>
      <main className="x-main px-4 py-10">
        <p className="mono text-[10px] uppercase tracking-widest text-[color:var(--muted-2)]">
          wallet briefing · live read
        </p>
        <h1 className="mt-1 font-serif text-[26px] leading-tight">
          What Yeetful noticed in <span className="mono text-[22px]">{short(address)}</span>
        </h1>
        <p className="mt-2 max-w-xl text-[13px] text-[color:var(--muted)]">
          Public chain data, read live. Yeetful turns each line into a guarded transaction —
          only the owner's wallet can sign it. Tap a suggestion to try the same move on{' '}
          <em>your</em> wallet.
        </p>

        <section className="mt-8">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted)]">
              needs attention
            </h2>
            {snap && snap.needs > 0 && (
              <span className="mono text-[11px] text-[color:var(--sell,#e5484d)]">
                {snap.needs} need{snap.needs === 1 ? 's' : ''} the owner
              </span>
            )}
          </div>
          {snap ? (
            <BriefingRows snap={snap} />
          ) : (
            <p className="text-[13px] text-[color:var(--muted)]">
              Couldn't read this wallet right now — the chains didn't answer. Refresh in a minute.
            </p>
          )}
        </section>

        {holdings.length > 0 && (
          <section className="mt-8">
            <h2 className="mono mb-2 text-[11px] uppercase tracking-widest text-[color:var(--muted)]">
              top holdings{snap?.portfolio ? ` · ${fmtUsd(snap.portfolio.totalUsd)} across ${snap.portfolio.chainsWithHoldings} chain${snap.portfolio.chainsWithHoldings === 1 ? '' : 's'}` : ''}
            </h2>
            <div className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
              {holdings.map((h, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[13px] font-medium">
                    {chartPairFor(h.symbol) ? (
                      <Link href={`/t/${h.symbol.toUpperCase()}`} className="hover:underline">
                        {h.symbol.toUpperCase()}
                      </Link>
                    ) : (
                      h.symbol.toUpperCase()
                    )}
                  </span>
                  {h.chain && <span className="mono text-[10px] uppercase text-[color:var(--muted-2)]">{h.chain}</span>}
                  <span className="mono ml-auto text-[12px] tabular-nums text-[color:var(--muted)]">
                    {h.valueUsd != null ? fmtUsd(h.valueUsd) : h.balance}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-10 rounded-2xl border border-[var(--line-2)] bg-[var(--surf-1)] px-5 py-4">
          <p className="text-[14px] font-medium">This is what Yeetful sees in a wallet.</p>
          <p className="mt-1 text-[12.5px] text-[color:var(--muted)]">
            Connect yours and get the same briefing live in chat — protection, funding fixes, and
            recurring buys, each one a transaction only you can sign.
          </p>
          <Link
            href="/chat"
            className="mt-3 inline-block rounded-xl bg-[var(--accent)] px-4 py-2 text-[13px] font-semibold text-[color:var(--accent-ink,#04110b)] transition-opacity hover:opacity-90"
          >
            Get my briefing →
          </Link>
        </section>
      </main>
      <Footer />
    </>
  )
}
