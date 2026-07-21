import type { Metadata } from 'next'
import SignHandoff from '@/components/SignHandoff'

// /sign — the agent → human handoff surface. An external agent (Claude
// Desktop/Code, OpenClaw, any MCP client) plans an action and hands its human
// ONE link: /sign?ask=<the sentence>[&mcps=slug,slug]. The page shows the ask
// and the guardrail contract, then drops into /chat with the ask prefilled —
// the guarded native layers REBUILD it from scratch. The URL carries a
// sentence, never calldata, never addresses to pay: nothing an agent can
// smuggle through this seam is executable by itself.

const TITLE = 'Review & sign — an agent prepared this ask'
const DESCRIPTION =
  'An AI agent planned this action. Yeetful rebuilds it with deterministic guarded builders — the model never writes calldata — and your wallet is the only thing that can sign it.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Yeetful', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default async function SignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  return <SignHandoff ask={one(sp.ask) ?? ''} mcps={one(sp.mcps) ?? ''} agent={one(sp.agent) ?? ''} />
}
