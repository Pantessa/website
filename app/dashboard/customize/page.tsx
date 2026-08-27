'use client'

// Dashboard · Customize page — the creator page's own section, because the
// controls were a single row at the top of /dashboard/links and every creator
// scrolled past them. Same API, same rules; it just has a door now.

import CreatorPageStudio from '@/components/CreatorPageStudio'

export default function DashboardCustomizePage() {
  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-xl font-semibold text-[color:var(--fg)]">Customize page</h1>
      <p className="mb-6 max-w-2xl text-sm text-[color:var(--muted)]">
        Your public page at <span className="mono">/l/your-name</span> — the one every link you mint
        lands on. Name it, color it, put your own logo on it. Everything here shows up in the share
        card the moment you change it.
      </p>
      <CreatorPageStudio />
    </div>
  )
}
