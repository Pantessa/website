// scripts/broker-drill.ts — the counterpart agent for the desk demo.
//
// Plays an EXTERNAL agent that needs something done with money it cannot
// touch: connects to /api/broker/mcp, opens "I need $15 of AAPL", reads the
// quote, picks a funding route when offered, takes the sign link, and polls
// status — the whole two-agent conversation, printed as a transcript.
//
// Read-only by construction: this script holds no key, receives no
// transaction material (it asserts that on every payload), and ends holding
// exactly one thing — a sign link a human could open.
//
//   BASE=http://localhost:3620 npx tsx scripts/broker-drill.ts [ask] [wallet]
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const BASE = (process.env.BASE ?? 'http://localhost:3000').replace(/\/$/, '')
const ASK = process.argv[2] ?? 'Buy $15 of AAPL'
const WALLET = process.argv[3] // optional: the "human's" wallet to scan

const HEX_RE = /0x[0-9a-fA-F]{64,}/

function say(who: 'desk' | 'agent', text: string) {
  const tag = who === 'desk' ? '\x1b[32m[desk ]\x1b[0m' : '\x1b[36m[agent]\x1b[0m'
  console.log(`${tag} ${text}`)
}

function parsePayload(res: unknown): Record<string, unknown> {
  const r = res as { content?: { type: string; text?: string }[]; isError?: boolean }
  const text = r.content?.find((c) => c.type === 'text')?.text ?? ''
  if (r.isError) throw new Error(`desk refused: ${text}`)
  if (HEX_RE.test(text)) throw new Error('LEAK: the desk returned raw hex material — contract broken.')
  return JSON.parse(text)
}

async function main() {
  say('agent', `I need this done: "${ASK}"${WALLET ? ` for my human's wallet ${WALLET}` : ''}`)

  const client = new Client({ name: 'hungry-agent', version: '0.1.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/broker/mcp`)))

  const caps = parsePayload(await client.callTool({ name: 'broker_capabilities', arguments: {} }))
  say('desk', `capabilities: ${(caps.capabilities as string[]).length} lanes · contract: ${(caps.contract as string).slice(0, 96)}…`)

  const open = parsePayload(
    await client.callTool({
      name: 'broker_open',
      arguments: { ask: ASK, agent: 'hungry-agent', ...(WALLET ? { wallet: WALLET } : {}) },
    }),
  )
  const plan = open.plan as {
    quote: { gate: string; kind: string; funding?: { verdict: string; movableUsd: number; askUsd: number } }
    options: { id: string; label: string; kind: string }[]
    say: string
  }
  say('desk', plan.say)
  say('desk', `options: ${plan.options.map((o) => `${o.id} (${o.label})`).join(' · ')}`)

  let intentId = open.intentId as string

  // Negotiate: if the desk offered funding routes, take the first one.
  const fundingOpt = plan.options.find((o) => o.kind === 'funding')
  if (fundingOpt) {
    say('agent', `my human is short — take the "${fundingOpt.label}" route (${fundingOpt.id})`)
    const chosen = parsePayload(
      await client.callTool({ name: 'broker_choose', arguments: { intent_id: intentId, option_id: fundingOpt.id } }),
    )
    const cplan = chosen.plan as { ask: string; say: string }
    say('desk', `working ask is now: "${cplan.ask}"`)
    say('desk', cplan.say)
  } else {
    say('agent', 'quote accepted — proceed as asked')
  }

  const handoff = parsePayload(
    await client.callTool({ name: 'broker_handoff', arguments: { intent_id: intentId } }),
  )
  say('desk', `sign link minted: ${handoff.url}`)
  say('agent', `handing ${handoff.url} to my human…`)

  const status = parsePayload(
    await client.callTool({ name: 'broker_status', arguments: { intent_id: intentId } }),
  )
  const funnel = status.funnel as Record<string, number>
  say('desk', `status: ${status.state} — ${status.say} (funnel ${JSON.stringify(funnel)})`)

  say('agent', 'done. I hold a link and a status feed — and not a single transaction byte.')

  // Leave no trace by default: this drill mints REAL rows in the shared DB.
  // KEEP=1 keeps the link alive so a human can actually open and sign it.
  if (process.env.KEEP === '1') {
    say('agent', `KEEP=1 — link stays live for a real signing drill (intent ${intentId}).`)
  } else {
    const closed = parsePayload(await client.callTool({ name: 'broker_close', arguments: { intent_id: intentId } }))
    say('agent', `cleaned up: ${closed.say}`)
  }
  await client.close()
}

main().catch((e) => {
  console.error(`❌ drill failed: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
