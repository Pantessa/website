import type { Metadata } from 'next'
import AppSpine from '@/components/AppSpine'
import WalletPage from '@/components/WalletPage'

// /wallet — the "Wallet details" window given the whole screen (2026-09-11,
// Nate: "I love our wallet model, can we make this a page in the app and put
// it on the left side bar as an option above docs"). The app spine stands
// beside it the way it stands beside the chat, the dashboard and the markets
// frame, and IS the navigation here: the brochure nav returns null on this
// path (Navigation → isWalletPath) and the WALLET seat wears the active
// state. The body is a client component (a connected wallet's live reads);
// the shell is static. Below lg the spine is the fixed bottom tab bar, so the
// shell reserves its height.
//
// Never indexed: what it shows is whoever is connected.

const TITLE = 'Wallet — Pantessa'
const DESCRIPTION =
  'Every chain your wallet holds money on, priced: gas per chain, recent transfers, and the ways in and out. Your wallet stays the only signer.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: true },
}

export default function WalletRoute() {
  return (
    <div data-shell="wallet" className="flex min-h-dvh items-stretch max-lg:pb-[calc(48px+env(safe-area-inset-bottom))]">
      <AppSpine surface="wallet" />
      <WalletPage />
    </div>
  )
}
