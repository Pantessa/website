'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/session'

/**
 * Star-rating widget — the human input to a service's reputation. SIWE-gated:
 * a signed-in wallet can set/change its 1–5 rating (one per wallet per service).
 */
export default function RateService({
  slug,
  initial,
}: {
  slug: string
  initial: { average: number | null; count: number; yourRating: number | null }
}) {
  const { address, signIn } = useSession()
  const [yourRating, setYourRating] = useState<number | null>(initial.yourRating)
  const [average, setAverage] = useState<number | null>(initial.average)
  const [count, setCount] = useState<number>(initial.count)
  const [hover, setHover] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (rating: number) => {
    setSaving(true)
    setErr(null)
    const prev = yourRating
    setYourRating(rating) // optimistic
    try {
      const res = await fetch(`/api/servers/${slug}/rate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const d = await res.json()
      setAverage(d.average)
      setCount(d.count)
      setYourRating(d.yourRating)
    } catch (e) {
      setYourRating(prev)
      setErr(e instanceof Error ? e.message : 'Could not save your rating.')
    } finally {
      setSaving(false)
    }
  }

  const shown = hover ?? yourRating ?? 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex items-center" onMouseLeave={() => setHover(null)} role="radiogroup" aria-label="Rate this service">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={!address || saving}
              onMouseEnter={() => address && setHover(n)}
              onClick={() => address && submit(n)}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              aria-checked={yourRating === n}
              role="radio"
              className={cn('p-0.5', address ? 'cursor-pointer' : 'cursor-default')}
            >
              <Star
                className="w-5 h-5 transition-colors"
                style={{ color: n <= shown ? 'var(--accent)' : 'var(--muted-2)' }}
                fill={n <= shown ? 'var(--accent)' : 'none'}
              />
            </button>
          ))}
        </div>
        <span className="text-[12px] text-[color:var(--muted)] mono">
          {average != null ? `${average.toFixed(1)} · ${count} rating${count === 1 ? '' : 's'}` : 'no ratings yet'}
        </span>
      </div>
      {!address ? (
        <button onClick={() => signIn()} className="text-[12px] text-left underline decoration-dotted underline-offset-2 text-[color:var(--muted)] hover:text-white w-fit">
          Sign in to rate this service
        </button>
      ) : yourRating ? (
        <span className="text-[11px] text-[color:var(--muted-2)]">Your rating: {yourRating}★ — click to change</span>
      ) : (
        <span className="text-[11px] text-[color:var(--muted-2)]">Click a star to rate</span>
      )}
      {err ? <span className="text-[11px] text-[#ff6b6b]">{err}</span> : null}
    </div>
  )
}
