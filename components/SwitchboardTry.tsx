'use client'

// D3 (safe slice) — "try a route". Interactive preview of the routing lever
// over the REAL catalog: pick a need (category), see every plannable route
// ranked the way Switchboard ranks (cheapest proven route wins), and the one
// it would pick. Each row expands (accordion) to reveal the EXACT call
// Switchboard would construct + pay for — method, URL, params. NO payment, NO
// inference. Data: /api/route/preview (DB-only).

import { useEffect, useState } from 'react'

interface ParamHint {
  name: string
  in: string
  required: boolean
  type?: string
}
interface RouteCall {
  method: string
  url: string
  provider: string | null
  description: string | null
  params: ParamHint[]
}
interface Candidate {
  slug: string
  service: string
  price: number
  proven: number
  txHash: string | null
  call: RouteCall
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
  const [open, setOpen] = useState<string | null>(null)

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
        <h2 className="swtry__h2">The engine at work.</h2>
        <p className="swtry__sub">
          Every plannable route in the live catalog, ranked the way Switchboard ranks them — the{' '}
          <strong>cheapest proven route wins</strong>. Expand any route to see the exact call it
          would run. This is the price lever, no spend; matching your exact words to an endpoint is
          the live planner’s job.
        </p>
      </div>

      <div className="swtry__chips mono">
        {cats.map((c, i) => (
          <button
            key={c.category}
            className={`swtry__chip ${i === sel ? 'is-on' : ''}`}
            onClick={() => {
              setSel(i)
              setOpen(null)
            }}
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
            const isOpen = open === c.slug
            return (
              <div className={`swtry__item ${isPick ? 'is-pick' : ''} ${isOpen ? 'is-open' : ''}`} key={c.slug}>
                <div className="swtry__rowwrap">
                  <button
                    className="swtry__row"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : c.slug)}
                  >
                    <span className="swtry__chev" aria-hidden="true">
                      ›
                    </span>
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
                  </button>
                  {c.txHash ? (
                    <a
                      className="swtry__tx"
                      href={`https://basescan.org/tx/${c.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      title="View a settlement for this route on Basescan"
                    >
                      tx ↗
                    </a>
                  ) : (
                    <span className="swtry__tx swtry__tx--none" aria-hidden="true" />
                  )}
                </div>

                {isOpen && (
                  <div className="swtry__detail">
                    <div className="swtry__call">
                      <span className="swtry__method">{c.call.method}</span>
                      <span className="swtry__url">{c.call.url}</span>
                    </div>
                    {c.call.params.length > 0 && (
                      <div className="swtry__params">
                        {c.call.params.map((p) => (
                          <span className="swtry__param" key={`${p.in}-${p.name}`}>
                            {p.name}
                            <span className="swtry__paramin">
                              {p.in}
                              {p.required ? ' · required' : ''}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="swtry__meta">
                      {c.call.provider && <span>{c.call.provider}</span>}
                      <span>${c.price.toFixed(4)} / call · x402 · no key</span>
                    </div>
                    {c.call.description && <p className="swtry__cdesc">{c.call.description}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
