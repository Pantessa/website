'use client'

// The bar over the chart after "Draw it on the <SYM> chart" in a room's (or
// the feed's) composer, 2026-11-20. It says where the drawing is headed and
// carries the way back: "Post to <room>" opens this page's Community tab,
// where the composer already holds the draft with the room picked and the
// live lines ready to attach (components/community/draw-handoff).

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { clearDrawFor, readDrawFor, type DrawFor } from '@/components/community/draw-handoff'
import '../comm.css'

export default function DrawForBar({ symbol, lines, onPost }: { symbol: string; lines: number; onPost: () => void }) {
  const [note, setNote] = useState<DrawFor | null>(null)
  useEffect(() => setNote(readDrawFor(symbol)), [symbol])
  if (!note) return null
  const drop = () => {
    clearDrawFor()
    setNote(null)
  }
  return (
    <div className="mkd" role="region" aria-label="Drawing for a post" data-draw-for={note.room || 'board'}>
      <p className="mkd__text">
        <span className="mkd__k">Drawing for</span> <strong>{note.label}</strong>.{' '}
        <span className="mkd__hint">
          {lines > 0 ? `${lines} line${lines === 1 ? '' : 's'} on the chart. They go with the post.` : 'Draw your lines on the chart below, then post them.'}
        </span>
      </p>
      <button
        type="button"
        className="mkd__go"
        onClick={() => {
          clearDrawFor()
          setNote(null)
          onPost()
          // The composer mounts with the tab: bring it into view once it is there.
          let tries = 0
          const find = () => {
            const el = document.querySelector('.cmy-compose')
            if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            else if (++tries < 30) window.setTimeout(find, 50)
          }
          window.setTimeout(find, 0)
        }}
        data-journey="Chart: post the drawing"
      >
        Post to {note.label}
      </button>
      <button type="button" className="mkd__x" onClick={drop} aria-label="Stop drawing for this post">
        <X width={14} height={14} />
      </button>
    </div>
  )
}
