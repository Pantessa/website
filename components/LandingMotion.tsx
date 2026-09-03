'use client'

// The page's nervous system — one client component that owns ALL of the
// landing's scroll behaviour, so the page pays for exactly one scroll
// listener instead of six components each growing their own.
//
// It does three things, all off ONE rAF-coalesced scroll pass:
//   1. STATIONS — a fixed rail on the right naming where you are and letting
//      you jump. It's navigation, not decoration, so reduced-motion keeps it
//      (only the smooth-scroll behaviour drops).
//   2. PARALLAX — decorative visuals drift against the scroll. Never applied
//      to anything you have to read: the machine's console and every block of
//      body copy stay exactly where the layout put them.
//   3. REVEALS — section heads rise once as they enter, then are dropped from
//      the list. Once, not on every pass: a heading that re-animates whenever
//      you scroll back up reads as a glitch.

import { useEffect, useState } from 'react'

/** The stations, top to bottom. Selector-based so server components don't
 *  need to grow props for this. */
const STATIONS: { sel: string; label: string }[] = [
  { sel: '.fhero', label: 'The intent' },
  { sel: '.mach', label: 'The machine' },
  { sel: '.spread', label: 'The link' },
  { sel: '.night', label: 'The night shift' },
  { sel: '.embeda', label: 'Your site' },
  { sel: '.trust', label: 'The proof' },
]

/** Decorative-only, and only on visuals that own their own whitespace.
 *  Positive drifts down-slower, negative up-faster. Nothing framed by a
 *  border goes on this list: drifting a card's contents out of its own frame
 *  reads as a layout bug, not depth. */
const PARALLAX: { sel: string; k: number }[] = [
  { sel: '.night__dialwrap', k: -0.055 },
  { sel: '.spread__svg', k: 0.045 },
]

export default function LandingMotion() {
  const [active, setActive] = useState(0)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const els = STATIONS.map((s) => document.querySelector<HTMLElement>(s.sel))
    if (!els.some(Boolean)) return
    setShown(true)

    // ── stations: whichever section owns the middle of the viewport wins.
    // Cheaper and far steadier than ratio-based IO across sections of wildly
    // different heights (the hero and the trust strip differ by 3×).
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const parallax = PARALLAX.flatMap((p) =>
      [...document.querySelectorAll<HTMLElement>(p.sel)].map((el) => ({ el, k: p.k })),
    )

    // `.reveal` starts at opacity 0 and is added by script, so a page without
    // JS never hides anything. Elements already on screen at mount are skipped
    // — hiding then re-showing them reads as a flash, not an entrance. The
    // reveal runs off the same scroll pass rather than its own observer: this
    // is the one effect that can HIDE content, so it gets the mechanism that
    // can't get wedged, not the fancier one.
    const pending = [
      ...document.querySelectorAll<HTMLElement>(
        '.mach__head, .spread__copy, .spread__film, .night__copy, .embeda__head, .trust__head',
      ),
    ].filter((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) return false
      el.classList.add('reveal')
      return true
    })

    let raf = 0
    const measure = () => {
      raf = 0
      const vh = window.innerHeight
      const mid = window.scrollY + vh / 2
      let next = 0
      els.forEach((el, i) => {
        if (el && el.offsetTop <= mid) next = i
      })
      setActive(next)

      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].getBoundingClientRect().top < vh * 0.92) {
          pending[i].classList.add('is-in')
          pending.splice(i, 1)
        }
      }

      if (!reduce) {
        for (const { el, k } of parallax) {
          const r = el.getBoundingClientRect()
          // −1 above the fold … +1 below it; 0 when the element is centred.
          // CLAMPED: on a first paint at scrollY 0 a section five screens down
          // scores t ≈ 5, which multiplied out to a 140px displacement — the
          // visual sat outside its own section until the first scroll event
          // corrected it.
          const t = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / vh))
          el.style.setProperty('--py', `${(t * k * vh).toFixed(1)}px`)
        }
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  if (!shown) return null

  return (
    <nav className="stations" aria-label="Page sections">
      {STATIONS.map((s, i) => (
        <button
          key={s.sel}
          className={`stations__s${i === active ? ' is-on' : ''}`}
          onClick={() => document.querySelector(s.sel)?.scrollIntoView({ behavior: 'smooth' })}
          aria-current={i === active ? 'true' : undefined}
        >
          <span className="stations__label mono">{s.label}</span>
          <span className="stations__tick" aria-hidden />
        </button>
      ))}
    </nav>
  )
}
