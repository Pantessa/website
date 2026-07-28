'use client'

// Rich portfolio card — renders a `kind:"portfolio"` tool payload (the wallet
// MCP) inside an assistant bubble instead of leaving balances as prose.
// Same visual language as the splash dashboard's holdings tile, plus per-chain
// subtotal chips, share bars, and a freshness stamp (the whole point: this is
// LIVE data, re-fetched after every transaction).

import { Wallet } from 'lucide-react'
import type { PortfolioDisplay, PortfolioHolding } from '@/lib/portfolio-display'

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

// Stable accent hue per symbol so USDC looks the same in every card.
function hueOf(symbol: string): number {
  let h = 0
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360
  return h
}

function TokenDot({ h }: { h: PortfolioHolding }) {
  const hue = hueOf(h.symbol)
  return (
    <span
      className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-[10px] font-semibold"
      style={{
        background: `hsl(${hue} 60% 50% / 0.15)`,
        color: `hsl(${hue} 70% 70%)`,
        border: `1px solid hsl(${hue} 60% 50% / 0.25)`,
      }}
    >
      {h.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || '?'}
    </span>
  )
}

export default function PortfolioCard({ data }: { data: PortfolioDisplay }) {
  const max = Math.max(...data.holdings.map((h) => h.valueUsd ?? 0), 0.01)
  const fetchedAt = data.updatedAt ? new Date(data.updatedAt) : null
  // Surface is plain --surf-1 (the panel fill every other card uses): Tailwind
  // can't opacity-modify a CSS-var color, so `bg-[var(--surf-2)]/60` painted
  // nothing at all. --surf-1 is what that blend was reaching for anyway.
  return (
    <div className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4 not-prose">
      {/* Header: owner + total */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-3.5 w-3.5 text-[color:var(--muted-2)]" />
          <span className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">
            Portfolio · {shortAddr(data.owner)}
          </span>
        </div>
        <span className="text-2xl font-semibold tracking-tight text-white">{usd(data.totalUsd)}</span>
      </div>

      {/* Per-chain subtotal chips */}
      {data.chains.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {data.chains.map((c) => (
            <span
              key={c.chain}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white/[0.03] px-2 py-0.5 text-[10px] text-[color:var(--muted)]"
            >
              <span className="font-medium text-white">{c.chain}</span>
              {usd(c.usd)}
              <span className="text-[color:var(--muted-2)]">
                · {c.holdings} asset{c.holdings === 1 ? '' : 's'}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Holdings */}
      <div className="mt-3 space-y-2">
        {data.holdings.map((h) => {
          const share = h.valueUsd !== null && h.valueUsd !== undefined ? Math.max(0.02, h.valueUsd / max) : 0
          return (
            <div key={`${h.chain}:${h.address ?? 'native'}:${h.symbol}`} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <TokenDot h={h} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-white">{h.symbol}</span>
                      {h.native && <span className="mono text-[9px] text-[color:var(--muted-2)]">native</span>}
                      <span className="rounded bg-white/5 px-1 py-0.5 text-[9px] text-[color:var(--muted-2)]">{h.chain}</span>
                    </div>
                    {h.name && <div className="truncate text-[10px] text-[color:var(--muted-2)]">{h.name}</div>}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-white">{h.valueUsd !== null && h.valueUsd !== undefined ? usd(h.valueUsd) : '—'}</div>
                  <div className="text-[10px] text-[color:var(--muted-2)]">
                    {h.balance} {h.symbol}
                  </div>
                </div>
              </div>
              {/* Share bar */}
              {share > 0 && (
                <div className="ml-9 mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.04]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round(share * 100)}%`, background: 'var(--accent)', opacity: 0.55 }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer: dust + freshness */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-[10px] text-[color:var(--muted-2)]">
        <span>{data.hiddenDust ? `${data.hiddenDust} dust/unpriced token${data.hiddenDust === 1 ? '' : 's'} hidden` : 'Spam filtered'}</span>
        <span className="mono">
          live on-chain data{fetchedAt ? ` · ${fetchedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>
    </div>
  )
}
