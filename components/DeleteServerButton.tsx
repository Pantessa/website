'use client'

// Admin-only "Delete Server" control at the very bottom of a service detail page.
// Only Pantessa admin wallets (isAdminAddress — the client sees OWNER_WALLETS) ever
// see it; the DELETE /api/servers/[slug] route re-checks the session server-side,
// so a hidden button is a courtesy, never the gate. Two-step confirm because the
// delete is irreversible (drops the endpoint surface, ratings, and owner claim).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { useSession } from '@/lib/session'
import { isAdminAddress } from '@/lib/admin'

export default function DeleteServerButton({ slug, name }: { slug: string; name: string }) {
  const { address } = useSession()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Wallet/session state is client-only — render nothing until we know the viewer
  // is an admin (avoids a hydration mismatch and never flashes for non-admins).
  if (!isAdminAddress(address)) return null

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/servers/${slug}`, { method: 'DELETE' })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setError(body?.error ?? 'Delete failed.')
        setBusy(false)
        return
      }
      // Gone — leave the (now-404) detail page for the directory.
      router.push('/servers')
      router.refresh()
    } catch {
      setError('Delete failed.')
      setBusy(false)
    }
  }

  return (
    <div className="mt-10 border-t border-[color:var(--line)] pt-6 flex flex-col items-start gap-2">
      <p className="text-[11px] uppercase tracking-wide text-[color:var(--muted-2)] font-medium">Admin</p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-[color:var(--muted)]">
            Permanently delete <span className="text-white font-medium">{name}</span> and its endpoints?
          </span>
          <button
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/60 bg-red-500/10 px-3 py-1.5 text-[13px] font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            <Trash2 width={14} height={14} />
            {busy ? 'Deleting…' : 'Yes, delete'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded-md border border-[color:var(--line)] px-3 py-1.5 text-[13px] text-[color:var(--muted)] transition-colors hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-500/60 px-3 py-1.5 text-[13px] font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          <Trash2 width={14} height={14} />
          Delete Server
        </button>
      )}
      {error && <p className="text-[12px] text-red-400">{error}</p>}
    </div>
  )
}
