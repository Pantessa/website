// Vercel Web Analytics custom events — one chokepoint so event names stay
// consistent and a tracking failure can never break product UX. Events only
// ship in production (the <Analytics /> mount is prod-gated in app/layout).
//
// Wallet addresses are recorded deliberately (owner directive): they're
// pseudonymous public chain data and double as the user id for funnels.

import { track } from '@vercel/analytics'

function send(name: string, props?: Record<string, string | number | boolean>) {
  try {
    track(name, props)
  } catch {
    /* analytics must never throw into the app */
  }
}

export const analytics = {
  /** Wallet connected (wagmi onConnect) — the top of every funnel. */
  walletConnected: (address: string, connector?: string) =>
    send('wallet_connected', { address, connector: connector ?? 'unknown' }),

  /** SIWE verified — the moment a visitor becomes a portal user. */
  signedIn: (address: string) => send('siwe_signed_in', { address }),

  /** Directory engagement: an agent toggled into/out of the runner. */
  agentToggled: (slug: string, active: boolean) =>
    send(active ? 'agent_added' : 'agent_removed', { slug }),

  /** A chat message sent — agents in play + whether the sender is authed.
   *  authed:false turns are the guest-trial lane (first-ask wall work). */
  chatMessage: (agents: number, authed: boolean) =>
    send('chat_message_sent', { agents, authed }),

  /** An example chip tapped (empty state / splash). sent=true means the tap
   *  ran the turn itself; false means it prefilled (MCP toggle needed). */
  exampleRun: (prompt: string, sent: boolean) =>
    send('example_chip', { prompt: prompt.slice(0, 80), sent }),

  /** A chat turn that actually paid: settled receipt totals. */
  chatPaid: (totalUsd: number, calls: number, services: string) =>
    send('chat_paid', { totalUsd, calls, services }),

  /** API key minted on the dashboard (no secret material, ever). */
  apiKeyMinted: () => send('api_key_minted'),

  /** EIP-712 grant signature completed. */
  grantSigned: (grantId: string) => send('grant_signed', { grantId }),

  /** Per-agent spend approval flipped. */
  approvalToggled: (slug: string, approved: boolean) =>
    send('agent_approval_toggled', { slug, approved }),

  /** The docs funnel metric: the Claude Code prompt copied. */
  promptCopied: (label: string) => send('docs_prompt_copied', { label }),
}
