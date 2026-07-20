'use client'

// Public proof feed for /switchboard — real routed turns in the open: the
// question, the answer Switchboard returned, and the on-chain tx for each paid
// call. Data: /api/route/proof. Renders nothing until real settled calls exist.

import { useEffect, useState } from 'react'

interface Call {
  service: string
  priceUsd: string
  txHash: string
}
interface ProofItem {
  id: string
  prompt: string
  answer: string
  createdAt: string
  calls: Call[]
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function SwitchboardProof() {
  const [items, setItems] = useState<ProofItem[] | null>(null)

  useEffect(() => {
    void fetch('/api/route/proof')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items: ProofItem[] } | null) => {
        if (d?.items?.length) setItems(d.items)
      })
      .catch(() => {})
  }, [])

  if (!items || items.length === 0) return null

  return (
    <section className="swproof">
      <div className="swproof__head">
        <span className="swproof__eyebrow mono">PROOF, IN THE OPEN</span>
        <h2 className="swproof__h2">Real questions. Real calls. On-chain.</h2>
        <p className="swproof__sub">
          Actual routed turns — what was asked, what the agent answered, and the settlement tx for
          every paid call. Nothing simulated.
        </p>
      </div>

      <div className="swproof__list">
        {items.map((it) => (
          <article className="swproof__card" key={it.id}>
            <div className="swproof__q mono">
              <span className="swproof__qmark">›</span> {it.prompt}
            </div>
            <p className="swproof__a">{it.answer}</p>
            <div className="swproof__calls mono">
              {it.calls.map((c, i) => (
                <a
                  className="swproof__call"
                  key={`${c.txHash}-${i}`}
                  href={`https://basescan.org/tx/${c.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  title="View settlement on Basescan"
                >
                  <span className="swproof__svc">{c.service}</span>
                  <span className="swproof__amt">${Number(c.priceUsd).toFixed(4)}</span>
                  <span className="swproof__tx">tx ↗</span>
                </a>
              ))}
              <span className="swproof__time">{ago(it.createdAt)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
