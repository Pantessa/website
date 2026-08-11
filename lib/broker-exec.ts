// lib/broker-exec.ts — the agent broker's I/O half.
//
// Owns persistence (broker_intents), the live funding scan, sign-link
// minting, and the settlement feedback loop the fire-and-forget hands MCP
// deliberately lacks: broker_status reads the SAME server-truth rows the
// dashboards read (intent_link_events + signed embed_turns), so the calling
// agent finally learns whether its human signed.
//
// Everything outbound passes assertNoTxMaterial — the desk talks in
// sentences and links, never transaction bytes.

import prisma from '@/lib/db'
import { mintSlug, composeMcps } from '@/lib/intent-links'
import { scanFundingSources } from '@/lib/funding-plan'
import {
  planIntent,
  cleanAgentName,
  cleanWallet,
  assertNoTxMaterial,
  type BrokerPlan,
  type BrokerState,
} from '@/lib/broker'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.pantessa.com').replace(/\/$/, '')

export interface OpenResult {
  intentId: string
  state: BrokerState
  plan: BrokerPlan
  contract: string
  next: string[]
}

const CONTRACT =
  'Sentences in, sentences and sign links out. The desk never returns calldata, typed data, or deposit addresses; ' +
  'the guarded deterministic builders rebuild every action from scratch on the sign side, and the human wallet is the only signer.'

/** Open a brokered intent: parse, quote, scan funding when a wallet rides
 *  along, persist, and return the negotiation. */
export async function openIntent(opts: {
  ask: string
  wallet?: unknown
  agent?: unknown
}): Promise<OpenResult> {
  const wallet = cleanWallet(opts.wallet)
  const agent = cleanAgentName(opts.agent)
  const scan = wallet ? await scanFundingSources(wallet).catch(() => null) : null
  const plan = planIntent(opts.ask, scan)

  const row = await prisma.brokerIntent.create({
    data: {
      id: mintSlug(10),
      ask: plan.ask,
      wallet,
      agent,
      state: 'open',
      plan: plan as object,
    },
  })

  const out: OpenResult = {
    intentId: row.id,
    state: 'open',
    plan,
    contract: CONTRACT,
    next: [
      'broker_choose with an option id to rewrite the working ask (funding routes are real resume-sentences)',
      'broker_handoff to mint the sign link for your human',
      'broker_status any time after handoff to learn whether they signed',
    ],
  }
  assertNoTxMaterial(out)
  return out
}

/** Choose an option: rewrite the working sentence and re-quote. The chosen
 *  resume re-enters the same parse ladder — no other negotiation channel
 *  exists, by design. */
export async function chooseOption(intentId: string, optionId: string): Promise<OpenResult> {
  const row = await mustIntent(intentId)
  if (row.state !== 'open') throw new Error(`Intent ${intentId} is ${row.state} — choosing is over.`)
  const prior = row.plan as unknown as BrokerPlan
  const opt = prior.options.find((o) => o.id === optionId)
  if (!opt) throw new Error(`Unknown option "${optionId}" — offered: ${prior.options.map((o) => o.id).join(', ')}.`)

  if (opt.kind === 'decline') {
    await closeIntent(row.id)
    const out = {
      intentId: row.id,
      state: 'closed' as BrokerState,
      plan: prior,
      contract: CONTRACT,
      next: ['This intent is closed. Open a new one when your human changes their mind.'],
    }
    assertNoTxMaterial(out)
    return out
  }

  const scan = row.wallet ? await scanFundingSources(row.wallet).catch(() => null) : null
  const plan = planIntent(opt.resume, scan)
  await prisma.brokerIntent.update({ where: { id: row.id }, data: { ask: plan.ask, plan: plan as object } })
  const out: OpenResult = {
    intentId: row.id,
    state: 'open',
    plan,
    contract: CONTRACT,
    next: ['broker_handoff when the working ask is what your human should sign.'],
  }
  assertNoTxMaterial(out)
  return out
}

export interface HandoffResult {
  intentId: string
  state: BrokerState
  url: string
  ask: string
  say: string
}

/** Mint the durable sign link for the working ask and bind it to the
 *  intent. The link is a full /i intent link, so the human gets the entire
 *  guarded runtime (connect-to-act, funding cascade, receipts) and the
 *  broker gets the funnel to report back. */
export async function handoffIntent(intentId: string): Promise<HandoffResult> {
  const row = await mustIntent(intentId)
  if (row.state === 'closed') throw new Error(`Intent ${intentId} is closed.`)
  if (row.linkSlug) {
    const out = {
      intentId: row.id,
      state: row.state as BrokerState,
      url: `${SITE}/i/${row.linkSlug}`,
      ask: row.ask,
      say: 'Sign link already minted — hand it to your human, then poll broker_status.',
    }
    assertNoTxMaterial(out)
    return out
  }

  const slug = mintSlug()
  await prisma.intentLink.create({
    data: {
      id: slug,
      ask: row.ask,
      variants: [row.ask],
      mcps: composeMcps(row.ask).join(',') || null,
      creator: null,
      agent: row.agent ? `${row.agent} (agent desk)` : 'agent desk',
    },
  })
  await prisma.brokerIntent.update({
    where: { id: row.id },
    data: { state: 'handed_off', linkSlug: slug },
  })

  const out: HandoffResult = {
    intentId: row.id,
    state: 'handed_off',
    url: `${SITE}/i/${slug}`,
    ask: row.ask,
    say:
      'Give this link to your human. They connect their own wallet, Pantessa rebuilds and guard-checks the ask, ' +
      'and only their signature moves anything. Poll broker_status to learn when they sign.',
  }
  assertNoTxMaterial(out)
  return out
}

export interface StatusResult {
  intentId: string
  state: BrokerState
  ask: string
  url: string | null
  funnel: { open: number; connect: number; built: number; signed: number; settled: number }
  signedUsd: number
  say: string
}

/** The feedback loop: server-truth funnel for the bound link, folded into
 *  the intent's state. Signed turns come from embed_turns (never client
 *  events), the same source the creator dashboards trust. */
export async function intentStatus(intentId: string): Promise<StatusResult> {
  const row = await mustIntent(intentId)
  const funnel = { open: 0, connect: 0, built: 0, signed: 0, settled: 0 }
  let signedUsd = 0

  if (row.linkSlug) {
    const events = await prisma.intentLinkEvent.groupBy({
      by: ['kind'],
      where: { slug: row.linkSlug },
      _count: { _all: true },
    })
    for (const e of events) {
      if (e.kind in funnel) funnel[e.kind as keyof typeof funnel] += e._count._all
    }
    const turns = await prisma.embedTurn.aggregate({
      where: { intentLinkSlug: row.linkSlug, outcome: 'signed' },
      _count: { _all: true },
      _sum: { valueUsd: true },
    })
    funnel.signed = Math.max(funnel.signed, turns._count._all)
    signedUsd = turns._sum.valueUsd ?? 0
  }

  let state = row.state as BrokerState
  if (state === 'handed_off' && funnel.signed > 0) state = 'signed'
  if (state !== 'closed' && funnel.settled > 0) state = 'settled'
  if (state !== row.state) {
    await prisma.brokerIntent.update({ where: { id: row.id }, data: { state } })
  }

  const say =
    state === 'settled'
      ? 'Settled — the receipt lives on the sign side.'
      : state === 'signed'
        ? `Signed — $${Math.round(signedUsd * 100) / 100} moved through the guarded path.`
        : state === 'handed_off'
          ? funnel.connect > 0
            ? 'The human connected a wallet and is looking at the build.'
            : funnel.open > 0
              ? 'The link was opened; no wallet connected yet.'
              : 'Waiting — the link has not been opened.'
          : state === 'open'
            ? 'Still negotiating — nothing has been handed to a human yet.'
            : 'Closed.'

  const out: StatusResult = {
    intentId: row.id,
    state,
    ask: row.ask,
    url: row.linkSlug ? `${SITE}/i/${row.linkSlug}` : null,
    funnel,
    signedUsd: Math.round(signedUsd * 100) / 100,
    say,
  }
  assertNoTxMaterial(out)
  return out
}

/** Walk away at any stage: closes the intent and revokes the bound sign
 *  link (a revoked link refuses new opens and leaves every board). States
 *  only move rightward, so a settled intent stays settled. */
export async function closeIntent(intentId: string): Promise<{ intentId: string; state: BrokerState; say: string }> {
  const row = await mustIntent(intentId)
  if (row.state === 'settled' || row.state === 'signed') {
    return { intentId: row.id, state: row.state as BrokerState, say: `Already ${row.state} — nothing to close.` }
  }
  if (row.linkSlug) {
    await prisma.intentLink.update({ where: { id: row.linkSlug }, data: { revoked: true } }).catch(() => {})
  }
  if (row.state !== 'closed') {
    await prisma.brokerIntent.update({ where: { id: row.id }, data: { state: 'closed' } })
  }
  const out = { intentId: row.id, state: 'closed' as BrokerState, say: 'Closed. Any sign link is revoked.' }
  assertNoTxMaterial(out)
  return out
}

async function mustIntent(intentId: string) {
  const id = typeof intentId === 'string' ? intentId.trim() : ''
  const row = id ? await prisma.brokerIntent.findUnique({ where: { id } }) : null
  if (!row) throw new Error(`No such intent "${intentId}".`)
  return row
}
