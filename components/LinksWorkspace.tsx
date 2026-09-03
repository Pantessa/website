'use client'

import { useCallback, useEffect, useState } from 'react'
import ChatLoader from '@/components/ChatLoader'
import LinksBoardView from '@/components/LinksBoardView'
import LinksStudioView from '@/components/LinksStudioView'
import { useSession } from '@/lib/session'
import type { CreatorPageRow, LinksBoard } from '@/lib/links-board'
import type { HouseLink } from '@/lib/house-links'

// The chat surface's LINKS destination.
//
// SIGNED IN it renders the creator's OWN studio — the same LinksStudioView
// the dashboard's Intent links page composes (name your page, mint, funnel,
// earnings). It used to open on the public leaderboard, which is the wrong
// answer to "show me my links": a creator checking their own funnel landed
// on everyone else's board and had to navigate to the dashboard anyway.
// The board is still one tap away from the studio's header.
//
// SIGNED OUT there is nothing personal to show, so the public board stays —
// it is the live proof, and its mint composer's press IS the sign-in door
// (guestDoor). Data comes from GET /api/links/board; a mint from the
// in-place composer re-reads with fresh=1 so the new link shows on Recently
// minted immediately instead of after the route's 60s cache.

interface BoardPayload {
  board: LinksBoard
  house: HouseLink[]
  pages: CreatorPageRow[]
}

function PublicBoard() {
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

export default function LinksWorkspace() {
  const { address, status } = useSession()

  // Hold the flip until the session settles — `address` is null while
  // status === 'loading', and rendering the public board for a beat before
  // swapping to the studio reads as a glitch.
  if (status === 'loading') return <ChatLoader inline />
  return address ? <LinksStudioView inApp /> : <PublicBoard />
}
