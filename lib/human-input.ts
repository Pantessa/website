'use client'

// Has a person touched this page load yet? One shared answer for the
// surfaces that spend house money the moment they mount (the AI brief, the
// morning tape): they wait for it, so a crawler that loads a page and leaves
// never makes a model write. Once true it stays true for the tab, so a soft
// navigation inside the app starts the next brief at once.
//
// Only events the browser marks `isTrusted` count, and only ones a hand
// makes: a pointer moving or pressing, a touch, a wheel, a key. Not `scroll`:
// a script's window.scrollTo fires a trusted scroll too.

import { useSyncExternalStore } from 'react'

const EVENTS = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown'] as const

let seen = false
let armed = false
const subs = new Set<() => void>()

function mark(e: Event) {
  if (!e.isTrusted || seen) return
  seen = true
  for (const t of EVENTS) window.removeEventListener(t, mark, true)
  for (const fn of subs) fn()
}

function arm() {
  if (armed || typeof window === 'undefined') return
  armed = true
  for (const t of EVENTS) window.addEventListener(t, mark, { capture: true, passive: true })
}

function subscribe(fn: () => void): () => void {
  arm()
  subs.add(fn)
  return () => subs.delete(fn)
}

/** True once a person has touched the page in this tab. False on the server. */
export function useHumanInput(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => seen,
    () => false,
  )
}
