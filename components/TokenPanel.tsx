import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { getTokenPanel, feeSharePct, shortAddr } from '@/lib/launch-token'
import ClaimMcp from '@/components/ClaimMcp'
import LaunchToken from '@/components/LaunchToken'
import BuyToken from '@/components/BuyToken'
import StakeToken from '@/components/StakeToken'
import Stakers from '@/components/Stakers'

/** A reasonable default ticker from the MCP name/slug (the owner can edit it). */
function defaultTicker(name: string, slug: string): string {
  const fromName = (name.match(/[A-Za-z0-9]+/g) ?? []).join('')
  return (fromName || slug.replace(/[^A-Za-z0-9]/g, '')).slice(0, 6).toUpperCase() || 'MCP'
}

/** A labelled, full (untruncated) address linking to the block explorer. */
function AddrRow({ label, addr, href, badge }: { label: string; addr: string; href: string; badge?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span className="mono" style={{ color: 'var(--smoke)', fontSize: 13, minWidth: 96 }}>
        {label}
      </span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mono"
        style={{ fontSize: 13, wordBreak: 'break-all', textDecoration: 'underline', textDecorationColor: 'var(--mist)' }}
      >
        {addr}
      </a>
      {badge && <span style={{ color: 'var(--accent)', fontSize: 13 }}>{badge}</span>}
    </div>
  )
}

/**
 * Per-MCP token panel on the service page (x402-launch M6). Read-only: shows the
 * launchpad state (unclaimed → claimed → launched) + live staking. Wallet actions
 * (claim / buy / stake / claim-fees) land in a follow-up (M6b).
 */
export default async function TokenPanel({
  slug,
  name,
  tokenAddress,
  stakingAddress,
}: {
  slug: string
  name: string
  tokenAddress: string | null
  stakingAddress: string | null
}) {
  const panel = await getTokenPanel({ slug, tokenAddress, stakingAddress })
  const pct = feeSharePct(panel.feeShareBps)

  const labelStyle = { color: 'var(--smoke)' } as const
  const boxStyle = {
    border: '1px solid var(--mist)',
    borderRadius: 12,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  }

  return (
    <div className="svc__section">
      <div className="svc__sectionhead">
        <h2 className="svc__h2">Token</h2>
        <span className="svc__count mono">own a piece</span>
      </div>

      {panel.state === 'launched' && panel.token && (
        <div style={boxStyle}>
          <p style={{ margin: 0 }}>
            <strong>Earn as the agent works.</strong> Stake this MCP&rsquo;s token to receive{' '}
            <strong style={{ color: 'var(--accent)' }}>{pct}%</strong> of every paid call, in USDC.
          </p>

          {/* Full addresses, each linking to the block explorer. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <AddrRow
              label="Token"
              addr={panel.token.address}
              href={`${panel.token.explorer}/token/${panel.token.address}`}
            />
            <AddrRow
              label="Staking vault"
              addr={panel.token.staking}
              href={`${panel.token.explorer}/address/${panel.token.staking}`}
            />
            {panel.owner && (
              <AddrRow
                label="Creator"
                addr={panel.owner.ownerAddress}
                href={`${panel.token.explorer}/address/${panel.owner.ownerAddress}`}
                badge={`✓ verified (${panel.owner.verifiedVia})`}
              />
            )}
          </div>

          <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 28px', fontSize: 14 }}>
            <span>
              <span style={labelStyle}>staked </span>
              {Number(panel.token.totalStaked).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span>
              <span style={labelStyle}>rev share </span>
              {pct}%
            </span>
          </div>

          {/* How it trades — Flaunch puts the token on a Uniswap v4 pool at launch. */}
          <div>
            <p className="mono" style={{ margin: '0 0 4px', fontSize: 13, ...labelStyle }}>
              How it trades
            </p>
            <p style={{ margin: 0, fontSize: 14 }}>
              Live on a Uniswap&nbsp;v4 pool from launch — no graduation step. The first ~30 minutes
              is a fixed-price <strong>fair launch</strong> (buys only, everyone the same price),
              then open trading. A <strong>Progressive Bid Wall</strong> turns trading fees into
              rising buy-side support for the price.
            </p>
          </div>

          {/* Buy — acquire the token with ETH through its v4 pool, then stake below. */}
          <div>
            <p className="mono" style={{ margin: '0 0 8px', fontSize: 13, ...labelStyle }}>
              Buy the token
            </p>
            <BuyToken token={panel.token.address} />
          </div>

          {/* Participate — stake to earn the rev share, claim USDC any time. */}
          <div>
            <p className="mono" style={{ margin: '0 0 8px', fontSize: 13, ...labelStyle }}>
              Stake to earn — {pct}% of every paid call, in USDC
            </p>
            <StakeToken token={panel.token.address} staking={panel.token.staking} />
          </div>

          <Stakers slug={slug} explorer={panel.token.explorer} />

          <Link
            href={`${panel.token.explorer}/token/${panel.token.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="svc__ext mono"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: 'max-content' }}
          >
            View on Basescan <ExternalLink size={13} />
          </Link>
        </div>
      )}

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
