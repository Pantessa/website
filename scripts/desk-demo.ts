// scripts/desk-demo.ts — M7: the demo that sells the desk, end to end.
//
// Plays the WHOLE loop in one run, preflight-style, printing the two-agent
// transcript as it goes:
//
//   1. an external agent (with a desk identity) opens "I need $15 of AAPL"
//   2. the desk quotes it through the real gate ladder and offers options
//   3. the agent proceeds and mints the sign link (broker_handoff)
//   4. the HUMAN side is simulated: open → connect → signed funnel events
//      land on the link (the same beacons the /i runtime posts)
//   5. the agent polls broker_status and watches the state flip to SIGNED
//   6. the agent's public track record page renders under its handle
//
// No transaction material ever crosses the MCP surface (asserted per call),
// no real money moves (the sign is a funnel event, not an embed_turn — so
// the record's MONEY stays honest: funnel events never mint value).
//
// Cleans up after itself (link + events + intent deleted) unless KEEP=1.
//
//   BASE=http://localhost:3717 npx tsx scripts/desk-demo.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHash } from 'node:crypto'

const BASE = (process.env.BASE ?? 'http://localhost:3000').replace(/\/$/, '')
const ASK = process.argv[2] ?? 'Buy $15 of AAPL'
const AGENT_NAME = 'Demo Agent'
const AGENT_KEY = 'desk-demo-agent-key'
const KEEP = process.env.KEEP === '1'

const HEX_RE = /0x[0-9a-fA-F]{64,}/

function say(who: 'desk' | 'agent' | 'human', text: string) {
  const tag =
    who === 'desk'
      ? '\x1b[32m[desk ]\x1b[0m'
      : who === 'human'
        ? '\x1b[33m[human]\x1b[0m'
        : '\x1b[36m[agent]\x1b[0m'
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
  const client = new Client({ name: 'demo-agent', version: '0.1.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/broker/mcp`)))
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    parsePayload(await client.callTool({ name, arguments: args }))

  say('agent', `I need this done for my human: "${ASK}"`)

  // 1–2: open with a bound identity; the desk quotes through the real ladder.
  const open = await call('broker_open', { ask: ASK, agent: AGENT_NAME, agent_key: AGENT_KEY })
  const intentId = String(open.intentId)
  const plan = open.plan as { say?: string; options?: { id: string; label: string }[] }
  say('desk', plan.say ?? 'quoted.')
  say('desk', `options: ${(plan.options ?? []).map((o) => `${o.id} (${o.label})`).join(' · ')}`)
  if (open.recordUrl) say('desk', `your public track record: ${open.recordUrl}`)

  // 3: proceed → sign link.
  await call('broker_choose', { intent_id: intentId, option_id: 'proceed' })
  say('agent', 'quote accepted — proceed as asked')
  const hand = await call('broker_handoff', { intent_id: intentId })
  const url = String(hand.url)
  const slug = url.split('/').pop()!
  say('desk', `sign link minted: ${url}`)
  say('agent', 'handing the link to my human…')

  // 4: the human side — the same funnel beacons the /i runtime posts.
  const beacon = (kind: string, extra: Record<string, unknown> = {}) =>
    fetch(`${BASE}/api/intent-links/${slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, ...extra }),
    })
  await beacon('open')
  say('human', 'opened the link — reading the ask and the guardrail contract')
  await beacon('connect', { wallet: '0x2222222222222222222222222222222222222222' })
  say('human', 'connected a wallet — the guarded build runs')
  await beacon('signed', { valueUsd: 15 })
  say('human', 'signed. (In the demo this is the funnel beacon; on the real page the wallet signature IS this moment.)')

  // 5: the agent hears back.
  const status = await call('broker_status', { intent_id: intentId })
  say('desk', `status: ${status.state} — ${status.say}`)
  if (status.state !== 'signed') throw new Error(`expected signed, got ${status.state}`)
  say('agent', 'my human signed — the loop is closed, and I never touched a transaction byte.')

  // 6: the public track record renders under the agent's handle.
  const handle = createHash('sha256').update(AGENT_KEY).digest('hex').slice(0, 16)
  const rec = await fetch(`${BASE}/agents/${handle}`)
  const recHtml = await rec.text()
  if (rec.status !== 200 || !recHtml.includes(AGENT_NAME)) throw new Error('track record page did not render')
  say('desk', `track record live: ${BASE}/agents/${handle} (intents +1; money stays honest — funnel events never mint value)`)

  // Cleanup — the demo leaves no rows unless KEEP=1.
  if (!KEEP) {
    process.env.DATABASE_URL ??= ''
    const { default: prisma } = await import('../lib/db')
    await prisma.intentLinkEvent.deleteMany({ where: { slug } })
    await prisma.intentLink.delete({ where: { id: slug } }).catch(() => {})
    await prisma.brokerIntent.delete({ where: { id: intentId } }).catch(() => {})
    say('agent', 'demo rows cleaned up.')
  } else {
    say('agent', `KEEP=1 — link ${url} and the record stay live for the clip.`)
  }
  await client.close()
  console.log('\n\x1b[1mDESK DEMO GREEN\x1b[0m — negotiate → handoff → human signs → agent hears back → public record.')
  process.exit(0)
}

main().catch((e) => {
  console.error('\x1b[31mDESK DEMO RED\x1b[0m', e instanceof Error ? e.message : e)
  process.exit(1)
})
