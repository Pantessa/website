// Loads the library's standalone script once per tab. Browser-only.
//
// The script defines `window.TradingView`. A build without the library never
// calls this (lib/tv/config advancedChartsBuilt); a build WITH it can still
// fail here (a blocked request, a stale deploy), and the caller falls back
// to the built-in chart.

import { TV_LIBRARY_PATH, TV_LIBRARY_VERSION } from './config'
import type { TvGlobal } from './types'

const LOAD_TIMEOUT_MS = 15_000
let pending: Promise<TvGlobal> | null = null

const globalTv = (): TvGlobal | null => {
  const tv = (window as unknown as { TradingView?: TvGlobal }).TradingView
  return tv && typeof tv.widget === 'function' ? tv : null
}

export function loadTvLibrary(): Promise<TvGlobal> {
  const ready = globalTv()
  if (ready) return Promise.resolve(ready)
  if (pending) return pending
  pending = new Promise<TvGlobal>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${TV_LIBRARY_PATH}charting_library.standalone.js?v=${encodeURIComponent(TV_LIBRARY_VERSION)}`
    script.async = true
    const timer = setTimeout(() => fail(new Error('chart library timed out')), LOAD_TIMEOUT_MS)
    const fail = (err: Error) => {
      clearTimeout(timer)
      script.remove()
      pending = null
      reject(err)
    }
    script.onload = () => {
      clearTimeout(timer)
      const tv = globalTv()
      if (tv) resolve(tv)
      else fail(new Error('chart library did not define its widget'))
    }
    script.onerror = () => fail(new Error('chart library failed to load'))
    document.head.appendChild(script)
  })
  return pending
}
