'use client'

import Link from 'next/link'
import { useYeetfulStore } from '@/lib/store'
import BrandIcon from '@/components/BrandIcon'

export default function ActiveServerBar() {
  const { activeServerIds, servers, clearActiveServers } = useYeetfulStore()
  const activeServers = servers.filter((s) => activeServerIds.includes(s.id))

  if (activeServers.length === 0) return null

  return (
    <div className="activebar">
      <div className="activebar__count">
        <span className="activebar__num mono">{activeServers.length}</span>
        <span>in runner</span>
      </div>
      <div className="activebar__chips">
        {activeServers.map((s) => (
          <span key={s.id} className="activebar__chip">
            <span className="activebar__chipglyph">
              <BrandIcon server={s} size={12} />
            </span>
            {s.name}
          </span>
        ))}
      </div>
      <div className="activebar__actions">
        <button className="activebar__clear" onClick={clearActiveServers}>
          Clear
        </button>
        <Link href="/chat" className="activebar__go">
          Start chat →
        </Link>
      </div>
    </div>
  )
}
