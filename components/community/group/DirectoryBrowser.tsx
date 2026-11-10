'use client'

// /g — every room, with one switch for the order (squad community, lane
// GROUP). The switch is page state, not a query: the page stays static and
// nobody later opens it wearing a stale ?sort=.

import { useState } from 'react'
import CommunityDirectory, { type DirectorySort } from './CommunityDirectory'

const SORTS: { id: DirectorySort; label: string }[] = [
  { id: 'members', label: 'Most members' },
  { id: 'new', label: 'Newest' },
  { id: 'active', label: 'Most active' },
]

export default function DirectoryBrowser() {
  const [sort, setSort] = useState<DirectorySort>('members')
  return (
    <>
      <div className="grp-sorts" role="tablist" aria-label="Order rooms by">
        {SORTS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === sort} className={`grp-sorts__tab${s.id === sort ? ' is-on' : ''}`} onClick={() => setSort(s.id)} data-sort={s.id} data-journey={`Rooms sort: ${s.label}`}>
            {s.label}
          </button>
        ))}
      </div>
      <CommunityDirectory variant="full" sort={sort} />
    </>
  )
}
