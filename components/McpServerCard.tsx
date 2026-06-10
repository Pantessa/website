'use client'

import Link from 'next/link'
import { Check, Plus, ExternalLink } from 'lucide-react'
import { McpServer, useYeetfulStore } from '@/lib/store'
import BrandIcon from '@/components/BrandIcon'

const ACCENT = '#3ECF8E'

interface McpServerCardProps {
  server: McpServer
  index?: number
}

export default function McpServerCard({ server }: McpServerCardProps) {
  const { activeServerIds, toggleServer } = useYeetfulStore()
  const active = activeServerIds.includes(server.id)

  return (
    <div className={`card ${active ? 'is-active' : ''}`} onClick={() => toggleServer(server.id)}>
      <div className="card__top">
        <div className="card__id">
          <div className="card__tile">
            <BrandIcon server={server} size={22} />
          </div>
          <div className="card__name">
            <h3>
              {/* Card click toggles selection; the name links to the detail page. */}
              <Link
                href={`/servers/${server.slug}`}
                className="card__link"
                onClick={(e) => e.stopPropagation()}
                title={`${server.name} — endpoints & pricing`}
              >
                {server.name}
              </Link>
            </h3>
            <span className="card__cat mono">{server.category}</span>
          </div>
        </div>
        <button
          className="card__btn"
          onClick={(e) => {
            e.stopPropagation()
            toggleServer(server.id)
          }}
          aria-label={active ? 'Remove agent' : 'Add agent'}
        >
          {active ? <Check width={13} height={13} strokeWidth={3.5} /> : <Plus width={13} height={13} strokeWidth={3} />}
        </button>
      </div>

      <p className="card__desc">{server.description}</p>

      <div className="card__foot">
        <div className="card__badges">
          <span className="badge badge--price mono">${server.priceUsd}/call</span>
          {active ? (
            <span className="badge badge--live" style={{ color: ACCENT, borderColor: ACCENT }}>
              <span className="badge__dot" style={{ background: ACCENT }} />
              On
            </span>
          ) : !server.callable ? (
            <span className="badge badge--dir mono">Directory</span>
          ) : null}
        </div>
        {server.websiteUrl && (
          <a
            className="card__ext"
            href={server.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="View on agentic.market"
          >
            <ExternalLink width={13} height={13} />
          </a>
        )}
      </div>
    </div>
  )
}
