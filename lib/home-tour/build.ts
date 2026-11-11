// THE TOUR · BUILD (lane SIDES-B owns this file). Rules: lib/home-tour/types.ts.
//
// Where each claim is implemented (checked 2026-11-10):
//   • "embeds in a few lines" — components/EmbedAssemble.tsx LINES, the
//     options documented on app/docs/embed.
//   • "signs through the wallet your page already has" — app/docs/embed
//     "Wallet bridge": signatures sign through the user's own wallet,
//     "prompting on your page, never inside the frame".
//   • "an agent plans in sentences … a person, or the agent's own key, signs"
//     — app/docs/desk lead: "it plans in plain sentences, deterministic
//     guarded builders write every transaction, and a human (or the agent's
//     own key, under caps) is the only signer. Nothing this surface hands
//     your agent can execute by itself."
//   • "the model never writes calldata or an address" — same lead; GUARDRAILS.md.
// The venue and address counts are NOT typed here: the panel's foot links
// them to /docs/venues from the snapshot and drops the line when they are null.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'build',
  label: 'Build',
  claim: 'Put it on your site. Hand it to your agent.',
  line: 'Embed the chat, or give an agent the desk.',
  body: 'The chat embeds in a few lines and signs with your visitors’ own wallets. An agent gets the desk: it plans in plain sentences, guarded builders write every transaction, and a person, or the agent’s own key, signs.',
  facts: ['The model never writes calldata or an address', 'Nothing an agent is handed can execute by itself', 'The embed signs through the wallet your page already has'],
  doors: [
    { label: 'Read the docs', href: '/docs', kind: 'primary' },
    { label: 'Embed the chat', href: '/docs/embed', kind: 'quiet' },
    { label: 'The agent desk', href: '/docs/desk', kind: 'quiet' },
  ],
  asks: [],
}
