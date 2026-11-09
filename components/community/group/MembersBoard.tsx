'use client'

// THE MEMBERS BOARD — who brought people, and who traded with proof (squad
// community, lane GROUP). Two rankings off GET /api/communities/<slug>/members.
// A row is a label and a number: a claimed handle, a short wallet or the name
// the platform reported, never an id. A member with nothing to count is not
// ranked; a room with nobody ranked yet shows who is in it instead.

import { useEffect, useState } from 'react'
import type { PublicMember } from '@/lib/community/spec'
import { useRoom, type BoardSort } from './Room'

const TABS: { id: BoardSort; label: string; unit: (n: number) => string; none: string }[] = [
  { id: 'invites', label: 'Brought the most', unit: (n) => (n === 1 ? 'member' : 'members'), none: 'Nobody has brought a member yet. Share your invite link to be first.' },
  { id: 'trades', label: 'Traded with proof', unit: (n) => (n === 1 ? 'verified trade' : 'verified trades'), none: 'No member has a verified trade on record yet.' },
]
const SHOWN = 10
const valueOf = (m: PublicMember, sort: BoardSort) => (sort === 'invites' ? m.invited : m.verifiedTrades)

function RoleMark({ role }: { role: PublicMember['role'] }) {
  if (role === 'member') return null
  return <span className={`grp-role grp-role--${role}`}>{role === 'owner' ? 'Owner' : 'Mod'}</span>
}

export default function MembersBoard() {
  const { boards, loadBoard } = useRoom()
  const [tab, setTab] = useState<BoardSort>('invites')
  useEffect(() => {
    loadBoard(tab)
  }, [tab, loadBoard])

  const meta = TABS.find((t) => t.id === tab)!
  const data = boards[tab]
  const ranked = Array.isArray(data) ? data.filter((m) => valueOf(m, tab) > 0).slice(0, SHOWN) : []
  const everyone = Array.isArray(data) ? data.slice(0, SHOWN) : []

  return (
    <section className="grp-board" aria-label="Members board" data-members-board>
      <div className="grp-board__tabs" role="tablist" aria-label="Rank members by">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className={`grp-board__tab${t.id === tab ? ' is-on' : ''}`} onClick={() => setTab(t.id)} data-board-tab={t.id} data-journey={`Room board: ${t.label}`}>
            {t.label}
          </button>
        ))}
      </div>
      {data === undefined ? (
        <p className="grp-board__note" aria-busy="true">
          Loading…
        </p>
      ) : data === 'error' ? (
        <p className="grp-board__note">The board could not be loaded.</p>
      ) : ranked.length > 0 ? (
        <ol className="grp-board__rows" data-board-rows={tab}>
          {ranked.map((m, i) => (
            <li key={`${m.label}-${m.joinedAt}-${i}`} className="grp-board__row">
              <span className="grp-board__rank">{i + 1}</span>
              <span className="grp-board__who">
                <span className="grp-board__label">{m.label}</span>
                <RoleMark role={m.role} />
              </span>
              <span className="grp-board__num">
                {valueOf(m, tab).toLocaleString('en-US')} <small>{meta.unit(valueOf(m, tab))}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <>
          <p className="grp-board__note">{meta.none}</p>
          {everyone.length > 0 && (
            <ul className="grp-board__rows grp-board__rows--plain" data-board-rows="members">
              {everyone.map((m, i) => (
                <li key={`${m.label}-${m.joinedAt}-${i}`} className="grp-board__row">
                  <span className="grp-board__who">
                    <span className="grp-board__label">{m.label}</span>
                    <RoleMark role={m.role} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
