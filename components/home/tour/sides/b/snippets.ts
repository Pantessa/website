// THE TOUR · BUILD — the code the panel shows (lane SIDES-B). Every block is
// COPIED from a page a builder would land on next, and pinned equal to it
// (scripts/landing-sides-b-pins.ts reads this file and the source and fails
// when they drift). Nothing here is invented: no option, no tool, no flag.
//
//   embed  — components/EmbedAssemble.tsx LINES ("the real install"); each
//            option is documented on app/docs/embed/page.tsx (mode, mcps,
//            wallet: 'auto').
//   desk   — app/docs/desk/page.tsx "Connect in five minutes", the desk MCP
//            line; the three tools named under it are that page's loop
//            (broker_open, broker_handoff, broker_status).
//   sdk    — app/docs/desk/page.tsx "The agent-signed path" (entry point
//            `pantessa/desk`); the install line is the SDK README's
//            (`npm install pantessa viem`, also app/docs/_quickstart).
//
// Pure and client-safe.

export type BuildTabId = 'embed' | 'desk' | 'sdk'

export interface BuildBlock {
  /** What the block is, above it ("your page", "terminal"). */
  where: string
  code: string
}

export interface BuildTab {
  id: BuildTabId
  label: string
  /** One line: what you get. */
  says: string
  blocks: BuildBlock[]
  /** Short true lines under the code. */
  points: string[]
}

export const EMBED_SNIPPET = `import { mountPantessaChat } from 'pantessa/embed'

mountPantessaChat({
  mode: 'bubble',
  mcps: ['uniswap-free', 'snapshot-free'],
  wallet: 'auto', // the host page's wallet signs
})`

export const DESK_MCP_SNIPPET = 'claude mcp add --transport http pantessa-desk https://www.pantessa.com/api/broker/mcp'

export const SDK_INSTALL_SNIPPET = 'npm install pantessa viem'

export const SDK_SNIPPET = `import { openAndExecute, driveJob } from 'pantessa/desk'
import { privateKeyToAccount } from 'viem/accounts'

const signer = privateKeyToAccount(process.env.AGENT_KEY as \`0x\${string}\`)
const base = 'https://www.pantessa.com'

const { jobId, token } = await openAndExecute({
  base,
  ask: 'Fund Hyperliquid with $15 from Base, then 2x long $12 of HYPE',
  signer,
  agentKey: process.env.DESK_KEY!,
})

await driveJob({
  base, jobId, token, signer,
  rpc: { 8453: process.env.BASE_RPC! },
  onLeg: (leg) => console.log(\`leg \${leg.seq} · \${leg.kind} · \${leg.summary}\`),
})`

/** The desk tools the panel names, in the order the docs' loop uses them. */
export const DESK_TOOLS = ['broker_open', 'broker_handoff', 'broker_status'] as const

export const BUILD_TABS: readonly BuildTab[] = [
  {
    id: 'embed',
    label: 'Embed',
    says: 'The chat on your page, as a bubble or inline.',
    blocks: [{ where: 'your page', code: EMBED_SNIPPET }],
    points: ['Signatures open in the wallet your page already has, never inside the frame.', 'Scope it to the apps you choose with mcps.'],
  },
  {
    id: 'desk',
    label: 'Agent desk',
    says: 'Connect an agent over MCP. It plans in sentences; it never gets calldata.',
    blocks: [{ where: 'terminal', code: DESK_MCP_SNIPPET }],
    points: ['broker_open: the agent states an intent as one plain sentence.', 'broker_handoff: a sign link for its human, rebuilt and guard-checked when opened.', 'broker_status: the agent hears back whether it was signed and settled.'],
  },
  {
    id: 'sdk',
    label: 'SDK',
    says: 'Hand it a signer and one call drives every leg of a job.',
    blocks: [
      { where: 'terminal', code: SDK_INSTALL_SNIPPET },
      { where: 'your agent', code: SDK_SNIPPET },
    ],
    points: ['Each leg is built and guard-checked when it is offered; the key stays with you.'],
  },
]
