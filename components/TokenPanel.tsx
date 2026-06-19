import Link from 'next/link'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { feeSharePct, shortAddr, type TokenPanelData } from '@/lib/launch-token'
import { usdCompact } from '@/lib/format'
import ClaimMcp from '@/components/ClaimMcp'
import LaunchToken from '@/components/LaunchToken'
import TradeToken from '@/components/TradeToken'
import TokenPriceChart from '@/components/TokenPriceChart'
import StakeToken from '@/components/StakeToken'
import Stakers from '@/components/Stakers'
import McpStats from '@/components/McpStats'

/** A reasonable default ticker from the MCP name/slug (the owner can edit it). */
function defaultTicker(name: string, slug: string): string {
  const fromName = (name.match(/[A-Za-z0-9]+/g) ?? []).join('')
  return (fromName || slug.replace(/[^A-Za-z0-9]/g, '')).slice(0, 6).toUpperCase() || 'MCP'
}

/** A labelled, full (untruncated) address linking to the block explorer. */
function AddrRow({ label, addr, href }: { label: string; addr: string; href: string }) {
  return (
    <div className="tok__addr">
      <span className="tok__addrlbl mono">{label}</span>
      <a href={href} target="_blank" rel="noopener noreferrer" className="tok__addrval mono">
        {addr}
      </a>
    </div>
  )
}

/** One cell of the Hyperliquid-style market strip. */
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="tok__stat">
      <span className="tok__statlbl">{label}</span>
      <span className={`tok__statval${accent ? ' tok__statval--accent' : ''}`}>{value}</span>
    </span>
  )
}

/**
 * Per-MCP token panel on the service page (x402-launch M6). Takes the already-
 * fetched panel (the page owns the fetch so it can lay the page out). The
 * launched state returns three grid areas as a fragment — `lead` (market strip +
 * chart), `detail` (how-it-trades / contract / stakers), and a sticky `rail`
 * (trade + earn) — that the page drops into its pump.fun-style split grid.
 * claimed / unclaimed return a single self-contained section.
 */
export default function TokenPanel({
  panel,
  slug,
  name,
}: {
  panel: TokenPanelData
  slug: string
  name: string
}) {
  const pct = feeSharePct(panel.feeShareBps)

  if (panel.state === 'launched' && panel.token) {
    const token = panel.token
    return (
      <>
        <div className="svc__lead">
          {/* Market strip — the dense, tabular at-a-glance readout. */}
          <div className="tok__strip">
            {token.market && (
              <>
                <Stat label="price" value={usdCompact(token.market.priceUsd)} />
                <Stat label="market cap" value={usdCompact(token.market.marketCapUsd)} />
              </>
            )}
            <Stat
              label="staked"
              value={Number(token.totalStaked).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            />
            <Stat label="rev share" value={`${pct}%`} accent />
          </div>

          <p className="tok__prose tok__lede">
            <strong>Earn as the agent works.</strong> Stake this MCP&rsquo;s token to receive{' '}
            <strong style={{ color: 'var(--accent)' }}>{pct}%</strong> of every paid call, in USDC.
          </p>

          {/* Price — hero spot + 24h chip + history sampled from the v4 pool. */}
          <div className="tok__card">
            <TokenPriceChart slug={slug} />
          </div>
        </div>

        <div className="svc__detail">
          {/* Performance — how the MCP is doing (settled, calls, accounts, usage). */}
          <McpStats slug={slug} />

          {/* How it trades — Flaunch puts the token on a Uniswap v4 pool at launch. */}
          <div className="tok__card">
            <p className="tok__cardhead">How it trades</p>
            <p className="tok__prose">
              Live on a Uniswap&nbsp;v4 pool from launch — no graduation step. The first ~30 minutes
              is a fixed-price <strong>fair launch</strong> (buys only, everyone the same price), then
              open trading. A <strong>Progressive Bid Wall</strong> turns trading fees into rising
              buy-side support for the price.
            </p>
          </div>

          {/* Contract — full addresses fold away; the verified badge stays visible. */}
          <details className="tok__details">
            <summary>
              <ChevronRight className="tok__chev" size={14} />
              Contract details
              {panel.owner && (
                <span className="tok__verified mono">✓ verified ({panel.owner.verifiedVia})</span>
              )}
            </summary>
            <div className="tok__detailsbody">
              <AddrRow label="Token" addr={token.address} href={`${token.explorer}/token/${token.address}`} />
              <AddrRow label="Staking vault" addr={token.staking} href={`${token.explorer}/address/${token.staking}`} />
              {panel.owner && (
                <AddrRow
                  label="Creator"
                  addr={panel.owner.ownerAddress}
                  href={`${token.explorer}/address/${panel.owner.ownerAddress}`}
                />
              )}
              <Link
                href={`${token.explorer}/token/${token.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="svc__ext mono"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: 'max-content' }}
              >
                View on Basescan <ExternalLink size={13} />
              </Link>
            </div>
          </details>

          <Stakers slug={slug} explorer={token.explorer} />
        </div>

        <aside className="svc__rail">
          {/* Trade — buy with ETH or sell for ETH through the v4 pool. */}
          <div className="tok__card tok__card--rail">
            <p className="tok__cardhead">Trade the token</p>
            <TradeToken token={token.address} />
          </div>

          {/* Participate — stake to earn the rev share, claim USDC any time. */}
          <div className="tok__card tok__card--rail">
            <p className="tok__cardhead">Stake to earn — {pct}% of every paid call, in USDC</p>
            <StakeToken token={token.address} staking={token.staking} />
          </div>
        </aside>
      </>
    )
  }

  // ── Not launched: a single self-contained section (claimed / unclaimed). ──
  const boxStyle = {
    border: '1px solid var(--mist)',
    borderRadius: 12,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  }
  const labelStyle = { color: 'var(--smoke)' } as const

  return (
    <div className="svc__section">
      <div className="svc__sectionhead">
        <h2 className="svc__h2">Token</h2>
        <span className="svc__count mono">own a piece</span>
      </div>

      {panel.state === 'claimed' && (
        <div style={boxStyle}>
          <p style={{ margin: 0 }}>
            Claimed by <strong>{shortAddr(panel.owner?.ownerAddress ?? '')}</strong>{' '}
            <span
              className="mono"
              title={`Verified via ${panel.owner?.verifiedVia}`}
              style={{ color: 'var(--accent)', fontSize: 13 }}
            >
              ✓ verified
            </span>
            . Token not launched yet.
          </p>
          <p className="mono" style={{ margin: 0, fontSize: 14, ...labelStyle }}>
            Once a token launches, {pct}% of every paid call settles to stakers.
          </p>
          <LaunchToken
            slug={slug}
            name={name}
            defaultSymbol={defaultTicker(name, slug)}
            ownerAddress={panel.owner?.ownerAddress ?? ''}
          />
          <ClaimMcp slug={slug} ownerAddress={panel.owner?.ownerAddress ?? null} />
        </div>
      )}

      {panel.state === 'unclaimed' && (
        <div style={boxStyle}>
          <p style={{ margin: 0 }}>
            <strong>Own a piece of this MCP.</strong> Its operator can launch a token, and{' '}
            {pct}% of every paid call flows to whoever stakes it — the better the MCP does, the more
            value flows.
          </p>
          <p className="mono" style={{ margin: 0, fontSize: 14, ...labelStyle }}>
            Operate this MCP? Claim it by signing in with the wallet it&apos;s paid to.
          </p>
          <ClaimMcp slug={slug} ownerAddress={null} />
        </div>
      )}
    </div>
  )
}
