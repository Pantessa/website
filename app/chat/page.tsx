import type { Metadata } from 'next'
import ChatWorkspace from '@/components/ChatWorkspace'

// /chat gets its own social card: deep links into the chat (?prompt= asks,
// shared-receipt handoffs, splash chips) are pasted around constantly, and
// without this they fell back to the generic site card. One sentence per
// surface (STORY.md): say what should happen; sign what it builds.

const TITLE = 'Yeetful Chat — say what should happen. Sign what it builds.'
const DESCRIPTION =
  'One composer for every dapp: swaps, recurring buys, stop-losses, fund-then-act jobs. Yeetful compiles the sentence into guarded transactions — your wallet stays the only signer.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Yeetful', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default function ChatPage() {
  return <ChatWorkspace />
}
