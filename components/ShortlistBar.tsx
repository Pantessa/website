'use client'

import { useRouter } from 'next/navigation'
import { Star, X } from 'lucide-react'
import { useYeetfulStore } from '@/lib/store'
import BrandIcon from '@/components/BrandIcon'

/** The wallet's saved MCP shortlist, shown as a compact strip on the directory.
 *  Renders nothing until at least one service is pinned. "Chat with these"
 *  seeds the chat's active set from the shortlist and jumps to /chat. */
export default function ShortlistBar() {
  const { shortlistIds, servers, toggleShortlist, setActiveServerIds } = useYeetfulStore()
  const router = useRouter()
  const picked = shortlistIds
    .map((id) => servers.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)

  if (picked.length === 0) return null

  return (
    <div className="shortlistbar">
      <div className="shortlistbar__label mono">
        <Star width={13} height={13} strokeWidth={2.5} fill="#3ECF8E" color="#3ECF8E" />
        MY SHORTLIST
        <span className="shortlistbar__count">{picked.length}/3</span>
      </div>
      <div className="shortlistbar__chips">
        {picked.map((s) => (
          <span key={s.id} className="shortlistbar__chip">
            <BrandIcon server={s} size={13} />
            {s.name}
            <button
              className="shortlistbar__x"
              onClick={() => toggleShortlist(s.id)}
              aria-label={`Remove ${s.name} from shortlist`}
              title="Remove from shortlist"
            >
              <X width={12} height={12} strokeWidth={2.5} />
            </button>
          </span>
        ))}
      </div>
      <button
        className="btn btn--ghost shortlistbar__go"
        onClick={() => {
          setActiveServerIds(shortlistIds)
          router.push('/chat')
        }}
      >
        Chat with these →
      </button>
    </div>
  )
}
