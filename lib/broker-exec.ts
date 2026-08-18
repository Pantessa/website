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
import { compileJobAsk } from '@/lib/jobs'
import { advanceJob, createJob, getJobWithSteps, cancelJob } from '@/lib/jobs-runner'
import { signJobToken } from '@/lib/job-token'
import {
  planIntent,
  cleanAgentName,
  cleanWallet,
  askUsd,
  assertNoTxMaterial,
  type BrokerPlan,
  type BrokerState,
} from '@/lib/broker'
import { assertDeskOpen, assertAgentIdentity, assertUnderDeskCap, cleanAgentKey } from '@/lib/broker-policy'
import { validateCallbackUrl, mintCallbackSecret, deliverWebhook } from '@/lib/broker-webhook'
import { agentHandleFor } from '@/lib/agent-record'
import { sendIntent } from '@/lib/inbox'
import { MOSAIC_CHAIN_IDS, composeMosaicAsk, sanitizeMosaicSlices, type MosaicChainWord } from '@/lib/mosaic'
import { recoverMessageAddress } from 'viem'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.pantessa.com').replace(/\/$/, '')

export interface OpenResult {
  intentId: string
  state: BrokerState
  plan: BrokerPlan
  contract: string
  next: string[]
  /** Present when the agent opened with a callback_url — the signing secret
   *  is returned ONCE here so the agent can verify webhook signatures. */
  callback?: { url: string; secret: string; note: string }
  /** Present when the intent is bound to an agent identity — the agent's
   *  public, shareable track record (money moved, signs, first/last seen). */
  recordUrl?: string
}

/** Per-call desk options read from the MCP request (lib/internal-run.ts):
 *  `internal` = our own harness/drill call — every intent_links / jobs row the
 *  call mints is stamped so the GTM arc never counts it as an arrival. */
export interface DeskCallOpts {
  internal?: boolean
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
  agentKey?: unknown
  callbackUrl?: unknown
}, call?: DeskCallOpts): Promise<OpenResult> {
  assertDeskOpen()
  const wallet = cleanWallet(opts.wallet)
  const agent = cleanAgentName(opts.agent)
  const agentKey = cleanAgentKey(opts.agentKey)

  // Optional push channel: validate the callback URL (SSRF fence) and mint a
  // per-intent signing secret returned ONCE below.
  let callbackUrl: string | null = null
  let callbackSecret: string | null = null
  if (opts.callbackUrl != null && opts.callbackUrl !== '') {
    if (typeof opts.callbackUrl !== 'string') throw new Error('callback_url must be a string URL.')
    const v = validateCallbackUrl(opts.callbackUrl)
    if (!v.ok) throw new Error(v.reason)
    callbackUrl = v.url
    callbackSecret = mintCallbackSecret()
  }

  const scan = wallet ? await scanFundingSources(wallet).catch(() => null) : null
  const plan = planIntent(opts.ask, scan)

  const row = await prisma.brokerIntent.create({
    data: {
      id: mintSlug(10),
      ask: plan.ask,
      wallet,
      agent,
      agentKey,
      agentKeyHash: agentKey ? agentHandleFor(agentKey) : null,
      callbackUrl,
      callbackSecret,
      state: 'open',
      plan: plan as object,
      isInternal: call?.internal === true,
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
      callbackUrl
        ? 'broker_status still polls, but a signed/settled webhook will POST to your callback_url too'
        : 'broker_status any time after handoff to learn whether they signed',
    ],
    ...(callbackUrl && callbackSecret
      ? {
          callback: {
            url: callbackUrl,
            secret: callbackSecret,
            note: 'Saved once. Verify each webhook: X-Pantessa-Signature = "sha256=" + HMAC-SHA256(rawBody, this secret). Signed/settled events for this intent POST here; broker_status remains the fallback.',
          },
        }
      : {}),
    ...(agentKey ? { recordUrl: `${SITE}/agents/${agentHandleFor(agentKey)}` } : {}),
  }
  assertNoTxMaterial(out)
  return out
}

/** Choose an option: rewrite the working sentence and re-quote. The chosen
 *  resume re-enters the same parse ladder — no other negotiation channel
 *  exists, by design. */
export async function chooseOption(intentId: string, optionId: string): Promise<OpenResult> {
  assertDeskOpen()
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
export async function handoffIntent(intentId: string, call?: DeskCallOpts): Promise<HandoffResult> {
  assertDeskOpen()
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
      isInternal: call?.internal === true,
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

export interface TileResult {
  intentId: string
  state: BrokerState
  url: string
  ask: string
  /** The human-side fork door — their editor pre-filled with this shape. */
  forkUrl: string
  quote: BrokerPlan['quote']
  contract: string
  say: string
}

/** MOSAIC on the desk: an agent hands its human a PORTFOLIO as a button.
 *
 *  Slices in (percentages and symbols only — the same sanitize + compose +
 *  re-parse rulebook as the human mint API), one durable /i link out, bound
 *  to a broker intent so broker_status reports the sign-side truth back.
 *  The shape compiles PER-WALLET at open time: every human who opens the
 *  link gets the same sentence diffed against their own holdings by the
 *  deterministic planner — the desk never sees a balance, an address, or a
 *  plan, just the sentence. */
export async function tileIntent(opts: { slices: unknown; chain?: unknown; agent?: unknown }, call?: DeskCallOpts): Promise<TileResult> {
  assertDeskOpen()
  const slices = sanitizeMosaicSlices(opts.slices)
  if ('problem' in slices) throw new Error(slices.problem)

  let chainWord: MosaicChainWord | undefined
  if (opts.chain != null) {
    const c = typeof opts.chain === 'string' ? opts.chain.toLowerCase() : ''
    if (!(c in MOSAIC_CHAIN_IDS)) {
      throw new Error("chain must be 'base', 'ethereum', or 'arbitrum' — or leave it out and each wallet tiles its own dominant chain.")
    }
    chainWord = c as MosaicChainWord
  }

  const composed = composeMosaicAsk(slices, chainWord)
  if ('problem' in composed) throw new Error(composed.problem)
  const agent = cleanAgentName(opts.agent)

  // planIntent quotes the sentence through the REAL gate ladder — a tile
  // ask lands on the mosaic gate as an action, and the dapp set rides back.
  const plan = planIntent(composed.ask)

  const slug = mintSlug()
  await prisma.intentLink.create({
    data: {
      id: slug,
      ask: plan.ask,
      variants: [plan.ask],
      mcps: composeMcps(plan.ask).join(',') || null,
      creator: null,
      agent: agent ? `${agent} (agent desk)` : 'agent desk',
      kind: 'mosaic',
      isInternal: call?.internal === true,
    },
  })
  const row = await prisma.brokerIntent.create({
    data: {
      id: mintSlug(10),
      ask: plan.ask,
      wallet: null,
      agent,
      state: 'handed_off',
      plan: plan as object,
      linkSlug: slug,
      isInternal: call?.internal === true,
    },
  })

  const out: TileResult = {
    intentId: row.id,
    state: 'handed_off',
    url: `${SITE}/i/${slug}`,
    ask: plan.ask,
    forkUrl: `${SITE}/mosaic?from=${slug}`,
    quote: plan.quote,
    contract: CONTRACT,
    say:
      'Give this link to your human. Every wallet that opens it gets this same shape compiled into ITS OWN batch — ' +
      'sells first, then buys, built and guard-checked at sign time, signed step by step. ' +
      'Poll broker_status to learn when they sign; the fork door lets them tweak the shape before minting their own.',
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
  /** Present on the agent-signed path: per-leg progress from the runner. */
  job?: { id: string; status: string; currentStep: number; legs: { seq: number; kind: string; status: string; title: string }[] }
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

  // The agent-signed path: fold the runner's truth in.
  let jobInfo: StatusResult['job']
  if (row.jobId) {
    const job = await getJobWithSteps(row.jobId)
    if (job) {
      jobInfo = {
        id: job.id,
        status: job.status,
        currentStep: job.currentStep,
        legs: job.steps.map((s) => ({ seq: s.seq, kind: s.kind, status: s.status, title: s.title })),
      }
      if (state === 'executing' && job.status === 'done') state = 'settled'
      if (state === 'executing' && job.status === 'canceled') state = 'closed'
    }
  }
  if (state !== row.state) {
    await prisma.brokerIntent.update({ where: { id: row.id }, data: { state } })
  }

  const say =
    state === 'executing'
      ? `Executing — leg ${(jobInfo?.currentStep ?? 0) + 1}/${jobInfo?.legs.length ?? '?'} (${jobInfo?.status ?? 'running'}). The runner holds the order; drive the current leg off the job API.`
      : state === 'settled'
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
    ...(jobInfo ? { job: jobInfo } : {}),
    say,
  }
  assertNoTxMaterial(out)
  return out
}

export interface ExecuteResult {
  intentId: string
  state: BrokerState
  jobId: string
  steps: { seq: number; kind: string; note: string }[]
  drive: {
    poll: string
    complete: string
    how: string[]
  }
  say: string
}

/** The x402-payer path: the agent signs the legs ITSELF, in the synced
 *  order the runner enforces, waiting on settlement between legs.
 *
 *  The working ask is compiled by the SAME jobs compiler human asks use;
 *  the job is owned by the AGENT's wallet; the desk hands back the job id
 *  + capability token + the drive recipe. Artifacts never travel through
 *  this MCP surface — the agent fetches each leg from the job API (the
 *  channel embed browsers already use, #414), signs with its own key, and
 *  posts completion. The runner treats completion as advancement, not
 *  proof: the next wait step / build's balance checks re-verify on-chain,
 *  so a lying agent fails its own job closed one leg later. Every build
 *  passes the same deterministic builders + fail-closed guards + spend
 *  policy as a human turn. */
export async function executeIntent(intentId: string, walletSignature: unknown, call?: DeskCallOpts): Promise<ExecuteResult> {
  assertDeskOpen()
  const row = await mustIntent(intentId)
  if (row.state !== 'open') throw new Error(`Intent ${intentId} is ${row.state} — execution starts from an open intent.`)
  if (!row.wallet)
    throw new Error(
      'broker_execute needs the wallet that will SIGN — re-open the intent passing your agent wallet address. ' +
        'For human signing, use broker_handoff instead.',
    )
  // The agent-signed path is the one with no human in the loop: it requires a
  // bound identity (refused by name otherwise), and the intent's notional
  // must sit under the desk cap. Human handoff above carries neither gate —
  // a human signature is its own ceiling.
  assertAgentIdentity(row.agentKey)
  assertUnderDeskCap(askUsd(row.ask))
  // The wallet must be PROVEN, not merely named (2026-08-18 squad audit): a
  // job is listed in its wallet's Jobs rail with a needs-you badge, so an
  // unproven wallet let any caller plant a sign request in a stranger's rail
  // ("swap … then send … to 0xATTACKER"). The agent holds the key on this
  // path by definition, so it signs the desk's consent text — bound to THIS
  // intent id + wallet — and the desk recovers the signer before any job row
  // exists. Single-use by construction: the intent must still be `open`.
  await assertWalletProof(row.id, row.wallet, walletSignature)

  const compiled = compileJobAsk(row.ask)
  if (!compiled || 'problem' in compiled || 'clarify' in compiled) {
    const why = compiled && 'problem' in compiled ? compiled.problem : compiled && 'clarify' in compiled ? 'it needs a clarification first' : 'it is a single-step ask'
    throw new Error(
      `"${row.ask}" does not compile to a multi-step job (${why}). ` +
        'The agent-signed path exists for SEQUENCED flows (fund → wait for arrival → act). ' +
        'For single steps or clarifications, negotiate further or use broker_handoff.',
    )
  }

  const job = await createJob(row.wallet, compiled, 'broker', { internal: call?.internal === true })
  // Kick the first build inline (the chat/jobs-API/DCA pattern) so leg 0 is
  // offered by the time the agent's first poll lands; the cron advances the
  // rest, including the waits between legs.
  await advanceJob(job).catch(() => {})
  const token = signJobToken(job.id)
  await prisma.brokerIntent.update({
    where: { id: row.id },
    data: { state: 'executing', jobId: job.id },
  })

  const out: ExecuteResult = {
    intentId: row.id,
    state: 'executing',
    jobId: job.id,
    steps: compiled.steps.map((s, i) => ({ seq: i, kind: s.kind, note: s.title })),
    drive: {
      poll: `${SITE}/api/jobs/${job.id}?t=${token}`,
      complete: `${SITE}/api/jobs/${job.id}/complete?t=${token}`,
      how: [
        'GET poll — the runner builds the CURRENT leg fresh (guarded, policy-checked) and serves its unsigned artifact there; later legs stay unbuilt until their turn.',
        'Sign the artifact with the wallet this intent was opened for, broadcast it yourself, then POST {seq, result:{txHash}} to complete.',
        'Wait legs verify on-chain arrival before the next leg builds — completion is advancement, not proof; lying fails the job closed one leg later.',
        'broker_status mirrors per-leg progress; broker_close cancels the job.',
      ],
    },
    say:
      `Compiled to a ${compiled.steps.length}-leg job owned by ${row.wallet}. ` +
      'Drive it leg by leg off the job API — the runner enforces the order and the waits between legs.',
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
  if (row.jobId && row.wallet) {
    await cancelJob(row.jobId, row.wallet).catch(() => {})
  }
  if (row.state !== 'closed') {
    await prisma.brokerIntent.update({ where: { id: row.id }, data: { state: 'closed' } })
  }
  const out = { intentId: row.id, state: 'closed' as BrokerState, say: 'Closed. Any sign link is revoked.' }
  assertNoTxMaterial(out)
  return out
}

export interface SendResult {
  intentId: string
  state: BrokerState
  url: string
  inboxUrl: string
  recipient: string
  handle?: string
  ask: string
  say: string
}

/** The wallet inbox (M5): address an intent TO a recipient wallet/handle. It
 *  lands in their /inbox where one tap opens the guarded /i runtime and only
 *  their signature moves anything — no negotiation, no polling, and the
 *  recipient never had to ask. Bound to a broker intent (like tile/handoff)
 *  so broker_status reports back and it counts on the agent's track record. */
export async function sendToInbox(opts: {
  ask: string
  recipient: unknown
  senderLabel?: unknown
  agent?: unknown
  agentKey?: unknown
}, call?: DeskCallOpts): Promise<SendResult> {
  assertDeskOpen()
  const agent = cleanAgentName(opts.agent)
  const agentKey = cleanAgentKey(opts.agentKey)
  const senderLabel = cleanSenderLabel(opts.senderLabel) ?? agent ?? undefined

  const sent = await sendIntent(SITE, {
    ask: typeof opts.ask === 'string' ? opts.ask : '',
    recipientRaw: opts.recipient,
    senderLabel,
    agent: agent ?? undefined,
    internal: call?.internal === true,
  })

  const row = await prisma.brokerIntent.create({
    data: {
      id: mintSlug(10),
      ask: sent.ask,
      wallet: sent.recipient,
      agent,
      agentKey,
      agentKeyHash: agentKey ? agentHandleFor(agentKey) : null,
      state: 'handed_off',
      plan: { ask: sent.ask, addressed: true } as object,
      linkSlug: sent.slug,
      isInternal: call?.internal === true,
    },
  })

  const out: SendResult = {
    intentId: row.id,
    state: 'handed_off',
    url: sent.url,
    inboxUrl: sent.inboxUrl,
    recipient: sent.recipient,
    ...(sent.handle ? { handle: sent.handle } : {}),
    ask: sent.ask,
    say:
      `Delivered to ${sent.handle ? `@${sent.handle}` : sent.recipient}'s inbox. ` +
      'They open it, Pantessa rebuilds and guard-checks the ask, and only their own signature moves anything. ' +
      'Poll broker_status to learn when they sign.',
  }
  assertNoTxMaterial(out)
  return out
}

/** The push channel (M3): when a signed/settled event lands for a link bound
 *  to a broker intent that opted into a callback, POST the signed webhook.
 *  Best-effort and fail-soft — the caller (the events route) fires this
 *  without awaiting, so a flaky endpoint never touches the event write. */
export async function fireIntentWebhook(
  slug: string,
  kind: 'signed' | 'settled',
  valueUsd: number | null,
): Promise<void> {
  try {
    const row = await prisma.brokerIntent.findFirst({
      where: { linkSlug: slug, callbackUrl: { not: null }, callbackSecret: { not: null } },
      select: { id: true, ask: true, linkSlug: true, callbackUrl: true, callbackSecret: true },
    })
    if (!row?.callbackUrl || !row.callbackSecret) return
    await deliverWebhook(row.callbackUrl, row.callbackSecret, {
      intentId: row.id,
      event: kind,
      ask: row.ask,
      url: row.linkSlug ? `${SITE}/i/${row.linkSlug}` : null,
      valueUsd,
      deliveryId: mintSlug(16),
      at: Date.now(),
    })
  } catch {
    // fail-soft — the loop is best-effort; broker_status remains the truth
  }
}

/** The consent text the agent's wallet signs (personal_sign) to prove it
 *  owns the wallet an agent-signed intent is bound to. Pure + exported so
 *  agents/harnesses build the identical bytes. */
export function deskExecuteConsentMessage(intentId: string, wallet: string): string {
  return [
    'Pantessa agent desk — execute consent',
    `Intent: ${intentId}`,
    `Wallet: ${wallet.toLowerCase()}`,
    'Signing lets the desk compile this intent into a job owned by this wallet. It moves nothing by itself; every leg still needs this wallet\'s own signature.',
  ].join('\n')
}

async function assertWalletProof(intentId: string, wallet: string, signature: unknown): Promise<void> {
  const refuse = (why: string): never => {
    throw new Error(
      `broker_execute needs wallet_signature — ${why}. Sign the exact text of deskExecuteConsentMessage(intent_id, wallet) ` +
        '(personal_sign / EIP-191) with the wallet you opened the intent for; the desk recovers the signer and refuses any other. ' +
        'For human signing, use broker_handoff — it needs no wallet proof.',
    )
  }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return refuse('a 65-byte 0x signature over the consent text is required')
  let signer: string
  try {
    signer = await recoverMessageAddress({ message: deskExecuteConsentMessage(intentId, wallet), signature: signature as `0x${string}` })
  } catch {
    return refuse('the signature does not verify against the consent text')
  }
  if (signer.toLowerCase() !== wallet.toLowerCase()) return refuse(`the signature recovers to ${signer.toLowerCase()}, not the intent's wallet`)
}

/** An agent-supplied inbox byline can never wear the marks Pantessa stamps
 *  itself: human sends carry `@handle` (a CLAIMED handle, stamped server-side
 *  from the sender's SIWE wallet) or a 0x… short address. Strip those shapes
 *  so "from @nategeier" can only ever mean the real claimed handle sent it. */
export function cleanSenderLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // NFKC first: fullwidth ＠ (U+FF20), small ﹫ (U+FE6B) etc. fold to '@',
  // fullwidth digits/letters fold to ASCII — a homoglyph is the same mark.
  let s = raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
  // Strip-until-stable: "@@ @nategeier" must not survive a single pass
  // (QA 2026-08-18 bypass).
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/^@+/, '').replace(/^0x[0-9a-fA-F]{4,}(…|\.\.\.)?[0-9a-fA-F]*/, '').trim()
  }
  s = s.slice(0, 60).trim()
  // Belt: after normalization the label may carry NO at-sign of any kind and
  // no 0x-hex run anywhere — refuse rather than reshape (the two Pantessa-
  // stamped marks are exactly those shapes).
  if (/[@\u0040\uFF20\uFE6B]/u.test(s) || /0x[0-9a-fA-F]{4,}/.test(s)) {
    throw new Error('sender_label may not contain an @-handle or a 0x address — those marks are stamped by Pantessa for claimed handles and human senders only. Use your agent or app name.')
  }
  return s || null
}

async function mustIntent(intentId: string) {
  const id = typeof intentId === 'string' ? intentId.trim() : ''
  const row = id ? await prisma.brokerIntent.findUnique({ where: { id } }) : null
  if (!row) throw new Error(`No such intent "${intentId}".`)
  return row
}
