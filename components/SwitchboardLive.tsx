'use client'

// D2 — "engine at work". The Switchboard hero animation is a simulation; THIS
// strip is the real thing: the most recent routes the engine actually settled,
// straight from /api/activity (the public spend_ledger, settled rows only).
// Every row with a txHash links to Basescan — witnessed, not self-reported.
// Renders nothing until real data arrives and never shows zeros (honesty bar,
// PROBLEM.md P0): no settlements yet → no strip.

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Recent {
  id: string
  service: string
  amountUsd: number
  txHash: string | null
  account: string
  createdAt: string
}
interface Activity {
  stats: { settledUsd: number; settledCalls: number }
  recent: Recent[]
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function SwitchboardLive() {
  const [data, setData] = useState<Activity | null>(null)

  useEffect(() => {
    void fetch('/api/activity')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Activity | null) => {
        if (d?.stats && d.recent) setData(d)
      })
      .catch(() => {})
  }, [])

  // No witnessed settlements yet → show nothing rather than an empty shell.
  if (!data || data.stats.settledCalls === 0 || data.recent.length === 0) return null

  const rows = data.recent.slice(0, 8)

  return (
    <section className="swlive">
      <div className="swlive__head">
        <div>
          <span className="swlive__eyebrow mono">WITNESSED ON BASE</span>
          <h2 className="swlive__h2">The engine at work.</h2>
        </div>
        <div className="swlive__stat mono">
          <div className="swlive__statnum">${data.stats.settledUsd.toFixed(2)}</div>
          <div className="swlive__statlbl">
            settled · {data.stats.settledCalls} routed calls
          </div>
        </div>
      </div>

      <div className="swlive__rows mono">
        {rows.map((r) => (
          <div className="swlive__row" key={r.id}>
            <span className="swlive__dot" aria-hidden="true" />
            <span className="swlive__svc">{r.service}</span>
            <span className="swlive__acct">{r.account}</span>
            <span className="swlive__amt">${r.amountUsd.toFixed(4)}</span>
            <span className="swlive__time">{ago(r.createdAt)}</span>
            {r.txHash ? (
              <a
                className="swlive__tx"
                href={`https://basescan.org/tx/${r.txHash}`}
                target="_blank"
                rel="noreferrer"
                title="View settlement on Basescan"
              >
                tx ↗
              </a>
            ) : (
              <span className="swlive__tx swlive__tx--none">settled</span>
            )}
          </div>
        ))}
      </div>

      <Link href="/activity" className="swlive__all mono">
        See all network activity →
      </Link>
    </section>
  )
}
