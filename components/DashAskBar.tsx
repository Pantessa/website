'use client'

// Ask from anywhere: the dashboard's standing invitation. The same command
// bar the chat runs, docked (sticky) to the bottom of every dashboard page —
// the product's thesis is "you have an intent, we do the rest", so the
// intent input should be wherever you are. Enter PREFILLS /chat?prompt=
// (the URL contract: a URL never fires a turn — the user always sends).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function DashAskBar() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const go = () => {
    const ask = q.trim()
    router.push(ask ? `/chat?prompt=${encodeURIComponent(ask)}` : '/chat')
  }
  return (
    <div className="dashask">
      <div className="flex items-center gap-3 py-1.5 pl-4 pr-1.5 rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--surf-1)_92%,transparent)] backdrop-blur-md shadow-[0_10px_36px_-14px_rgba(0,0,0,0.55)] transition-[border-color,box-shadow] duration-200 focus-within:border-[color:var(--accent)]/45 focus-within:shadow-[0_0_0_4px_rgba(52,227,160,0.07),0_0_24px_rgba(52,227,160,0.06)]">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
          }}
          placeholder="Ask Pantessa — swaps, stocks, stop-losses, anything…"
          aria-label="Ask Pantessa — lands in chat with the ask ready"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-[color:var(--muted-2)] border-0 focus:outline-none"
        />
        <button
          onClick={go}
          aria-label="Take this ask to chat"
          title="Lands in chat with this ask ready — nothing sends until you do"
          className={cn(
            'flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all',
            q.trim()
              ? 'bg-[color:var(--accent)] text-black hover:brightness-110'
              : 'bg-[var(--surf-2)] text-[color:var(--muted-2)]',
          )}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
