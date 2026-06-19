'use client'

// Who's staking this MCP's token (x402-launch M6c). Fetches the bounded
// Staked-log scan from /api/mcp/[slug]/stakers — no indexer. Renders nothing
// until there's at least one current staker.

import { useEffect, useState } from 'react'

type Staker = { address: string; staked: string }

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

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
    <div className="tok__card">
      <p className="tok__cardhead">Participating ({stakers.length})</p>
      <div className="tok__stakers">
        {stakers.map((s) => (
          <div key={s.address} className="tok__stakerrow">
            <a
              href={`${explorer}/address/${s.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tok__stakeraddr"
              title={s.address}
            >
              {short(s.address)}
            </a>
            <span className="tok__stakerstk">
              {Number(s.staked).toLocaleString(undefined, { maximumFractionDigits: 2 })} staked
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
