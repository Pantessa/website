'use client'

// Slim, dismissible welcome strip at the top of the dashboard Overview for
// brand-new signed-in users. Points at the Get-started checklist just below.
// Dismiss persists (localStorage) and it never returns. Defaults hidden until
// storage is read so returning users never see a flash.

import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'

const DISMISS_KEY = 'yf_welcome_dismissed'

export default function WelcomeNudge() {
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      setHidden(false)
    }
  }, [])

  if (hidden) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setHidden(true)
  }

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-2.5">
      <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" />
      <p className="text-xs text-white min-w-0 flex-1">
        Welcome to Yeetful — from your first ask to money moved in a few steps.{' '}
        <a href="#get-started" className="underline underline-offset-2 decoration-dotted hover:text-emerald-300">
          Get started ↓
        </a>
      </p>
      <button
        onClick={dismiss}
        aria-label="Dismiss welcome"
        className="flex-shrink-0 p-1 rounded-md text-[color:var(--muted-2)] hover:text-white transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
