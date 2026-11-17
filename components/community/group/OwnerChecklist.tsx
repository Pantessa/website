'use client'

// THE OWNER'S FIRST-RUN CHECKLIST — a card on the room, never a modal (squad
// community, lane GROUP). Four steps, each a button that does the thing. A
// step ticks from the room's real state and from nothing the owner clicked:
// a second member, a linked Telegram chat, a linked Discord channel, a post.
// Dismissed per browser; gone by itself once all four are done.

import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useRoom } from './Room'
import { checklistDone, checklistKey, inviteUrl, type ChecklistStep } from './room-logic'

const STEPS: { id: ChecklistStep; title: string; why: string; act: string }[] = [
  { id: 'invite', title: 'Share your invite link', why: 'Ticks when a second member joins.', act: 'Copy link' },
  { id: 'telegram', title: 'Connect your Telegram group', why: 'The whole group can join from one pinned button.', act: 'Connect' },
  { id: 'discord', title: 'Connect Discord', why: 'New posts are announced in your channel.', act: 'Connect' },
  { id: 'post', title: 'Post the first idea', why: 'A chart, a link, a video or a trade with proof.', act: 'Write it' },
]

export default function OwnerChecklist() {
  const { slug, room, me, focus } = useRoom()
  // Unknown until the browser's own record is read: nothing flashes in.
  const [dismissed, setDismissed] = useState<boolean | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(checklistKey(slug)) === '1')
    } catch {
      setDismissed(false)
    }
  }, [slug])

  if (!room || !me || me.role !== 'owner' || dismissed !== false) return null
  const done = checklistDone(room)
  const left = STEPS.filter((s) => !done[s.id]).length
  if (left === 0) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(checklistKey(slug), '1')
    } catch {
      // storage blocked: it comes back on the next visit
    }
  }
  const run = async (id: ChecklistStep) => {
    if (id === 'invite') {
      focus('invite')
      try {
        await navigator.clipboard.writeText(inviteUrl(slug, me.invite, window.location.origin))
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      } catch {
        // no clipboard permission: the invite panel is in view with the link selected
      }
      return
    }
    focus(id === 'post' ? 'compose' : id)
  }

  return (
    <section className="grp-check" aria-labelledby="room-check-h" data-owner-checklist>
      <div className="grp-check__head">
        <h2 id="room-check-h" className="grp-card__title">
          Get your room going
        </h2>
        <span className="grp-check__left">
          {STEPS.length - left} of {STEPS.length} done
        </span>
        <button type="button" className="grp-check__x" onClick={dismiss} aria-label="Hide this checklist" data-journey="Room checklist: hide">
          <X width={15} height={15} />
        </button>
      </div>
      <ol className="grp-check__steps">
        {STEPS.map((s) => (
          <li key={s.id} className={`grp-check__step${done[s.id] ? ' is-done' : ''}`} data-step={s.id} data-done={done[s.id] ? '' : undefined}>
            <span className="grp-check__mark" aria-hidden>
              {done[s.id] && <Check width={12} height={12} />}
            </span>
            <span className="grp-check__text">
              <span className="grp-check__title">{s.title}</span>
              <span className="grp-check__why">{done[s.id] ? 'Done.' : s.why}</span>
            </span>
            {!done[s.id] && (
              <button type="button" className="grp-btn grp-btn--sm" onClick={() => void run(s.id)} data-journey={`Room checklist: ${s.title}`}>
                {s.id === 'invite' && copied ? 'Copied' : s.act}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
