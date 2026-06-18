'use client'

// Who's staking this MCP's token (x402-launch M6c). Fetches the bounded
// Staked-log scan from /api/mcp/[slug]/stakers — no indexer. Renders nothing
// until there's at least one current staker.

import { useEffect, useState } from 'react'

type Staker = { address: string; staked: string }

export default function Stakers({ slug, explorer }: { slug: string; explorer: string }) {
  const [stakers, setStakers] = useState<Staker[] | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/mcp/${slug}/stakers`)
      .then((r) => r.json())
      .then((d) => live && setStakers(Array.isArray(d.stakers) ? d.stakers : []))
      .catch(() => live && setStakers([]))
    return () => {
      live = false
    }
  }, [slug])

  if (!stakers || stakers.length === 0) return null

  return (
    <div>
      <p className="mono" style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--smoke)' }}>
        Participating ({stakers.length})
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {stakers.map((s) => (
          <div key={s.address} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <a
              href={`${explorer}/address/${s.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mono"
              style={{ fontSize: 13, wordBreak: 'break-all', textDecoration: 'underline', textDecorationColor: 'var(--mist)' }}
            >
              {s.address}
            </a>
            <span className="mono" style={{ fontSize: 13, color: 'var(--smoke)' }}>
              {Number(s.staked).toLocaleString(undefined, { maximumFractionDigits: 2 })} staked
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
