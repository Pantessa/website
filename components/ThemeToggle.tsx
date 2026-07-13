'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

/* Footer theme switch — three-way (system / light / dark). "System" is the
   default: no localStorage entry, the OS preference decides and live-tracks
   (the bootstrap script in app/layout.tsx owns the pre-paint + media-query
   side; this control owns explicit choices). Key shared with that script. */

const KEY = 'yf-theme'

type Mode = 'system' | 'light' | 'dark'

function applyMode(mode: Mode) {
  let theme: 'light' | 'dark'
  if (mode === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } else {
    theme = mode
  }
  const el = document.documentElement
  el.dataset.theme = theme
  el.classList.toggle('dark', theme === 'dark')
}

const OPTIONS: { mode: Mode; label: string; icon: React.ReactNode }[] = [
  { mode: 'system', label: 'Match system theme', icon: <Monitor size={14} strokeWidth={1.8} /> },
  { mode: 'light', label: 'Light theme', icon: <Sun size={14} strokeWidth={1.8} /> },
  { mode: 'dark', label: 'Dark theme', icon: <Moon size={14} strokeWidth={1.8} /> },
]

export default function ThemeToggle() {
  // SSR renders the neutral default; the stored choice lands after mount
  // (reading localStorage during render would mismatch hydration).
  const [mode, setMode] = useState<Mode>('system')

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY)
      if (stored === 'light' || stored === 'dark') setMode(stored)
    } catch {
      /* storage unavailable (private mode) — stay on system */
    }
  }, [])

  const choose = (next: Mode) => {
    setMode(next)
    try {
      if (next === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {
      /* still apply for this page view */
    }
    applyMode(next)
  }

  return (
    <div className="themetog" role="radiogroup" aria-label="Color theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          role="radio"
          aria-checked={mode === opt.mode}
          aria-label={opt.label}
          title={opt.label}
          className={`themetog__opt${mode === opt.mode ? ' is-on' : ''}`}
          onClick={() => choose(opt.mode)}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  )
}
