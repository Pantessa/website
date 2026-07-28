'use client'

// THE NIGHT SHIFT — standing intent, told as the thing it actually is: a
// clock that keeps running while nobody is at the keyboard. A 24-hour dial
// sweeps the night arc (21:00 → 06:00) on a loop; as the hand passes each
// event it fires, and the receipt lands in the log beside it. The loop is
// the argument — it restarts because the night always comes back.
//
// Everything derives from one normalized progress value, so:
//   · prefers-reduced-motion pins p = 1 (every event fired, nothing moving)
//   · off-screen and hidden tabs park the rAF instead of racing it
//   · the section reads correctly as a still frame at any p
//
// Replaces StandingIntent's static "overnight log" screenshot. Same four
// standing surfaces underneath (DCA · Guardian · Jobs · NFTs), each landing a
// real ask prefilled into /chat — ?prompt= never auto-sends.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

/** The night arc: 21:00 → 06:00, drawn clockwise from upper-left through
 *  midnight at the top. Hours past 24 keep counting (26 = 02:00). */
const START_H = 21
const END_H = 30
const R = 128
const C = 160

const angleOf = (h: number) => (h / 24) * 360 - 90
const pointAt = (h: number, r = R) => {
  const a = (angleOf(h) * Math.PI) / 180
  return { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r }
}
const pOf = (h: number) => (h - START_H) / (END_H - START_H)

interface NightEvent {
  h: number
  clock: string
  kind: string
  body: string
  meta: string
}

/** Four things Yeetful really does between turns — one per capability, so the
 *  log isn't four flavours of the same job. */
const EVENTS: NightEvent[] = [
  {
    h: 22.25,
    clock: '22:15',
    kind: 'DCA',
    body: 'Autopilot pulled $25 and bought ETH',
    meta: 'one-shot Spend Permission · nothing else it can touch',
  },
  {
    h: 24.633,
    clock: '00:38',
    kind: 'JOB 3/3',
    body: 'Bridge settled → bought $25 of NVDA',
    meta: 'each step rebuilt and guard-checked at its own turn',
  },
  {
    h: 26.783,
    clock: '02:47',
    kind: 'GUARDIAN',
    body: 'ETH stop fired at $3,208 · position closed',
    meta: 'delegated key · revocable · never custody',
  },
  {
    h: 29.5,
    clock: '05:30',
    kind: 'SPOT GUARD',
    body: '312th sweep · mark above the floor · no action',
    meta: 'checking is the job — most minutes it does nothing, loudly',
  },
]

const POINTS: { t: string; d: string }[] = [
  {
    t: 'Say it once',
    d: '“Every week,” “if it drops 8%,” “once the bridge settles.” The sentence becomes standing intent — not a reminder to come back and type it again.',
  },
  {
    t: 'Guard-checked at fire time',
    d: 'Nothing runs on stale math. Every step is rebuilt and re-checked the moment it’s due, so dead calldata never reaches a wallet.',
  },
  {
    t: 'Your keys, your receipts',
    d: 'You sign, or a scoped key you can revoke does. Either way the tx hash lands in your ledger before you wake up.',
  },
]

const TILES: { label: string; t: string; d: string; ask: string; href: string }[] = [
  {
    label: 'RECURRING BUYS',
    t: 'DCA in one sentence',
    d: 'A sentence makes the schedule. Each buy compiles fresh on its day — no bot to host, no hot key to leak.',
    ask: 'Buy $10 of AAPL every week',
    href: `/chat?mcps=robinhood-free&prompt=${encodeURIComponent('Buy $10 of AAPL every week')}`,
  },
  {
    label: 'GUARDIAN',
    t: 'Stop-losses that don’t sleep',
    d: 'Autonomous protection via a delegated agent key. It watches every minute and closes the position for you. Revoke any time.',
    ask: 'Set a stop-loss on my ETH position at −8%',
    href: `/chat?mcps=hyperliquid-free&prompt=${encodeURIComponent('Set a stop-loss on my ETH position at -8%')}`,
  },
  {
    label: 'JOBS',
    t: 'Fund → wait → act',
    d: 'Multi-step work compiles as one job: bridge, wait for settlement, then swap, stake, send, or buy. Guard-checked step by step.',
    ask: 'Swap 1 USDC from Base to Arbitrum, then send it to nate.eth',
    href: `/chat?prompt=${encodeURIComponent('Swap 1 USDC from Base to Arbitrum, then send the 1 USDC on Arbitrum to nate.eth')}`,
  },
  {
    label: 'NFTS',
    t: 'Sell it in a sentence',
    d: 'Guarded Seaport listings: ownership verified on-chain, fees pulled from the collection’s live schedule, re-checked before submit.',
    ask: 'Sell my NFT #4172 for 0.8 ETH',
    href: `/chat?mcps=opensea-free&prompt=${encodeURIComponent('Sell my NFT #4172 for 0.8 ETH')}`,
  },
]

/** SVG arc path between two hours on the dial. */
function arc(h1: number, h2: number, r = R) {
  const a = pointAt(h1, r)
  const b = pointAt(h2, r)
  const large = Math.abs(angleOf(h2) - angleOf(h1)) > 180 ? 1 : 0
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`
}

/** p → the clock face's readout, e.g. 0.5 → "01:30". */
function clockAt(p: number) {
  const h = START_H + p * (END_H - START_H)
  const hh = Math.floor(h) % 24
  const mm = Math.floor((h % 1) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

const CYCLE_MS = 17000

export default function NightShift() {
  const [p, setP] = useState(0)
  const [still, setStill] = useState(false)
  const [live, setLive] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setStill(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Only run while the dial is on screen — a clock nobody is looking at is
  // exactly the thing that shouldn't burn a rAF.
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver((es) => setLive(es.some((e) => e.isIntersecting)), {
      threshold: 0.15,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!live || still) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(80, now - last)
      last = now
      if (!document.hidden) setP((x) => (x + dt / CYCLE_MS) % 1)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [live, still])

  const prog = still ? 1 : p
  const handH = START_H + prog * (END_H - START_H)
  const hand = pointAt(handH, R - 14)
  const fired = EVENTS.map((e) => prog >= pOf(e.h))
  const firedCount = fired.filter(Boolean).length

  return (
    <section className="night" id="standing" ref={sectionRef}>
      <div className="night__grid">
        <div className="night__copy">
          <span className="night__eyebrow mono">THE NIGHT SHIFT</span>
          <h2 className="night__h2">
            The money moved. <span className="x-grad">Nobody was at the keyboard.</span>
          </h2>
          <p className="night__sub">
            Recurring buys, stop-loss protections and multi-step jobs keep working between your
            turns. Yeetful is the non-custodial back office for autonomous money: it builds,
            guard-checks and receipts every move — and holds nothing.
          </p>
          <ul className="night__points">
            {POINTS.map((x) => (
              <li className="night__point" key={x.t}>
                <strong>{x.t}</strong> <span>{x.d}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* the dial — one night, on a loop, because the night comes back */}
        <div className="night__stage">
          <div className="night__dialwrap">
            <svg className="night__dial" viewBox="0 0 320 320" aria-hidden>
              <defs>
                <radialGradient id="nightGlow">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
                  <stop offset="70%" stopColor="var(--accent)" stopOpacity="0.03" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx={C} cy={C} r={R} fill="url(#nightGlow)" />
              {/* the hours the night arc actually spans */}
              {[21, 0, 3, 6].map((label, i) => {
                const h = [21, 24, 27, 30][i]
                const pt = pointAt(h, R + 19)
                return (
                  <text key={label} className="night__hour mono" x={pt.x} y={pt.y + 3.5}>
                    {String(label).padStart(2, '0')}
                  </text>
                )
              })}
              {/* hour ticks, full 24 */}
              {Array.from({ length: 24 }, (_, i) => {
                const inner = pointAt(i, i % 6 === 0 ? R - 13 : R - 7)
                const outer = pointAt(i, R)
                return (
                  <line
                    key={i}
                    className={`night__tick${i % 6 === 0 ? ' is-major' : ''}`}
                    x1={inner.x}
                    y1={inner.y}
                    x2={outer.x}
                    y2={outer.y}
                  />
                )
              })}
              <circle className="night__rim" cx={C} cy={C} r={R} />
              <path className="night__arc" d={arc(START_H, END_H)} />
              <path
                className="night__arcrun"
                d={arc(START_H, Math.max(START_H + 0.001, handH))}
              />

              {EVENTS.map((e, i) => {
                const pt = pointAt(e.h)
                return (
                  <g key={e.clock} className={`night__ev${fired[i] ? ' is-fired' : ''}`}>
                    <circle className="night__evhalo" cx={pt.x} cy={pt.y} r="13" />
                    <circle className="night__evdot" cx={pt.x} cy={pt.y} r="4.5" />
                  </g>
                )
              })}

              <line className="night__hand" x1={C} y1={C} x2={hand.x} y2={hand.y} />
              <circle className="night__handhead" cx={hand.x} cy={hand.y} r="4" />
              <circle className="night__hub" cx={C} cy={C} r="3" />
            </svg>
            <div className="night__face">
              <span className="night__time mono">{still ? '06:00' : clockAt(prog)}</span>
              <span className="night__facesub mono">
                {firedCount} receipt{firedCount === 1 ? '' : 's'} · 0 keys held
              </span>
            </div>
          </div>

          <ol className="night__log">
            {EVENTS.map((e, i) => (
              <li className={`night__row${fired[i] ? ' is-in' : ''}`} key={e.clock}>
                <span className="night__rtime mono">{e.clock}</span>
                <span className="night__rbody">
                  <b className="night__rkind mono">{e.kind}</b> {e.body}
                  <em className="night__rmeta mono">{e.meta}</em>
                </span>
                <span className="night__rok" aria-hidden>
                  ✓
                </span>
              </li>
            ))}
          </ol>
          <p className="night__caption mono">
            The best screenshot is the one where nobody was at the keyboard.
          </p>
        </div>
      </div>

      {/* the four standing surfaces — each lands its ask in /chat, prefilled */}
      <div className="night__tiles">
        {TILES.map((x) => (
          <Link href={x.href} className="night__tile" key={x.label}>
            <span className="night__tlabel mono">{x.label}</span>
            <h3 className="night__tt">{x.t}</h3>
            <p className="night__td">{x.d}</p>
            <span className="night__task mono">&ldquo;{x.ask}&rdquo; →</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
