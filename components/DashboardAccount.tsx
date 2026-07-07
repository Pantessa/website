'use client'

// The account control pinned to the BOTTOM of the dashboard rail (and repeated
// in the mobile drawer). Inside /dashboard the top site-nav drops its account
// pill — navigation lives in this rail — so this is where a signed-in user sees
// their wallet and signs out. A button opens an upward popover with wallet
// details (RainbowKit's account modal) and Sign out.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { LogOut, Wallet, ChevronsUpDown } from 'lucide-react'
import { useSession } from '@/lib/session'
import { short } from '@/lib/dashboard-ui'

export default function DashboardAccount({ address }: { address: string }) {
  const router = useRouter()
  const { signOut } = useSession()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const closeNow = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeNow()
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) closeNow()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, closeNow])

  return (
    <ConnectButton.Custom>
      {({ openAccountModal, mounted }) => (
        <div className="dashacct" ref={wrap}>
          {open && (
            <div className="dashacct__menu" role="menu">
              {mounted && (
                <button
                  type="button"
                  role="menuitem"
                  className="dashacct__item"
                  onClick={() => {
                    closeNow()
                    openAccountModal()
                  }}
                >
                  <Wallet width={15} height={15} strokeWidth={2.25} />
                  Wallet details
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="dashacct__item dashacct__item--danger"
                onClick={() => {
                  closeNow()
                  signOut().then(() => router.push('/'))
                }}
              >
                <LogOut width={15} height={15} strokeWidth={2.25} />
                Sign out
              </button>
            </div>
          )}

          <button
            type="button"
            className={`dashacct__btn ${open ? 'is-active' : ''}`}
            aria-haspopup="true"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="dashacct__dot" aria-hidden />
            <span className="dashacct__addr mono">{short(address)}</span>
            <ChevronsUpDown className="dashacct__chev" width={14} height={14} />
          </button>
        </div>
      )}
    </ConnectButton.Custom>
  )
}
