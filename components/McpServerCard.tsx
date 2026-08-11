'use client'

import Link from 'next/link'
import { Check, Plus, ExternalLink, ArrowUpRight, Star } from 'lucide-react'
import { McpServer, useYeetfulStore } from '@/lib/store'
import BrandIcon from '@/components/BrandIcon'
import { cleanServerName } from '@/lib/utils'

const ACCENT = '#3ECF8E'
const MAX_SHORTLIST = 3

interface McpServerCardProps {
  server: McpServer
  index?: number
}

export default function McpServerCard({ server }: McpServerCardProps) {
  const { activeServerIds, toggleServer, shortlistIds, toggleShortlist } = useYeetfulStore()
  const active = activeServerIds.includes(server.id)
  const pinned = shortlistIds.includes(server.id)
  const shortlistFull = shortlistIds.length >= MAX_SHORTLIST

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
                title={`${cleanServerName(server.name)} — endpoints & pricing`}
              >
                {cleanServerName(server.name)}
              </Link>
            </h3>
            <span className="card__cat mono">{server.category}</span>
          </div>
        </div>
        <div className="card__acts">
          <button
            className={`card__star ${pinned ? 'is-pinned' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleShortlist(server.id)
            }}
            disabled={!pinned && shortlistFull}
            aria-pressed={pinned}
            title={
              pinned
                ? 'In your shortlist — click to remove'
                : shortlistFull
                  ? `Shortlist is full (max ${MAX_SHORTLIST})`
                  : 'Add to your shortlist'
            }
            aria-label={pinned ? 'Remove from shortlist' : 'Add to shortlist'}
          >
            <Star width={13} height={13} strokeWidth={2.5} fill={pinned ? ACCENT : 'none'} />
          </button>
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
      </div>

      <p className="card__desc">{server.description}</p>

      <div className="card__foot">
        <div className="card__badges">
          {server.gated === false ? (
            <span className="badge badge--price mono" style={{ color: ACCENT, borderColor: ACCENT }} title="No payment gate — free MCP by Pantessa, rate-limited">
              FREE
            </span>
          ) : (
            <span className="badge badge--price mono">${server.priceUsd}/call</span>
          )}
          {server.reputation && server.reputation.settled > 0 && (
            <span
              className="badge mono"
              style={{ color: ACCENT, borderColor: ACCENT }}
              title={`${server.reputation.settled} settled paid calls via Pantessa`}
            >
              ✓ {Math.round(server.reputation.settleRate * 100)}% · {server.reputation.settled}
            </span>
          )}
          {active ? (
            <span className="badge badge--live" style={{ color: ACCENT, borderColor: ACCENT }}>
              <span className="badge__dot" style={{ background: ACCENT }} />
              On
            </span>
          ) : server.callable || server.autoCallable ? (
            // Wired or planner-auto-callable: it works the moment you select it.
            null
          ) : (
            <span className="badge badge--dir mono">Directory</span>
          )}
        </div>
        <div className="card__links">
          <Link
            className="card__more mono"
            href={`/servers/${server.slug}`}
            onClick={(e) => e.stopPropagation()}
            title="Endpoints & pricing"
          >
            Details
            <ArrowUpRight width={11} height={11} />
          </Link>
          {(server.callable || server.autoCallable) && (
            <Link
              className="card__more mono"
              href={`/chat?try=${server.slug}`}
              onClick={(e) => e.stopPropagation()}
              title={`Try ${cleanServerName(server.name)} in chat`}
            >
              Try in chat
              <ArrowUpRight width={11} height={11} />
            </Link>
          )}
          {server.websiteUrl && (
            <a
              className="card__ext"
              href={server.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={`See info for ${cleanServerName(server.name)}`}
            >
              <ExternalLink width={13} height={13} />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
