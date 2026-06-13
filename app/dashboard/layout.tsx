'use client'

// Dashboard shell: the wallet → SIWE gate lives HERE (once), and authed
// children render inside a Vercel-style layout — persistent left sidebar with
// sections, content on the right. Pages below this layout can assume a
// signed-in session and just fetch.

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { ShieldCheck, Wallet } from 'lucide-react'
import { useSession } from '@/lib/session'
import DashboardSidebar from '@/components/DashboardSidebar'
import OrgSwitcher from '@/components/OrgSwitcher'
import { short } from '@/lib/dashboard-ui'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { address, needsSignIn, signIn, signingIn, status } = useSession()

  // Wallet state is client-only — render nothing until mounted (hydration-safe).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  if (!isConnected) {
    return (
      <Gate
        icon={<Wallet className="w-7 h-7" />}
        title="Connect your wallet"
        body="The dashboard shows your agent expense account — spend, approvals, and receipts — scoped to your wallet."
        cta="Connect Wallet"
        onClick={() => openConnectModal?.()}
      />
    )
  }
  if (!address) {
    return (
      <Gate
        icon={<ShieldCheck className="w-7 h-7" />}
        title="Sign in to your expense account"
        body="A quick wallet signature proves ownership — then your spend data and approvals load."
        cta={signingIn ? 'Signing in…' : 'Sign in with Ethereum'}
        onClick={() => signIn()}
        busy={signingIn || (status === 'loading' && !needsSignIn)}
      />
    )
  }

  return (
    <div className="dash">
      <aside className="dash__rail">
        <OrgSwitcher />
        <div className="dash__who mono">{short(address)}</div>
        <DashboardSidebar pathname={pathname} />
      </aside>
      <main className="dash__main">{children}</main>
    </div>
  )
}

function Gate({
  icon,
  title,
  body,
  cta,
  onClick,
  busy,
}: {
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  onClick: () => void
  busy?: boolean
}) {
  return (
    <div className="max-w-md mx-auto px-6 py-24 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
        {icon}
      </div>
      <h1 className="text-xl font-semibold text-white mb-2">{title}</h1>
      <p className="text-sm text-[color:var(--muted)] mb-6">{body}</p>
      <button className="btn btn--solid" onClick={onClick} disabled={busy}>
        {busy ? 'One sec…' : cta}
      </button>
    </div>
  )
}
