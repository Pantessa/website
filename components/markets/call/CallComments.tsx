'use client'

// Replies on a call's page. The thread arrives server-rendered (crawlers and
// the first paint read it); a reply posts through the existing comments door
// (SIWE, plain text, hourly fences) and is appended from the door's own
// answer. Every string is a text node. Signed out, the unified door opens in
// place (rule 6: no redirect, the reader stays on the call).

import { useState } from 'react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'
import type { PublicComment } from '@/lib/chart-posts'
import { ageLabel } from '@/lib/news-shared'
import { friendlyError } from '@/lib/friendly-error'

export default function CallComments({ postId, initial }: { postId: string; initial: PublicComment[] }) {
  const session = useSession()
  const [comments, setComments] = useState(initial)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const send = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(`/api/posts/${postId}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: reply }) })
      const d = (await r.json()) as { error?: string; comment?: PublicComment }
      if (!r.ok || !d.comment) throw new Error(d.error ?? `Could not reply (${r.status}).`)
      setComments((cur) => [...cur, d.comment!])
      setReply('')
    } catch (e) {
      setErr(friendlyError(e, 'Could not reply.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="callpg__thread" aria-label="Replies">
      <h2 className="mono">
        {comments.length} repl{comments.length === 1 ? 'y' : 'ies'}
      </h2>
      {comments.length === 0 && <p className="callpg__muted">Nobody has replied yet. Agree, disagree, or say where the line breaks.</p>}
      {comments.map((c) => (
        <p key={c.id} className="mkp__comment">
          <b>{c.authorLabel}</b>
          <span className="callpg__age mono">{ageLabel(c.createdAt)}</span>
          {c.body}
        </p>
      ))}
      {session.address ? (
        <form
          className="mkp__creply"
          onSubmit={(e) => {
            e.preventDefault()
            if (reply.trim() && !busy) void send()
          }}
        >
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply (plain text)" maxLength={1000} aria-label="Reply" />
          <button type="submit" className="mkc__ghost" disabled={busy || !reply.trim()}>
            {busy ? 'Sending…' : 'Reply'}
          </button>
        </form>
      ) : (
        <div className="callpg__share">
          <span className="callpg__muted">Sign in to reply. One free signature, no account form.</span>
          <CreateAccountButton className="mkc__ghost" label="Sign in" />
        </div>
      )}
      {err && <p className="mkt-share__note mkt-share__note--err">{err}</p>}
    </section>
  )
}
