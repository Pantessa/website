import type { Metadata } from 'next'
import AppSpine from '@/components/AppSpine'
import WalletPage from '@/components/WalletPage'
import { FRAME_ATTR, SCROLL_ATTR } from '@/lib/phone-shell'

// /wallet — the "Wallet details" window given the whole screen (2026-09-11,
// Nate: "I love our wallet model, can we make this a page in the app and put
// it on the left side bar as an option above docs"). The app spine stands
// beside it the way it stands beside the chat, the dashboard and the markets
// frame, and IS the navigation here: the brochure nav returns null on this
// path (Navigation → isWalletPath) and the WALLET seat wears the active
// state. The body is a client component (a connected wallet's live reads);
// the shell is static.
//
// Below lg the shell is a PHONE FRAME (squad mobile-native, 2026-09-24; app/
// native-shell.css): the wrapper is the frame, the column around WalletPage
// is its ONE scroller (so PAGES' <main> stays untouched), and the spine's tab
// bar is the frame's last row, in flow. The old `max-lg:pb-[calc(48px+…)]`
// reserve is gone: the scroller ends where the bar begins. At lg+ the extra
// column is a flex pass-through (main keeps its flex-1), so nothing moves.
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
  const frame = { [FRAME_ATTR]: '' }
  const scroll = { [SCROLL_ATTR]: '' }
  return (
    <div data-shell="wallet" className="flex items-stretch lg:min-h-dvh" {...frame}>
      <AppSpine surface="wallet" />
      <div className="flex flex-1 min-w-0 flex-col" {...scroll}>
        <WalletPage />
      </div>
    </div>
  )
}
