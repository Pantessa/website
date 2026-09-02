'use client'

import { useCallback, useEffect, useState } from 'react'
import ChatLoader from '@/components/ChatLoader'
import LinksBoardView from '@/components/LinksBoardView'
import type { CreatorPageRow, LinksBoard } from '@/lib/links-board'
import type { HouseLink } from '@/lib/house-links'

// The chat surface's LINKS view — the spine's LINKS destination renders the
// PUBLIC /links page in the main screen (same LinksBoardView markup, board
// on top), so "see my links" lands on the live board + mint composer
// instead of just a drawer. Data comes from GET /api/links/board; a mint
// from the in-place composer re-reads with fresh=1 so the new link shows on
// Recently minted immediately instead of after the route's 60s cache.

interface BoardPayload {
  board: LinksBoard
  house: HouseLink[]
  pages: CreatorPageRow[]
}

export default function LinksWorkspace() {
  const [data, setData] = useState<BoardPayload | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (fresh?: boolean) => {
    setFailed(false)
    try {
      const r = await fetch(`/api/links/board${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      setData((await r.json()) as BoardPayload)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (failed && !data) {
    return (
      <div className="flex-1 grid place-items-center py-16">
        <div className="text-center space-y-2">
          <p className="text-[13px] text-[color:var(--muted-2)]">The board didn&apos;t load.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[12px] font-medium text-[color:var(--accent)] hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!data) return <ChatLoader inline />

  return (
    <LinksBoardView
      board={data.board}
      house={data.house}
      pages={data.pages}
      inApp
      onMinted={() => void load(true)}
    />
  )
}
