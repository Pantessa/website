#!/usr/bin/env tsx
/**
 * The First Manager — a house Rebalancer that WORKS a hired 'shape'
 * mandate (THE ROSTER, wave 2). One run = one look:
 *
 *   1. probe the roster door (disabled → refuse, the server's words)
 *   2. find the wallet's slot HIRED to this manager's identity
 *   3. one-card-at-a-time: an undecided proposal already in the inbox →
 *      refuse to stack (tighter than the server's 3-pending fence)
 *   4. read the wallet's REAL balances (the mosaic exec shell's own
 *      multichain read, chain-scoped the same way)
 *   5. decideManagerMove (lib/roster-manager — the mosaic planner's own
 *      band): within band → "Already in shape", proposes NOTHING
 *   6. drifted → ONE $-priced intent via the REAL broker_open door,
 *      presenting agent_key — the merged R2 rails address it to the
 *      employer's inbox wearing the slot badge. Cap/budget walls are the
 *      SERVER's; their words are surfaced verbatim.
 *
 * No cron tonight — runnable by hand:
 *
 *   BASE=http://localhost:3811 npm run manager:once -- --wallet 0x…
 *
 * Every run is stamped internal (x-yf-internal-run) unless --live.
 * HOUSE_MANAGER_KEY (env or .env.local) is the identity; its
 * agentHandleFor hash is what the employer hired on /agents.
 */
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { agentHandleFor } from '../lib/agent-record'
import { getMultichainPortfolio } from '../lib/alchemy'
import { decideManagerMove, stackingRefusal, undecidedProposalFor } from '../lib/roster-manager'
import { parseMosaicAsk, mosaicStableFor, MOSAIC_CHAIN_LABELS, type MosaicChainWord, type MosaicHolding } from '../lib/mosaic'

const BASE = (process.env.BASE ?? 'http://localhost:3000').replace(/\/$/, '')
const LIVE = process.argv.includes('--live')
const walletArg = process.argv[process.argv.indexOf('--wallet') + 1]

// .env.local fallback for local runs (dotenv is a declared dep; Alchemy +
// the manager key both live there).
function envLocal(name: string): string | null {
  if (process.env[name]) return process.env[name]!
  try {
    const m = readFileSync('.env.local', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))
    return m ? m[1].trim().replace(/^"|"$/g, '') : null
  } catch {
    return null
  }
}

// Explicitly annotated so TS control-flow treats every refuse() as exit.
const refuse: (why: string) => never = (why) => {
  console.log(`🙅 ${why}`)
  process.exit(2)
}

async function main() {
  if (!walletArg || !/^0x[0-9a-fA-F]{40}$/.test(walletArg)) refuse('Pass --wallet 0x… (the employer wallet).')
  const wallet = walletArg.toLowerCase()
  const managerKey = envLocal('HOUSE_MANAGER_KEY') ?? refuse('HOUSE_MANAGER_KEY is not set — the manager has no identity.')
  const myHash = agentHandleFor(managerKey)
  const internalHeaders: Record<string, string> = LIVE ? {} : { 'x-yf-internal-run': '1' }
  console.log(`🧑‍💼 First Manager · identity ${myHash} · ${LIVE ? 'LIVE run' : 'internal run (stamped)'} · ${BASE}`)

  // 1 — the roster door itself (preview writes nothing; 503 = disabled).
  const probe = await fetch(`${BASE}/api/roster`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...internalHeaders },
    body: JSON.stringify({ preview: true, mandate: 'buy $1 of ETH weekly' }),
  })
  if (probe.status === 503) refuse(`The roster is closed: ${((await probe.json()) as { error?: string }).error ?? 'ROSTER_ENABLED is off.'}`)

  // 2 — the mandate: a slot on this wallet HIRED to this manager.
  const roster = ((await (await fetch(`${BASE}/api/roster?wallet=${wallet}`)).json()) as {
    slots?: { id: string; status: string; mandateKind: string; mandateText: string; agentKeyHash: string | null; capUsd: number }[]
  }).slots ?? []
  const slot = roster.find((s) => s.status === 'hired' && s.agentKeyHash === myHash && s.mandateKind === 'shape')
  if (!slot) {
    const near = roster.find((s) => s.agentKeyHash === myHash)
    refuse(
      near
        ? `No workable mandate: this manager's slot on ${wallet} is ${near.status} (${near.mandateKind}).`
        : `No mandate: ${wallet} has not hired this manager (${myHash}) into a shape slot. Hire it from the Team tab first.`,
    )
  }
  console.log(`📋 Mandate: "${slot!.mandateText}" · $${slot!.capUsd} cap · slot ${slot!.id}`)

  // 3 — one card at a time.
  const inbox = ((await (await fetch(`${BASE}/api/inbox?wallet=${wallet}`)).json()) as {
    items?: { slug: string; roster?: { slotId?: string } }[]
  }).items ?? []
  const undecided = undecidedProposalFor(inbox, slot!.id)
  if (undecided) refuse(stackingRefusal(undecided.slug))

  // 4 — the real balances, chain-scoped the way the mosaic exec shell does.
  const parsed = parseMosaicAsk(slot!.mandateText)
  if (!parsed || 'problem' in parsed) refuse('The stored mandate no longer parses — refusing rather than guessing.')
  const portfolio = await getMultichainPortfolio(wallet).catch(() => null)
  if (!portfolio) refuse("Couldn't read the wallet just now — nothing to manage against. Try again in a minute.")
  const named = new Set(parsed!.slices.map((s) => s.token))
  const chainUsd = (word: MosaicChainWord) =>
    portfolio!.holdings.reduce((a, h) => {
      if (h.chain !== MOSAIC_CHAIN_LABELS[word]) return a
      const sym = h.symbol.toUpperCase()
      if (!named.has(sym) && sym !== mosaicStableFor(word)) return a
      return a + (h.valueUsd ?? 0)
    }, 0)
  const chainWord: MosaicChainWord =
    parsed!.chainWord ??
    (['base', 'ethereum', 'arbitrum', 'robinhood'] as MosaicChainWord[]).reduce((best, w) => (chainUsd(w) > chainUsd(best) ? w : best), 'base' as MosaicChainWord)
  const holdings: MosaicHolding[] = portfolio!.holdings
    .filter((h) => h.chain === MOSAIC_CHAIN_LABELS[chainWord])
    .map((h) => ({ symbol: h.symbol.toUpperCase(), balance: parseFloat(h.balance) || 0, priceUsd: h.priceUsd, valueUsd: h.valueUsd, native: h.native }))

  // 5 — the decision (the mosaic planner's own band).
  const verdict = decideManagerMove({ slot: slot!, myAgentKeyHash: myHash, chainWord, holdings })
  if (verdict.kind === 'refuse') refuse(verdict.note)
  if (verdict.kind === 'in-shape') {
    console.log(`✅ ${verdict.note}`)
    console.log('   Proposing nothing — a good employee does not invent work.')
    return
  }

  // 6 — ONE $-priced proposal through the real desk door. The server's own
  // gates (cap at open, §4.4 budget, benched/fired) answer; we surface
  // their words verbatim and never retry around them.
  console.log(`📐 ${verdict.note}`)
  console.log(`✍️  Proposing: "${verdict.ask}"`)
  const client = new Client({ name: 'house-manager', version: '0.1.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/broker/mcp`), { requestInit: { headers: internalHeaders } }))
  const res = (await client.callTool({
    name: 'broker_open',
    arguments: { ask: verdict.ask, agent: 'Pantessa Rebalancer', agent_key: managerKey, wallet },
  })) as { content?: { type: string; text?: string }[]; isError?: boolean }
  const text = res.content?.find((c) => c.type === 'text')?.text ?? ''
  if (res.isError) refuse(`The desk refused: ${text}`)
  const out = JSON.parse(text) as { roster?: { url?: string; inboxUrl?: string; badge?: { label?: string } } }
  if (!out.roster) refuse('The desk opened a plain intent (no roster binding) — the hire must have changed mid-run. Nothing was addressed.')
  console.log(`📬 Delivered to the employer's inbox wearing the "${out.roster!.badge?.label}" badge:`)
  console.log(`   ${out.roster!.url}`)
  console.log(`   ${out.roster!.inboxUrl}`)
  await client.close()
}

main().catch((e) => {
  console.error(`💥 ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
