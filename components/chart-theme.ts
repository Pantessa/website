'use client'

// Theme-aware colors for every recharts surface (dashboard, adoption,
// activity, landing stats, blog). The dark values are the originals; light
// swaps the white-relative inks for paper-relative ones and deepens the
// accent hues so lines and bars keep contrast. Components re-render on
// toggle via the data-theme MutationObserver.

import { useEffect, useState } from 'react'

/** True when <html data-theme="light"> — live-tracks the footer toggle. */
export function useSiteTheme(): boolean {
  const [light, setLight] = useState(false)
  useEffect(() => {
    const el = document.documentElement
    const update = () => setLight(el.dataset.theme === 'light')
    update()
    const mo = new MutationObserver(update)
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return light
}

export interface ChartColors {
  accent: string
  blue: string
  grid: string
  muted: string
  /** Full-strength ink for category labels (was text `fill: '#fff'`). */
  ink: string
  /** Base of the monochrome bar ramp (was `fill="#ffffff"`). */
  mono: string
  tooltip: {
    background: string
    border: string
    borderRadius: number
    fontSize: number
    color: string
    boxShadow?: string
  }
}

const DARK: ChartColors = {
  accent: '#34E0A1',
  blue: '#6AA8FF',
  grid: 'rgba(255,255,255,0.06)',
  muted: 'rgba(255,255,255,0.45)',
  ink: '#fff',
  mono: '#ffffff',
  tooltip: {
    background: '#101012',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    fontSize: 12,
    color: '#fff',
  },
}

const LIGHT: ChartColors = {
  accent: '#0e8f62',
  blue: '#3b6fd4',
  grid: 'rgba(16,21,18,0.08)',
  muted: 'rgba(16,21,18,0.52)',
  ink: '#101512',
  mono: '#101512',
  tooltip: {
    background: '#ffffff',
    border: '1px solid rgba(16,21,18,0.14)',
    borderRadius: 10,
    fontSize: 12,
    color: '#101512',
    boxShadow: '0 10px 30px rgba(10,30,20,0.14)',
  },
}

export function useChartColors(): ChartColors {
  return useSiteTheme() ? LIGHT : DARK
}
