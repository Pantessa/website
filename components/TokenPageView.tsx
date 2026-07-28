'use client'

// The /t/<symbol> page body: chart hero + trade-in-chat CTAs. Client-side
// because the price header feeds off the chart's own live poll (onStats) —
// one data path for the candles and the headline number.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChartCandlestick } from 'lucide-react'
import CandleChart, { fmtPrice, type ChartStats } from '@/components/CandleChart'
import TokenIcon from '@/components/TokenIcon'
import { chartPairFor } from '@/lib/charts'

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`

export default function TokenPageView({ symbol }: { symbol: string }) {
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const [stats, setStats] = useState<ChartStats | null>(null)

  const chg = stats?.changePct24h ?? null
  const chgClass = chg === null ? 'tok__chg--flat' : chg > 0 ? 'tok__chg--up' : chg < 0 ? 'tok__chg--down' : 'tok__chg--flat'
  const chgLabel = chg === null ? '24h —' : `${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}% 24h`
  const sym = pair?.symbol ?? symbol

  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      {/* Header: token + pair + live price */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <TokenIcon symbol={sym} size={36} />
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[color:var(--fg)]">
            {pair ? pair.label : sym || 'Token'}
            <ChartCandlestick className="h-4 w-4 text-[color:var(--muted-2)]" aria-hidden />
          </h1>
          <p className="mono text-[10.5px] uppercase tracking-widest text-[color:var(--muted-2)]">
            {pair ? `Live chart · ${pair.source}` : 'No live chart yet'}
          </p>
        </div>
        {pair && stats?.last != null && (
          <div className="ml-auto text-right">
            <div className="tok__price mono text-[color:var(--fg)]">${fmtPrice(stats.last)}</div>
            <div className={`tok__chg ${chgClass}`}>{chgLabel}</div>
          </div>
        )}
      </div>

      {pair ? (
        <CandleChart symbol={sym} height={420} onStats={setStats} />
      ) : (
        <div className="rounded-2xl border border-[var(--line)] px-5 py-10 text-center">
          <p className="text-[14px] text-[color:var(--fg)]">
            No live chart for {sym || 'this token'} yet.
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[color:var(--muted)]">
            Stablecoins chart flat by design, and tokenized stocks get their candle feed next.
            You can still act on it in chat — one sentence, guarded, signed only by your wallet.
          </p>
        </div>
      )}

      {/* Act on it — prefill contract: the composer fills, the user sends. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {sym && (
          <>
            <Link
              href={promptHref(`Buy $50 of ${sym}`)}
              className="rounded-full border border-[var(--line-2)] px-3.5 py-1.5 text-[12px] font-medium text-[color:var(--accent)] transition-colors hover:bg-white/[0.04]"
            >
              Buy {sym} in chat
            </Link>
            <Link
              href={promptHref(`DCA $10 into ${sym} weekly`)}
              className="rounded-full border border-[var(--line)] px-3.5 py-1.5 text-[12px] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:text-[color:var(--fg)]"
            >
              DCA {sym} weekly
            </Link>
            <Link
              href={promptHref(`Sell $50 of ${sym}`)}
              className="rounded-full border border-[var(--line)] px-3.5 py-1.5 text-[12px] text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:text-[color:var(--fg)]"
            >
              Sell {sym}
            </Link>
          </>
        )}
        <span className="mono ml-auto text-[10px] uppercase tracking-widest text-[color:var(--muted-2)]">
          Non-custodial · your wallet signs
        </span>
      </div>
    </section>
  )
}
