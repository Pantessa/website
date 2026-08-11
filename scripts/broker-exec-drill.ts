// scripts/broker-exec-drill.ts — the x402-payer drill: an agent that SIGNS.
//
// Plays an external agent holding its own key (the same kind that signs
// x402 payments): opens a SEQUENCED ask at the desk, calls broker_execute,
// then drives the job leg by leg off the job API — polling until the runner
// builds the current leg, printing the guarded artifact's SHAPE (never the
// bytes), signing locally, and (only with LIVE=1) broadcasting + posting
// completion so the runner's wait leg can verify arrival and release the
// next leg.
//
// DRY by default: with a fresh throwaway key the first build refuses on
// real balances — which IS the demo of the guard posture. LIVE=1 with a
// funded AGENT_KEY runs the real sequenced flow and moves REAL money.
//
//   BASE=http://localhost:3620 npx tsx scripts/broker-exec-drill.ts \
//     ["swap 1 USDC for ETH on base, then send 0.5 USDC on base to 0x…"]
//   AGENT_KEY=0x… LIVE=1 …            # the real thing — owner's call
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const BASE = (process.env.BASE ?? 'http://localhost:3000').replace(/\/$/, '')
const LIVE = process.env.LIVE === '1'
const KEY = (process.env.AGENT_KEY ?? generatePrivateKey()) as `0x${string}`
const account = privateKeyToAccount(KEY)
const ASK =
  process.argv[2] ??
  `swap 1 USDC for ETH on base, then send 0.5 USDC on base to ${account.address}`

function say(who: 'desk' | 'agent' | 'jobapi', text: string) {
  const tag =
    who === 'desk' ? '\x1b[32m[desk  ]\x1b[0m' : who === 'jobapi' ? '\x1b[33m[jobapi]\x1b[0m' : '\x1b[36m[agent ]\x1b[0m'
  console.log(`${tag} ${text}`)
}

function parsePayload(res: unknown): Record<string, unknown> {
  const r = res as { content?: { type: string; text?: string }[]; isError?: boolean }
  const text = r.content?.find((c) => c.type === 'text')?.text ?? ''
  if (r.isError) throw new Error(`desk refused: ${text}`)
  if (/0x[0-9a-fA-F]{64,}/.test(text)) throw new Error('LEAK: MCP surface returned raw hex material.')
  return JSON.parse(text)
}

/** Describe an artifact without printing its bytes. */
function shapeOf(artifact: unknown): string {
  if (!artifact || typeof artifact !== 'object') return 'none yet'
  const a = artifact as Record<string, unknown>
  const keys = Object.keys(a)
  const chain = (a.chainId ?? (a.txChain as any)?.[0]?.chainId ?? '?') as string | number
  return `{${keys.slice(0, 6).join(', ')}} on chain ${chain}`
  // deliberately no values — the drill treats bytes as radioactive
}

async function main() {
  say('agent', `I am ${account.address} (${LIVE ? 'LIVE — will broadcast' : 'DRY — will not broadcast'})`)
  say('agent', `sequenced ask: "${ASK}"`)

  const client = new Client({ name: 'payer-agent', version: '0.1.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/broker/mcp`)))

  const open = parsePayload(
    await client.callTool({
      name: 'broker_open',
      arguments: { ask: ASK, wallet: account.address, agent: 'payer-agent' },
    }),
  )
  const intentId = open.intentId as string
  say('desk', (open.plan as any).say)

  const exec = parsePayload(await client.callTool({ name: 'broker_execute', arguments: { intent_id: intentId } }))
  const steps = exec.steps as { seq: number; kind: string; note: string }[]
  say('desk', exec.say as string)
  for (const s of steps) say('desk', `  leg ${s.seq}: [${s.kind}] ${s.note}`)
  const drive = exec.drive as { poll: string; complete: string }
  const pollUrl = drive.poll.replace(/^https?:\/\/[^/]+/, BASE)
  const completeUrl = drive.complete.replace(/^https?:\/\/[^/]+/, BASE)

  // Drive loop: poll until the current leg is offered, handle it, repeat.
  for (let tick = 0; tick < 24; tick++) {
    const { job } = (await (await fetch(pollUrl)).json()) as {
      job: {
        status: string
        currentStep: number
        steps: { seq: number; kind: string; status: string; title: string; artifact?: unknown }[]
        failReason?: string
      }
    }
    const cur = job.steps?.find((s) => s.seq === job.currentStep)
    say('jobapi', `job ${job.status} · leg ${job.currentStep}: ${cur ? `[${cur.kind}] ${cur.title} (${cur.status})` : '—'}`)

    if (job.status === 'done') { say('agent', 'all legs settled. 🤝'); break }
    if (job.status === 'failed') { say('jobapi', `failed closed: ${job.failReason ?? 'see step'}`); break }

    if (cur?.kind === 'sign' && cur.status === 'offered' && cur.artifact) {
      say('jobapi', `guarded artifact ready: ${shapeOf(cur.artifact)}`)
      if (!LIVE) {
        say('agent', 'DRY — I would sign and broadcast this leg with my own key, then POST completion. Stopping here.')
        break
      }
      // LIVE: sign + broadcast is builder-specific (txChain legs are raw txs
      // the wallet sends; order legs go to their submit relays). v0 drill
      // handles the raw-tx case only.
      say('agent', 'LIVE signing not wired for this artifact kind in the v0 drill — stopping before broadcast.')
      break
    }
    if (cur?.kind === 'wait') say('agent', 'runner is verifying on-chain arrival before releasing the next leg…')
    await new Promise((r) => setTimeout(r, 5000))
  }

  const status = parsePayload(await client.callTool({ name: 'broker_status', arguments: { intent_id: intentId } }))
  say('desk', `status: ${status.state} — ${status.say}`)

  if (process.env.KEEP === '1') {
    say('agent', `KEEP=1 — job stays live (intent ${intentId}).`)
  } else {
    const closed = parsePayload(await client.callTool({ name: 'broker_close', arguments: { intent_id: intentId } }))
    say('agent', `cleaned up: ${closed.say}`)
  }
  await client.close()
}

main().catch((e) => {
  console.error(`❌ exec drill failed: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
