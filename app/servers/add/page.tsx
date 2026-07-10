'use client'

// /servers/add IS the chat's Add-MCP dialog now — ONE add flow everywhere
// (Nate 2026-07-10: two diverging forms; keep the chat one). The URL stays:
// docs, the landing BYO tile, ComposeSet, and EmbedsPanel all deep-link it.
// The dialog discovers tools/list from the pasted base URL, lets the
// submitter star "ping first" tools, and drops the agent straight into the
// chat working set — so the natural next step after adding is /chat.

import { useState } from 'react'
import Link from 'next/link'
import { Plus, MessageSquare, LayoutGrid } from 'lucide-react'
import AddMcpModal from '@/components/AddMcpModal'

export default function AddServerPage() {
  const [open, setOpen] = useState(true)

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-20">
      <p className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">Bring your own</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Add your MCP</h1>
      <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted)]">
        Paste your MCP&apos;s base URL and its tools are discovered automatically. Star the tools a new
        account should try first — they become the agent&apos;s starting hints. The moment it&apos;s added,
        it lands in your chat working set, composable with every other agent in your set.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-[#04231a] transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add an MCP
        </button>
        <Link
          href="/chat"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:text-white"
        >
          <MessageSquare className="h-4 w-4" /> Use it in chat
        </Link>
        <Link
          href="/servers"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[color:var(--muted)] transition-colors hover:border-[var(--line-2)] hover:text-white"
        >
          <LayoutGrid className="h-4 w-4" /> Browse the directory
        </Link>
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-[color:var(--muted-2)]">
        Adding the same MCP base again refreshes its tools instead of creating a duplicate. Free MCP
        calls are rate-limited per IP; paid ones settle per call over x402.
      </p>

      <AddMcpModal open={open} onClose={() => setOpen(false)} />
    </main>
  )
}
