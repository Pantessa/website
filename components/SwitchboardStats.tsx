'use client'

// Landing analytics — "we track every paying and earning agent." Real numbers
// from /api/activity (the public spend_ledger + launchpad earn side), the same
// feed /activity uses. Spend-over-time = money the network moved; top agents =
// who earned it. Honesty bar (PROBLEM.md P0): renders nothing until there's
// real settled volume, and never shows zeros.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { SpendByAgent, SpendOverTime } from '@/components/LazyCharts'
import Reveal from '@/components/Reveal'
import { Card, CardTitle } from '@/lib/dashboard-ui'
import type { LaunchpadSummary } from '@/lib/launchpad-summary'

interface Activity {
  stats: {
    settledUsd: number
    settledCalls: number
    activeAccounts: number
  }
  daily: { day: string; spent: number; calls: number }[]
  top: { service: string; spent: number; calls: number }[]
  launchpad: LaunchpadSummary | null
}

/** Counts from 0 to `value` the first time the number scrolls into view.
 * Skipped entirely (renders the final value) under prefers-reduced-motion. */
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(() => format(value))

  useEffect(() => {
    const el = ref.current
    if (
      !el ||
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setShown(format(value))
      return
    }
    setShown(format(0))
    let raf = 0
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      // t0 anchors to the FIRST frame timestamp — rAF timestamps can lag a
      // performance.now() taken here, which would start progress negative.
      let t0 = 0
      const dur = 900
      const tick = (t: number) => {
        if (!t0) t0 = t
        const p = Math.min(1, Math.max(0, (t - t0) / dur))
        const eased = 1 - Math.pow(1 - p, 3)
        setShown(format(value * eased))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return <span ref={ref}>{shown}</span>
}

function Stat({
  value,
  format,
  label,
}: {
  value: number
  format: (n: number) => string
  label: string
}) {
  return (
    <div className="swstats__stat">
      <div className="swstats__statnum">
        <CountUp value={value} format={format} />
      </div>
      <div className="swstats__statlbl mono">{label}</div>
    </div>
  )
}

export default function SwitchboardStats() {
  const [data, setData] = useState<Activity | null>(null)

  useEffect(() => {
    void fetch('/api/activity')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Activity | null) => {
        if (d?.stats && d.daily && d.top) setData(d)
      })
      .catch(() => {})
  }, [])

  // No witnessed volume yet → render nothing rather than an empty shell of zeros.
  if (!data || data.stats.settledCalls === 0 || data.top.length === 0) return null

  const s = data.stats
  const lp = data.launchpad
  const avgPerCall = s.settledCalls > 0 ? s.settledUsd / s.settledCalls : 0

  return (
    <section className="swstats">
      <Reveal>
        <div className="swhead">
          <div className="swstats__head">
            <span className="swstats__eyebrow mono">
              <span className="swdot" aria-hidden="true" />
              THE NETWORK, IN THE OPEN
            </span>
            <h2 className="swstats__h2">
              Every paying <span className="swstats__em">and earning</span> agent, tracked.
            </h2>
            <p className="swstats__sub">
              Every routed call settles on Base and lands in a public ledger — what the network
              spent, and which agents earned it. No dashboards to trust; the receipts are open.
            </p>
          </div>
          <Link href="/activity" className="swmore mono">
            Open the public ledger <span className="swmore__arrow">→</span>
          </Link>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="swstats__stats">
          <Stat value={s.settledUsd} format={(n) => `$${n.toFixed(2)}`} label="settled on Base" />
          <Stat value={s.settledCalls} format={(n) => String(Math.round(n))} label="routed calls" />
          <Stat value={avgPerCall} format={(n) => `$${n.toFixed(4)}`} label="avg per call" />
          <Stat
            value={s.activeAccounts}
            format={(n) => String(Math.round(n))}
            label="paying agents"
          />
          {lp && lp.stakerRewardsUsd > 0 && (
            <Stat
              value={lp.stakerRewardsUsd}
              format={(n) => `$${n.toFixed(2)}`}
              label="paid to stakers"
            />
          )}
        </div>
      </Reveal>

      <Reveal delay={140}>
        <div className="swstats__charts">
          <Card className="min-w-0">
            <CardTitle serif eyebrow="LAST 30 DAYS">Network spend</CardTitle>
            <SpendOverTime daily={data.daily} />
          </Card>
          <Card className="min-w-0">
            <CardTitle serif eyebrow="EARNINGS">Top earning agents</CardTitle>
            <SpendByAgent perAgent={data.top} />
          </Card>
        </div>
      </Reveal>
    </section>
  )
}
