'use client'

// D3 (safe slice) — "try a route". Interactive preview of the routing lever
// over the REAL catalog: pick a need (category), see every plannable route
// ranked the way Switchboard ranks (cheapest proven route wins), and the one
// it would pick. NO payment, NO inference — the live English→endpoint match is
// the planner's job. Data: /api/route/preview (DB-only).

import { useEffect, useState } from 'react'

interface Candidate {
  slug: string
  service: string
  price: number
  proven: number
}
interface Cat {
  category: string
  candidates: Candidate[]
  pick: string
  pickProven: boolean
  saved: number
}

export default function SwitchboardTry() {
  const [cats, setCats] = useState<Cat[] | null>(null)
  const [sel, setSel] = useState(0)

  useEffect(() => {
    void fetch('/api/route/preview')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { categories: Cat[] } | null) => {
        if (d?.categories?.length) setCats(d.categories)
      })
      .catch(() => {})
  }, [])

  if (!cats || cats.length === 0) return null

  const cat = cats[Math.min(sel, cats.length - 1)]
  const pick = cat.candidates.find((c) => c.slug === cat.pick)

  return (
    <section className="swtry">
      <div className="swtry__head">
        <span className="swtry__eyebrow mono">TRY A ROUTE</span>
        <h2 className="swtry__h2">Pick a need. Watch it route.</h2>
        <p className="swtry__sub">
          Every plannable route in the live catalog, ranked the way Switchboard ranks them — the{' '}
          <strong>cheapest proven route wins</strong>. This is the price lever, no spend; matching your
          exact words to an endpoint is the live planner’s job.
        </p>
      </div>

      <div className="swtry__chips mono">
        {cats.map((c, i) => (
          <button
            key={c.category}
            className={`swtry__chip ${i === sel ? 'is-on' : ''}`}
            onClick={() => setSel(i)}
          >
            {c.category}
            <span className="swtry__chipn">{c.candidates.length}</span>
          </button>
        ))}
      </div>

      <div className="swtry__panel">
        {pick && (
          <div className="swtry__verdict mono">
            <span className="swtry__weigh">
              weighing {cat.candidates.length} {cat.category.toLowerCase()} route
              {cat.candidates.length === 1 ? '' : 's'} →
            </span>{' '}
            <span className="swtry__pickname">{pick.service}</span>{' '}
            <span className="swtry__pickprice">${pick.price.toFixed(4)}</span>
            {cat.saved > 0 && <span className="swtry__saved"> · saves ${cat.saved.toFixed(4)} vs priciest</span>}
          </div>
        )}

        <div className="swtry__rows mono">
          {cat.candidates.map((c) => {
            const isPick = c.slug === cat.pick
            return (
              <div className={`swtry__row ${isPick ? 'is-pick' : ''}`} key={c.slug}>
                <span className="swtry__route">{c.service}</span>
                {c.proven > 0 ? (
                  <span className="swtry__proven" title={`${c.proven} settled calls on-network`}>
                    ✓ proven {c.proven}
                  </span>
                ) : (
                  <span className="swtry__unproven">untested</span>
                )}
                <span className="swtry__price">${c.price.toFixed(4)}</span>
                <span className="swtry__tag">{isPick ? 'PICK' : ''}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
