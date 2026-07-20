import { NextRequest, NextResponse } from 'next/server'
import { erc20Abi, formatUnits, getAddress, isAddress } from 'viem'
import { getPaidFetch, hasAgentWallet } from '@/lib/agent-wallet'
import {
  decodeSettlement,
  failureReason,
  getChallenge,
  derivePayment,
  finalizePaymentHeader,
  fetchWithPaymentHeader,
  type PreparedPayment,
  type SigningRequest,
} from '@/lib/x402'
import type { McpServer } from '@/lib/store'
import { voteRequestFromToolResult, friendlyVoteError, type VoteRequest } from '@/lib/snapshot-vote'
import { parseVoteIntent, resolveVoteReference, type VoteIntent } from '@/lib/vote-intent'
import { crossChainAgentOf, detectCrossChain, parseSwapIntent, parseSwapFollowUp, swapWorkingContext, type SwapIntent } from '@/lib/swap-intent'
import { chainById, chainByKey, primaryStable, publicClientFor, sanitizeChainId, DEFAULT_CHAIN_ID, APP_CHAINS } from '@/lib/chains'
import { usdPerToken, usdToTokenAmount } from '@/lib/usd-probe'
import { parseRobinhoodBridge, buildRobinhoodBridge } from '@/lib/robinhood-bridge'
import {
  guardLidoStakeBuild,
  isLidoGuidedAsk,
  lidoAgentOf,
  LIDO_GAS_BUFFER_ETH,
  parseLidoStake,
  suggestedStakeEth,
  type LidoBuiltStake,
  type LidoPositionPayload,
  type LidoStakeParams,
} from '@/lib/lido-stake'
import { DEST_GAS_FLOOR_ETH, FUNDING_CHAIN_WORD, fundingFallbackForFailures, offerFundingPlan } from '@/lib/funding-plan'
import {
  parseCrossChainSwap,
  parseCrossChainFollowUp,
  guardCrossChainBuild,
  expectedOriginChainId,
  crossChainPending,
  type CrossChainSwapParams,
  type BuiltSwap,
} from '@/lib/cross-chain-swap'
import { arbitrumUsdcBalance, buildHlExecTurn, hlAgentOf, HL_MIN_DEPOSIT_USDC, parseHlIntent } from '@/lib/hyperliquid-exec'
import { parseGuardianArm } from '@/lib/hl-guardian'
import { armGuardianPolicy } from '@/lib/hl-guardian-store'
import { compileJobAsk } from '@/lib/jobs'
import { advanceJob, createJob } from '@/lib/jobs-runner'
import { signJobToken } from '@/lib/job-token'
import { runDcaTurn } from '@/lib/dca-exec'
import {
  aaveAgentOf,
  competingVenueOf,
  parseAaveSupply,
  parseAaveSupplyFollowUp,
  pickSupplyReserve,
  guardAaveSupplyBuild,
  aaveSupplyPending,
  parseAaveOp,
  parseAaveOpFollowUp,
  aaveOpPending,
  guardAaveOpBuild,
  pickWithdrawPosition,
  pickRepayPosition,
  pickBorrowReserve,
  reserveForOp,
  reserveLegIds,
  parseUsd,
  AAVE_OP_PENDING_KINDS,
  type AaveSupplyParams,
  type AaveOpParams,
  type AaveAmountRule,
  type AaveBuiltPlan,
  type AaveReserveRow,
  type AavePortfolioSupplyRow,
  type AavePortfolioBorrowRow,
  type AavePortfolioPosition,
  type PickedReserve,
} from '@/lib/aave-supply'
import { policyCheck, buildReport } from '@/lib/tx-guardrails'
import { buildGuardrailedOrder } from '@/lib/cow-build'
import { parseNftAsk, buildNftBuy, buildNftTransfer, buildNftListing } from '@/lib/nft-layer'
import { parseTransferSegment, buildTransferArtifact } from '@/lib/transfer-exec'
import { buildUniswapSwap, NoV3PoolError } from '@/lib/uniswap-venue'
import { buildUniswapV4Swap, NoV4PoolError, GatedV4PoolError } from '@/lib/uniswap-v4'
import { buildLifiSwap, NoLifiRouteError } from '@/lib/lifi-venue'
import { fundingNeedUsd, planRobinhoodFundingChips, readFundingShortfall, ROBINHOOD_CHAIN_ID } from '@/lib/lifi-bridge'
import { resolveToken, tokenDecimals, humanToAtoms } from '@/lib/cow'
import { ensureTokenList } from '@/lib/token-list'
import { resolveProposal } from '@/lib/snapshot-read'
import { detectGovernanceIntent, runGovernanceTurn } from '@/lib/governance'
import { sanitizeWorkingContext, contextBlockForPlanner, type WorkingContext, extractEntities, carryContext } from '@/lib/working-context'
import { getSessionAddress } from '@/lib/auth'
import { spendCredits } from '@/lib/billing'
import { recordEmbedSighting, resolveEmbedKey } from '@/lib/embed-key'
import { walletContextLine } from '@/lib/wallet-context'
import { grantViolation, type GrantPolicy } from '@/lib/spend-grant'
import {
  getActiveGrant,
  spentTodayUsd,
  spentTotalUsd,
  recordLedger,
  toPolicy,
} from '@/lib/grant-store'
import {
  loadPlannableEndpoints,
  plannerPrompt,
  parsePlannerPicks,
  buildSmartRequest,
  type PlannableEndpoint,
  type PlannedPick,
  type ConversationTurn,
} from '@/lib/endpoint-planner'
import { loadCatalog } from '@/lib/catalog'
import { routeMessage, selectInferenceProvider, compactForSynthesis, dedupePlannerPicks, type TraceStep, type SmartPick } from '@/lib/router'
import { buildSignableArtifact } from '@/lib/transaction-layer'
import { guardPlannerArtifact } from '@/lib/planner-artifact-guard'
import { portfolioFromToolResult, type PortfolioDisplay } from '@/lib/portfolio-display'
import { parseClarify, type ClarifyRequest } from '@/lib/clarify'
import type { EntityRef } from '@/lib/working-context'
import { isCacheable, routeCacheKey, getCached, setCached } from '@/lib/route-cache'
import { recordRouteEvent, routeSavings } from '@/lib/route-telemetry'
import { newTurnId, recordTraceLine } from '@/lib/route-trace'
import { recordIncident } from '@/lib/incidents'
import type { RouterDecision } from '@/lib/router'

// x402 signing + paid fetch need the Node runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Receipt {
  name: string
  endpoint: string
  priceUsd: string
  txHash?: string
  ok: boolean
  note?: string
  /** Set only on NOT_ALLOWED (no-approval) blocks → the UI deep-links to
   *  /servers/<slug>#approve so the user can approve in one click. */
  slug?: string
}

/** A planned paid call — round-tripped to the browser so the wallet can sign it. */
interface PlannedCall {
  id: string
  role: 'data' | 'inference'
  name: string
  host: string
  priceUsd: string
  endpoint: string
  url?: string // data url (with query)
  method?: string // data call method (default GET); smart POSTs carry a body
  body?: string // JSON body for smart POST calls
  tool?: string // inference tool name (mcp) or gateway model id (http)
  protocol?: 'mcp' | 'http' // inference transport (default mcp)
  mcp?: boolean // data call is an MCP tools/call (parse the JSON-RPC result)
  prepared: PreparedPayment | null // null = endpoint didn't require payment
}

/** Smart endpoints planned for selected, non-hand-wired services (USE_DB only). */
async function loadSmartEndpoints(listedOnly: McpServer[]): Promise<PlannableEndpoint[]> {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return []
  try {
    return await loadPlannableEndpoints(listedOnly.map((s) => s.slug).filter(Boolean))
  } catch (err) {
    console.warn('smart endpoints unavailable:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Max prior turns + per-turn chars threaded into prompts (keeps cost bounded). */
const HISTORY_TURNS = 6
const HISTORY_CHARS = 600

/**
 * Sanitize client-supplied conversation history: keep only well-formed
 * user/assistant turns, strip our own footers/diagnostics from assistant
 * messages (they're UI scaffolding, not content), trim, and cap to the last
 * few turns so the planner + answer have context without unbounded prompt cost.
 */
export function sanitizeHistory(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) return []
  const out: ConversationTurn[] = []
  for (const m of raw) {
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    // Drop the appended "ℹ️ Not called…", "⚙️ Diagnostics…", "💸 …" scaffolding.
    const clean = content.split(/\n\n(?:ℹ️|⚙️|💸)/)[0].trim()
    if (clean) out.push({ role, content: clean.slice(0, HISTORY_CHARS) })
  }
  return out.slice(-HISTORY_TURNS)
}

/** Recent conversation rendered for the answer prompt. */
function answerHistoryBlock(history: ConversationTurn[]): string {
  if (history.length === 0) return ''
  return history.map((h) => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`).join('\n')
}

/** Ask the inference model to pick endpoints + params for the user message. */
async function planSmartPicks(
  inference: McpServer,
  message: string,
  smart: PlannableEndpoint[],
  history: ConversationTurn[] = [],
  ctx?: WorkingContext,
  /** User address for the "$USER_ADDRESS" context token (see PlanContext). */
  userAddress?: string,
): Promise<{ picks: PlannedPick[]; dropped: PlannableEndpoint[]; txHash?: string; clarify?: ClarifyRequest }> {
  const { text, txHash } = await callInference(inference, plannerPrompt(message, smart, history, contextBlockForPlanner(ctx), { userAddress }))
  // Never pay two services for the same capability — keep the best per
  // capability (same dedup the Auto-Router applies). dropped → surfaced as notes.
  const { picks, dropped } = dedupePlannerPicks(parsePlannerPicks(text, smart), smart)
  // RR17: the planner may ask instead of pick — honored only with zero picks.
  const clarify = picks.length === 0 ? parseClarify(text) ?? undefined : undefined
  return { picks, dropped, txHash, clarify }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ── Phase 2 (wallet): execute with client-provided signatures ────────────
    if (body.phase === 'execute') {
      return await executeWithSignatures(
        String(body.message ?? ''),
        Array.isArray(body.plan) ? (body.plan as PlannedCall[]) : [],
        (body.signatures ?? {}) as Record<string, string>,
        Array.isArray(body.listedOnly) ? (body.listedOnly as McpServer[]) : [],
        Array.isArray(body.notes) ? (body.notes as string[]).filter((n) => typeof n === 'string').slice(0, 8) : [],
        sanitizeHistory(body.history),
        typeof body.turnId === 'string' ? body.turnId : undefined,
        sanitizeWorkingContext(body.workingContext),
        typeof body.walletAddress === 'string' && isAddress(body.walletAddress)
          ? getAddress(body.walletAddress)
          : undefined,
        typeof body.capabilities === 'string' ? body.capabilities.slice(0, 4000) : '',
      )
    }

    const message: string = body.message ?? ''
    const history = sanitizeHistory(body.history)
    // Structured state from the previous turns (RR2) — the scope we operated
    // in + the exact list the user was shown. Client-echoed like `history`,
    // sanitized + age-expired here. Follow-ups resolve against THIS, not
    // regexes over the last reply's prose.
    const workingContext = sanitizeWorkingContext(body.workingContext)
    const activeServers: McpServer[] = Array.isArray(body.activeServers) ? body.activeServers : []
    // Client-supplied turn id → the manual path records its reasoning to
    // route_trace_lines so the in-chat engine terminal can poll it live.
    const clientTurnId: string | undefined =
      typeof body.turnId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.turnId) ? body.turnId : undefined
    // The native tx-build layers' routing decisions were INVISIBLE — the
    // engine pane only showed planner lines, so a parse fall-through read as
    // the MCP failing (live 2026-07-13: "can I supply 1 more USDC" → planner
    // → -32602, with no hint the native Aave layer had declined). Negative
    // seq base keeps these ordered BEFORE the planner/burner sections' seq 0+
    // when a declined ask falls through to them on the same turn id.
    let nativeSeq = -1000
    const nativeTrace = clientTurnId
      ? (event: unknown) => recordTraceLine(clientTurnId, nativeSeq++, event, 'wallet')
      : () => {}
    const walletAddress: string | undefined =
      typeof body.walletAddress === 'string' && isAddress(body.walletAddress)
        ? getAddress(body.walletAddress)
        : undefined
    // The chat chain picker's selection — the chain the user made first-class
    // for this session. Untrusted client value; only registry ids survive.
    const selectedChainId = sanitizeChainId(body.selectedChainId)

    if (!message.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    // ── Embed attribution: which key + host origin this turn came from ──────
    // A valid `yfe_` key bills the KEY OWNER's plan for house answers (the
    // host pays for their visitors); with or without a key, the turn bumps
    // the (key, origin) row in the embeds ledger. Self-reported telemetry —
    // fire-and-forget, never blocks the turn.
    const embedBill =
      typeof body.embedKey === 'string' ? await resolveEmbedKey(body.embedKey) : null
    const embedOrigin =
      typeof body.embedOrigin === 'string' && body.embedOrigin ? body.embedOrigin.slice(0, 200) : undefined
    if (embedOrigin) {
      void recordEmbedSighting({
        embedKeyId: embedBill?.id ?? '',
        ownerAddress: embedBill?.ownerAddress ?? null,
        origin: embedOrigin,
        bumpTurn: true,
      })
    }

    // ── Auto-Router: the engine picks services across the whole directory and
    //    streams its reasoning + the answer (burner mode; wallet is B5). The
    //    manual path below is untouched. ───────────────────────────────────
    if (body.autoRouter === true) {
      const inferenceSlug = typeof body.inferenceSlug === 'string' ? body.inferenceSlug : undefined
      return streamAutoRouter(message, history, walletAddress, undefined, undefined, inferenceSlug, workingContext)
    }

    const inference = activeServers.find(
      (s) =>
        s.kind === 'inference' &&
        s.callable &&
        s.endpoint &&
        (s.protocol === 'mcp' || s.protocol === 'http'),
    )
    const dataServers = activeServers.filter(
      (s) => s.kind === 'data' && s.callable && s.endpoint && s.protocol === 'http',
    )
    // MCP *data* services (e.g. Yeetful · Nansen): callable over MCP, their wired
    // `tool` takes structured args (toolArgs) rather than the free-text prompt the
    // inference path sends. Handled by a dedicated tools/call path.
    const mcpDataServers = activeServers.filter(
      (s) => s.kind === 'data' && s.callable && s.endpoint && s.protocol === 'mcp' && s.tool,
    )
    const listedOnly = activeServers.filter((s) => !s.callable)

    // ── Vote intent: build a Snapshot vote for the user to sign ───────────────
    // Detected before the inference check — preparing a vote doesn't need an
    // inference agent. Gated on a snapshot MCP service being active.
    const snapshotSvc = activeServers.find(
      (s) =>
        s.kind === 'data' &&
        s.protocol === 'mcp' &&
        s.callable &&
        !!s.endpoint &&
        /snapshot/i.test(`${s.slug} ${s.endpoint}`),
    )
    if (snapshotSvc) {
      const intent = parseVoteIntent(message)
      if (intent.isVote) {
        return await prepareVoteTurn(message, intent, snapshotSvc, walletAddress, workingContext)
      }
    }

    // ── Governance intents (manual mode): list AND vote ───────────────────────
    // Whenever ANY snapshot service is active (including the free, non-gated
    // one), governance runs through runGovernanceTurn — name → space-id
    // resolution, free hub reads, and for votes the EIP-712 built for the
    // USER's wallet (voteRequest/voteProposal → sign buttons with choices).
    // NEVER the endpoint planner: prepare_vote/submit_vote are signing tools —
    // a planner guessing their args produced a failed call the model then
    // narrated as "Vote submitted!" (2026-07-03 live incident). Signables
    // break the loop; only an explicit human signature casts a vote.
    let govIntent = detectGovernanceIntent(message)
    const snapshotActive = activeServers.some((s) => /snapshot/i.test(`${s.slug} ${s.name}`))
    // Conversational follow-up: the last assistant turn offered a vote
    // ("Ready to vote on **X**" / "vote For on **X**") and the user replies
    // with just a choice — "For", "yes", "vote for that option", "option 2".
    // Synthesize the full vote intent so the governance flow (choice buttons,
    // user-wallet EIP-712) handles it — instead of the planner or the house
    // model improvising over a bare "For".
    let govMessage = message
    const lastAssistant = snapshotActive ? ([...history].reverse().find((t) => t.role === 'assistant')?.content ?? '') : ''
    // ANCHORED choice matcher: the whole message must be a choice utterance
    // ("For", "yes", "lets vote yes", "option 2") — merely CONTAINING a choice
    // word must not hijack the turn ("can i swap 1 USDC for UNI" matched
    // \bfor\b and got answered with a proposals list — 2026-07-03).
    const anchoredChoice = (m: string) => m
      .trim()
      .match(/^(?:i(?:'d| would)?\s+(?:like|want)\s+to\s+)?(?:let'?s\s+)?(?:vote\s+|go\s+|choose\s+|pick\s+)?(for|against|abstain|yes|no|option\s+[1-9]|[1-9])(?:\s+(?:on\s+)?(?:that|this)(?:\s+(?:option|one|proposal))?)?[.!\s]*$/i)?.[1]
    if (snapshotActive && message.trim().length <= 60) {
      // 1) STRUCTURED continuity (RR2): a pending vote or a single offered
      //    proposal from the working context resolves a bare choice reply
      //    deterministically — no prose scraping.
      const pendingVote = workingContext?.pending?.kind === 'vote' ? workingContext.pending : undefined
      const soleOffer = workingContext?.offers?.kind === 'proposal' && workingContext.offers.items.length === 1
        ? workingContext.offers.items[0] : undefined
      const choice = (!govIntent || (govIntent.kind === 'vote' && !govIntent.proposalId && !govIntent.spaceQuery)) ? anchoredChoice(message) : undefined
      const num = choice?.match(/^(?:option\s+)?([1-9])$/i)?.[1]
      // A bare number after a NUMBERED LIST picks that proposal; with a
      // pending vote already pinned, a number means choice option N instead.
      const numberedOffer = num && !pendingVote?.data.proposalId
        ? workingContext?.offers?.items.find((it) => it.n === Number(num)) : undefined
      const refId = pendingVote?.data.proposalId ?? numberedOffer?.id ?? soleOffer?.id
      if (choice && refId) {
        govIntent = {
          kind: 'vote',
          proposalId: refId,
          choiceText: numberedOffer ? undefined : num ? `option ${num}` : choice,
          agentRequested: govIntent?.agentRequested ?? false,
        }
      } else if (!govIntent) {
        // 2) LEGACY prose fallback (chats predating the working context): the
        //    last reply offered a vote ("Ready to vote on **X**") and the user
        //    answered with a bare choice.
        const title = lastAssistant.match(/(?:Ready to vote on|vote (?:For|[A-Za-z]+) on) \*\*(.+?)\*\*/)?.[1]
        const c = anchoredChoice(message)
        if (title && c) {
          govMessage = `vote ${c} on "${title}"`
          govIntent = detectGovernanceIntent(govMessage)
        }
      }
    }
    // "vote For on 1" after a list: the message names no DAO — the working
    // context carries the space (handled inside runGovernanceTurn). Prose
    // fallback for pre-context chats: "… in **Nate DAO**" in the last reply.
    if (govIntent && !govIntent.spaceQuery && !workingContext?.scope) {
      const sp = lastAssistant.match(/(?:proposals?|ballot|voting)[^*\n]{0,40}in \*\*(.+?)\*\*/i)?.[1] ?? lastAssistant.match(/open proposals? in \*\*(.+?)\*\*/i)?.[1]
      if (sp) govIntent = { ...govIntent, spaceQuery: sp }
    }
    if (govIntent && snapshotActive) {
      let govSeq = 0
      const gov = await runGovernanceTurn({
        message: govMessage,
        intent: govIntent,
        walletAddress,
        emit: clientTurnId ? (e) => recordTraceLine(clientTurnId, govSeq++, e, walletAddress ? 'wallet' : 'burner') : () => {},
        synthesize: (p) => planViaAnthropic(p),
        ctx: workingContext,
      })
      return NextResponse.json({
        reply: gov.reply,
        ...(gov.voteRequest ? { voteRequest: gov.voteRequest } : {}),
        ...(gov.voteProposal ? { voteProposal: gov.voteProposal } : {}),
        ...(gov.workingContext ? { workingContext: gov.workingContext } : {}),
      })
    }

    // ── Swap intent: Yeetful-NATIVE transaction building ──────────────────────
    // Swap building is a first-party capability — the core product — not an
    // MCP the user must shortlist (Nate, 2026-07-02: "pull the swap tools out
    // as our own custom yeetful tools"). Any chat can say "swap 100 USDC for
    // WETH"; Yeetful picks the VENUE and each venue stays venue-pure:
    //   · Uniswap — when the user says "uniswap" or has Uniswap active
    //     without CoW → on-chain SwapRouter02 tx (evm-tx → SendTxButton),
    //     approval to SwapRouter02.
    //   · CoW (default otherwise) — MEV-protected order book → EIP-712 order
    //     (SignOrderButton), approval to the VaultRelayer.
    // Both run the SAME cross-app guardrails (lib/tx-guardrails); the parser
    // is conservative (plain questions fall through to routing).
    //
    // Follow-ups against a PENDING artifact first (invariant #11): the last
    // turn returned a swap/order awaiting signature — "actually make it
    // 2 USDC" rebuilds it with the new amount, "cancel that" abandons it.
    // Resolved deterministically against what the user saw, never re-parsed.
    // Cross-chain follow-ups against a pending (already-built) deposit —
    // cancel / amend the amount / affirmations. Deterministic, never re-parsed.
    const pendingXchain =
      workingContext?.pending && workingContext.pending.kind === 'xchain' ? workingContext.pending : undefined
    if (pendingXchain) {
      const cc = parseCrossChainFollowUp(message, pendingXchain)
      if (cc?.kind === 'cancel') {
        const p = pendingXchain.data
        return NextResponse.json({
          reply: `👍 Dropped the cross-chain swap — ${p.amount} ${p.originToken} (${p.originChain} → ${p.destinationChain}) was never signed, so nothing moved.`,
          workingContext: { v: 1, age: 0, ...(workingContext?.scope ? { scope: workingContext.scope } : {}) } satisfies WorkingContext,
        })
      }
      if (cc?.kind === 'noop') {
        return NextResponse.json({
          reply: `🔏 The swap is built above — sign the deposit transfer with the button to send it. Say “cancel” to drop it.`,
        })
      }
      if (cc?.kind === 'amend') {
        const ccAgent = crossChainAgentOf(activeServers)
        if (ccAgent.agent && ccAgent.usable) {
          nativeTrace({ type: 'status', label: `native cross-chain layer: amending the pending deposit to ${cc.params.amount} ${cc.params.originToken.toUpperCase()} (${cc.params.originChain} → ${cc.params.destinationChain})` })
          return await buildCrossChainSwapTurn(ccAgent.agent, cc.params, walletAddress, workingContext, message, nativeTrace)
        }
        // Amend parsed but the agent left the set (or is a shell row) since
        // the build — fall through to normal routing, with the breadcrumb.
        nativeTrace({ type: 'note', level: 'warn', label: 'native cross-chain layer: amend follow-up parsed but the cross-chain agent is no longer callable — normal routing' })
      }
    }

    // Aave-supply follow-ups against a pending (already-built) deposit —
    // cancel / amend the amount / affirmations. Deterministic, never re-parsed.
    const pendingAave =
      workingContext?.pending && workingContext.pending.kind === 'aave-supply' ? workingContext.pending : undefined
    if (pendingAave) {
      const fu = parseAaveSupplyFollowUp(message, pendingAave)
      if (fu?.kind === 'cancel') {
        const p = pendingAave.data
        return NextResponse.json({
          reply: `👍 Dropped the Aave supply — ${p.amount} ${(p.token ?? '').toUpperCase()} was never signed, so nothing moved.`,
          workingContext: { v: 1, age: 0, ...(workingContext?.scope ? { scope: workingContext.scope } : {}) } satisfies WorkingContext,
        })
      }
      if (fu?.kind === 'noop') {
        return NextResponse.json({
          reply: `🔏 The supply is built above — sign the step(s) in the card to send it. Say “cancel” to drop it.`,
        })
      }
      if (fu?.kind === 'amend') {
        const aaveRead = aaveAgentOf(activeServers)
        if (aaveRead.agent && aaveRead.usable) {
          nativeTrace({ type: 'status', label: `native aave layer: amending the pending supply to ${fu.params.amount} ${fu.params.token.toUpperCase()}` })
          return await buildAaveSupplyTurn(aaveRead.agent, fu.params, walletAddress, workingContext, message, nativeTrace)
        }
      }
    }

    // Same follow-up handling for pending withdraw / borrow / repay builds.
    const pendingAaveOp =
      workingContext?.pending && (AAVE_OP_PENDING_KINDS as readonly string[]).includes(workingContext.pending.kind)
        ? workingContext.pending
        : undefined
    if (pendingAaveOp) {
      const fu = parseAaveOpFollowUp(message, pendingAaveOp)
      if (fu?.kind === 'cancel') {
        const p = pendingAaveOp.data
        return NextResponse.json({
          reply: `👍 Dropped the Aave ${p.op} — ${p.amount === 'all' ? 'all your' : p.amount} ${(p.token ?? '').toUpperCase()} was never signed, so nothing moved.`,
          workingContext: { v: 1, age: 0, ...(workingContext?.scope ? { scope: workingContext.scope } : {}) } satisfies WorkingContext,
        })
      }
      if (fu?.kind === 'noop') {
        return NextResponse.json({
          reply: `🔏 The ${pendingAaveOp.data.op} is built above — sign the step(s) in the card to send it. Say “cancel” to drop it.`,
        })
      }
      if (fu?.kind === 'amend') {
        const aaveRead = aaveAgentOf(activeServers)
        if (aaveRead.agent && aaveRead.usable) {
          nativeTrace({ type: 'status', label: `native aave layer: amending the pending ${fu.params.op} to ${fu.params.max ? `all ${fu.params.token.toUpperCase()}` : `${fu.params.amount} ${fu.params.token.toUpperCase()}`}` })
          return await buildAaveOpTurn(aaveRead.agent, fu.params, walletAddress, workingContext, message, nativeTrace)
        }
      }
    }

    const pendingArtifact =
      workingContext?.pending && (workingContext.pending.kind === 'swap' || workingContext.pending.kind === 'order')
        ? workingContext.pending
        : undefined
    const swapFollowUp = parseSwapFollowUp(message, pendingArtifact)
    if (swapFollowUp && pendingArtifact) {
      if (swapFollowUp.kind === 'cancel') {
        const p = pendingArtifact.data
        return NextResponse.json({
          reply: `👍 Dropped the ${pendingArtifact.kind === 'order' ? 'order' : 'swap'} — ${p.amount} ${p.sellToken} → ${p.buyToken} was never signed, so nothing moved.`,
          // Clear the pending action; keep the rest of the conversation state.
          workingContext: {
            v: 1,
            age: 0,
            ...(workingContext?.scope ? { scope: workingContext.scope } : {}),
            ...(workingContext?.offers ? { offers: workingContext.offers } : {}),
          } satisfies WorkingContext,
        })
      }
      const pendingVenue: 'uniswap' | 'cow' = pendingArtifact.data.venue === 'uniswap' ? 'uniswap' : 'cow'
      // Rebuild on the SAME chain the original artifact targeted (the pending
      // data carries chainId for non-Base builds) — never silently back on Base.
      const pendingChainId = sanitizeChainId(Number(pendingArtifact.data.chainId)) ?? DEFAULT_CHAIN_ID
      nativeTrace({ type: 'status', label: `native swap layer: amending the pending ${pendingArtifact.kind} to ${swapFollowUp.intent.sellAmountHuman} ${(swapFollowUp.intent.sellToken ?? '').toUpperCase()} → ${(swapFollowUp.intent.buyToken ?? '').toUpperCase()} on ${pendingVenue === 'uniswap' ? 'Uniswap' : 'CoW'} (${chainById(pendingChainId)?.name})` })
      return await prepareSwapTurn(swapFollowUp.intent, walletAddress, pendingVenue, workingContext, nativeTrace, pendingChainId)
    }
    // ── Aave supply: NATIVE deterministic build (no confirm round-trips) ────
    // "add 1 USDC to an Aave pool on Ethereum" once went planner/house-model:
    // the model sent the SYMBOL where build_supply validates an ADDRESS
    // (MCP -32602), asked "should I proceed?" three turns running, and
    // FABRICATED wallet balances in prose (live 2026-07-10; the real balance
    // was 0). Now: parse → resolve the reserve from the agent's own
    // `reserves` tool → build_supply → guard → ONE approve→supply card,
    // built immediately with everything shown. The confirmation is the
    // signature. Generic "add 1 USDC to a pool" routes here too when the
    // Aave agent is in the set — no protocol quiz.
    const aaveAsk = parseAaveSupply(message)
    if (aaveAsk) {
      const aaveRead = aaveAgentOf(activeServers)
      if ('problem' in aaveAsk) {
        // Clearly an Aave deposit, just under-specified (no amount) — the ONE
        // clarify that's actually necessary.
        nativeTrace({ type: 'status', label: 'native aave layer: supply ask under-specified — asking for the amount' })
        return NextResponse.json({ reply: `🏦 ${aaveAsk.problem}` })
      }
      const rivalVenue = aaveAsk.weak ? competingVenueOf(activeServers) : null
      if (rivalVenue) {
        // Venue-generic verb ("deposit 5 USDC") and another selected agent
        // could serve it — don't assume Aave; normal routing decides.
        nativeTrace({ type: 'note', level: 'info', label: `native aave layer passed: venue-generic verb and ${rivalVenue} is also selected — normal routing decides the venue` })
      } else if (aaveAsk.explicitAave || aaveRead.agent) {
        if (!aaveRead.agent) {
          nativeTrace({ type: 'note', level: 'warn', label: 'native aave layer: supply parsed but no Aave agent in the set — asking the user to add it' })
          return NextResponse.json({
            reply: `🏦 Supplying to Aave needs the **Aave** agent in your set — add it from the rail and ask again, and I'll build the deposit for you to sign.`,
          })
        }
        if (!aaveRead.usable) {
          // An add-MCP shell row (no endpoint) — same honest guard as the
          // cross-chain agent (routing at it makes the planner hallucinate).
          nativeTrace({ type: 'note', level: 'warn', label: `native aave layer: ${aaveRead.agent.name} has no callable endpoint (shell row) — refusing honestly` })
          return NextResponse.json({
            reply: `🏦 Your **${aaveRead.agent.name}** agent isn't fully connected — no callable tools are registered for it. Re-add it (or pick the Aave agent from the Free tab) and ask again.`,
          })
        }
        if (aaveAsk.otherChain) {
          nativeTrace({ type: 'note', level: 'info', label: `native aave layer: non-Ethereum chain (${aaveAsk.otherChain}) — Aave v4 is Ethereum-only, no build` })
          return NextResponse.json({
            reply: `🏦 Aave v4 is live on **Ethereum only** today — I can't build a supply on ${aaveAsk.otherChain}. Say “supply ${aaveAsk.amount} ${aaveAsk.token.toUpperCase()} to Aave on Ethereum” and I'll prepare it.`,
          })
        }
        nativeTrace({ type: 'status', label: `native aave layer claimed the turn: supply ${aaveAsk.amount} ${aaveAsk.token.toUpperCase()}${aaveAsk.explicitAave ? '' : ' (set-hint: Aave selected)'} — planner bypassed` })
        return await buildAaveSupplyTurn(aaveRead.agent, aaveAsk, walletAddress, workingContext, message, nativeTrace)
      } else {
        // Pool-ish/bare ask with no Aave agent and Aave not named → normal routing.
        nativeTrace({ type: 'note', level: 'info', label: 'native aave layer passed: supply-shaped ask but no Aave agent in the set — normal routing' })
      }
    }

    // ── Aave withdraw / borrow / repay: the same native recipe ──────────────
    // Anchored to the user's REAL position (portfolio), built via the agent's
    // build_* tool, every step guardrailed. Borrow runs the agent's `preview`
    // first so the health-factor impact is shown before signing.
    const aaveOpAsk = parseAaveOp(message)
    if (aaveOpAsk) {
      const aaveRead = aaveAgentOf(activeServers)
      if ('problem' in aaveOpAsk) {
        nativeTrace({ type: 'status', label: `native aave layer: ${aaveOpAsk.op} ask under-specified — asking for the amount` })
        return NextResponse.json({ reply: `🏦 ${aaveOpAsk.problem}` })
      }
      const rivalOpVenue = aaveOpAsk.weak ? competingVenueOf(activeServers) : null
      if (rivalOpVenue) {
        nativeTrace({ type: 'note', level: 'info', label: `native aave layer passed: venue-generic ${aaveOpAsk.op} and ${rivalOpVenue} is also selected — normal routing decides the venue` })
      } else if (aaveOpAsk.explicitAave || aaveRead.agent) {
        if (!aaveRead.agent) {
          nativeTrace({ type: 'note', level: 'warn', label: `native aave layer: ${aaveOpAsk.op} parsed but no Aave agent in the set — asking the user to add it` })
          return NextResponse.json({
            reply: `🏦 A ${aaveOpAsk.op} on Aave needs the **Aave** agent in your set — add it from the rail and ask again, and I'll build it for you to sign.`,
          })
        }
        if (!aaveRead.usable) {
          nativeTrace({ type: 'note', level: 'warn', label: `native aave layer: ${aaveRead.agent.name} has no callable endpoint (shell row) — refusing honestly` })
          return NextResponse.json({
            reply: `🏦 Your **${aaveRead.agent.name}** agent isn't fully connected — no callable tools are registered for it. Re-add it (or pick the Aave agent from the Free tab) and ask again.`,
          })
        }
        if (aaveOpAsk.otherChain) {
          nativeTrace({ type: 'note', level: 'info', label: `native aave layer: non-Ethereum chain (${aaveOpAsk.otherChain}) — Aave v4 is Ethereum-only, no build` })
          return NextResponse.json({
            reply: `🏦 Aave v4 is live on **Ethereum only** today — I can't build a ${aaveOpAsk.op} on ${aaveOpAsk.otherChain}. Say “${aaveOpAsk.op} ${aaveOpAsk.amount ?? 'all my'} ${aaveOpAsk.token.toUpperCase()} on Ethereum” and I'll prepare it.`,
          })
        }
        nativeTrace({ type: 'status', label: `native aave layer claimed the turn: ${aaveOpAsk.op} ${aaveOpAsk.max ? `all ${aaveOpAsk.token.toUpperCase()}` : `${aaveOpAsk.amount} ${aaveOpAsk.token.toUpperCase()}`}${aaveOpAsk.explicitAave ? '' : ' (set-hint: Aave selected)'} — planner bypassed` })
        return await buildAaveOpTurn(aaveRead.agent, aaveOpAsk, walletAddress, workingContext, message, nativeTrace)
      } else {
        // Lending-ish verb with no Aave agent and Aave not named → normal routing.
        nativeTrace({ type: 'note', level: 'info', label: `native aave layer passed: ${aaveOpAsk.op}-shaped ask but no Aave agent in the set — normal routing` })
      }
    }
    if (!aaveAsk && !aaveOpAsk && /\baave\b/i.test(message)) {
      // Aave named but neither native parser claimed it — the planner routes
      // it. This line is the breadcrumb that was missing when a parse miss
      // sent a build ask to the planner and its -32602 looked like MCP flake.
      nativeTrace({ type: 'note', level: 'info', label: 'aave named but no imperative supply/withdraw/borrow/repay parse — normal routing (reads are fine here; build asks should say e.g. “supply 5 USDC to aave”)' })
    }

    // DCA — recurring buys ("buy $10 of AAPL every week"), the due-period
    // chip's resume string, and pause/resume/cancel/list. Runs BEFORE the
    // jobs compiler and the swap layer: a cadence-bearing buy must become a
    // SCHEDULE, never a one-shot swap that quietly drops "every week". Each
    // due period compiles a one-step job (native-swap builder — same venue
    // cascade + guardrails as any swap), confirm-mode only.
    const dcaTurn = await runDcaTurn(message, walletAddress, selectedChainId, nativeTrace)
    if (dcaTurn) return NextResponse.json(dcaTurn)

    // Multi-step JOBS — a compound ask ("bridge …, then deposit …, then long
    // …, then protect it") compiles into a FIXED sequence of guarded steps
    // executed by the jobs runner (waits included). Runs BEFORE the single
    // native gates: their parsers would otherwise each claim one segment of
    // a compound message. Compiles deterministically or refuses honestly.
    const jobAsk = compileJobAsk(message)
    if (jobAsk && 'problem' in jobAsk) {
      nativeTrace({ type: 'note', level: 'warn', label: `jobs layer: compound ask but a segment failed to compile — ${jobAsk.problem.slice(0, 120)}` })
      return NextResponse.json({ reply: `🧭 ${jobAsk.problem}` })
    }
    if (jobAsk) {
      if (!walletAddress) {
        return NextResponse.json({ reply: "🧭 That chains multiple money steps — connect your wallet first and I'll compile it into a job you sign step by step." })
      }
      nativeTrace({ type: 'status', label: `jobs layer claimed the turn: ${jobAsk.steps.length}-step job — ${jobAsk.title} — planner bypassed` })
      const job = await createJob(walletAddress, jobAsk)
      // Kick the first step inline so the card opens with something to sign.
      await advanceJob(job).catch(() => {})
      return NextResponse.json({
        reply: `🧭 **Job compiled:** ${job.title}. Every step is built and guard-checked when it's offered; between your signatures the runner handles settlement waits and server-side steps on its own.`,
        jobId: job.id,
        // Capability token: the JobCard reads/advances THIS job with it —
        // embed visitors have no SIWE session (lib/job-token.ts).
        jobToken: signJobToken(job.id),
        buildPath: 'native-job',
      })
    }

    // Guardian arming from chat — "protect my SYRUP long with a 10% stop".
    // No signable artifact: with an active delegation the policy arms
    // server-side through the SAME rulebook as the dashboard; without one,
    // point at the one-signature approval. Requires the Hyperliquid agent in
    // the set so a stray "stop loss" in another context never claims a turn.
    const armAsk = parseGuardianArm(message)
    if (armAsk && hlAgentOf(activeServers).agent) {
      nativeTrace({ type: 'status', label: `guardian layer claimed the turn: ${armAsk.kind} on ${armAsk.coin} (${armAsk.triggerMode} ${armAsk.triggerValue}) — planner bypassed` })
      if (!walletAddress) {
        return NextResponse.json({ reply: '🛡️ Connect your wallet first — the guardian watches YOUR Hyperliquid positions.' })
      }
      const armed = await armGuardianPolicy(walletAddress, armAsk)
      if (!armed.ok) {
        nativeTrace({ type: 'note', level: 'warn', label: `guardian layer: arming refused — ${armed.error.slice(0, 140)}` })
        const approveHint = armed.status === 409 && /delegation/i.test(armed.error)
          ? ' Approve it on the [Guardian dashboard](/dashboard/guardian) — one signature, the agent key can trade but never withdraw, and it expires on its own.'
          : ''
        return NextResponse.json({ reply: `🛡️ ${armed.error}${approveHint}` })
      }
      const p = armed.policy
      nativeTrace({ type: 'status', label: `guardian layer: armed ${p.kind} on ${p.coin} (${p.triggerMode} ${p.triggerValue})` })
      return NextResponse.json({
        reply:
          `🛡️ **Armed.** ${p.kind === 'stop_loss' ? 'Stop-loss' : 'Take-profit'} on your ${p.coin} ${p.side}: closes reduce-only when ` +
          `${p.triggerMode === 'price' ? `the mark crosses ${p.triggerValue}` : `price moves ${p.triggerValue}% ${p.kind === 'stop_loss' ? 'against' : 'for'} you from entry`}. ` +
          `(${armed.positionNote}.)`,
        guardianPolicyId: p.id,
        buildPath: 'native-hl-guardian',
      })
    }

    // Lido staking layer — "stake 0.5 eth on lido" builds a guarded stake
    // (recipient pinned to the canonical mainnet contracts), and the GUIDED
    // ask ("help me stake on lido") answers with a deterministic balance
    // check + the exact next ask as a chip — the agent proposes the job.
    // Demands the venue word AND the Lido MCP in the set.
    const lidoAgent = lidoAgentOf(activeServers)
    if (lidoAgent.agent && lidoAgent.usable && isLidoGuidedAsk(message)) {
      nativeTrace({ type: 'status', label: 'lido layer claimed the turn (guided): deterministic balance check → proposing the exact ask as a chip' })
      return await guideLidoStakeTurn(lidoAgent.agent, walletAddress, message, nativeTrace)
    }
    const lidoAsk = parseLidoStake(message)
    if (lidoAsk && lidoAgent.agent && lidoAgent.usable) {
      if ('problem' in lidoAsk) {
        nativeTrace({ type: 'status', label: `lido layer: ask under-specified — ${lidoAsk.problem.slice(0, 120)}` })
        return NextResponse.json({ reply: `🌊 ${lidoAsk.problem}` })
      }
      nativeTrace({ type: 'status', label: `lido layer claimed the turn: stake ${lidoAsk.amount} ETH → ${lidoAsk.receive} — planner bypassed` })
      return await buildLidoStakeTurn(lidoAgent.agent, lidoAsk, walletAddress, message, nativeTrace)
    }
    if (lidoAsk && !lidoAgent.agent) {
      nativeTrace({ type: 'note', level: 'info', label: 'lido-shaped stake ask but no Lido MCP in the set — normal routing' })
    }

    // Hyperliquid execution layer — perp orders + the bridge-deposit on-ramp,
    // signed by the USER'S wallet (their wallet IS the HL account). Demands
    // the venue word, so it never claims generic swap asks; runs BEFORE the
    // swap layer so "buy 10 syrup perp on hyperliquid" isn't mistaken for a
    // spot swap.
    const hlIntent = parseHlIntent(message)
    if (hlIntent) {
      const hlAgent = hlAgentOf(activeServers)
      if (hlAgent.agent && hlAgent.usable) {
        // Universal funding plan: an under-funded deposit (above the bridge
        // minimum — smaller ones the build refuses on its own) offers to move
        // USDC over via NEAR Intents instead of building a blocked artifact.
        // A failed read falls through — the deposit's balance guardrail
        // fails closed on its own.
        if (hlIntent.kind === 'deposit' && walletAddress && hlIntent.amountUsdc >= HL_MIN_DEPOSIT_USDC) {
          const arbUsdc = await arbitrumUsdcBalance(walletAddress).catch(() => null)
          if (arbUsdc !== null && arbUsdc < hlIntent.amountUsdc) {
            const offer = await offerFundingPlan({
              user: walletAddress,
              need: {
                chainId: 42161,
                token: 'USDC',
                amountHuman: Number((hlIntent.amountUsdc - arbUsdc).toFixed(2)),
                followupResume: `deposit ${hlIntent.amountUsdc} USDC to Hyperliquid`,
                actionLabel: 'the Hyperliquid deposit',
              },
              trace: nativeTrace,
            })
            if (offer && 'insufficient' in offer) {
              return NextResponse.json({
                reply: `🚫 The deposit needs ${hlIntent.amountUsdc} USDC on Arbitrum and the wallet holds ${arbUsdc.toFixed(2)} there. ${offer.insufficient}`,
              })
            }
            if (offer) return NextResponse.json({ ...offer, reply: `🌉 ${offer.reply}` })
          }
        }
        const what = hlIntent.kind === 'deposit' ? `deposit ${hlIntent.amountUsdc} USDC` : `${hlIntent.kind} ${hlIntent.coin}`
        nativeTrace({ type: 'status', label: `native hl layer claimed the turn: ${what} on Hyperliquid — planner bypassed` })
        try {
          const turn = await buildHlExecTurn(hlIntent, walletAddress, nativeTrace)
          return NextResponse.json(turn)
        } catch (e) {
          nativeTrace({ type: 'error', label: `native hl layer: ${(e as Error).message}` })
          return NextResponse.json({ reply: `📈 ${(e as Error).message}` })
        }
      }
      nativeTrace({ type: 'note', level: 'info', label: 'hl-shaped ask but no Hyperliquid agent in the set — normal routing' })
    }

    // ── Native Robinhood Chain bridge (deterministic). There is exactly ONE
    //    bridge we trust for Robinhood Chain — the canonical Arbitrum bridge —
    //    so a bridge ask either builds it or gets an honest answer. Before
    //    this gate the planner claimed these turns and INVENTED venue chips
    //    (Stargate/Across, live 2026-07-14) — none of them integrated.
    const bridgeAsk = parseRobinhoodBridge(message)
    if (bridgeAsk) {
      if ('problem' in bridgeAsk) {
        nativeTrace({ type: 'status', label: 'native bridge layer claimed the turn — outside the canonical route, honest limits (no build)' })
        return NextResponse.json({ reply: `🌉 ${bridgeAsk.problem}` })
      }
      if (!walletAddress) {
        nativeTrace({ type: 'note', level: 'info', label: 'bridge ask but no wallet connected — asking to connect before building' })
        return NextResponse.json({
          reply: '🌉 Connect your wallet to bridge — you sign the transaction yourself, so it has to be built for your address.',
          connectWallet: true,
        })
      }
      nativeTrace({ type: 'select', service: 'Robinhood Chain bridge (native)', endpoint: bridgeAsk.kind === 'deposit' ? 'Delayed Inbox depositEth on Ethereum' : 'ArbSys withdrawEth on Robinhood Chain', priceUsd: 0, reason: 'native bridge layer — the canonical bridge is the one trusted route, built deterministically and guarded' })
      try {
        const built = await buildRobinhoodBridge({ kind: bridgeAsk.kind, amount: bridgeAsk.amount, from: walletAddress })
        if (built.blocked) {
          const reasons = built.refusal ?? built.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ')
          nativeTrace({ type: 'note', level: 'warn', label: `bridge build REFUSED: ${(reasons || 'a safety check failed.').slice(0, 200)}` })
          return NextResponse.json({ reply: `🚫 ${reasons || 'A safety check failed — nothing was built.'}`, guardrails: built.guardrails, blocked: true, buildPath: 'native-bridge-robinhood' })
        }
        nativeTrace({ type: 'status', label: `bridge guard passed — ${bridgeAsk.kind} of ${bridgeAsk.amount} ETH built (valueUsd ${built.guardrails.valueUsd ?? 'n/a'}), awaiting signature` })
        return NextResponse.json({
          reply: `🌉 ${built.summary}\n${built.note}`,
          txRequest: built.tx,
          guardrails: built.guardrails,
          buildPath: 'native-bridge-robinhood',
        })
      } catch (e) {
        nativeTrace({ type: 'note', level: 'warn', label: `bridge build failed: ${(e as Error).message.slice(0, 160)}` })
        return NextResponse.json({ reply: `🌉 Couldn't build the bridge transfer: ${(e as Error).message}` })
      }
    }

    // ── Native NFT layer (deterministic). Claims only turns that name an NFT
    //    (the word "nft"/"opensea", a "#id", or a contract#id pair), so token
    //    swaps and stock sells never land here — and it runs BEFORE the swap
    //    gate because "sell my Pudgy Penguin #2489 for 4.2 ETH" is sell-shaped.
    //    Transfers: on-chain-verified safeTransferFrom (ERC-721 + ERC-1155),
    //    re-decoded by an independent guard. Sells: a Seaport 1.6 order built
    //    from the collection's LIVE fee schedule, offered as an EIP-712
    //    artifact (SignNftListingButton) and re-verified at the submit relay.
    //    Buys: live-listing resolve → OpenSea fulfillment re-encoded LOCALLY,
    //    target pinned to Seaport 1.6, price re-checked vs floor/cap.
    const nftAsk = parseNftAsk(message)
    if (nftAsk) {
      if (nftAsk.kind === 'problem') {
        nativeTrace({ type: 'status', label: 'native nft layer claimed the turn — ask incomplete, answering honestly (no build)' })
        return NextResponse.json({ reply: `🖼️ ${nftAsk.problem}` })
      }
      if (!walletAddress) {
        nativeTrace({ type: 'note', level: 'info', label: 'nft ask but no wallet connected — asking to connect before building' })
        return NextResponse.json({
          reply: '🖼️ Connect your wallet first — NFT buys, transfers, and listings build against your actual address, and you sign them yourself.',
          connectWallet: true,
        })
      }
      const what =
        nftAsk.kind === 'transfer'
          ? `transfer "${nftAsk.ref}" → ${nftAsk.to}`
          : nftAsk.kind === 'buy'
            ? `buy "${nftAsk.ref}"${nftAsk.maxPriceEth ? ` ≤ ${nftAsk.maxPriceEth} ETH` : ''}`
            : `sell "${nftAsk.ref}" @ ${nftAsk.priceEth} ETH`
      nativeTrace({ type: 'select', service: 'OpenSea/Seaport (native NFT layer)', endpoint: what, priceUsd: 0, reason: 'native nft layer — ownership anchored on-chain, order/calldata built deterministically and guarded' })
      try {
        if (nftAsk.kind === 'buy') {
          // Live-listing resolve → locally re-encoded Seaport fill, target
          // pinned, price re-checked vs floor + any explicit cap, full
          // OUTFLOW policy gate.
          const built = await buildNftBuy(nftAsk, walletAddress)
          if ('problem' in built) {
            nativeTrace({ type: 'note', level: 'info', label: `nft buy not buildable: ${built.problem.slice(0, 160)}` })
            return NextResponse.json({ reply: `🖼️ ${built.problem}` })
          }
          if (built.blocked) {
            nativeTrace({ type: 'note', level: 'warn', label: `nft buy REFUSED: ${(built.refusal ?? 'a safety check failed.').slice(0, 200)}` })
            return NextResponse.json({ reply: `🚫 ${built.refusal ?? 'A safety check failed — nothing was built.'}`, guardrails: built.guardrails, blocked: true, buildPath: 'native-nft-buy' })
          }
          const buyWarns = built.guardrails.checks.filter((c) => !c.ok && c.level === 'warn').map((c) => `⚠️ ${c.note}`)
          nativeTrace({ type: 'status', label: `nft buy guard passed — Seaport fill built (valueUsd ${built.guardrails.valueUsd ?? 'n/a'}), awaiting signature` })
          return NextResponse.json({
            reply: `🖼️ ${built.summary}\n${built.note}${buyWarns.length ? `\n${buyWarns.join('\n')}` : ''}`,
            txRequest: built.tx,
            guardrails: built.guardrails,
            buildPath: 'native-nft-buy',
          })
        }
        if (nftAsk.kind === 'transfer') {
          const built = await buildNftTransfer(nftAsk, walletAddress)
          if ('problem' in built) {
            nativeTrace({ type: 'note', level: 'info', label: `nft transfer not buildable: ${built.problem.slice(0, 160)}` })
            return NextResponse.json({ reply: `🖼️ ${built.problem}` })
          }
          if (built.blocked) {
            nativeTrace({ type: 'note', level: 'warn', label: `nft transfer REFUSED: ${(built.refusal ?? 'a safety check failed.').slice(0, 200)}` })
            return NextResponse.json({ reply: `🚫 ${built.refusal ?? 'A safety check failed — nothing was built.'}`, guardrails: built.guardrails, blocked: true, buildPath: 'native-nft-transfer' })
          }
          nativeTrace({ type: 'status', label: `nft transfer guard passed (valueUsd ${built.guardrails.valueUsd ?? 'n/a'}), awaiting signature` })
          return NextResponse.json({
            reply: `🖼️ ${built.summary}\n${built.note}`,
            txRequest: built.tx,
            guardrails: built.guardrails,
            buildPath: 'native-nft-transfer',
          })
        }
        const built = await buildNftListing(nftAsk, walletAddress)
        if ('problem' in built) {
          nativeTrace({ type: 'note', level: 'info', label: `nft listing not buildable: ${built.problem.slice(0, 160)}` })
          return NextResponse.json({ reply: `🖼️ ${built.problem}` })
        }
        if (built.blocked) {
          nativeTrace({ type: 'note', level: 'warn', label: `nft listing REFUSED: ${(built.refusal ?? 'a safety check failed.').slice(0, 200)}` })
          return NextResponse.json({ reply: `🚫 ${built.refusal ?? 'A safety check failed — nothing was built.'}`, guardrails: built.guardrails, blocked: true, buildPath: 'native-nft-list' })
        }
        const warns = built.guardrails.checks.filter((c) => !c.ok && c.level === 'warn').map((c) => `⚠️ ${c.note}`)
        nativeTrace({ type: 'status', label: `nft listing guard passed — Seaport order built (valueUsd ${built.guardrails.valueUsd ?? 'n/a'}), awaiting signature` })
        return NextResponse.json({
          reply: `🔏 ${built.summary}\n${built.note}${warns.length ? `\n${warns.join('\n')}` : ''}`,
          orderRequest: built.order,
          guardrails: built.guardrails,
          buildPath: 'native-nft-list',
        })
      } catch (e) {
        nativeTrace({ type: 'note', level: 'warn', label: `nft build failed: ${(e as Error).message.slice(0, 160)}` })
        return NextResponse.json({ reply: `🖼️ Couldn't build that NFT action: ${(e as Error).message}` })
      }
    }

    // ── Native transfer layer (deterministic). "send 1 USDC on arbitrum to
    //    0x…" — pinned locally-encoded calldata (or a native ETH send),
    //    live-balance checked, priced, full outflow policy gate. Runs AFTER
    //    the NFT layer (NFT-shaped sends belong there) and demands an
    //    explicit 0x/ENS recipient + chain word, so HL deposits and bridge
    //    asks never land here. The same parser backs 'native-transfer' job
    //    steps, so "swap … then send …" chains reuse this exact build.
    const transferAsk = parseTransferSegment(message, { fallbackChainId: selectedChainId })
    if (transferAsk && 'problem' in transferAsk) {
      nativeTrace({ type: 'status', label: 'native transfer layer claimed the turn — ask incomplete, answering honestly (no build)' })
      return NextResponse.json({ reply: `💸 ${transferAsk.problem}` })
    }
    if (transferAsk) {
      if (!walletAddress) {
        nativeTrace({ type: 'note', level: 'info', label: 'transfer ask but no wallet connected — asking to connect before building' })
        return NextResponse.json({
          reply: '💸 Connect your wallet first — a send builds against your live balance, and you sign it yourself.',
          connectWallet: true,
        })
      }
      nativeTrace({ type: 'select', service: 'Native transfer layer', endpoint: `send ${transferAsk.amountHuman} ${transferAsk.token.toUpperCase()} → ${transferAsk.to} on ${transferAsk.chainName}`, priceUsd: 0, reason: 'native transfer layer — calldata encoded locally, re-decoded by an independent guard, balance and policy checked' })
      try {
        const built = await buildTransferArtifact(transferAsk, walletAddress)
        if ('problem' in built) {
          nativeTrace({ type: 'note', level: 'info', label: `transfer not buildable: ${built.problem.slice(0, 160)}` })
          return NextResponse.json({ reply: `💸 ${built.problem}` })
        }
        if (built.blocked) {
          nativeTrace({ type: 'note', level: 'warn', label: `transfer REFUSED: ${(built.refusal ?? 'a safety check failed.').slice(0, 200)}` })
          return NextResponse.json({ reply: `🚫 ${built.refusal ?? 'A safety check failed — nothing was built.'}`, guardrails: built.guardrails, blocked: true, buildPath: 'native-transfer' })
        }
        nativeTrace({ type: 'status', label: `transfer guard passed (valueUsd ${built.guardrails.valueUsd ?? 'n/a'}), awaiting signature` })
        return NextResponse.json({
          reply: `💸 ${built.summary}\n${built.note}`,
          txRequest: built.tx,
          guardrails: built.guardrails,
          buildPath: 'native-transfer',
        })
      } catch (e) {
        nativeTrace({ type: 'note', level: 'warn', label: `transfer build failed: ${(e as Error).message.slice(0, 160)}` })
        return NextResponse.json({ reply: `💸 Couldn't build the transfer: ${(e as Error).message}` })
      }
    }

    const swapIntent = parseSwapIntent(message)
    if (swapIntent.isSwap) {
      // The native venue layer (Uniswap/CoW) builds on the registry chains
      // (Base default; Ethereum/Arbitrum/Robinhood via the chain picker or a
      // chain named in the message). A TRUE cross-chain ask ("from base to
      // arbitrum", "bridge to solana") or a single chain we DON'T support
      // natively belongs to a cross-chain agent (NEAR Intents): with one in
      // the working set the deposit is built natively below; without one,
      // answer honestly — never a silently-wrong build.
      const xc = detectCrossChain(message)
      const ccAgent = crossChainAgentOf(activeServers)
      // Which single chain does this ask target? A chain NAMED in the message
      // wins (explicit text beats UI state); else the chain picker's
      // selection; else Base.
      const namedNative = !xc.crossChain && xc.chains.length === 1 ? chainByKey(xc.chains[0]) : null
      const pickerChain = chainById(selectedChainId)
      const targetChain = namedNative ?? pickerChain ?? chainById(DEFAULT_CHAIN_ID)!
      // Cross-chain = two chains / bridge phrasing, or one named chain that
      // isn't in the native registry (solana, polygon, …).
      const foreignChain = !xc.crossChain && xc.chains.length === 1 && !namedNative
      const crossChain = xc.crossChain || foreignChain
      if (crossChain && !ccAgent.agent) {
        const named = xc.chains.map((c) => `**${c[0].toUpperCase()}${c.slice(1)}**`).join(' → ')
        const nativeNames = APP_CHAINS.map((c) => c.name).join(' / ')
        nativeTrace({ type: 'note', level: 'warn', label: `native swap layer declined: cross-chain ask (${xc.chains.join(' → ')}) but no cross-chain agent in the set — pointing at NEAR Intents, no build` })
        return NextResponse.json({
          reply: `🔗 That swap involves ${named}, and Yeetful's built-in swap tools cover ${nativeNames}. Add the **NEAR Intents (Free)** agent to your set and ask again — it swaps any asset to any asset across ~35 chains with ONE transfer you sign (unfillable swaps auto-refund). Or pick one of the supported chains and I'll build it there.`,
        })
      }
      if (crossChain && ccAgent.agent && !ccAgent.usable) {
        // A cross-chain agent IS selected but can't be called (an add-MCP
        // shell with no endpoint/tools — its discovery failed). Routing the
        // swap at it makes the planner invent venues; say what's wrong
        // instead (live 2026-07-09: hallucinated 1inch/Across/Stargate chips).
        nativeTrace({ type: 'note', level: 'warn', label: `native cross-chain layer: ${ccAgent.agent.name} has no callable endpoint (shell row) — refusing honestly` })
        return NextResponse.json({
          reply: `🔗 Your **${ccAgent.agent.name}** agent isn't fully connected — no callable tools are registered for it, so I can't route this cross-chain swap through it. Remove it from your set and pick **NEAR Intents (Free)** from the Free tab (or re-add your MCP so its tools register), then ask again.`,
        })
      }
      if (!crossChain) {
        const uniActive = activeServers.some((s) => s.slug === 'uniswap' || /uniswap/i.test(s.name))
        const cowActive = activeServers.some((s) => s.slug === 'cow-swap' || /cow[\s·-]?swap/i.test(s.name))
        let venue: 'uniswap' | 'cow' =
          /\buni\s?swap\b|\buni\b/i.test(message) || (uniActive && !cowActive) ? 'uniswap' : 'cow'
        // The venue must exist on the target chain — CoW has no order book on
        // Robinhood Chain, so the default flips to Uniswap there.
        if (venue === 'cow' && !targetChain.cow) venue = 'uniswap'
        const pair = swapIntent.sellToken && swapIntent.buyToken
          ? `${swapIntent.mode === 'limit' ? 'limit ' : ''}${swapIntent.sellAmountHuman ?? '?'} ${swapIntent.sellToken.toUpperCase()} → ${swapIntent.buyToken.toUpperCase()}`
          : 'swap ask (pair not fully parsed yet)'
        const chainVia = namedNative ? 'named in the message' : pickerChain ? 'from the chain picker' : 'default'
        nativeTrace({ type: 'status', label: `native swap layer claimed the turn: ${pair} on ${venue === 'uniswap' ? 'Uniswap' : 'CoW'} (${targetChain.name}, ${chainVia}) — planner bypassed` })
        return await prepareSwapTurn(swapIntent, walletAddress, venue, workingContext, nativeTrace, targetChain.id)
      }
      // crossChain + a usable cross-chain agent → build it NATIVELY (deterministic
      // build_swap + guardrails + Sign button), never via the planner/house
      // model. A parse miss (a question, not an imperative build) falls through
      // to routing so the quote tool can still answer.
      if (ccAgent.agent && ccAgent.usable) {
        const cc = parseCrossChainSwap(message)
        if (cc && 'problem' in cc) {
          nativeTrace({ type: 'status', label: `native cross-chain layer: ask under-specified — ${cc.problem.slice(0, 160)}` })
          return NextResponse.json({ reply: `🔗 ${cc.problem}` })
        }
        if (cc) {
          nativeTrace({ type: 'status', label: `native cross-chain layer claimed the turn: swap ${cc.amount} ${cc.originToken.toUpperCase()} (${cc.originChain}) → ${cc.destinationToken.toUpperCase()} (${cc.destinationChain}) — planner bypassed` })
          return await buildCrossChainSwapTurn(ccAgent.agent, cc, walletAddress, workingContext, message, nativeTrace)
        }
        // The breadcrumb that keeps a parse miss from reading as MCP flake:
        // cross-chain-shaped but not an imperative build → the planner routes
        // it (quote questions belong there).
        nativeTrace({ type: 'note', level: 'info', label: 'native cross-chain layer passed: cross-chain-shaped ask but no imperative swap parse — normal routing (quote questions route via the planner)' })
      }
      // Otherwise (a quote question, etc.) fall through to routing below.
    }

    // Need an inference provider to phrase an answer. With none selected, fall
    // back to the HOUSE model (direct Anthropic, same key as the planner) so
    // free-MCP turns work end-to-end with zero USDC — instead of refusing.
    let synthesizer = inference
    if (!synthesizer) {
      const picked = activeServers.find((s) => s.kind === 'inference')
      if (!picked && process.env.ANTHROPIC_API_KEY) {
        synthesizer = HOUSE_INFERENCE
      } else {
        const hint = picked
          ? `“${picked.name}” isn't wired for live x402 yet. Try **Yeetful · Claude**, **ChatGPT**, **DeepSeek**, or **Google Gemini** — they're live.`
          : 'Add an **Inference** agent (e.g. **Yeetful · Claude** or **ChatGPT**) so I can answer.'
        return NextResponse.json({ reply: `⚡ ${hint}` })
      }
    }

    // Auto-callable endpoints for selected services that aren't hand-wired.
    // Planning costs one extra inference call, paid by the house wallet — so
    // smart calls need the burner even in wallet mode. Every reason a service
    // can't be auto-called lands in `notes` so the reply can say WHY.
    const notes: string[] = []
    if (isHouseInference(synthesizer)) {
      notes.push('No inference agent selected — the answer was written by Yeetful’s house model (free). Add **Yeetful · Claude** or **ChatGPT** for a paid, receipted engine.')
    }
    let smart: PlannableEndpoint[] = []
    if (listedOnly.length > 0) {
      if (!hasAgentWallet()) {
        notes.push(
          'Auto-calling is offline: no house wallet on the server (PRIVATE_KEY unset). The planner that wires directory services into a chat turn is house-paid, so these services can only be listed.',
        )
      } else if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) {
        notes.push('Auto-calling is offline: the endpoint directory DB is disabled (USE_DB / DATABASE_URL).')
      } else {
        smart = await loadSmartEndpoints(listedOnly)
        const plannable = new Set(smart.map((e) => e.serverSlug))
        const unplannable = listedOnly.filter((s) => !plannable.has(s.slug))
        if (unplannable.length > 0) {
          notes.push(
            `No machine-readable parameter schemas published for: ${unplannable.map((s) => s.name).join(', ')} — calls can't be constructed safely, so they stay listed-only.`,
          )
        }
      }
    }

    // ── Plan gate (billing): house-model answers are metered in YEET credits.
    // Attributable turns (SIWE session first, else the wallet in context)
    // debit ONE credit per house-synthesized turn, checked here — the single
    // choke point both burner and wallet phase-1 pass through (phase-2
    // executes an already-debited turn). Anonymous guests keep the existing
    // burner limits; paid inference engines are x402-receipted, not credits.
    // spendCredits fails OPEN — a billing-store hiccup never blocks chat.
    if (isHouseInference(synthesizer)) {
      // Bill precedence: a valid embed key (the HOST pays for their site's
      // visitors) > the SIWE session > the wallet in context.
      const billTo = embedBill?.ownerAddress ?? (await getSessionAddress()) ?? walletAddress
      if (billTo) {
        const credit = await spendCredits(billTo, embedBill ? 'embed-house-inference' : 'house-inference')
        if (!credit.ok) {
          return NextResponse.json({
            reply: embedBill
              ? `🪙 This site’s Yeetful plan is out of included answers for the month. The chat resumes when the plan renews or the site upgrades — or connect a paid engine and pay per call from your own wallet.`
              : `🪙 You’ve used all **${credit.allowance.toLocaleString()} YEET credits** on the ${credit.planName} plan this month. Upgrade at **yeetful.com/pricing** for more — or add a paid engine like **Yeetful · Claude** and keep going pay-per-call from your wallet.`,
            planGate: { plan: credit.plan, upgradeUrl: '/pricing' },
          })
        }
        if (!embedBill && credit.remaining <= Math.max(25, Math.ceil(credit.allowance * 0.1))) {
          notes.push(
            `YEET credits running low — ${credit.remaining.toLocaleString()} left this month on the ${credit.planName} plan. Upgrade at yeetful.com/pricing.`,
          )
        }
      }
    }

    // ── Phase 1 (wallet): plan + return signing requests ─────────────────────
    if (walletAddress) {
      // A fully-FREE turn (house synthesizer + only price-0 endpoints) has
      // nothing for the wallet to sign — skip the two-phase confirm entirely
      // and answer in one pass ($0.00 sheets are noise + wallets flag them).
      const fullyFree =
        isHouseInference(synthesizer) &&
        dataServers.length === 0 &&
        mcpDataServers.length === 0 &&
        smart.every((e) => e.priceUsd === '0')
      if (fullyFree) {
        return await runWithBurner(message, synthesizer, dataServers, mcpDataServers, listedOnly, smart, notes, history, clientTurnId, workingContext, walletAddress)
      }
      return await planWalletPayments(message, synthesizer, dataServers, mcpDataServers, listedOnly, walletAddress, smart, notes, history, workingContext)
    }

    // ── Burner mode: the server's agent wallet pays everything in one shot ────
    // House synthesis needs no burner: free data calls + a direct-Anthropic
    // answer spend zero USDC, so the turn runs even with PRIVATE_KEY unset.
    if (hasAgentWallet() || isHouseInference(synthesizer)) {
      return await runWithBurner(message, synthesizer, dataServers, mcpDataServers, listedOnly, smart, notes, history, clientTurnId, workingContext, walletAddress)
    }

    // ── Demo mode: nothing can pay ───────────────────────────────────────────
    return NextResponse.json({ reply: demoReply(message, activeServers) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Chat request failed'
    console.error('Chat error:', error)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

// ── Vote intent ───────────────────────────────────────────────────────────────

/**
 * Resolve a vote intent into a signable Snapshot vote. Reads (proposal lookup)
 * are free; only the typed-data construction (prepare_vote) is paid, by the
 * house wallet — the user just signs the result. Returns a friendly clarifying
 * reply when the proposal or choice can't be pinned down.
 *
 * Invariant #11: the proposal pins against the STRUCTURED working context
 * first (pending vote → the numbered list the user was shown), exactly like
 * the free governance path — the stateless resolve is the fallback. And every
 * offer this path makes (candidate list, vote awaiting signature) WRITES the
 * context so the next turn's "vote on 2" / bare "For" resolves against it.
 */
async function prepareVoteTurn(
  message: string,
  intent: VoteIntent,
  snapshotSvc: McpServer,
  walletAddress: string | undefined,
  ctx?: WorkingContext,
) {
  if (!walletAddress) {
    return NextResponse.json({
      reply:
        '🗳️ Connect your wallet to vote — Snapshot voting power is tied to your address, so you sign the vote yourself.',
      // The client renders a Connect-wallet button and re-runs this ask
      // once a wallet lands (chat page: RainbowKit; embed: the host bridge).
      connectWallet: true,
    })
  }

  // Pin the proposal from the working context (pure, no fetch). "option N"
  // after a numbered LIST is a proposal pick, so its choice reading is spent.
  const ref = resolveVoteReference(message, intent, ctx)
  const choiceText = ref?.pickedByNumber ? undefined : intent.choiceText
  const space = ref?.space ?? intent.spaceHint
  const scope: WorkingContext['scope'] = space
    ? { server: 'snapshot', label: space, params: { space } }
    : ctx?.scope
  const carryOffers = ctx?.offers?.kind === 'proposal' ? ctx.offers : undefined
  const pendingVoteCtx = (proposalId: string, title?: string, knownSpace?: string): WorkingContext => {
    const sp = space ?? knownSpace
    return {
      v: 1,
      age: 0,
      ...(sp ? { scope: { server: 'snapshot', label: sp, params: { space: sp } } } : scope ? { scope } : {}),
      ...(carryOffers ? { offers: carryOffers } : {}),
      pending: {
        kind: 'vote',
        summary: `vote on “${title ?? `${proposalId.slice(0, 10)}…`}” — awaiting the user's signature/choice`,
        data: { proposalId, ...(title ? { title } : {}), ...(sp ? { space: sp } : {}) },
      },
    }
  }

  if (!choiceText) {
    return NextResponse.json({
      reply: ref
        ? `🗳️ Which way on **${ref.title ?? 'that proposal'}**? Say e.g. “vote For”, “vote against”, or “vote option 2”.`
        : '🗳️ Which way? Say e.g. “vote For”, “vote against”, or “vote option 2”.',
      // The bare "For" answering this resolves against the pinned pending vote.
      ...(ref ? { workingContext: pendingVoteCtx(ref.proposalId, ref.title) } : {}),
    })
  }
  if (!hasAgentWallet()) {
    return NextResponse.json({
      reply:
        '🗳️ Voting needs the house wallet to prepare the signed message (x402), which isn’t configured here.',
    })
  }

  let resolved: Awaited<ReturnType<typeof resolveProposal>>
  try {
    resolved = await resolveProposal({ proposalId: ref?.proposalId ?? intent.proposalId, spaceHint: intent.spaceHint })
  } catch (e) {
    return NextResponse.json({
      reply: `🗳️ Couldn’t reach Snapshot to find the proposal: ${e instanceof Error ? e.message : 'error'}.`,
    })
  }
  if (!('id' in resolved)) {
    const list = resolved.candidates
    if (list.length === 0) {
      return NextResponse.json({
        reply: intent.spaceHint
          ? `🗳️ No active proposals in ${intent.spaceHint} right now.`
          : '🗳️ No active proposals found. Name a DAO (e.g. aave.eth) or paste a proposal id.',
      })
    }
    // Offer the candidates as clickable chips (full ids retained in meta) so the
    // user picks one instead of pasting a 64-hex id they can only see truncated.
    // NUMBERED, and the SAME numbering is written to the working context — the
    // next turn's "vote on 2" resolves against what the user saw (invariant #11).
    const items = list.slice(0, 6).map((p) => ({ id: p.id, title: p.title, space: p.space.id }))
    const lines = items.map((p, i) => `${i + 1}. **${p.title}** — ${p.space}`).join('\n')
    return NextResponse.json({
      reply: `🗳️ Which proposal? Pick one to vote ${choiceText} on — say “vote on 1” — or name the DAO/space:\n${lines}`,
      voteCandidates: { choiceText, items },
      workingContext: {
        v: 1,
        age: 0,
        ...(scope ? { scope } : {}),
        offers: {
          kind: 'proposal',
          items: list.slice(0, 6).map((p, i) => ({
            n: i + 1,
            id: p.id,
            title: p.title,
            ...(p.space?.id ? { data: { spaceId: p.space.id, spaceName: p.space.name || p.space.id } } : {}),
          })),
        },
      } satisfies WorkingContext,
    })
  }

  const host = hostOf(snapshotSvc.endpoint!)
  const receipts: Receipt[] = []
  try {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'prepare_vote',
        arguments: { proposal: resolved.id, from: walletAddress, choiceText },
      },
    })
    const res = await getPaidFetch()(snapshotSvc.endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body,
    })
    if (!res.ok) throw new Error(await failureReason(res))
    const data = parseMcpDataResult(res.headers.get('content-type') ?? '', await res.text())
    const txHash = decodeSettlement(res)?.transaction
    receipts.push({ name: snapshotSvc.name, endpoint: host, priceUsd: snapshotSvc.priceUsd ?? '0.01', txHash, ok: true })
    const vote = voteRequestFromToolResult(data)
    if (!vote) {
      const note = typeof data === 'string' ? data : JSON.stringify(data)
      return NextResponse.json({ reply: `🗳️ ${friendlyVoteError(note)}`, receipts, payer: 'the house wallet' })
    }
    return NextResponse.json({
      reply: `🗳️ ${vote.summary}`,
      receipts,
      payer: 'the house wallet',
      voteRequest: vote,
      // The vote awaits the user's signature — the same pending-vote write as
      // the free governance path, so "For"/"option 2" next turn resolves to it.
      workingContext: pendingVoteCtx(vote.proposal.id, vote.proposal.title, vote.proposal.space),
    })
  } catch (err) {
    return NextResponse.json({ reply: `🗳️ ${friendlyVoteError(err)}`, receipts })
  }
}

// ── Cross-chain swap (native, via the NEAR Intents agent) ───────────────────

/** Call ONE tool on an MCP agent deterministically (tools/call over the free
 *  MCP transport — no planner, no payment). Throws on transport/tool errors. */
async function callAgentTool(endpoint: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await getPaidFetch()(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  })
  if (!res.ok) throw new Error(await failureReason(res))
  return parseMcpDataResult(res.headers.get('content-type') ?? '', await res.text())
}

/**
 * Build a cross-chain swap into a SIGNABLE deposit transfer — the native,
 * deterministic path (never the planner/house model, which once fabricated a
 * deposit address). Calls the NEAR Intents agent's `build_swap`, GUARDRAILS
 * the returned transfer (must move exactly the quoted amount to the API's
 * one-time deposit address on the origin chain), and returns it as a Sign
 * button. The address the user sees and the tx they sign both come only from
 * the verified tool result.
 */
async function buildCrossChainSwapTurn(
  agent: McpServer,
  params: CrossChainSwapParams,
  walletAddress: string | undefined,
  ctx?: WorkingContext,
  originalMessage?: string,
  trace: (event: unknown) => void = () => {},
) {
  if (!walletAddress) {
    trace({ type: 'note', level: 'info', label: 'no wallet connected — asking to connect before building' })
    return NextResponse.json({
      reply:
        '🔗 Connect your wallet to build the cross-chain swap — you sign the deposit transfer yourself, so it has to be built for your address.',
      connectWallet: true,
      ...(originalMessage ? { connectAsk: originalMessage } : {}),
    })
  }

  trace({ type: 'select', service: agent.name, endpoint: 'tools/call build_swap', priceUsd: 0, reason: 'native cross-chain layer — one-time deposit address from the agent, verified by the guard before anything is offered' })
  let built: BuiltSwap
  try {
    built = (await callAgentTool(agent.endpoint!, 'build_swap', {
      originChain: params.originChain,
      originToken: params.originToken,
      destinationChain: params.destinationChain,
      destinationToken: params.destinationToken,
      amount: params.amount,
      from: walletAddress,
    })) as BuiltSwap
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'the build failed'
    trace({ type: 'receipt', receipt: { name: agent.name, endpoint: 'build_swap', priceUsd: 0, ok: false, note: msg.slice(0, 200) } })
    return NextResponse.json({
      reply: `🔗 Couldn't build that cross-chain swap: ${msg}`,
    })
  }

  const guard = guardCrossChainBuild(built, { chainId: expectedOriginChainId(params.originChain) })
  if (!guard.ok || !guard.tx) {
    // A verification failure is a REFUSAL, not a warning — never offer a
    // transfer we couldn't prove is correct.
    trace({ type: 'note', level: 'warn', label: `guard REFUSED the cross-chain build: ${guard.reasons.join(' ').slice(0, 200)}` })
    return NextResponse.json({
      reply: `🚫 I built the swap but refused it — the transfer didn't verify: ${guard.reasons.join(' ')} Nothing to sign; try again or use a different route.`,
      blocked: true,
    })
  }
  trace({ type: 'status', label: 'guard verified the deposit transfer — Sign & send card built, awaiting signature' })

  const summary = guard.summary ?? built.quote?.summary ?? 'Cross-chain swap'
  const expiry = guard.addressExpires ? ` The one-time deposit address expires ${guard.addressExpires}.` : ''
  const warn = guard.warnings.length ? `\n${guard.warnings.map((w) => `⚠️ ${w}`).join('\n')}` : ''
  return NextResponse.json({
    reply:
      `🔏 ${summary}\n\nSign the deposit transfer below — it sends exactly the quoted amount to NEAR Intents' one-time deposit address, and solvers deliver on the destination chain automatically.${expiry}${warn}`,
    txRequest: guard.tx,
    // Which layer built it — echoed on the tx-built/signed telemetry beacons
    // so /dashboard/embeds can break the funnel down per builder (lib/build-path.ts).
    buildPath: 'native-cross-chain',
    // Invariant #11: a pending action — "cancel" drops it, "make it 2" rebuilds.
    workingContext: {
      v: 1 as const,
      age: 0,
      ...(ctx?.scope ? { scope: ctx.scope } : {}),
      ...(ctx?.offers ? { offers: ctx.offers } : {}),
      pending: crossChainPending(params, guard.depositAddress ?? '', summary),
    } satisfies WorkingContext,
  })
}

// ── Lido staking (native, via the Lido MCP) ──────────────────────────────────

/**
 * The guided moment: "help me stake on lido" → a DETERMINISTIC context check
 * (the lido MCP's `position` read + direct USDC balance reads), then the
 * exact next ask proposed as a chip. Chips ROUND-TRIP: every resume string
 * parses under a native layer (harness-checked) — a chip that routes to the
 * planner is a suggested prompt in disguise.
 */
async function guideLidoStakeTurn(
  agent: McpServer,
  walletAddress: string | undefined,
  originalMessage: string,
  trace: (event: unknown) => void = () => {},
) {
  if (!walletAddress) {
    return NextResponse.json({
      reply: '🌊 Connect your wallet and I can check what you have to stake — the plan gets built for your address.',
      connectWallet: true,
      connectAsk: originalMessage,
    })
  }

  let pos: LidoPositionPayload | null = null
  try {
    pos = (await callAgentTool(agent.endpoint!, 'position', { user: walletAddress })) as LidoPositionPayload
  } catch (e) {
    trace({ type: 'note', level: 'warn', label: `lido layer: position read failed — ${(e as Error).message.slice(0, 140)}` })
    return NextResponse.json({ reply: `🌊 Couldn't read your balances just now (${(e as Error).message.slice(0, 120)}) — ask again in a moment.` })
  }

  const ethBal = pos.eth?.balance ?? '0'
  const stakeable = suggestedStakeEth(ethBal)
  const already = Number(pos.totalStaked?.stEth) > 0 ? ` You already have ${pos.totalStaked?.stEth} stETH earning${pos.currentAprPct != null ? ` ~${pos.currentAprPct}% APR` : ''}.` : ''

  if (stakeable) {
    trace({ type: 'status', label: `lido guided: ${ethBal} ETH on mainnet → proposing "Stake ${stakeable} ETH on Lido"` })
    return NextResponse.json({
      reply:
        `🌊 You hold **${ethBal} ETH** on Ethereum — enough to stake **${stakeable}** and keep a gas buffer.${already} ` +
        `Staking mints stETH 1:1 and starts earning via daily rebases; exiting later goes through the withdrawal queue or a DEX swap. One transaction, your wallet signs it.`,
      clarify: {
        question: 'Ready?',
        options: [
          { label: `Stake ${stakeable} ETH on Lido`, resume: `Stake ${stakeable} ETH on Lido` },
          { label: 'Receive wstETH instead', resume: `Stake ${stakeable} ETH on Lido as wstETH` },
        ],
      },
      buildPath: 'native-lido',
    })
  }

  // Broke on mainnet — the universal funding plan sizes the move so the
  // stake can actually FIRE (stake minimum + gas buffer + solver fees).
  // The bespoke chip this replaces once bridged $2 → 0.001 ETH and the
  // stake step refused it: nothing left after the gas buffer (2026-07-16).
  const funded = await lidoFundingTurn(walletAddress, Number(ethBal) || 0, null, 'stETH', trace)
  if (funded) return funded

  trace({ type: 'status', label: 'lido guided: no ETH and the funding scan found nothing to move — honest empty answer' })
  return NextResponse.json({
    reply:
      `🌊 Staking on Lido takes ETH on Ethereum, and this wallet holds ${ethBal} ETH there.${already} ` +
      `Fund the wallet and ask again — I'll size the stake to your balance.`,
  })
}

/** The smallest stake `suggestedStakeEth` will size — below it, mainnet gas
 *  makes the stake uneconomical, so funding plans target at least this. */
const LIDO_MIN_STAKE_ETH = 0.003

/**
 * The funding-plan turn for an unstakeable Lido ask: size the shortfall
 * (asked ETH floored at the economical minimum, plus the gas buffer, minus
 * what's already there) and offer NEAR-Intents legs from the other chains
 * as chips. The chip's job stakes ALL the ETH that arrives (minus the gas
 * buffer) — bridge fees mean the exact ask would strand the remainder.
 * Null when the scan/price is unavailable (caller falls through to the
 * normal build, which fails closed with the MCP's own message).
 */
async function lidoFundingTurn(
  walletAddress: string,
  balEth: number,
  askEth: number | null,
  receive: 'stETH' | 'wstETH',
  trace: (event: unknown) => void,
) {
  const targetEth = Number((Math.max(askEth ?? 0, LIDO_MIN_STAKE_ETH) + Number(LIDO_GAS_BUFFER_ETH)).toFixed(6))
  const shortfall = Number((targetEth - balEth).toFixed(6))
  if (shortfall <= 0) return null
  const offer = await offerFundingPlan({
    user: walletAddress,
    need: {
      chainId: 1,
      token: 'ETH',
      amountHuman: shortfall,
      followupResume: `stake all my ETH on Lido${receive === 'wstETH' ? ' as wstETH' : ''}`,
      actionLabel: 'the stake',
    },
    trace,
  })
  if (!offer) return null
  const holding = `the wallet holds ${balEth.toFixed(4).replace(/\.?0+$/, '') || '0'} ETH on Ethereum`
  if ('insufficient' in offer) {
    const askNote =
      askEth !== null
        ? `Staking ${askEth} ETH really needs ~${targetEth} ETH on Ethereum once mainnet gas is counted, and ${holding}.`
        : `Staking on Lido needs at least ~${targetEth} ETH on Ethereum once mainnet gas is counted, and ${holding}.`
    return NextResponse.json({ reply: `🌊 ${askNote} ${offer.insufficient}` })
  }
  const tinyNote =
    askEth !== null && askEth < LIDO_MIN_STAKE_ETH
      ? ` (${askEth} ETH alone wouldn't clear mainnet gas — the plan lands ~${targetEth} ETH and stakes all of it.)`
      : ''
  return NextResponse.json({
    ...offer,
    reply: `🌉 ${offer.reply} The stake step sizes itself to whatever arrives, minus a small gas buffer.${tinyNote}`,
  })
}

/** Build + guard a single Lido stake and offer it for signature. */
async function buildLidoStakeTurn(
  agent: McpServer,
  params: LidoStakeParams,
  walletAddress: string | undefined,
  originalMessage?: string,
  trace: (event: unknown) => void = () => {},
) {
  if (!walletAddress) {
    return NextResponse.json({
      reply: '🌊 Connect your wallet to build the stake — you sign it yourself, so it has to be built for your address.',
      connectWallet: true,
      ...(originalMessage ? { connectAsk: originalMessage } : {}),
    })
  }

  // ── Universal funding plan: a shortfall is an offer, never a wall ────────
  // Read the live mainnet balance BEFORE building. An ask the wallet can't
  // cover (or a 'max' with nothing stakeable) scans ETH + USDC on the other
  // chains and offers the bridge-then-stake job as chips — the same pattern
  // the Robinhood funding plan proved, riding NEAR Intents instead of LiFi.
  // A failed balance read falls through: build_stake fails closed on its own.
  const mainnetClient = publicClientFor(1)
  const balWei = mainnetClient ? await mainnetClient.getBalance({ address: walletAddress as `0x${string}` }).catch(() => null) : null
  const balEth = balWei === null ? null : Number(balWei) / 1e18

  let amountEth = params.amount
  if (amountEth === 'max') {
    const resolved = balEth !== null ? suggestedStakeEth(String(balEth)) : null
    if (!resolved) {
      const funded = balEth !== null ? await lidoFundingTurn(walletAddress, balEth, null, params.receive, trace) : null
      if (funded) return funded
      return NextResponse.json({ reply: '🌊 Nothing left to stake — your mainnet ETH balance is at (or below) the gas buffer.' })
    }
    amountEth = resolved
  } else if (balEth !== null && Number.isFinite(Number(amountEth)) && balEth < Number(amountEth) + Number(LIDO_GAS_BUFFER_ETH)) {
    const funded = await lidoFundingTurn(walletAddress, balEth, Number(amountEth), params.receive, trace)
    if (funded) return funded
  }

  trace({ type: 'select', service: agent.name, endpoint: 'tools/call build_stake', priceUsd: 0, reason: 'native lido layer — construction-only build, recipient pinned to the canonical mainnet contracts by the guard' })
  let built: LidoBuiltStake
  try {
    built = (await callAgentTool(agent.endpoint!, 'build_stake', { user: walletAddress, amount: amountEth, receive: params.receive })) as LidoBuiltStake
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'the build failed'
    trace({ type: 'receipt', receipt: { name: agent.name, endpoint: 'build_stake', priceUsd: 0, ok: false, note: msg.slice(0, 200) } })
    return NextResponse.json({ reply: `🌊 Couldn't build that stake: ${msg}` })
  }

  const guard = guardLidoStakeBuild(built, { amountEth, receive: params.receive })
  if (!guard.ok || !guard.tx) {
    trace({ type: 'note', level: 'warn', label: `guard REFUSED the lido build: ${guard.reasons.join(' ').slice(0, 200)}` })
    return NextResponse.json({
      reply: `🚫 I built the stake but refused it — it didn't verify: ${guard.reasons.join(' ')} Nothing to sign.`,
      blocked: true,
    })
  }

  // Price the artifact off the same position read the splash uses (fail-soft).
  const valueUsd = await callAgentTool(agent.endpoint!, 'position', { user: walletAddress })
    .then((p) => {
      const eth = (p as LidoPositionPayload).eth
      const price = Number(eth?.usd) / Number(eth?.balance)
      return Number.isFinite(price) && price > 0 ? Number((Number(amountEth) * price).toFixed(2)) : null
    })
    .catch(() => null)

  trace({ type: 'status', label: 'guard verified the stake — Sign & send card built, awaiting signature' })
  const warn = guard.warnings.length ? `\n${guard.warnings.map((w) => `⚠️ ${w}`).join('\n')}` : ''
  return NextResponse.json({
    reply: `🔏 ${guard.summary ?? `Stake ${amountEth} ETH with Lido.`}\n\nSign below — the recipient is the canonical Lido ${params.receive === 'wstETH' ? 'wstETH' : 'stETH'} contract, verified before this was offered.${warn}`,
    txRequest: guard.tx,
    guardrails: { ok: true, warnings: guard.warnings, valueUsd },
    buildPath: 'native-lido',
  })
}

// ── Aave supply / withdraw / borrow / repay (native, via the Aave agent) ─────

/** The ledger/policy host Aave builds are attributed to. */
const AAVE_POLICY_HOST = 'aave-mcp.yeetful.com'

/**
 * The spend-policy gate at the point of signing, shared by every Aave op —
 * builds the guardrails report (guardrails.valueUsd = the money-moved
 * headline metric), ledgers a policy denial, and returns the refusal
 * response when the policy blocks.
 */
async function aavePolicyGate(
  valueUsd: number | null,
  walletAddress: string,
  opLabel: string,
  buildNote: string,
): Promise<{ guardrails: ReturnType<typeof buildReport>; blocked: NextResponse | null }> {
  const grant = await getActiveGrant(walletAddress.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const { check: polCheck, violation } = policyCheck(valueUsd, policy, spentToday, AAVE_POLICY_HOST, 0, { selfSigned: true })
  const guardrails = buildReport(
    valueUsd,
    [
      { id: 'aave-build', level: 'block', ok: true, note: buildNote },
      polCheck,
    ],
    violation ? { violation, valueUsd, host: AAVE_POLICY_HOST } : null,
  )
  if (violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: AAVE_POLICY_HOST,
      serviceName: 'Aave',
      amountUsd: 0,
      ok: false,
      note: `blocked: ${violation} (aave ${opLabel})`,
    })
  }
  const blocked = !guardrails.ok
    ? NextResponse.json({
        reply: `🚫 ${opLabel[0].toUpperCase()}${opLabel.slice(1)} built but refused by your guardrails: ${polCheck.note}`,
        guardrails,
        blocked: true,
      })
    : null
  return { guardrails, blocked }
}

/**
 * The funding-plan turn shared by Aave supply + repay: read the wallet's
 * live mainnet balance of the RESOLVED reserve token, and when it can't
 * cover the ask, offer NEAR-Intents legs from the other chains as chips —
 * the pick compiles into a job (fund → wait → the Aave op, rebuilt fresh by
 * lib/aave-exec.ts once the funds are really there). Returns null when the
 * wallet covers it or the scan/read is unavailable (callers fall through to
 * the normal build, which fails closed on its own).
 */
async function aaveFundingTurn(
  walletAddress: string,
  currency: string,
  decimals: number,
  token: string,
  askAmount: number,
  followupResume: string,
  actionLabel: string,
  trace: (event: unknown) => void,
) {
  if (!Number.isFinite(askAmount) || askAmount <= 0) return null
  const client = publicClientFor(1)
  if (!client) return null
  let held: number | null = null
  try {
    const raw = await client.readContract({ address: currency as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [walletAddress as `0x${string}`] })
    held = Number(formatUnits(raw, decimals))
  } catch {
    return null
  }
  if (held === null || held >= askAmount) return null
  const offer = await offerFundingPlan({
    user: walletAddress,
    need: {
      chainId: 1,
      token,
      amountHuman: Number((askAmount - held).toFixed(6)),
      followupResume,
      actionLabel,
    },
    trace,
  })
  if (!offer) return null
  if ('insufficient' in offer) {
    return NextResponse.json({
      reply: `🏦 ${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} needs ${askAmount} ${token} on Ethereum and the wallet holds ${held}. ${offer.insufficient}`,
    })
  }
  return NextResponse.json({ ...offer, reply: `🌉 ${offer.reply}` })
}

/**
 * Build an Aave v4 supply into a signable approve→supply chain — the native,
 * deterministic path (never the planner/house model, which sent the token
 * SYMBOL to an address-validated param and fabricated balances in prose).
 * Resolves the reserve from the agent's `reserves` tool, calls `build_supply`
 * with the RESOLVED addresses, GUARDRAILS every returned step (exact amount,
 * spoke from the official list, deposit credits the user), and returns ONE
 * self-advancing card. No confirmation round-trip — the reply shows the pool,
 * amount, USD value, and APY; signing is the confirmation.
 */
async function buildAaveSupplyTurn(
  agent: McpServer,
  params: AaveSupplyParams,
  walletAddress: string | undefined,
  ctx?: WorkingContext,
  originalMessage?: string,
  trace: (event: unknown) => void = () => {},
) {
  const token = params.token.toUpperCase()
  if (!walletAddress) {
    trace({ type: 'note', level: 'info', label: 'no wallet connected — asking to connect before building' })
    return NextResponse.json({
      reply: '🏦 Connect your wallet to supply — the deposit is built for your address and you sign it yourself.',
      connectWallet: true,
      ...(originalMessage ? { connectAsk: originalMessage } : {}),
    })
  }

  // 1) Resolve the reserve from the agent's own reserves list — address,
  //    decimals, APY, and spoke all come from the official API, never a model.
  let picked: PickedReserve | null = null
  try {
    const res = (await callAgentTool(agent.endpoint!, 'reserves', { symbols: [token], chainId: 1 })) as {
      reserves?: AaveReserveRow[]
    }
    picked = pickSupplyReserve(res?.reserves ?? [], token)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'the lookup failed'
    trace({ type: 'receipt', receipt: { name: agent.name, endpoint: 'reserves', priceUsd: 0, ok: false, note: msg.slice(0, 200) } })
    return NextResponse.json({ reply: `🏦 Couldn't read Aave's reserve list: ${msg}` })
  }
  if (!picked) {
    trace({ type: 'note', level: 'warn', label: `${token} is not an active supplyable reserve — no build` })
    return NextResponse.json({
      reply: `🏦 ${token} isn't an active, supplyable Aave v4 reserve on Ethereum right now — ask “where can I earn on ${token}?” to see what's listed.`,
    })
  }
  trace({ type: 'select', service: agent.name, endpoint: `${picked.spokeName} spoke · tools/call reserves → build_supply`, priceUsd: 0, reason: 'native aave supply layer — addresses from the official reserve list' })

  const atoms = humanToAtoms(params.amount, picked.decimals)
  if (!atoms) {
    return NextResponse.json({
      reply: `🏦 “${params.amount}” has more decimal places than ${token} supports (${picked.decimals}).`,
    })
  }

  // ── Universal funding plan: a shortfall is an offer, never a wall ────────
  // Read the live mainnet balance of the RESOLVED reserve token before
  // building; a short supply offers NEAR-Intents legs from the other chains
  // as chips (fund → wait → supply, one job). ETH/WETH supplies are skipped
  // (intents deliver native ETH; the reserve wants WETH — an offer that
  // can't settle is worse than the honest build error). Read failure falls
  // through — AaveKit's build validates against real balances and fails
  // closed on its own.
  if (token !== 'ETH' && token !== 'WETH') {
    const fundingTurn = await aaveFundingTurn(walletAddress, picked.currency, picked.decimals, token, Number(params.amount), `supply ${params.amount} ${token} to Aave`, 'the Aave supply', trace)
    if (fundingTurn) return fundingTurn
  }

  // 2) Build via the agent, with resolved 0x addresses (the planner once sent
  //    the symbol "USDC" here and died on the tool's address-regex → -32602).
  let built: AaveBuiltPlan
  try {
    built = (await callAgentTool(agent.endpoint!, 'build_supply', {
      spokeAddress: picked.spokeAddress,
      currency: picked.currency,
      amount: params.amount,
      user: walletAddress,
      chainId: 1,
    })) as AaveBuiltPlan
  } catch (err) {
    // AaveKit validates server-side against REAL balances — surface its
    // reason verbatim ("Insufficient balance: this needs 1.000000 USDC but
    // the wallet holds 0.000000…") instead of a model's guess.
    const msg = err instanceof Error ? err.message : 'the build failed'
    trace({ type: 'receipt', receipt: { name: agent.name, endpoint: 'build_supply', priceUsd: 0, ok: false, note: msg.slice(0, 200) } })
    return NextResponse.json({ reply: `🏦 Couldn't build the supply: ${msg}` })
  }

  // 3) Guard — nothing is offered unless every step verifies.
  const guard = guardAaveSupplyBuild(built, {
    chainId: 1,
    atoms: BigInt(atoms),
    currency: picked.currency,
    spoke: picked.spokeAddress,
    user: walletAddress,
    onChainId: picked.onChainId,
  })
  if (!guard.ok || !guard.steps) {
    // A verification failure is a REFUSAL, not a warning.
    trace({ type: 'note', level: 'warn', label: `guard REFUSED the supply build: ${guard.reasons.join(' ').slice(0, 200)}` })
    return NextResponse.json({
      reply: `🚫 I built the supply but refused it — the transaction didn't verify: ${guard.reasons.join(' ')} Nothing to sign.`,
      blocked: true,
    })
  }
  trace({ type: 'status', label: `guard verified every step — ${guard.steps.length === 2 ? 'approve → supply' : 'supply'} card built, awaiting signature` })

  // 4) The spend-policy gate at the point of signing, and the money-moved
  //    value (guardrails.valueUsd — the headline-metric contract).
  const valueUsd = picked.priceUsd !== null ? Number(params.amount) * picked.priceUsd : null
  const { guardrails, blocked } = await aavePolicyGate(
    valueUsd,
    walletAddress,
    'supply',
    `Build verified: the steps move exactly ${params.amount} ${token} into Aave v4 ${picked.spokeName}, credited to your wallet.`,
  )
  if (blocked) return blocked

  const apy = picked.supplyApyPct !== null ? `${picked.supplyApyPct.toFixed(2)}% APY` : "the pool's live APY"
  const usd = valueUsd !== null ? ` (≈$${valueUsd.toFixed(2)})` : ''
  const summary = `Supply ${params.amount} ${token}${usd} to Aave v4 ${picked.spokeName} on Ethereum — earning ${apy}`
  const stepsNote =
    guard.steps.length > 1
      ? `Sign the ${token} approval in the card below, and the supply appears automatically once it confirms — nothing to retype.`
      : 'One signature in the card below sends it.'
  const warns = guard.warnings.map((w) => `⚠️ ${w}`).join('\n')
  return NextResponse.json({
    reply:
      `🔏 ${summary}\n` +
      `— Pool: ${picked.spokeName} spoke \`${picked.spokeAddress}\` · ${token} \`${picked.currency}\` (from Aave's official reserve list)\n` +
      `— The deposit credits ${walletAddress} and starts earning immediately; withdraw any time.\n` +
      `${stepsNote}${warns ? `\n${warns}` : ''}`,
    txChain: { summary, steps: guard.steps },
    buildPath: 'native-aave-supply',
    guardrails,
    workingContext: {
      v: 1 as const,
      age: 0,
      ...(ctx?.scope ? { scope: ctx.scope } : {}),
      ...(ctx?.offers ? { offers: ctx.offers } : {}),
      pending: aaveSupplyPending(params, picked.spokeName, summary),
    } satisfies WorkingContext,
  })
}

/** What the user's portfolio tool returns — the position-anchoring read. */
interface AavePortfolioRead {
  positions?: AavePortfolioPosition[]
  supplies?: AavePortfolioSupplyRow[]
  borrows?: AavePortfolioBorrowRow[]
}

/**
 * Build an Aave v4 withdraw / borrow / repay into a signable chain — the same
 * native recipe as supply, anchored to the user's REAL position: `portfolio`
 * names the spoke the funds actually sit on (never "the deepest pool"),
 * `reserves` cross-checks addresses + the on-chain reserve id, the matching
 * build_* tool constructs the steps, and the guard verifies every one
 * (pinned selector, exact amount or the live-probed max encoding, funds
 * moving only to/for the user). Borrow runs the agent's `preview` first so
 * the health-factor impact is in the reply. No confirmation round-trip —
 * signing is the confirmation.
 */
async function buildAaveOpTurn(
  agent: McpServer,
  params: AaveOpParams,
  walletAddress: string | undefined,
  ctx?: WorkingContext,
  originalMessage?: string,
  trace: (event: unknown) => void = () => {},
) {
  const token = params.token.toUpperCase()
  const op = params.op
  const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
  if (!walletAddress) {
    trace({ type: 'note', level: 'info', label: 'no wallet connected — asking to connect before building' })
    return NextResponse.json({
      reply: `🏦 Connect your wallet to ${op} — the transaction is built for your address and position, and you sign it yourself.`,
      connectWallet: true,
      ...(originalMessage ? { connectAsk: originalMessage } : {}),
    })
  }

  // 1) Anchor to the user's real position — which spoke, how much is there.
  let pf: AavePortfolioRead
  try {
    pf = (await callAgentTool(agent.endpoint!, 'portfolio', { user: walletAddress, chainId: 1 })) as AavePortfolioRead
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'the lookup failed'
    trace({ type: 'receipt', receipt: { name: agent.name, endpoint: 'portfolio', priceUsd: 0, ok: false, note: msg.slice(0, 200) } })
    return NextResponse.json({ reply: `🏦 Couldn't read your Aave position: ${msg}` })
  }

  let supplyPos: AavePortfolioSupplyRow | null = null
  let debtPos: AavePortfolioBorrowRow | null = null
  if (op === 'withdraw') {
    supplyPos = pickWithdrawPosition(pf.supplies ?? [], token)
    if (!supplyPos) {
      trace({ type: 'note', level: 'info', label: `no ${token} supply position found — honest reply, no build` })
      return NextResponse.json({
        reply: `🏦 You don't have any ${token} supplied on Aave v4 — nothing to withdraw. Ask “show my Aave position” to see what's there.`,
      })
    }
    if (!params.max && Number(params.amount) > Number(supplyPos.withdrawable ?? 0)) {
      return NextResponse.json({
        reply: `🏦 Your withdrawable ${token} on Aave v4 ${supplyPos.spoke ?? ''} is ${supplyPos.withdrawable} (asked: ${params.amount}) — say “withdraw all my ${token}” and I'll build the full withdrawal.`,
      })
    }
  }
  if (op === 'repay') {
    debtPos = pickRepayPosition(pf.borrows ?? [], token)
    if (!debtPos) {
      trace({ type: 'note', level: 'info', label: `no ${token} debt found — honest reply, no build` })
      return NextResponse.json({
        reply: `🏦 You don't have any ${token} debt on Aave v4 — nothing to repay. Ask “show my Aave position” to see what's outstanding.`,
      })
    }
    if (!params.max && Number(params.amount) > Number(debtPos.debt ?? 0)) {
      return NextResponse.json({
        reply: `🏦 Your ${token} debt on Aave v4 ${debtPos.spoke ?? ''} is ${debtPos.debt} (asked: ${params.amount}) — say “repay all my ${token} debt” and I'll build the full repayment, accrued interest included.`,
      })
    }
  }

  // 2) Cross-check against the official reserves list (addresses, decimals,
  //    APYs, on-chain reserve id) — the guard's expectations come from here.
  let reserveRows: AaveReserveRow[]
  try {
    const res = (await callAgentTool(agent.endpoint!, 'reserves', { symbols: [token], chainId: 1 })) as {
      reserves?: AaveReserveRow[]
    }
    reserveRows = res?.reserves ?? []
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'the lookup failed'
    trace({ type: 'receipt', receipt: { name: agent.name, endpoint: 'reserves', priceUsd: 0, ok: false, note: msg.slice(0, 200) } })
    return NextResponse.json({ reply: `🏦 Couldn't read Aave's reserve list: ${msg}` })
  }

  let picked: PickedReserve | null = null
  if (op === 'withdraw') {
    picked = reserveForOp(reserveRows, token, supplyPos!.spokeAddress!, 'supply')
  } else if (op === 'repay') {
    picked = reserveForOp(reserveRows, token, debtPos!.spokeAddress!, 'borrow')
  } else {
    const b = pickBorrowReserve(reserveRows, token, pf.positions ?? [])
    if (!b) {
      const anyPower = (pf.positions ?? []).some((p) => (parseUsd(p.remainingBorrowingPowerUsd) ?? 0) > 0)
      return NextResponse.json({
        reply: anyPower
          ? `🏦 ${token} isn't borrowable on the Aave v4 spokes where you hold collateral — ask “where can I borrow ${token}?” to see what's listed.`
          : `🏦 Borrowing needs collateral supplied first — you have no borrowing power on Aave v4 yet. Supply an asset (e.g. “supply 100 USDC to Aave”), then borrow against it.`,
      })
    }
    picked = b.picked
  }
  if (!picked) {
    // A position exists but the official list has no matching reserve leg —
    // we can't verify what a build would return, so we refuse to build.
    return NextResponse.json({
      reply: `🏦 I couldn't cross-check the ${token} reserve on Aave's official list, so I won't build the ${op}. Nothing to sign.`,
    })
  }
  const posTokenAddr = op === 'withdraw' ? supplyPos!.token?.address : op === 'repay' ? debtPos!.token?.address : null
  if (posTokenAddr && !eq(posTokenAddr, picked.currency)) {
    trace({ type: 'note', level: 'warn', label: `position ${token} address does not match the official reserve list — refusing to build` })
    return NextResponse.json({
      reply: `🏦 Your position's ${token} address doesn't match Aave's official reserve list, so I won't build the ${op}. Nothing to sign.`,
    })
  }
  trace({ type: 'select', service: agent.name, endpoint: `${picked.spokeName} spoke · tools/call portfolio → reserves → build_${op}`, priceUsd: 0, reason: `native aave ${op} layer — anchored to your real position` })

  let atoms: string | null = null
  if (!params.max) {
    atoms = humanToAtoms(params.amount!, picked.decimals)
    if (!atoms) {
      return NextResponse.json({
        reply: `🏦 “${params.amount}” has more decimal places than ${token} supports (${picked.decimals}).`,
      })
    }
  }

  // ── Universal funding plan (repay only): a wallet that can't cover its
  // own repayment gets funding chips instead of AaveKit's refusal. Max
  // repays size the need to the live debt (interest headroom rides the
  // plan's own margin). ETH/WETH skipped for the same reason as supply.
  if (op === 'repay' && token !== 'ETH' && token !== 'WETH') {
    const repayAsk = params.max ? Number(debtPos!.debt ?? 0) : Number(params.amount)
    const fundingTurn = await aaveFundingTurn(
      walletAddress,
      picked.currency,
      picked.decimals,
      token,
      repayAsk,
      params.max ? `repay all my ${token} debt on aave` : `repay ${params.amount} ${token} on aave`,
      'the Aave repayment',
      trace,
    )
    if (fundingTurn) return fundingTurn
  }

  // 3) Borrow only: simulate first — the health-factor impact belongs in the
  //    reply the user signs against (AaveKit refuses HF<1 builds regardless).
  let hfLine = ''
  let hfWarning: string | null = null
  if (op === 'borrow') {
    try {
      const prev = (await callAgentTool(agent.endpoint!, 'preview', {
        spokeAddress: picked.spokeAddress,
        currency: picked.currency,
        user: walletAddress,
        amount: params.amount,
        action: 'borrow',
        chainId: 1,
      })) as { healthFactor?: { current?: string | null; after?: string | null; warning?: string | null } }
      const cur = Number(prev?.healthFactor?.current)
      const after = Number(prev?.healthFactor?.after)
      if (Number.isFinite(cur) && Number.isFinite(after)) {
        hfLine = `\n— Health factor: ${cur.toFixed(2)} → ${after.toFixed(2)} (Aave's own preview — 1.00 is liquidation)`
        if (after < 1.1) hfWarning = `That leaves a thin liquidation margin (health factor ${after.toFixed(2)}) — a small price move could liquidate your collateral.`
      } else if (prev?.healthFactor?.warning) {
        hfWarning = prev.healthFactor.warning
      }
    } catch {
      hfLine = '\n— (Couldn’t simulate the health-factor impact — Aave still refuses any borrow that would break it.)'
    }
  }

  // 4) Build via the agent with the RESOLVED addresses.
  let built: AaveBuiltPlan
  try {
    built = (await callAgentTool(agent.endpoint!, `build_${op}`, {
      spokeAddress: picked.spokeAddress,
      currency: picked.currency,
      user: walletAddress,
      chainId: 1,
      ...(params.max ? { max: true } : { amount: params.amount }),
    })) as AaveBuiltPlan
  } catch (err) {
    // AaveKit validates server-side against REAL balances + health factor —
    // surface its reason verbatim, never a model's guess.
    const msg = err instanceof Error ? err.message : 'the build failed'
    trace({ type: 'receipt', receipt: { name: agent.name, endpoint: `build_${op}`, priceUsd: 0, ok: false, note: msg.slice(0, 200) } })
    return NextResponse.json({ reply: `🏦 Couldn't build the ${op}: ${msg}` })
  }

  // 5) Guard — nothing is offered unless every step verifies.
  const amountRule: AaveAmountRule = params.max
    ? op === 'withdraw'
      ? { kind: 'withdraw-max' }
      : { kind: 'repay-max', debtAtoms: BigInt(humanToAtoms(debtPos!.debt ?? '0', picked.decimals) ?? '0') }
    : { kind: 'exact', atoms: BigInt(atoms!) }
  // The calldata's reserve id may be ANY active leg of this asset on this
  // spoke that serves the op — AaveKit resolves the leg from its own row
  // order (live: Bluechip USDC = mixed leg 4 + borrow-only leg 7).
  const legIds = reserveLegIds(reserveRows, token, picked.spokeAddress, op === 'withdraw' ? 'supply' : 'borrow')
  const guard = guardAaveOpBuild(built, {
    op,
    chainId: 1,
    amount: amountRule,
    currency: picked.currency,
    spoke: picked.spokeAddress,
    user: walletAddress,
    onChainIds: legIds.length > 0 ? legIds : picked.onChainId !== null ? [picked.onChainId] : null,
  })
  if (!guard.ok || !guard.steps) {
    trace({ type: 'note', level: 'warn', label: `guard REFUSED the ${op} build: ${guard.reasons.join(' ').slice(0, 200)}` })
    return NextResponse.json({
      reply: `🚫 I built the ${op} but refused it — the transaction didn't verify: ${guard.reasons.join(' ')} Nothing to sign.`,
      blocked: true,
    })
  }
  trace({ type: 'status', label: `guard verified every step — ${op} card built, awaiting signature` })

  // 6) Money-moved value + the spend-policy gate at the point of signing.
  const valueUsd = params.max
    ? op === 'withdraw'
      ? parseUsd(supplyPos!.balanceUsd)
      : parseUsd(debtPos!.debtUsd)
    : picked.priceUsd !== null
      ? Number(params.amount) * picked.priceUsd
      : null
  const amountText = params.max
    ? op === 'withdraw'
      ? `all your ${token} (~${supplyPos!.withdrawable})`
      : `your full ${token} debt (~${debtPos!.debt}, accrued interest included)`
    : `${params.amount} ${token}`
  const { guardrails, blocked } = await aavePolicyGate(
    valueUsd,
    walletAddress,
    op,
    `Build verified: the steps ${op} exactly ${amountText} on Aave v4 ${picked.spokeName}, ${op === 'repay' ? 'paying down your own debt' : 'sent to your wallet'}.`,
  )
  if (blocked) return blocked

  // 7) One self-advancing card, everything shown — signing is the confirmation.
  const usd = valueUsd !== null ? ` (≈$${valueUsd.toFixed(2)})` : ''
  let summary: string
  let detail: string
  if (op === 'withdraw') {
    const remaining =
      !params.max && supplyPos!.withdrawable ? ` — ~${(Number(supplyPos!.withdrawable) - Number(params.amount)).toFixed(4)} ${token} stays in the pool earning` : ''
    summary = `Withdraw ${amountText}${usd} from Aave v4 ${picked.spokeName} back to your wallet`
    detail = `— The funds land in ${walletAddress}${remaining}.`
  } else if (op === 'borrow') {
    const apy = picked.borrowApyPct !== null ? `${picked.borrowApyPct.toFixed(2)}% borrow APY` : "the pool's live borrow APY"
    summary = `Borrow ${amountText}${usd} from Aave v4 ${picked.spokeName} against your collateral — ${apy}`
    detail = `— The borrowed ${token} lands in ${walletAddress}; interest accrues until you repay.${hfLine}`
  } else {
    const remaining =
      !params.max && debtPos!.debt ? ` — ~${(Number(debtPos!.debt) - Number(params.amount)).toFixed(4)} ${token} debt remains` : params.max ? ' — clears the debt in full (the build quotes a hair over for interest accrual; the contract takes only what’s owed)' : ''
    summary = `Repay ${amountText}${usd} on Aave v4 ${picked.spokeName}`
    detail = `— Pays down your own debt${remaining}.`
  }
  const stepsNote =
    guard.steps.length > 1
      ? `Sign the ${token} approval in the card below, and the ${op} appears automatically once it confirms — nothing to retype.`
      : 'One signature in the card below sends it.'
  const warns = [...guard.warnings, ...(hfWarning ? [hfWarning] : [])].map((w) => `⚠️ ${w}`).join('\n')
  return NextResponse.json({
    reply:
      `🔏 ${summary}\n` +
      `— Pool: ${picked.spokeName} spoke \`${picked.spokeAddress}\` · ${token} \`${picked.currency}\` (from Aave's official reserve list)\n` +
      `${detail}\n` +
      `${stepsNote}${warns ? `\n${warns}` : ''}`,
    txChain: { summary, steps: guard.steps },
    buildPath: 'native-aave-op',
    guardrails,
    workingContext: {
      v: 1 as const,
      age: 0,
      ...(ctx?.scope ? { scope: ctx.scope } : {}),
      ...(ctx?.offers ? { offers: ctx.offers } : {}),
      pending: aaveOpPending(params, picked.spokeName, summary),
    } satisfies WorkingContext,
  })
}

// ── Swap intent ───────────────────────────────────────────────────────────────

/**
 * Resolve a swap intent into a guardrailed, signable action — Yeetful's NATIVE
 * transaction tool (no service needs to be shortlisted). Venue-pure builds:
 * 'uniswap' → on-chain SwapRouter02 tx (txRequest → SendTxButton, approve to
 * SwapRouter02 attached when allowance is short); 'cow' → EIP-712 order
 * (orderRequest → SignOrderButton). Amounts convert to atoms via the token's
 * real decimals, never model-guessed. Refuses cleanly on unknown tokens or
 * ambiguous asks; guardrail blocks surface with their reasons and the
 * artifact is withheld. The user signs — funds never touch Yeetful.
 */
async function prepareSwapTurn(intent: SwapIntent, walletAddress: string | undefined, venue: 'uniswap' | 'cow' = 'cow', ctx?: WorkingContext, trace: (event: unknown) => void = () => {}, chainId: number = DEFAULT_CHAIN_ID) {
  const chain = chainById(chainId) ?? chainById(DEFAULT_CHAIN_ID)!
  chainId = chain.id
  // Warm the chain's dynamic token map (official Uniswap list) so UNI/AAVE/
  // AAPL/… resolve — not just the hand-pinned tokens (RR14). Cached 24h per
  // chain; never throws.
  await ensureTokenList(chainId)
  if (!walletAddress) {
    trace({ type: 'note', level: 'info', label: 'no wallet connected — asking to connect before building' })
    return NextResponse.json({
      reply:
        '🔄 Connect your wallet to swap — you sign the transaction yourself, so it has to be built for your address.',
      connectWallet: true,
    })
  }
  // Dollar-denominated asks ("swap $1 worth of ETH for USDG", "buy $5 of
  // AAPL"): resolve the $ amount into a token amount BEFORE the gate below,
  // via the same venue quoters the build uses (lib/usd-probe.ts). A "buy $X"
  // with no spend token named spends the chain's primary stable.
  if (!intent.problem && intent.sellAmountUsd && !intent.sellAmountHuman && intent.buyToken) {
    const buySym = intent.buyToken.toUpperCase()
    if (!intent.sellToken) {
      const stable = primaryStable(chainId)
      if (stable) intent = { ...intent, sellToken: stable.symbol }
    }
    if (intent.sellToken) {
      const sellSym = intent.sellToken.toUpperCase()
      const dec = tokenDecimals(intent.sellToken, chainId)
      if (dec === null) {
        trace({ type: 'note', level: 'warn', label: `unknown token “${intent.sellToken}” on ${chain.name} — no build` })
        return NextResponse.json({
          reply: `🔄 I don't know the token “${intent.sellToken}” on ${chain.name} — use a known symbol (${Object.keys(chain.tokens).filter((s) => s !== 'ETH').join(', ')}, …).`,
        })
      }
      const probe = await usdPerToken(chainId, intent.sellToken)
      const amountHuman = probe ? usdToTokenAmount(Number(intent.sellAmountUsd), probe.usd, dec) : null
      if (!amountHuman) {
        trace({ type: 'note', level: 'warn', label: `couldn't price ${sellSym} on ${chain.name} to size a $${intent.sellAmountUsd} ask — asking for a token amount` })
        return NextResponse.json({
          reply: `🔄 I couldn't price ${sellSym} on ${chain.name} to size a $${intent.sellAmountUsd} swap — say a token amount instead, e.g. “swap 0.01 ${sellSym} for ${buySym}”.`,
        })
      }
      trace({ type: 'status', label: `native swap layer: $${intent.sellAmountUsd} of ${sellSym} ≈ ${amountHuman} ${sellSym} (priced via ${probe!.via})` })
      intent = { ...intent, sellAmountHuman: amountHuman }
    }
  }

  if (intent.problem || !intent.sellToken || !intent.buyToken || !intent.sellAmountHuman) {
    trace({ type: 'status', label: 'native swap layer: ask under-specified — asking for the amount and pair' })
    return NextResponse.json({ reply: `🔄 ${intent.problem ?? 'Say the amount and pair — e.g. “swap 100 USDC for WETH” or “swap $5 of ETH for USDG”.'}` })
  }

  // Known-symbol hint, per chain (Robinhood has USDG/USDe, not USDC/DAI).
  const knownSymbols = Object.keys(chain.tokens).filter((s) => s !== 'ETH').join(', ')
  const sellDec = tokenDecimals(intent.sellToken, chainId)
  if (sellDec === null) {
    trace({ type: 'note', level: 'warn', label: `unknown token “${intent.sellToken}” on ${chain.name} — no build` })
    return NextResponse.json({
      reply: `🔄 I don't know the token “${intent.sellToken}” on ${chain.name} — use a known symbol (${knownSymbols}, …) or a 0x address via the API.`,
    })
  }
  const sellAmount = humanToAtoms(intent.sellAmountHuman, sellDec)
  if (!sellAmount) {
    trace({ type: 'note', level: 'warn', label: `“${intent.sellAmountHuman}” exceeds ${intent.sellToken.toUpperCase()}'s ${sellDec} decimals — no build` })
    return NextResponse.json({
      reply: `🔄 “${intent.sellAmountHuman}” has more decimal places than ${intent.sellToken.toUpperCase()} supports (${sellDec}).`,
    })
  }
  // ── Robinhood funding plan ── an unfunded buy on Robinhood Chain is not a
  // dead end when the money is sitting on Base, Ethereum, or Arbitrum:
  // LiFi routes USDC → USDG (and a gas leg → native ETH) directly onto
  // Robinhood Chain in seconds from all three origins (Base probed live
  // 2026-07-15, Ethereum + Arbitrum 2026-07-17), so instead of building a
  // swap the wallet can't pay for, offer to convert whichever origin's
  // USDC covers it — the user's pick compiles into a multi-step JOB
  // (fund → wait → buy) via the chips' resume messages (lib/jobs.ts
  // parseRobinhoodFunding). RPC trouble falls through to the normal
  // build, which fails closed on its own.
  const rhStable = chainId === ROBINHOOD_CHAIN_ID && intent.mode !== 'limit' ? primaryStable(chainId) : null
  if (rhStable && intent.sellToken.toUpperCase() === rhStable.symbol.toUpperCase()) {
    try {
      const shortfall = await readFundingShortfall(walletAddress)
      if (shortfall.usdgAtoms < BigInt(sellAmount)) {
        const buyUsd = Number(Number(intent.sellAmountHuman).toFixed(2)) // USDG is the $1 unit of account
        const buySym = intent.buyToken.toUpperCase()
        const holdingUsd = Number(shortfall.usdgAtoms) / 10 ** rhStable.decimals
        const includeGas = !shortfall.hasGas
        const needUsd = fundingNeedUsd(buyUsd, includeGas)
        const chips = planRobinhoodFundingChips({
          origins: shortfall.origins,
          needUsd,
          gasIncluded: includeGas,
          followup: `buy $${buyUsd} of ${buySym}`,
        })
        const holdingsSummary = shortfall.origins.map((o) => `~$${o.usd} of USDC on ${o.word}`).join(', ')
        if (chips) {
          const options = [...chips]
          if (options.length < 2) options.push({ label: 'Not now', resume: 'Never mind — leave my USDC where it is.' })
          trace({
            type: 'status',
            label: `funding layer claimed the turn: ${rhStable.symbol} short on ${chain.name} (holds ~$${holdingUsd.toFixed(2)}, needs $${buyUsd}) but the wallet holds ${holdingsSummary} — offering the funding plan (${includeGas ? 'gas leg included' : 'gas already covered'})`,
          })
          return NextResponse.json({
            reply:
              `🌉 You don't have enough ${rhStable.symbol} on ${chain.name} for this yet (holding ~$${holdingUsd.toFixed(2)}, the buy needs ~$${buyUsd}) — ` +
              `but you're holding **${holdingsSummary}**. I can convert some of it${includeGas ? ', drop in a little ETH for gas,' : ''} ` +
              `and buy the ${buySym} — all in one job you sign step by step, funds arriving on ${chain.name} in seconds.`,
            clarify: { question: 'Fund it from another chain?', options: options.slice(0, 4) },
            buildPath: 'native-lifi-fund-offer',
          })
        }
        // No plan — but a shortfall claim is only honest over chains that
        // actually scanned: an unreadable origin is "unknown", never "empty".
        const unscanned = shortfall.failedOrigins.length > 0 ? ` (couldn't check ${shortfall.failedOrigins.join(' or ')})` : ''
        trace({
          type: 'note',
          level: 'warn',
          label: `funding layer: ${rhStable.symbol} short on ${chain.name} and the scanned USDC (${holdingsSummary || 'none found'})${unscanned} can't cover the ~$${needUsd} plan — honest refusal, no build`,
        })
        return NextResponse.json({
          reply:
            `🚫 This buy needs ~$${buyUsd} of ${rhStable.symbol} on ${chain.name} and the wallet holds ~$${holdingUsd.toFixed(2)} there — ` +
            `and the USDC I can see on other chains (${holdingsSummary || 'none on Base, Ethereum, or Arbitrum'}${unscanned}) isn't enough to fund it either (the plan needs ~$${needUsd}${includeGas ? ' including a gas leg' : ''}). ` +
            `Nothing was built — top up USDC on Base, Ethereum, or Arbitrum, or ${rhStable.symbol} on ${chain.name}, and ask again.`,
        })
      }
    } catch {
      /* balance reads unavailable → the normal build path below fails closed on its own */
    }
  }

  // ── Universal funding plan (same-chain swaps): a market swap whose sell
  // token the wallet can't cover offers fund-then-swap chips — the swap
  // segment compiles as a job step through the SAME venue cascade
  // (lib/swap-exec.ts). Limit orders are exempt (CoW's order book settles
  // whenever the funds arrive — being short is a feature there), Robinhood
  // Chain keeps its LiFi plan above, and a failed read falls through to the
  // venue build, whose own simulation fails closed.
  if (walletAddress && intent.mode !== 'limit' && chainId !== ROBINHOOD_CHAIN_ID && FUNDING_CHAIN_WORD[chainId]) {
    try {
      const sellSym = intent.sellToken.toUpperCase()
      const isEthSell = sellSym === 'ETH'
      const sellAddr = isEthSell ? null : resolveToken(intent.sellToken, chainId)
      const client = publicClientFor(chainId)
      if (client && (isEthSell || sellAddr)) {
        const balanceAtoms = isEthSell
          ? await client.getBalance({ address: walletAddress as `0x${string}` })
          : await client.readContract({ address: sellAddr as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [walletAddress as `0x${string}`] })
        const held = Number(balanceAtoms) / 10 ** sellDec
        // An ETH sell must also leave gas for the swap itself.
        const needTotal = Number(intent.sellAmountHuman) + (isEthSell ? (DEST_GAS_FLOOR_ETH[chainId] ?? 0.0002) : 0)
        if (held < needTotal) {
          const buySym = intent.buyToken.toUpperCase()
          const offer = await offerFundingPlan({
            user: walletAddress,
            need: {
              chainId,
              token: sellSym,
              amountHuman: Number((needTotal - held).toFixed(6)),
              followupResume: `swap ${intent.sellAmountHuman} ${sellSym} for ${buySym} on ${FUNDING_CHAIN_WORD[chainId]}`,
              actionLabel: 'the swap',
            },
            trace,
          })
          if (offer && 'insufficient' in offer) {
            return NextResponse.json({
              reply: `🔄 The swap sells ${intent.sellAmountHuman} ${sellSym} on ${chain.name} and the wallet holds ${held.toFixed(6).replace(/\.?0+$/, '') || '0'}. ${offer.insufficient}`,
            })
          }
          if (offer) return NextResponse.json({ ...offer, reply: `🌉 ${offer.reply}` })
          // null → scan/price unavailable; the venue build below fails closed
        }
      }
    } catch {
      /* balance read unavailable → the venue build below fails closed on its own */
    }
  }

  let buyAmountAtLeast: string | undefined
  if (intent.mode === 'limit') {
    if (!chain.cow) {
      // Resting limit orders are an order-book feature — CoW isn't on this
      // chain, and Uniswap v3 has no native limit orders. Honest reply.
      trace({ type: 'note', level: 'warn', label: `limit order asked on ${chain.name}, but CoW's order book isn't there — no build` })
      return NextResponse.json({
        reply: `🔄 Resting limit orders run on CoW's order book, which isn't live on ${chain.name}. I can build a market swap there instead — or place the limit order on Base/Ethereum/Arbitrum.`,
      })
    }
    const buyDec = tokenDecimals(intent.buyToken, chainId)
    if (buyDec === null) {
      trace({ type: 'note', level: 'warn', label: `unknown token “${intent.buyToken}” on ${chain.name} — no build` })
      return NextResponse.json({
        reply: `🔄 I don't know the token “${intent.buyToken}” on ${chain.name} — use a known symbol (${knownSymbols}, …).`,
      })
    }
    buyAmountAtLeast = humanToAtoms(intent.buyAmountAtLeastHuman ?? '', buyDec) ?? undefined
    if (!buyAmountAtLeast) {
      trace({ type: 'note', level: 'warn', label: `couldn't read the limit price “${intent.buyAmountAtLeastHuman}” — no build` })
      return NextResponse.json({ reply: `🔄 Couldn't read the limit price “${intent.buyAmountAtLeastHuman}”.` })
    }
  }

  // ── Uniswap venue: on-chain SwapRouter02 transaction (market swaps only —
  //    resting limit orders are an order-book feature, so those stay on CoW
  //    with a note). Uniswap-pure build; cross-app guardrails inside.
  if (venue === 'uniswap' && (intent.mode ?? 'swap') === 'swap') {
    trace({ type: 'select', service: 'Uniswap (native venue)', endpoint: `quote → SwapRouter02 tx build on ${chain.name}`, priceUsd: 0, reason: 'native swap layer — Yeetful builds the tx deterministically, guardrails before anything is offered' })
    try {
      const uni = await buildUniswapSwap({
        sellToken: intent.sellToken,
        buyToken: intent.buyToken,
        amountHuman: intent.sellAmountHuman,
        from: walletAddress,
        chainId,
      })
      if (uni.blocked) {
        const reasons = uni.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ')
        trace({ type: 'note', level: 'warn', label: `guardrails REFUSED the Uniswap swap: ${(reasons || 'a safety check failed.').slice(0, 200)}` })
        return NextResponse.json({
          reply: `🚫 Swap built but refused by your guardrails: ${reasons || 'a safety check failed.'}`,
          guardrails: uni.guardrails,
          blocked: true,
        })
      }
      const warns = uni.guardrails.checks.filter((c) => !c.ok && c.level === 'warn').map((c) => `⚠️ ${c.note}`)
      if (uni.approveTx) {
        // Two-step: ONE self-advancing card carries approve AND swap — the
        // user never re-sends the message (step 1's green "Confirmed" read as
        // done; first-time users walked away without swapping). The swap step
        // is re-quoted server-side when the approval confirms (refresh
        // recipe) — prices move while approvals mine.
        const sell = intent.sellToken.toUpperCase()
        const buy = intent.buyToken.toUpperCase()
        trace({ type: 'status', label: `guardrails passed — approve → swap card built (${intent.sellAmountHuman} ${sell} → ${buy}), awaiting signature` })
        return NextResponse.json({
          reply: `🔏 ${uni.summary}\n🔗 Two steps in the card below — sign the ${sell} approval, and the swap appears automatically once it confirms (re-quoted fresh). Nothing to retype.${warns.length ? `\n${warns.join('\n')}` : ''}`,
          txChain: {
            summary: uni.summary,
            steps: [
              { label: 'approve', title: `Approve ${sell} to Uniswap's SwapRouter02`, tx: uni.approveTx },
              { label: 'swap', title: `Swap ${intent.sellAmountHuman} ${sell} → ${buy}`, tx: uni.swapTx, validUntil: uni.validUntil },
            ],
            refresh: {
              kind: 'uniswap-swap',
              stepIndex: 1,
              params: { sellToken: intent.sellToken, buyToken: intent.buyToken, amountHuman: intent.sellAmountHuman, chainId: String(chainId) },
            },
          },
          buildPath: 'native-swap-uniswap',
          guardrails: uni.guardrails,
          // Invariant #11: the artifact is a pending action — "make it 2" /
          // "cancel that" next turn resolve against this, not re-parsed prose.
          workingContext: swapWorkingContext(intent, 'uniswap', ctx, chainId),
        })
      }
      trace({ type: 'status', label: `guardrails passed — swap tx built (${intent.sellAmountHuman} ${intent.sellToken.toUpperCase()} → ${intent.buyToken.toUpperCase()} on ${chain.name}), awaiting signature` })
      // One step, but still a CHAIN: SendTxChain's deadline watch re-quotes
      // before validUntil lapses. A bare txRequest has no refresh recipe —
      // clicked after the deadline, the wallet's gas estimate reverts and the
      // fee fallback paints the 2^50 sentinel (the 2026-07-14 AAPL incident).
      return NextResponse.json({
        reply: `🔏 ${uni.summary}${warns.length ? `\n${warns.join('\n')}` : ''}`,
        txChain: {
          summary: uni.summary,
          steps: [
            { label: 'swap', title: `Swap ${intent.sellAmountHuman} ${intent.sellToken.toUpperCase()} → ${intent.buyToken.toUpperCase()}`, tx: uni.swapTx, validUntil: uni.validUntil },
          ],
          refresh: {
            kind: 'uniswap-swap',
            stepIndex: 0,
            params: { sellToken: intent.sellToken, buyToken: intent.buyToken, amountHuman: intent.sellAmountHuman, chainId: String(chainId) },
          },
        },
        buildPath: 'native-swap-uniswap',
        guardrails: uni.guardrails,
        workingContext: swapWorkingContext(intent, 'uniswap', ctx, chainId),
      })
    } catch (err) {
      // v3 has no pool → fall through to the guarded v4 layer where the chain
      // carries one (Robinhood's tokenized stocks are v4-only). Pairs v3 CAN
      // fill never reach here — v4 is strictly the fallback.
      if (err instanceof NoV3PoolError && chain.uniswapV4) {
        trace({ type: 'status', label: `no v3 pool for the pair on ${chain.name} — trying the Uniswap v4 fallback (tokenized-stock pools live there)` })
        return await prepareUniswapV4Turn(intent, walletAddress, chainId, ctx, trace)
      }
      const msg = err instanceof Error ? err.message : 'quote failed'
      trace({ type: 'note', level: 'warn', label: `Uniswap build failed: ${msg.slice(0, 200)}` })
      return NextResponse.json({ reply: `🔄 Couldn't build the Uniswap swap: ${msg}` })
    }
  }

  const cowNote =
    venue === 'uniswap' && intent.mode === 'limit'
      ? '\n🔀 Resting limit orders run on the CoW order book (fee comes from surplus when filled) — Uniswap v3 has no native limit orders.'
      : ''
  if (cowNote) {
    trace({ type: 'note', level: 'info', label: 'limit order re-routed to the CoW order book — Uniswap v3 has no native resting orders' })
  }

  trace({ type: 'select', service: 'CoW Protocol (native venue)', endpoint: `quote → EIP-712 ${intent.mode === 'limit' ? 'limit ' : ''}order build on ${chain.name}`, priceUsd: 0, reason: 'native swap layer — Yeetful builds the order deterministically, guardrails before anything is offered' })
  try {
    const built = await buildGuardrailedOrder({
      mode: intent.mode ?? 'swap',
      chainId,
      sellToken: intent.sellToken,
      buyToken: intent.buyToken,
      sellAmount,
      buyAmountAtLeast,
      from: walletAddress,
    })
    if (built.blocked || !built.artifact || built.artifact.kind !== 'eip712-order') {
      const reasons = built.guardrails.checks
        .filter((c) => !c.ok && c.level === 'block')
        .map((c) => c.note)
        .join(' ')
      trace({ type: 'note', level: 'warn', label: `guardrails REFUSED the CoW order: ${(reasons || 'a safety check failed.').slice(0, 200)}` })
      return NextResponse.json({
        reply: `🚫 Order built but refused by your guardrails: ${reasons || 'a safety check failed.'}`,
        guardrails: built.guardrails,
        blocked: true,
      })
    }
    const warns = built.guardrails.checks
      .filter((c) => !c.ok && c.level === 'warn')
      .map((c) => `⚠️ ${c.note}`)
    trace({ type: 'status', label: `guardrails passed — EIP-712 ${intent.mode === 'limit' ? 'limit ' : ''}order built (${intent.sellAmountHuman} ${intent.sellToken.toUpperCase()} → ${intent.buyToken.toUpperCase()} on ${chain.name}), awaiting signature` })
    return NextResponse.json({
      reply: `🔏 ${built.summary}${cowNote}${warns.length ? `\n${warns.join('\n')}` : ''}`,
      orderRequest: built.artifact.order,
      buildPath: 'native-swap-cow',
      guardrails: built.guardrails,
      // Invariant #11: the order awaits SignOrderButton — write it as the
      // pending action so amount amendments and cancels resolve against it.
      workingContext: swapWorkingContext(intent, 'cow', ctx, chainId),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'quote failed'
    trace({ type: 'note', level: 'warn', label: `CoW order build failed: ${msg.slice(0, 200)}` })
    return NextResponse.json({ reply: `🔄 Couldn't build the swap: ${msg}` })
  }
}

/**
 * The Uniswap v4 fallback turn — reached ONLY when v3 threw NoV3PoolError on
 * a chain that carries a v4 deployment (lib/chains.ts uniswapV4). Same trust
 * shape as v3: deterministic build, calldata guard inside the builder (a
 * block-level check withholds the artifact), one self-advancing SendTxChain
 * for the Permit2 approvals + swap, and the swap step re-quoted at advance
 * time via /api/tx/refresh.
 */
async function prepareUniswapV4Turn(
  intent: SwapIntent,
  walletAddress: string,
  chainId: number,
  ctx: WorkingContext | undefined,
  trace: (event: unknown) => void,
) {
  const chain = chainById(chainId)!
  trace({ type: 'select', service: 'Uniswap v4 (native venue)', endpoint: `V4 Quoter → Universal Router build on ${chain.name}`, priceUsd: 0, reason: 'v4 fallback — the pair has no v3 pool; Yeetful builds + verifies the router calldata deterministically' })
  try {
    const uni = await buildUniswapV4Swap({
      sellToken: intent.sellToken!,
      buyToken: intent.buyToken!,
      amountHuman: intent.sellAmountHuman!,
      from: walletAddress,
      chainId,
    })
    if (uni.blocked) {
      const reasons = uni.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ')
      trace({ type: 'note', level: 'warn', label: `guardrails REFUSED the Uniswap v4 swap: ${(reasons || 'a safety check failed.').slice(0, 200)}` })
      return NextResponse.json({
        reply: `🚫 Swap built but refused by your guardrails: ${reasons || 'a safety check failed.'}`,
        guardrails: uni.guardrails,
        blocked: true,
      })
    }
    const warns = uni.guardrails.checks.filter((c) => !c.ok && c.level === 'warn').map((c) => `⚠️ ${c.note}`)
    const sell = intent.sellToken!.toUpperCase()
    const buy = intent.buyToken!.toUpperCase()
    // Approvals in place → ONE swap step, still a chain (never a bare
    // txRequest): the refresh recipe + validUntil put it under SendTxChain's
    // deadline watch, so a card left unsigned past the ~600s deadline is
    // re-quoted instead of reverting at the wallet's gas estimate (the
    // 2026-07-14 AAPL $32M-fee incident on Robinhood Chain).
    trace({
      type: 'status',
      label:
        uni.steps.length === 1
          ? `guardrails passed — v4 swap tx built (${intent.sellAmountHuman} ${sell} → ${buy} on ${chain.name}), awaiting signature`
          : `guardrails passed — ${uni.steps.length}-step v4 card built (${intent.sellAmountHuman} ${sell} → ${buy}, Permit2 approvals + swap), awaiting signature`,
    })
    return NextResponse.json({
      reply:
        uni.steps.length === 1
          ? `🔏 ${uni.summary}${warns.length ? `\n${warns.join('\n')}` : ''}`
          : `🔏 ${uni.summary}\n🔗 ${uni.steps.length} steps in the card below — v4 pulls funds through Permit2, so the approvals come first and the swap appears automatically once they confirm (re-quoted fresh). Nothing to retype.${warns.length ? `\n${warns.join('\n')}` : ''}`,
      txChain: {
        summary: uni.summary,
        steps: uni.steps,
        refresh: {
          kind: 'uniswap-v4-swap',
          stepIndex: uni.steps.length - 1,
          params: { sellToken: intent.sellToken!, buyToken: intent.buyToken!, amountHuman: intent.sellAmountHuman!, chainId: String(chainId) },
        },
      },
      buildPath: 'native-swap-uniswap-v4',
      guardrails: uni.guardrails,
      // Invariant #11: pending action — "make it 2" / "cancel" resolve here.
      workingContext: swapWorkingContext(intent, 'uniswap', ctx, chainId),
    })
  } catch (err) {
    if (err instanceof NoV4PoolError) {
      trace({ type: 'note', level: 'warn', label: `no v4 pool either — the pair isn't on Uniswap on ${chain.name}` })
      return NextResponse.json({
        reply: `🔄 No Uniswap v3 or v4 pool on ${chain.name} can fill ${intent.sellToken!.toUpperCase()} → ${intent.buyToken!.toUpperCase()} for this amount.`,
      })
    }
    if (err instanceof GatedV4PoolError) {
      // The pool quotes but can never execute from a direct UR call
      // (Robinhood's stock pools settle only through their backend-signed
      // DexAggregator). LiFi wraps that venue — fall through to the LiFi
      // settlement layer instead of refusing. The honest refusal survives
      // ONLY for the case where LiFi can't fill either (prepareLifiTurn).
      trace({ type: 'note', level: 'info', label: `v4 pool is venue-gated (quotes but a direct swap can't fill) — routing to the LiFi settlement venue (${err.message.slice(0, 120)})` })
      return await prepareLifiTurn(intent, walletAddress, chainId, ctx, trace, err.message)
    }
    const msg = err instanceof Error ? err.message : 'quote failed'
    trace({ type: 'note', level: 'warn', label: `Uniswap v4 build failed: ${msg.slice(0, 200)}` })
    return NextResponse.json({ reply: `🔄 Couldn't build the Uniswap swap: ${msg}` })
  }
}

/**
 * The LiFi settlement turn — reached ONLY when v4 threw GatedV4PoolError:
 * the pool quotes on the public Quoter but every real fill settles through
 * the chain's own venue (Robinhood's backend-signed DexAggregator), which
 * LiFi wraps. Different trust shape, same fail-closed posture: the router
 * address is pinned, the approval is exact-amount, LiFi's price is checked
 * against our own independent v4 quote, and the swap is simulated before
 * anything is offered (lib/lifi-venue.ts). The chain carries a 0.20%
 * Yeetful fee as its own visible transfer step (lib/fees.ts).
 */
async function prepareLifiTurn(
  intent: SwapIntent,
  walletAddress: string,
  chainId: number,
  ctx: WorkingContext | undefined,
  trace: (event: unknown) => void,
  gateReason: string,
) {
  const chain = chainById(chainId)!
  trace({ type: 'select', service: 'LiFi (native settlement venue)', endpoint: `li.quest quote → pinned-router build on ${chain.name}`, priceUsd: 0, reason: 'the pool only fills through the chain\'s own venue — LiFi wraps it; Yeetful pins the router, cross-checks the price on-chain, and simulates before offering' })
  try {
    const built = await buildLifiSwap({
      sellToken: intent.sellToken!,
      buyToken: intent.buyToken!,
      amountHuman: intent.sellAmountHuman!,
      from: walletAddress,
      chainId,
    })
    if (built.blocked) {
      const reasons = built.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ')
      trace({ type: 'note', level: 'warn', label: `guardrails REFUSED the LiFi swap: ${(reasons || 'a safety check failed.').slice(0, 200)}` })
      return NextResponse.json({
        reply: `🚫 Swap built but refused by your guardrails: ${reasons || 'a safety check failed.'}`,
        guardrails: built.guardrails,
        blocked: true,
      })
    }
    const warns = built.guardrails.checks.filter((c) => !c.ok && c.level === 'warn').map((c) => `⚠️ ${c.note}`)
    const sell = intent.sellToken!.toUpperCase()
    const buy = intent.buyToken!.toUpperCase()
    trace({ type: 'status', label: `guardrails passed — ${built.steps.length}-step LiFi card built (${intent.sellAmountHuman} ${sell} → ${buy} through ${chain.name}'s own venue), awaiting signature` })
    return NextResponse.json({
      reply: `🔏 ${built.summary}\n🔗 This pair only settles through ${chain.name}'s own swap venue, so the trade routes via LiFi — Yeetful pinned the settlement contract, price-checked the fill against its own on-chain quote, and dry-ran it. The card below carries every step${built.feeHuman !== '0' ? `, including the ${built.feeHuman} ${sell} Yeetful fee as its own visible transfer` : ''}.${warns.length ? `\n${warns.join('\n')}` : ''}`,
      txChain: {
        summary: built.summary,
        steps: built.steps,
        refresh: {
          kind: 'lifi-swap',
          stepIndex: built.swapStepIndex,
          params: { sellToken: intent.sellToken!, buyToken: intent.buyToken!, amountHuman: intent.sellAmountHuman!, chainId: String(chainId) },
        },
      },
      buildPath: 'native-swap-lifi',
      guardrails: built.guardrails,
      // Invariant #11: pending action — "make it 2" / "cancel" resolve here.
      workingContext: swapWorkingContext(intent, 'lifi', ctx, chainId),
    })
  } catch (err) {
    if (err instanceof NoLifiRouteError) {
      // LiFi can't fill either — the ONE case that keeps the honest refusal.
      trace({ type: 'note', level: 'warn', label: `LiFi has no route either — honest refusal stands (${err.message.slice(0, 160)})` })
      return NextResponse.json({ reply: `🚫 ${gateReason} LiFi couldn't route it through that venue either — nothing was built, no signature needed.` })
    }
    const msg = err instanceof Error ? err.message : 'quote failed'
    trace({ type: 'note', level: 'warn', label: `LiFi build failed: ${msg.slice(0, 200)}` })
    return NextResponse.json({ reply: `🔄 Couldn't build the venue-settled swap: ${msg}` })
  }
}

// ── Wallet mode ──────────────────────────────────────────────────────────────

/** Probe every endpoint, derive an unsigned payment for the user's wallet. */
async function planWalletPayments(
  message: string,
  inference: McpServer,
  dataServers: McpServer[],
  mcpDataServers: McpServer[],
  listedOnly: McpServer[],
  walletAddress: string,
  smart: PlannableEndpoint[],
  notes: string[],
  history: ConversationTurn[] = [],
  workingContext?: WorkingContext,
) {
  const plan: PlannedCall[] = []

  // Policy gate at PLAN time: never ask the wallet to sign a payment the
  // grant forbids. (Until now wallet mode relied purely on the human signing
  // each payment — the dashboard toggles only gated burner mode. Denials are
  // ledgered so the audit trail shows them.)
  const owner = await getSessionAddress()
  const grant = owner ? await getActiveGrant(owner) : null
  const policy: GrantPolicy | null = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const spentTotal = grant ? await spentTotalUsd(grant.id) : 0
  let plannedUsd = 0
  const planGate = async (name: string, host: string, price: number): Promise<string | null> => {
    if (!policy || !grant) return null
    const violation = grantViolation(policy, host, price, spentToday + plannedUsd, spentTotal + plannedUsd)
    if (violation) {
      await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: name, amountUsd: 0, ok: false, note: violation })
      return violation
    }
    plannedUsd += price
    return null
  }

  for (const ds of dataServers) {
    const dsViolation = await planGate(ds.name, hostOf(ds.endpoint!), Number(ds.priceUsd ?? '0.01'))
    if (dsViolation) {
      notes.push(`${ds.name} was blocked by your spend policy (${dsViolation}) — manage it on the Dashboard.`)
      continue
    }
    const url = new URL(ds.endpoint!)
    url.searchParams.set(ds.queryParam ?? 'q', message)
    const challenge = await getChallenge(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    plan.push({
      id: `data:${ds.slug}`,
      role: 'data',
      name: ds.name,
      host: hostOf(ds.endpoint!),
      priceUsd: ds.priceUsd ?? '0.01',
      endpoint: ds.endpoint!,
      url: url.toString(),
      prepared: challenge ? derivePayment(challenge, walletAddress) : null,
    })
  }

  // MCP data services: an x402-gated tools/call POST (flat-priced, like the MCP
  // inference path, so the plan-time body matches the execute-time body).
  for (const ds of mcpDataServers) {
    const dsViolation = await planGate(ds.name, hostOf(ds.endpoint!), Number(ds.priceUsd ?? '0.01'))
    if (dsViolation) {
      notes.push(`${ds.name} was blocked by your spend policy (${dsViolation}) — manage it on the Dashboard.`)
      continue
    }
    const reqd = mcpDataRequest(ds)
    const challenge = await getChallenge(reqd.url, {
      method: reqd.method,
      headers: reqd.headers,
      body: reqd.body,
    })
    plan.push({
      id: `mcpdata:${ds.slug}`,
      role: 'data',
      name: ds.name,
      host: hostOf(ds.endpoint!),
      priceUsd: ds.priceUsd ?? '0.01',
      endpoint: ds.endpoint!,
      url: reqd.url,
      method: reqd.method,
      body: reqd.body,
      mcp: true,
      prepared: challenge ? derivePayment(challenge, walletAddress) : null,
    })
  }

  // Smart calls: the planner (house-paid) picks endpoints for selected
  // directory services; the user's wallet signs the actual data payments.
  const smartServed = new Set<string>()
  if (smart.length > 0) {
    try {
      const { picks, dropped, clarify } = await planSmartPicks(inference, message, smart, history, workingContext, walletAddress)
      if (clarify) {
        // RR17: ambiguous money/governance target — ask, don't charge for a
        // half-understood turn. The pick resumes as a normal next message.
        return NextResponse.json({ reply: `🤔 ${clarify.question}`, clarify, notes })
      }
      for (const d of dropped) notes.push(`Skipped ${d.serverName} — another picked service covers the same capability; kept the better-rated/cheaper one.`)
      if (picks.length === 0) {
        const considered = [...new Set(smart.map((e) => e.serverName))].join(', ')
        notes.push(`The planner reviewed ${considered} but judged none of their endpoints relevant to this message.`)
      }
      const byId = new Map(smart.map((e) => [e.id, e]))
      for (const pick of picks) {
        const ep = byId.get(pick.endpointId)!
        const built = buildSmartRequest(ep, pick.params, { userAddress: walletAddress })
        if ('error' in built) {
          notes.push(`${ep.serverName}: planned call skipped — ${built.error}.`)
          continue
        }
        const { request } = built
        const smartViolation = await planGate(ep.serverName, hostOf(request.url), Number(ep.priceUsd))
        if (smartViolation) {
          notes.push(`${ep.serverName} was blocked by your spend policy (${smartViolation}) — manage it on the Dashboard.`)
          continue
        }
        const challenge = await getChallenge(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
        })
        smartServed.add(ep.serverSlug)
        plan.push({
          id: `smart:${ep.id}`,
          role: 'data',
          name: ep.serverName,
          host: hostOf(request.url),
          priceUsd: ep.priceUsd,
          endpoint: ep.url,
          url: request.url,
          method: request.method,
          body: request.body,
          prepared: challenge ? derivePayment(challenge, walletAddress) : null,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      console.warn('smart planning failed (continuing without):', msg)
      notes.push(`Endpoint planning failed (${truncate(msg, 120)}) — directory services skipped this turn.`)
    }
  }
  const stillListedOnly = listedOnly.filter((s) => !smartServed.has(s.slug))

  // Inference 402 probe. MCP gateways price flat (body-independent); http
  // gateways price by request size, so the probe carries the real model and
  // the execute-time prompt is capped into the same flat tier (see capPrompt).
  const infViolation = await planGate(
    inference.name,
    hostOf(inference.endpoint!),
    Number(inference.priceUsd ?? '0.01'),
  )
  if (infViolation) {
    return NextResponse.json({
      reply: `🚫 Your spend policy blocked the inference call (${inference.name}: ${infViolation}). Adjust it on your **Dashboard** and try again.`,
      blocked: true,
      notes,
    })
  }
  const infProtocol = inferenceProtocolOf(inference)
  const infTool = inference.tool ?? (infProtocol === 'http' ? 'openai/gpt-4o-mini' : 'ask_claude')
  // House synthesizer never 402s — skip the probe, nothing to sign.
  const infChallenge = isHouseInference(inference)
    ? null
    : await getChallenge(inference.endpoint!, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: infProtocol === 'http' ? inferenceBody('http', infTool, 'probe') : dummyMcpBody(infTool),
      })
  plan.push({
    id: `inference:${inference.slug}`,
    role: 'inference',
    name: inference.name,
    host: hostOf(inference.endpoint!),
    priceUsd: inference.priceUsd ?? '0.01',
    endpoint: inference.endpoint!,
    tool: infTool,
    protocol: infProtocol,
    prepared: infChallenge ? derivePayment(infChallenge, walletAddress) : null,
  })

  // Signing requests the browser needs (one per call that requires payment).
  const payments = plan
    .filter((c) => c.prepared)
    .map((c) => ({
      id: c.id,
      name: c.name,
      host: c.host,
      priceUsd: c.priceUsd,
      signing: c.prepared!.signing as SigningRequest,
    }))

  return NextResponse.json({
    phase: 'awaiting-signatures',
    message,
    plan,
    payments,
    listedOnly: stillListedOnly,
    notes,
    // Grounds "what can I do?" in the connected set when synthesis runs in
    // phase 2 (executeWithSignatures). Echoed back by the client, like `notes`.
    capabilities: capabilitiesBlock([inference, ...dataServers, ...mcpDataServers, ...listedOnly], smart),
  })
}

/** Phase 2: attach the wallet's signatures, run the paid calls, answer. */
async function executeWithSignatures(
  message: string,
  plan: PlannedCall[],
  signatures: Record<string, string>,
  listedOnly: McpServer[],
  notes: string[] = [],
  history: ConversationTurn[] = [],
  /** The plan phase's turnId — so wallet settlements persist to the live feed
   *  under the same turn as the plan trace (grouped). Falls back to a fresh id. */
  turnId: string = newTurnId(),
  workingContext?: WorkingContext,
  /** The user's connected wallet — answer-prompt context ("my address").
   *  Falls back to the SIWE session address below. */
  walletAddress?: string,
  /** Connected-agent capability summary from phase 1, so meta-questions
   *  ("what can I do here?") stay grounded when the answer is synthesized here. */
  capabilities = '',
) {
  if (!message.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  const receipts: Receipt[] = []
  const contextBlocks: string[] = []
  let carriedEntities: EntityRef[] = []
  let portfolioCard: PortfolioDisplay | undefined
  // Balance-shaped tool failures feed the generic funding fallback after the
  // data loop — ANY MCP's "insufficient funds" can end in chips, not a wall.
  const balanceFailures: { name: string; note: string }[] = []
  const inferenceCall = plan.find((c) => c.role === 'inference')

  // Persist each wallet-mode receipt to the live routing feed (route_trace_lines)
  // — the burner path already does this via the SSE chokepoint; wallet mode is a
  // separate request, so do it here. Fire-and-forget; never fails the turn.
  let traceSeq = 0
  const pushReceipt = (r: Receipt) => {
    receipts.push(r)
    recordTraceLine(turnId, traceSeq++, { type: 'receipt', receipt: r }, 'wallet')
  }

  // Ledger wallet-mode payments too (the user pays the seller directly; we
  // record the receipt under their active grant so the dashboard sees it).
  // No grant → no ledger, same as before.
  const owner = await getSessionAddress()
  const grant = owner ? await getActiveGrant(owner) : null
  const ledger = (c: PlannedCall, ok: boolean, txHash?: string, note?: string) => {
    if (!grant) return
    void recordLedger({
      grantId: grant.id, orgId: grant.orgId ?? undefined,
      host: c.host,
      serviceName: c.name,
      amountUsd: ok ? Number(c.priceUsd) || 0 : 0,
      ok,
      txHash,
      note: note ?? (ok ? 'settled' : 'call failed'),
    }).catch(() => {})
  }

  // Data calls first → gather context. Smart calls carry method/body.
  for (const c of plan.filter((c) => c.role === 'data')) {
    try {
      // Free endpoints (our non-gated MCPs) plan with prepared=null — nothing
      // was signed because nothing 402s. Call them plainly, no payment header.
      const header = c.prepared ? paymentHeaderFor(c, signatures) : null
      const init: RequestInit = {
        method: c.method ?? 'GET',
        headers: {
          accept: c.mcp ? 'application/json, text/event-stream' : 'application/json',
          ...(c.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(c.body ? { body: c.body } : {}),
      }
      const res = header ? await fetchWithPaymentHeader(c.url!, init, header) : await fetch(c.url!, init)
      if (!res.ok) throw new Error(await failureReason(res))
      const data = c.mcp
        ? parseMcpDataResult(res.headers.get('content-type') ?? '', await res.text())
        : await res.json()
      carriedEntities = extractEntities(data, carriedEntities)
      // Display layer: a portfolio-shaped return renders as a rich card next
      // to the synthesized text (latest read wins — freshest data).
      const card = portfolioFromToolResult(data)
      if (card) portfolioCard = card
      contextBlocks.push(`### ${c.name}\n${compactForSynthesis(data, 3500)}`)
      if (card) contextBlocks.push('NOTE: this portfolio is ALSO rendered as a rich visual card right below your reply — write ONE short summary sentence (total + notable point); do NOT repeat the holdings/table in text.')
      const txHash = decodeSettlement(res)?.transaction
      pushReceipt({ name: c.name, endpoint: c.host, priceUsd: c.priceUsd, txHash, ok: true })
      ledger(c, true, txHash)
    } catch (err) {
      const note = err instanceof Error ? err.message : 'call failed'
      // Failures must be VISIBLE to synthesis — an invisible failure led the
      // model to narrate "Vote submitted!" over a failed call (2026-07-03).
      contextBlocks.push(`### ${c.name} — TOOL CALL FAILED\n${truncate(note, 300)}\nThis call did NOT succeed; nothing was executed or submitted. Tell the user it failed — never claim the action happened.`)
      balanceFailures.push({ name: c.name, note })
      pushReceipt({ name: c.name, endpoint: c.host, priceUsd: c.priceUsd, ok: false, note })
      ledger(c, false, undefined, truncate(note, 120))
      // Feed the self-heal loop from the wallet path too (deduped by service +
      // error class; links this turn's trace). Fire-and-forget.
      recordIncident({ service: c.name, message: note, turnId })
    }
  }

  if (!inferenceCall) {
    return NextResponse.json({ error: 'No inference call in plan.' }, { status: 400 })
  }

  // ── Generic funding fallback (any MCP): a balance-shaped failure becomes
  // bridge-only chips + a synthesis directive. Fail-soft: undetectable or
  // unscannable → the failure surfaces exactly as before.
  let fundingFallback: Awaited<ReturnType<typeof fundingFallbackForFailures>> = null
  const fallbackWallet = walletAddress ?? owner ?? undefined
  if (fallbackWallet && balanceFailures.length > 0) {
    fundingFallback = await fundingFallbackForFailures(fallbackWallet, balanceFailures, (e) => recordTraceLine(turnId, traceSeq++, e, 'wallet')).catch(() => null)
    if (fundingFallback) contextBlocks.push(fundingFallback.contextBlock)
  }

  // Inference with the real prompt. MCP authorizations are body-independent;
  // http prompts are capped into the plan-time price tier (capPrompt).
  const execProtocol: 'mcp' | 'http' = inferenceCall.protocol === 'http' ? 'http' : 'mcp'
  const execTool =
    inferenceCall.tool ?? (execProtocol === 'http' ? 'openai/gpt-4o-mini' : 'ask_claude')
  const prompt = capPrompt(execProtocol, buildPrompt(message, contextBlocks, history, workingContext, walletAddress ?? owner ?? undefined, capabilities))
  let text: string
  let infTx: string | undefined
  if (inferenceCall.id === `inference:${HOUSE_INFERENCE_SLUG}`) {
    // House synthesizer: direct Anthropic on the planner key — nothing was
    // signed at plan time (prepared=null) and nothing is paid here.
    const t = await planViaAnthropic(prompt)
    if (!t) throw new Error('house synthesis unavailable (ANTHROPIC_API_KEY missing or the API call failed)')
    text = t
  } else {
    const header = paymentHeaderFor(inferenceCall, signatures)
    const res = await fetchWithPaymentHeader(
      inferenceCall.endpoint,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: inferenceBody(execProtocol, execTool, prompt),
      },
      header,
    )
    if (!res.ok) throw new Error(await failureReason(res))
    text = parseInferenceText(execProtocol, res.headers.get('content-type') ?? '', await res.text())
    infTx = decodeSettlement(res)?.transaction
  }
  pushReceipt({ name: inferenceCall.name, endpoint: inferenceCall.host, priceUsd: inferenceCall.priceUsd, txHash: infTx, ok: true })
  ledger(inferenceCall, true, infTx)

  const reply = text + infoFooter(listedOnly, notes)
  // RR18: resolved entities ride the reply so the NEXT turn (possibly on a
  // different MCP) plans against exact values, not prose.
  return NextResponse.json({
    reply,
    receipts,
    payer: 'your wallet',
    portfolio: portfolioCard,
    workingContext: carryContext(workingContext, carriedEntities),
    // The generic funding fallback's chips ride the same turn — the model's
    // reply narrates them (contextBlock directive), the chips execute them.
    ...(fundingFallback?.offer ? { clarify: fundingFallback.offer.clarify, buildPath: fundingFallback.offer.buildPath } : {}),
  })
}

/** Build the payment header for a planned call from its client signature. */
function paymentHeaderFor(call: PlannedCall, signatures: Record<string, string>) {
  if (!call.prepared) throw new Error(`${call.name} unexpectedly required no payment`)
  const sig = signatures[call.id]
  if (!sig) throw new Error(`Missing wallet signature for ${call.name}`)
  return finalizePaymentHeader(call.prepared, sig)
}

// ── Burner mode ──────────────────────────────────────────────────────────────

async function runWithBurner(
  message: string,
  inference: McpServer,
  dataServers: McpServer[],
  mcpDataServers: McpServer[],
  listedOnly: McpServer[],
  smart: PlannableEndpoint[] = [],
  notes: string[] = [],
  history: ConversationTurn[] = [],
  /** When set, the turn's reasoning is recorded to route_trace_lines so the
   *  in-chat engine terminal (and /activity) can watch it live. */
  turnId?: string,
  workingContext?: WorkingContext,
  /** The user's wallet address, when known. Burner mode pays with the HOUSE
   *  wallet but the "$USER_ADDRESS" token must still mean the USER — a
   *  fully-free turn with a connected wallet routes here, and "do I have open
   *  proposals" needs their address, not the burner's. */
  userAddress?: string,
) {
  let traceSeq = 0
  const trace = turnId ? (event: unknown) => recordTraceLine(turnId, traceSeq++, event, 'burner') : () => {}
  trace({ type: 'status', label: 'routing within your selected agents' })
  const receipts: Receipt[] = []
  const contextBlocks: string[] = []
  let carriedEntities: EntityRef[] = []
  // A vote built by the snapshot MCP's prepare_vote tool, hoisted out of the
  // tool result so the chat can render a Sign-vote button instead of dumping
  // the EIP-712 typed data into the inference prompt.
  let voteRequest: VoteRequest | null = null
  // A portfolio-shaped tool return, hoisted so the chat renders a rich card
  // next to the synthesized text (display layer — presentation only).
  let portfolioCard: PortfolioDisplay | undefined
  // Balance-shaped tool failures feed the generic funding fallback before
  // synthesis — ANY MCP's "insufficient funds" can end in chips, not a wall.
  const balanceFailures: { name: string; note: string }[] = []

  // Load the signed-in owner's active spend grant. When one exists, every
  // burner payment is gated by it (expiry → allowlist → per-call → per-day) and
  // ledgered; when absent, behavior is unchanged (no enforcement, no ledger).
  const owner = await getSessionAddress()
  const grant = owner ? await getActiveGrant(owner) : null
  const policy: GrantPolicy | null = grant ? toPolicy(grant) : null
  let spentToday = grant ? await spentTodayUsd(grant.id) : 0
  let spentTotal = grant ? await spentTotalUsd(grant.id) : 0
  const blocked: string[] = []

  for (const ds of dataServers) {
    const host = hostOf(ds.endpoint!)
    const price = Number(ds.priceUsd ?? '0.01')

    if (policy && grant) {
      const violation = grantViolation(policy, host, price, spentToday, spentTotal)
      if (violation) {
        await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ds.name, amountUsd: 0, ok: false, note: violation })
        receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? ds.slug : undefined })
        blocked.push(`${ds.name} (${violation})`)
        continue
      }
    }

    try {
      const { json, txHash } = await paidGet(ds.endpoint!, ds.queryParam ?? 'q', message)
      carriedEntities = extractEntities(json, carriedEntities)
      contextBlocks.push(`### ${ds.name}\n${compactForSynthesis(json, 3500)}`)
      receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', txHash, ok: true })
      if (grant) {
        await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ds.name, amountUsd: price, ok: true, txHash, note: 'settled' })
        spentToday += price
        spentTotal += price
      }
    } catch (err) {
      const note = err instanceof Error ? err.message : 'call failed'
      balanceFailures.push({ name: ds.name, note })
      receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note })
    }
  }

  // ── MCP data services: pay + tools/call with structured args ──────────────
  for (const ds of mcpDataServers) {
    const host = hostOf(ds.endpoint!)
    const price = Number(ds.priceUsd ?? '0.01')

    if (policy && grant) {
      const violation = grantViolation(policy, host, price, spentToday, spentTotal)
      if (violation) {
        await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ds.name, amountUsd: 0, ok: false, note: violation })
        receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? ds.slug : undefined })
        blocked.push(`${ds.name} (${violation})`)
        continue
      }
    }

    try {
      const reqd = mcpDataRequest(ds)
      const res = await getPaidFetch()(reqd.url, { method: reqd.method, headers: reqd.headers, body: reqd.body })
      if (!res.ok) throw new Error(await failureReason(res))
      const data = parseMcpDataResult(res.headers.get('content-type') ?? '', await res.text())
      const txHash = decodeSettlement(res)?.transaction
      // prepare_vote returns a sign_vote payload — surface it as a button rather
      // than feeding the raw typed data to the model.
      const vote = voteRequestFromToolResult(data)
      if (vote) {
        voteRequest = vote
        contextBlocks.push(`### ${ds.name}\nPrepared a vote for the user to sign: ${vote.summary}`)
      } else {
        carriedEntities = extractEntities(data, carriedEntities)
        const card = portfolioFromToolResult(data)
        if (card) portfolioCard = card
        contextBlocks.push(`### ${ds.name}\n${compactForSynthesis(data, 3500)}`)
        if (card) contextBlocks.push('NOTE: this portfolio is ALSO rendered as a rich visual card right below your reply — write ONE short summary sentence (total + notable point); do NOT repeat the holdings/table in text.')
      }
      receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', txHash, ok: true })
      if (grant) {
        await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ds.name, amountUsd: price, ok: true, txHash, note: 'settled' })
        spentToday += price
        spentTotal += price
      }
    } catch (err) {
      const note = err instanceof Error ? err.message : 'call failed'
      balanceFailures.push({ name: ds.name, note })
      receipts.push({ name: ds.name, endpoint: host, priceUsd: ds.priceUsd ?? '0.01', ok: false, note })
    }
  }

  // ── Smart calls: planner picks endpoints for non-wired selected services ──
  const infHost = hostOf(inference.endpoint!)
  const infPrice = Number(inference.priceUsd ?? '0.01')
  const smartServed = new Set<string>()
  if (smart.length > 0) {
    // The planning call is an extra inference payment — gate it like one.
    const plannerViolation = policy && grant ? grantViolation(policy, infHost, infPrice, spentToday, spentTotal) : null
    if (plannerViolation) {
      blocked.push(`endpoint planner (${plannerViolation})`)
    } else {
      try {
        const { picks, dropped, txHash, clarify } = await planSmartPicks(inference, message, smart, history, workingContext, userAddress)
        if (clarify) {
          // RR17: break the turn on the question — nothing further is paid.
          trace({ type: 'note', level: 'info', label: `Ambiguous target — asking: ${clarify.question}` })
          return NextResponse.json({ reply: `🤔 ${clarify.question}`, clarify, receipts, notes })
        }
        for (const d of dropped) notes.push(`Skipped ${d.serverName} — another picked service covers the same capability; kept the better-rated/cheaper one.`)
        if (grant) {
          await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash, note: 'settled' })
          spentToday += infPrice
          spentTotal += infPrice
        }
        if (picks.length === 0) {
          const considered = [...new Set(smart.map((e) => e.serverName))].join(', ')
          notes.push(`The planner reviewed ${considered} but judged none of their endpoints relevant to this message.`)
        }
        const byId = new Map(smart.map((e) => [e.id, e]))
        for (const pick of picks) {
          const ep = byId.get(pick.endpointId)!
          const built = buildSmartRequest(ep, pick.params, { userAddress })
          if ('error' in built) {
            receipts.push({ name: ep.serverName, endpoint: hostOf(ep.url), priceUsd: ep.priceUsd, ok: false, note: `skipped: ${built.error}` })
            continue
          }
          const { request } = built
          const host = hostOf(request.url)
          const price = Number(ep.priceUsd)
          trace({ type: 'select', service: ep.serverName, endpoint: `${host} · ${request.mcp ? 'tools/call' : request.method}`, priceUsd: ep.priceUsd, reason: 'endpoint planner pick' })
          if (policy && grant) {
            const violation = grantViolation(policy, host, price, spentToday, spentTotal)
            if (violation) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ep.serverName, amountUsd: 0, ok: false, note: violation })
              receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? ep.serverSlug : undefined })
              trace({ type: 'receipt', receipt: { name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, ok: false, note: `blocked: ${violation}` } })
              blocked.push(`${ep.serverName} (${violation})`)
              continue
            }
          }
          try {
            const { json, txHash: dataTx } = await paidCall(request)
            carriedEntities = extractEntities(json, carriedEntities)
            // Display layer: a portfolio-shaped return renders as a rich card
            // next to the synthesized text (latest read wins — freshest).
            const card = portfolioFromToolResult(json)
            if (card) portfolioCard = card
            contextBlocks.push(`### ${ep.serverName}\n${compactForSynthesis(json, 3500)}`)
            if (card) contextBlocks.push('NOTE: this portfolio is ALSO rendered as a rich visual card right below your reply — write ONE short summary sentence (total + notable point); do NOT repeat the holdings/table in text.')
            receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, txHash: dataTx, ok: true })
            trace({ type: 'receipt', receipt: { name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, txHash: dataTx, ok: true } })
            smartServed.add(ep.serverSlug)
            if (grant) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: ep.serverName, amountUsd: price, ok: true, txHash: dataTx, note: 'settled' })
              spentToday += price
              spentTotal += price
            }
            // Transaction layer: a planned tool that returned a SIGNABLE action
            // (an ExecutionPlan / send_transaction / order) short-circuits the
            // turn — the user signs, we don't synthesize prose about it. This
            // mirrors the Auto-Router loop; without it, manual mode narrated
            // "here's what you need to sign" as text (live 2026-07-09,
            // near-intents build_swap).
            const art = buildSignableArtifact(json)
            if (art) {
              // Planner-sourced signables are NOT native builds — run the
              // generic drain-shape guard before anything reaches a sign
              // button (third-party transfers, unlimited approvals, operator
              // grants, unknown chains, non-CoW generic orders all refuse).
              const verdict = guardPlannerArtifact(art, { from: userAddress ?? null })
              if (!verdict.ok) {
                notes.push(`Refused a ${ep.serverName} transaction that failed Yeetful's guardrails.`)
                contextBlocks.push(
                  `### GUARDRAIL REFUSAL — ${ep.serverName}\nThe tool returned a signable transaction Yeetful REFUSED to offer: ${verdict.reasons.join(' ')}\nNothing was signed or offered. Tell the user plainly why it was refused — never present it as signable.`,
                )
                continue
              }
              // buildPath 'planner': the signable came out of a tool the
              // ENDPOINT PLANNER picked — not a native builder (lib/build-path.ts).
              if (art.kind === 'eip712-vote') {
                return NextResponse.json({ reply: `🗳️ ${art.summary}`, receipts, payer: 'the house wallet', voteRequest: art.vote, buildPath: 'planner', notes })
              }
              if (art.kind === 'eip712-order') {
                return NextResponse.json({ reply: `🔏 ${art.summary}`, receipts, payer: 'the house wallet', orderRequest: art.order, buildPath: 'planner', notes })
              }
              if (art.kind === 'evm-tx-chain') {
                return NextResponse.json({
                  reply: `🔏 ${art.summary}\n🔗 ${art.chain.steps.length} steps in the card below — each appears as the previous confirms.`,
                  receipts,
                  payer: 'the house wallet',
                  txChain: art.chain,
                  buildPath: 'planner',
                  notes,
                })
              }
              return NextResponse.json({ reply: `🔏 ${art.summary}`, receipts, payer: 'the house wallet', txRequest: art.tx, buildPath: 'planner', notes })
            }
          } catch (err) {
            const note = err instanceof Error ? err.message : 'call failed'
            contextBlocks.push(`### ${ep.serverName} — TOOL CALL FAILED\n${truncate(note, 300)}\nThis call did NOT succeed; nothing was executed or submitted. Tell the user it failed — never claim the action happened.`)
            balanceFailures.push({ name: ep.serverName, note })
            receipts.push({ name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, ok: false, note })
            trace({ type: 'receipt', receipt: { name: ep.serverName, endpoint: host, priceUsd: ep.priceUsd, ok: false, note: truncate(note, 160) } })
            // Record the failed paid call for the self-heal loop — the default
            // (non-Auto-Router) chat path most users hit. Without this, only the
            // Auto-Router path fed incidents, so the table stayed empty and the
            // self-heal workflow had nothing to act on. Fire-and-forget; deduped
            // by service + error class.
            recordIncident({ service: ep.serverName, message: note })
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        console.warn('smart planning failed (continuing without):', msg)
        notes.push(`Endpoint planning failed (${truncate(msg, 120)}) — directory services skipped this turn.`)
      }
    }
  }

  // Inference is the call that actually answers — if the grant blocks it, stop.
  if (policy && grant) {
    const violation = grantViolation(policy, infHost, infPrice, spentToday, spentTotal)
    if (violation) {
      await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: 0, ok: false, note: violation })
      const also = blocked.length ? ` Also blocked: ${blocked.join(', ')}.` : ''
      return NextResponse.json({
        reply: `🚫 Your spend grant blocked the inference call (${inference.name}: ${violation}).${also} Approve the agent on your **Dashboard** (or raise the caps) and try again.`,
        receipts,
        blocked: true,
      })
    }
  }

  // ── Generic funding fallback (any MCP): a balance-shaped failure becomes
  // bridge-only chips + a synthesis directive. Uses the USER's wallet (the
  // burner only pays for calls; funding plans always move the user's money).
  let fundingFallback: Awaited<ReturnType<typeof fundingFallbackForFailures>> = null
  const fallbackWallet = userAddress ?? owner ?? undefined
  if (fallbackWallet && balanceFailures.length > 0) {
    fundingFallback = await fundingFallbackForFailures(fallbackWallet, balanceFailures, trace).catch(() => null)
    if (fundingFallback) contextBlocks.push(fundingFallback.contextBlock)
  }

  const capabilities = capabilitiesBlock([inference, ...dataServers, ...mcpDataServers, ...listedOnly], smart)
  const prompt = buildPrompt(message, contextBlocks, history, workingContext, userAddress ?? owner ?? undefined, capabilities)
  trace({ type: 'status', label: `writing the answer — ${inference.name}` })
  const { text, txHash } = await callInference(inference, prompt)
  receipts.push({ name: inference.name, endpoint: infHost, priceUsd: inference.priceUsd ?? '0.01', txHash, ok: true })
  trace({ type: 'receipt', receipt: { name: inference.name, endpoint: infHost, priceUsd: inference.priceUsd ?? '0.01', txHash, ok: true } })
  if (grant) {
    await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash, note: 'settled' })
    spentToday += infPrice
  }

  let reply = text + infoFooter(listedOnly.filter((s) => !smartServed.has(s.slug)), notes)
  if (grant && policy) {
    reply += `\n\n— spend grant “${grant.label}”: $${spentToday.toFixed(2)}/$${policy.perDayUsd} today`
    if (blocked.length) reply += ` · blocked ${blocked.join(', ')}`
  }
  // buildPath 'manual': the vote artifact came from a DIRECTLY-called
  // working-set tool (prepare_vote in the mcpDataServers loop) — no planning.
  return NextResponse.json({
    reply,
    receipts,
    payer: 'the house wallet',
    voteRequest: voteRequest ?? undefined,
    ...(voteRequest ? { buildPath: 'manual' } : {}),
    portfolio: portfolioCard,
    workingContext: carryContext(workingContext, carriedEntities),
    // The generic funding fallback's chips ride the same turn (never over a
    // vote artifact — a signable already claimed the turn's action slot).
    ...(!voteRequest && fundingFallback?.offer ? { clarify: fundingFallback.offer.clarify, buildPath: fundingFallback.offer.buildPath } : {}),
  })
}

async function paidGet(endpoint: string, queryParam: string, value: string) {
  const url = new URL(endpoint)
  url.searchParams.set(queryParam, value)
  const res = await getPaidFetch()(url.toString(), { method: 'GET', headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(await failureReason(res))
  return { json: await res.json(), txHash: decodeSettlement(res)?.transaction }
}

/** Pay + execute a planner-built request (GET with query or POST with body). */
// Resilience: a single hanging MCP must never stall a routed turn. Each paid
// data call is bounded; on timeout it throws → the engine records a failed
// observation and fails over to the next-best shortlisted provider.
const DATA_CALL_TIMEOUT_MS = 12_000
const INFERENCE_TIMEOUT_MS = 30_000

async function paidCall(request: { url: string; method: string; headers: Record<string, string>; body?: string; mcp?: boolean }) {
  const res = await getPaidFetch()(request.url, {
    method: request.method,
    headers: request.headers,
    signal: AbortSignal.timeout(DATA_CALL_TIMEOUT_MS),
    ...(request.body ? { body: request.body } : {}),
  })
  if (!res.ok) throw new Error(await failureReason(res))
  // MCP tools/call (our free MCPs): unwrap the JSON-RPC / SSE envelope. These
  // endpoints never 402, so the paid fetch passes through without payment.
  if (request.mcp) {
    return { json: parseMcpDataResult(res.headers.get('content-type') ?? '', await res.text()), txHash: decodeSettlement(res)?.transaction }
  }
  return { json: await res.json(), txHash: decodeSettlement(res)?.transaction }
}

// ── Auto-Router (streaming) ─────────────────────────────────────────────────
//
// Burner-mode auto-routing with a live SSE trace. The engine (lib/router) picks
// services across the whole directory; each reasoning step, payment, receipt,
// and the final answer is streamed as `data: {json}\n\n`. Wire contract (the
// engine window renders by `type`): the four TraceStep shapes from lib/router
// (status / analyze / candidate / select), plus over-the-wire `pay`, `receipt`,
// `reply`, `error`, `done`. Grant gating + ledgering match burner mode exactly.
export function streamAutoRouter(
  message: string,
  history: ConversationTurn[],
  walletAddress?: string,
  /** When set (Bearer-key callers via /api/route), the spend scope is this
   *  address instead of the SIWE session — so the engine gates the agent's
   *  own grant. */
  ownerOverride?: string,
  /** The calling API key's id (Bearer via /api/route) — attributes routed spend
   *  to that agent so per-key budgets + the Agents tab reflect it (B22). */
  apiKeyId?: string,
  /** Optional inference-engine pin (slug, e.g. 'deepseek' | 'chatgpt' |
   *  'google-gemini' | 'claude'). Used by the live-service test to rotate
   *  engines; ignored when the slug isn't a callable inference. */
  inferenceSlug?: string,
  /** Structured conversation state (RR2) — client-echoed, already sanitized. */
  workingContext?: WorkingContext,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Accumulate the trace-type events as they stream so the turn's reasoning
      // can be persisted to Message.meta + replayed later (B16). No PII (service
      // slugs / intent / public tx hashes only); capped to keep meta small.
      const traceLog: unknown[] = []
      const TRACE_TYPES = new Set(['status', 'analyze', 'shortlist', 'candidate', 'select', 'note', 'pay', 'receipt', 'tool', 'eip712', 'error'])
      const trace = () => traceLog.slice(-60)
      // Persist the trace to the shared DB so it streams to the public Activity
      // page in real time (local dev + prod share one Neon DB). Fire-and-forget;
      // privacy-filtered in lib/route-trace. Payer: an agent key → 'agent', else
      // the house burner wallet.
      const turnId = newTurnId()
      const tracePayer = apiKeyId ? 'agent' : 'burner'
      let traceSeq = 0
      const send = (event: unknown) => {
        if (event && typeof event === 'object' && TRACE_TYPES.has((event as { type?: string }).type ?? '') && traceLog.length < 300) {
          traceLog.push(event)
          recordTraceLine(turnId, traceSeq++, event, tracePayer)
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      const startMs = Date.now()
      const finish = () => {
        send({ type: 'done' })
        controller.close()
      }
      // Routing telemetry helpers (B14): derive turn metrics from the decision +
      // the receipts collected so far. Privacy: service slugs + intent only.
      const shortlistedOf = (d: RouterDecision) => {
        const s = d.trace.find((x) => x.type === 'shortlist')
        return s && s.type === 'shortlist' ? s.candidates.length : 0
      }
      const intentOf = (d: RouterDecision) => {
        const a = d.trace.find((x) => x.type === 'analyze')
        return a && a.type === 'analyze' ? a.intent : undefined
      }
      const picksOf = (d: RouterDecision) => d.smartPicks.map((p) => ({ service: p.serverName, endpoint: p.endpointUrl, priceUsd: p.priceUsd }))
      try {
        send({ type: 'status', label: 'Starting the routing engine…' } satisfies TraceStep)

        // ── Governance fast-path: proposals/votes are free Snapshot reads + a
        //    gasless EIP-712 signature, not paid MCP calls. Run the transaction
        //    tools (resolve → list → build EIP-712 → sign → relay → results),
        //    each streamed as a terminal step. ─────────────────────────────────
        const govIntent = detectGovernanceIntent(message)
        if (govIntent) {
          send({
            type: 'analyze',
            intent: govIntent.kind === 'vote' ? 'Cast a governance vote' : 'Find open governance proposals',
            needs: govIntent.spaceQuery ? [`Snapshot space: ${govIntent.spaceQuery}`] : ['active Snapshot proposals'],
          } satisfies TraceStep)

          // Optional paid summary (item 1): the free Snapshot reads gather the
          // facts; Yeetful Claude phrases them conversationally. This is a REAL
          // burner-paid inference call — shown as select → pay → receipt in the
          // terminal — gated by the spend policy. Free template if unavailable.
          const govReceipts: Receipt[] = []
          const synthesize = async (prompt: string): Promise<string | null> => {
            if (!hasAgentWallet()) return null
            const catalog = await loadCatalog()
            const inference = selectInferenceProvider(catalog, inferenceSlug)
            if (!inference?.endpoint) return null
            const infHost = hostOf(inference.endpoint)
            const infPrice = Number(inference.priceUsd ?? '0.01')
            const owner = ownerOverride ?? (await getSessionAddress())
            const grant = owner ? await getActiveGrant(owner) : null
            if (grant) {
              const v = grantViolation(toPolicy(grant), infHost, infPrice, await spentTodayUsd(grant.id), await spentTotalUsd(grant.id))
              if (v) { send({ type: 'note', level: 'warn', label: `Skipped the conversational summary — spend policy (${v}).` }); return null }
            }
            send({ type: 'select', service: inference.name, endpoint: inference.endpoint, priceUsd: inference.priceUsd ?? undefined, reason: 'Phrase the Snapshot data conversationally' } satisfies TraceStep)
            send({ type: 'pay', service: inference.name, host: infHost, priceUsd: String(infPrice) })
            try {
              const r = await callInference(inference, prompt)
              const receipt: Receipt = { name: inference.name, endpoint: infHost, priceUsd: String(infPrice), txHash: r.txHash, ok: true }
              govReceipts.push(receipt)
              send({ type: 'receipt', receipt })
              if (grant) await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash: r.txHash, note: 'settled (governance summary)' })
              return r.text?.trim() || null
            } catch {
              send({ type: 'note', level: 'warn', label: 'Summary inference failed — showing the raw data.' })
              return null
            }
          }

          try {
            const gov = await runGovernanceTurn({ message, intent: govIntent, walletAddress, emit: send, synthesize, ctx: workingContext })
            const paid = govReceipts.length > 0
            send({
              type: 'reply',
              content: gov.reply,
              receipts: govReceipts,
              payer: gov.cast ? 'your agent' : paid ? 'the house wallet' : 'none',
              trace: trace(),
              ...(gov.voteRequest ? { voteRequest: gov.voteRequest } : {}),
              ...(gov.voteProposal ? { voteProposal: gov.voteProposal } : {}),
              ...(gov.workingContext ? { workingContext: gov.workingContext } : {}),
            })
            recordRouteEvent({
              payer: gov.cast ? 'agent' : paid ? 'house' : 'none',
              latencyMs: Date.now() - startMs,
              intent: govIntent.kind,
              settledCount: govReceipts.length,
              totalCostUsd: govReceipts.reduce((a, r) => a + (Number(r.priceUsd) || 0), 0),
            })
          } catch (e) {
            send({ type: 'reply', content: `🗳️ Governance routing hit an error: ${e instanceof Error ? e.message : 'unknown error'}.`, receipts: [], payer: 'none' })
          }
          return finish()
        }

        const catalog = await loadCatalog()
        const inference = selectInferenceProvider(catalog, inferenceSlug)
        if (!inference) {
          send({
            type: 'reply',
            content: '⚡ No live inference engine is available. Enable an Inference agent (e.g. **Yeetful · Claude**) so I can answer.',
            receipts: [],
            payer: 'none',
          })
          recordRouteEvent({ blocked: true, payer: 'none', latencyMs: Date.now() - startMs })
          return finish()
        }

        // Auto-Router pays from the house wallet (burner). Wallet-signed routing
        // is B5; without a house wallet there's nothing to pay with.
        if (!hasAgentWallet()) {
          send({
            type: 'reply',
            content: '⚡ Auto Router needs the house wallet (PRIVATE_KEY) to pay per call, which isn’t configured here. Turn Auto Router off to pick agents and pay with your own wallet.',
            receipts: [],
            payer: 'none',
          })
          recordRouteEvent({ blocked: true, payer: 'none', latencyMs: Date.now() - startMs })
          return finish()
        }

        // Spend grant (burner): when the owner has an active grant, every
        // payment is gated + ledgered; absent → no enforcement, no ledger. The
        // owner is the Bearer key's scope (/api/route) or the SIWE session (chat).
        const owner = ownerOverride ?? (await getSessionAddress())
        const grant = owner ? await getActiveGrant(owner) : null
        const policy: GrantPolicy | null = grant ? toPolicy(grant) : null
        let spentToday = grant ? await spentTodayUsd(grant.id) : 0
        let spentTotal = grant ? await spentTotalUsd(grant.id) : 0
        const infHost = hostOf(inference.endpoint!)
        const infPrice = Number(inference.priceUsd ?? '0.01')
        const receipts: Receipt[] = []
        let savedUsd = 0 // accumulated cache savings this turn

        // Persist one route event from the receipts gathered so far + overrides.
        const recordTurn = (o: { blocked?: boolean; payer?: string; shortlisted?: number; picks?: { service: string; endpoint?: string; priceUsd?: string }[]; intent?: string }) =>
          recordRouteEvent({
            latencyMs: Date.now() - startMs,
            settledCount: receipts.filter((r) => r.ok && r.note !== 'cached').length,
            failedCount: receipts.filter((r) => !r.ok).length,
            cachedCount: receipts.filter((r) => r.note === 'cached').length,
            totalCostUsd: receipts.filter((r) => r.ok).reduce((a, r) => a + (Number(r.priceUsd) || 0), 0),
            savedUsd,
            ...o,
          })

        // The routing call AND the answer both hit the inference host — if the
        // grant forbids it, stop before spending a cent.
        if (policy && grant) {
          const violation = grantViolation(policy, infHost, infPrice, spentToday, spentTotal)
          if (violation) {
            await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: 0, ok: false, note: violation })
            send({ type: 'status', label: `Blocked by your spend policy (${violation}).` } satisfies TraceStep)
            send({
              type: 'reply',
              content: `🚫 Your spend policy blocked ${inference.name} (${violation}). Approve it (or raise the caps) on your **Dashboard** and try again.`,
              receipts,
              payer: 'the house wallet',
              blocked: true,
            })
            recordTurn({ blocked: true, payer: 'the house wallet' })
            return finish()
          }
        }

        // The routing/planning inference always tries the direct Anthropic API
        // first (the planner is the product — see planViaAnthropic). That call is
        // house-paid via the API key, off the x402 rail entirely, so it costs the
        // grant nothing and can't self-pay. Only when no ANTHROPIC_API_KEY is set
        // do we fall back to the paid inference MCP, and ONLY then do we ledger
        // the routing cost (burner: counts against the grant; wallet: house eats).
        const runRoutingInference = async (inf: McpServer, prompt: string) => {
          const direct = await planViaAnthropic(prompt)
          if (direct) return { text: direct, txHash: undefined }
          // Fell back to the paid answer engine for PLANNING — the weak path that
          // collapses routing. Make it loud (the silent fallback cost a whole
          // debugging cycle): a server warn + a visible note in the engine window.
          const why = process.env.ANTHROPIC_API_KEY ? 'Anthropic planner call failed' : 'ANTHROPIC_API_KEY not set'
          console.warn(`[reason-router] planner fell back to ${inf.name} — ${why}`)
          send({ type: 'note', level: 'warn', label: `Planner fell back to ${inf.name} (${why}) — routing quality degraded.` })
          const r = await callInference(inf, prompt)
          if (grant && !walletAddress) {
            await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash: r.txHash, note: 'settled (routing)' })
            spentToday += infPrice
            spentTotal += infPrice
          }
          return r
        }

        const executeCall = async (pick: SmartPick): Promise<{ data?: unknown; error?: string; defer?: boolean }> => {
          const host = hostOf(pick.request.url)
          const price = Number(pick.priceUsd)
          // Cache: an identical recent GET read is served for $0.00, no payment,
          // no gate (there's nothing to spend). Reads only; never actions/fails.
          const cacheable = isCacheable(pick.request)
          const cacheKey = cacheable ? routeCacheKey(pick.request) : ''
          if (cacheable) {
            const hit = getCached(cacheKey)
            if (hit !== undefined) {
              send({ type: 'note', level: 'info', label: `↺ ${pick.serverName}: served from cache ($0.00)` })
              const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: '0.00', ok: true, note: 'cached' }
              receipts.push(r)
              send({ type: 'receipt', receipt: r })
              savedUsd += Number(pick.priceUsd) || 0 // a re-pay avoided
              return { data: hit }
            }
          }
          if (policy && grant) {
            const violation = grantViolation(policy, host, price, spentToday, spentTotal)
            if (violation) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host, serviceName: pick.serverName, amountUsd: 0, ok: false, note: violation })
              const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: pick.priceUsd, ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? pick.serverSlug : undefined }
              receipts.push(r)
              send({ type: 'receipt', receipt: r })
              return { error: `blocked: ${violation}` }
            }
          }
          send({ type: 'pay', service: pick.serverName, host, priceUsd: pick.priceUsd })
          const payStart = Date.now()
          try {
            const { json, txHash } = await paidCall(pick.request)
            const latencyMs = Date.now() - payStart
            const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: pick.priceUsd, txHash, ok: true }
            receipts.push(r)
            send({ type: 'receipt', receipt: r })
            if (grant) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host, serviceName: pick.serverName, amountUsd: price, ok: true, txHash, note: 'settled', latencyMs })
              spentToday += price
              spentTotal += price
            }
            // Cache a successful read — but NEVER a signable action (votes/txns
            // are time-sensitive + per-user) and never a non-GET.
            if (cacheable && !buildSignableArtifact(json)) setCached(cacheKey, json)
            return { data: json }
          } catch (err) {
            const note = err instanceof Error ? err.message : 'call failed'
            const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: pick.priceUsd, ok: false, note }
            receipts.push(r)
            send({ type: 'receipt', receipt: r })
            // Record the FAILED attempt (no spend) so reputation + failure-aware
            // routing learn from broken/dead endpoints — without this, a dead
            // gateway is invisible to the engine and gets picked again forever.
            // `error:`-prefixed so the public activity "blocked by policy" stat
            // (policy refusals) doesn't count call failures.
            if (grant) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host, serviceName: pick.serverName, amountUsd: 0, ok: false, note: `error: ${note}`.slice(0, 200) })
            }
            // Deduplicated incident for the self-heal loop (groups by service +
            // error class; links to this turn's trace). Fire-and-forget.
            recordIncident({ service: pick.serverName, message: note, turnId })
            return { error: note }
          }
        }

        // ── Wallet mode (RR19): the loop RUNS for free ($0) reads — resolve →
        //    read hops execute live exactly like burner mode — while any PAID
        //    pick DEFERS: it stays an unexecuted plan pick the wallet signs in
        //    the two-phase execute path. Multi-hop for the main persona.
        if (walletAddress) {
          const decision = await routeMessage({
            message,
            history,
            catalog,
            onStep: (s) => send(s),
            runInference: runRoutingInference,
            userAddress: walletAddress ?? ownerOverride,
            executeCall: (pick) => (pick.priceUsd === '0' ? executeCall(pick) : Promise.resolve({ defer: true })),
          })
          if (decision.clarify) {
            send({ type: 'reply', content: `🤔 ${decision.clarify.question}`, clarify: decision.clarify, trace: trace() })
            recordTurn({ payer: 'the house wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
            return finish()
          }
          // RR19: the free loop can yield a SIGNABLE (a $0 build_swap ran live)
          // — surface it exactly like burner mode; the user signs the ACTION,
          // no data plan needed. Signables break the loop (invariant 4).
          if (decision.artifact) {
            // buildPath 'planner': the Auto-Router engine picked the tool that
            // returned this signable (lib/build-path.ts).
            if (decision.artifact.kind === 'eip712-vote') {
              send({ type: 'reply', content: `🗳️ ${decision.artifact.summary}`, receipts, payer: 'your wallet', voteRequest: decision.artifact.vote, buildPath: 'planner', trace: trace(), workingContext: carryContext(workingContext, decision.entities) })
            } else if (decision.artifact.kind === 'eip712-order') {
              send({ type: 'reply', content: `🔏 ${decision.artifact.summary}`, receipts, payer: 'your wallet', orderRequest: decision.artifact.order, buildPath: 'planner', trace: trace(), workingContext: carryContext(workingContext, decision.entities) })
            } else if (decision.artifact.kind === 'evm-tx-chain') {
              send({ type: 'reply', content: `🔏 ${decision.artifact.summary}\n🔗 ${decision.artifact.chain.steps.length} steps in the card below — each appears as the previous confirms.`, receipts, payer: 'your wallet', txChain: decision.artifact.chain, buildPath: 'planner', trace: trace(), workingContext: carryContext(workingContext, decision.entities) })
            } else {
              send({ type: 'reply', content: `🔏 ${decision.artifact.summary}`, receipts, payer: 'your wallet', txRequest: decision.artifact.tx, buildPath: 'planner', trace: trace(), workingContext: carryContext(workingContext, decision.entities) })
            }
            recordTurn({ payer: 'your wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
            return finish()
          }
          const wPlan: PlannedCall[] = []
          let plannedUsd = 0
          const planGate = async (name: string, h: string, price: number): Promise<string | null> => {
            if (!policy || !grant) return null
            const v = grantViolation(policy, h, price, spentToday + plannedUsd, spentTotal + plannedUsd)
            if (v) {
              await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: h, serviceName: name, amountUsd: 0, ok: false, note: v })
              return v
            }
            plannedUsd += price
            return null
          }
          for (const pick of decision.smartPicks) {
            const host = hostOf(pick.request.url)
            const violation = await planGate(pick.serverName, host, Number(pick.priceUsd))
            if (violation) {
              const r: Receipt = { name: pick.serverName, endpoint: host, priceUsd: pick.priceUsd, ok: false, note: `blocked: ${violation}`, slug: violation === 'NOT_ALLOWED' ? pick.serverSlug : undefined }
              receipts.push(r)
              send({ type: 'receipt', receipt: r })
              continue
            }
            const challenge = await getChallenge(pick.request.url, { method: pick.request.method, headers: pick.request.headers, body: pick.request.body })
            wPlan.push({ id: `smart:${pick.endpointId}`, role: 'data', name: pick.serverName, host, priceUsd: pick.priceUsd, endpoint: pick.endpointUrl, url: pick.request.url, method: pick.request.method, body: pick.request.body, mcp: pick.request.mcp, prepared: challenge ? derivePayment(challenge, walletAddress) : null })
          }
          const infProtocol = inferenceProtocolOf(inference)
          const infTool = inference.tool ?? (infProtocol === 'http' ? 'openai/gpt-4o-mini' : 'ask_claude')
          const infChallenge = await getChallenge(inference.endpoint!, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: infProtocol === 'http' ? inferenceBody('http', infTool, 'probe') : dummyMcpBody(infTool),
          })
          wPlan.push({ id: `inference:${inference.slug}`, role: 'inference', name: inference.name, host: infHost, priceUsd: inference.priceUsd ?? '0.01', endpoint: inference.endpoint!, tool: infTool, protocol: infProtocol, prepared: infChallenge ? derivePayment(infChallenge, walletAddress) : null })
          const payments = wPlan
            .filter((c) => c.prepared)
            .map((c) => ({ id: c.id, name: c.name, host: c.host, priceUsd: c.priceUsd, signing: c.prepared!.signing as SigningRequest }))
          // Carry the turnId so the wallet's execute phase persists its
          // settlements under THIS turn → they show in the live feed, grouped
          // with the plan trace.
          send({ type: 'plan', plan: wPlan, payments, listedOnly: [], notes: decision.notes, turnId })
          recordTurn({ payer: 'your wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
          return finish()
        }

        // ── Burner mode: multi-step loop. executeCall pays + gates + ledgers +
        //    streams each chosen call; routeMessage chains resolve→fetch and
        //    feeds results back, returning the gathered context to answer with.
        const decision = await routeMessage({ message, history, catalog, onStep: (s) => send(s), runInference: runRoutingInference, executeCall, userAddress: walletAddress ?? ownerOverride })

        // RR17: the route broke on an ambiguous money/governance target —
        // surface the question; the chip's pick arrives as the next turn.
        if (decision.clarify) {
          send({ type: 'reply', content: `🤔 ${decision.clarify.question}`, receipts, payer: 'the house wallet', clarify: decision.clarify, trace: trace() })
          recordTurn({ payer: 'the house wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
          return finish()
        }

        // Transaction layer: a routed tool returned a signable action — surface
        // it for explicit approval instead of synthesizing an answer. Votes reuse
        // the existing SignVoteButton (voteRequest meta); a raw tx rides txRequest.
        if (decision.artifact) {
          // buildPath 'planner': the Auto-Router engine picked the tool that
          // returned this signable (lib/build-path.ts).
          if (decision.artifact.kind === 'eip712-vote') {
            send({ type: 'reply', content: `🗳️ ${decision.artifact.summary}`, receipts, payer: 'the house wallet', voteRequest: decision.artifact.vote, buildPath: 'planner', trace: trace() })
          } else if (decision.artifact.kind === 'eip712-order') {
            // Intent-based order (CoW swap / OpenSea): the built order is sent
            // for signature. Guardrails (A3) gate it; the sign UI is A4.
            send({ type: 'reply', content: `🔏 ${decision.artifact.summary}`, receipts, payer: 'the house wallet', orderRequest: decision.artifact.order, buildPath: 'planner', trace: trace() })
          } else if (decision.artifact.kind === 'evm-tx-chain') {
            // Multi-step build (approve → swap): one self-advancing card.
            send({ type: 'reply', content: `🔏 ${decision.artifact.summary}\n🔗 ${decision.artifact.chain.steps.length} steps in the card below — each appears as the previous confirms.`, receipts, payer: 'the house wallet', txChain: decision.artifact.chain, buildPath: 'planner', trace: trace() })
          } else {
            send({ type: 'reply', content: `🔏 ${decision.artifact.summary}`, receipts, payer: 'the house wallet', txRequest: decision.artifact.tx, buildPath: 'planner', trace: trace() })
          }
          recordTurn({ payer: 'the house wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
          return finish()
        }

        // Re-gate the answer call against the now-higher running total.
        if (policy && grant) {
          const violation = grantViolation(policy, infHost, infPrice, spentToday, spentTotal)
          if (violation) {
            await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: infHost, serviceName: inference.name, amountUsd: 0, ok: false, note: violation })
            send({
              type: 'reply',
              content: `🚫 Your spend policy blocked the answer (${inference.name}: ${violation}). Raise the caps on your **Dashboard**.`,
              receipts,
              payer: 'the house wallet',
              blocked: true,
            })
            recordTurn({ blocked: true, payer: 'the house wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
            return finish()
          }
        }

        send({ type: 'status', label: 'Synthesizing the answer…' } satisfies TraceStep)
        const synthStart = Date.now()
        // Same user-address precedence as the planner's $USER_ADDRESS (line
        // ~1659): the request's wallet, else the Bearer key's owner scope.
        const { text, txHash } = await callInference(inference, buildPrompt(message, decision.context, history, undefined, walletAddress ?? ownerOverride))
        const synthLatencyMs = Date.now() - synthStart
        const r: Receipt = { name: inference.name, endpoint: infHost, priceUsd: inference.priceUsd ?? '0.01', txHash, ok: true }
        receipts.push(r)
        send({ type: 'receipt', receipt: r })
        if (grant) {
          await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, apiKeyId, host: infHost, serviceName: inference.name, amountUsd: infPrice, ok: true, txHash, note: 'settled', latencyMs: synthLatencyMs })
        }

        // Value proof (B15): what smart routing saved this turn vs naive routing.
        const shortlistStep = decision.trace.find((s) => s.type === 'shortlist')
        const shortlistPrices = shortlistStep && shortlistStep.type === 'shortlist' ? shortlistStep.candidates.map((c) => Number(c.priceUsd) || 0) : []
        const sv = routeSavings({ shortlistPrices, pickPrices: decision.smartPicks.map((p) => Number(p.priceUsd) || 0), cacheSavedUsd: savedUsd })
        const routeReport = {
          considered: shortlistedOf(decision),
          picked: decision.smartPicks.map((p) => p.serverName),
          spentUsd: receipts.filter((r) => r.ok).reduce((a, r) => a + (Number(r.priceUsd) || 0), 0),
          cacheSavedUsd: sv.cacheSavedUsd,
          savedVsPriciestUsd: sv.savedVsPriciestUsd,
        }
        send({
          type: 'reply',
          content: text + infoFooter([], decision.notes),
          receipts,
          payer: 'the house wallet',
          routeReport,
          // Display layer: a portfolio-shaped tool return rides the reply so
          // the chat renders it as a rich card under the synthesized text.
          portfolio: decision.portfolio,
          trace: trace(),
          // RR18: values the loop's tool results resolved ride the reply so
          // the next turn plans against exact ids/symbols across MCPs.
          workingContext: carryContext(workingContext, decision.entities),
        })
        recordTurn({ payer: 'the house wallet', shortlisted: shortlistedOf(decision), picks: picksOf(decision), intent: intentOf(decision) })
        finish()
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'auto-router failed' })
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}

/**
 * Inference request body for either transport. `http` = an OpenAI-compatible
 * x402 gateway (BlockRun): `tool` carries the gateway model id, output capped
 * at 256 tokens to match the flat per-call price tier.
 */
function inferenceBody(protocol: 'mcp' | 'http', tool: string, prompt: string): string {
  if (protocol === 'http') {
    return JSON.stringify({
      model: tool,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
    })
  }
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: { prompt } },
  })
}

function parseInferenceText(protocol: 'mcp' | 'http', contentType: string, raw: string): string {
  if (protocol === 'http') {
    try {
      const json = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] }
      const text = json.choices?.[0]?.message?.content
      if (typeof text === 'string' && text.trim()) return text.trim()
    } catch {
      /* fall through */
    }
    throw new Error('Gateway returned no completion text.')
  }
  return parseClaudeText(contentType, raw)
}

function inferenceProtocolOf(s: { protocol?: string | null }): 'mcp' | 'http' {
  return s.protocol === 'http' ? 'http' : 'mcp'
}

/**
 * BlockRun prices per request size: flat $0.001 up to ~2.4K input tokens, then
 * it grows. The wallet flow signs the plan-time amount, so the execute-time
 * prompt must stay inside the same (flat) price tier — cap http prompts well
 * under the threshold. MCP (Yeetful · Claude) is flat-priced; no cap needed.
 */
const HTTP_PROMPT_MAX_CHARS = 4000
function capPrompt(protocol: 'mcp' | 'http', prompt: string): string {
  return protocol === 'http' ? truncate(prompt, HTTP_PROMPT_MAX_CHARS) : prompt
}

// The planner is the product, so the routing/SELECTION call always runs on a
// known-good model via the direct Anthropic API (house key) — decoupled from
// whichever paid engine ends up ANSWERING. This keeps picks reliable no matter
// what the answer engine is, and sidesteps the x402 self-pay break (a from==to
// transfer when the answer engine's payTo is the house burner). Returns null on
// any failure or when no key is set, so the caller falls back to the paid MCP.
const PLANNER_MODEL = process.env.PLANNER_MODEL || 'claude-haiku-4-5-20251001'
async function planViaAnthropic(prompt: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: PLANNER_MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim()
    return text || null
  } catch {
    return null
  }
}

/**
 * The HOUSE synthesizer — used when the user selected NO inference agent.
 * Answers are written by a direct Anthropic call on the planner's API key
 * (never x402, never the burner), so a free-MCP turn costs zero USDC.
 * The endpoint is Anthropic's real API host so hostOf()/policy checks see an
 * honest host; callInference short-circuits on the slug before any fetch.
 */
const HOUSE_INFERENCE_SLUG = 'yeetful-house'
const HOUSE_INFERENCE = {
  id: HOUSE_INFERENCE_SLUG,
  slug: HOUSE_INFERENCE_SLUG,
  name: 'Yeetful · House (free)',
  description: 'House synthesis on the planner key — free preview when no inference agent is selected.',
  category: 'Inference',
  kind: 'inference',
  callable: true,
  protocol: 'mcp',
  tool: 'ask_claude',
  endpoint: 'https://api.anthropic.com/v1/messages',
  priceUsd: '0',
} as McpServer

function isHouseInference(s: Pick<McpServer, 'slug'>): boolean {
  return s.slug === HOUSE_INFERENCE_SLUG
}

async function callInference(
  inference: Pick<McpServer, 'endpoint' | 'tool' | 'protocol'> & { slug?: string },
  prompt: string,
) {
  // House synthesizer: direct Anthropic on the planner key — no x402, no USDC.
  if (inference.slug === HOUSE_INFERENCE_SLUG) {
    const text = await planViaAnthropic(prompt)
    if (!text) throw new Error('house synthesis unavailable (ANTHROPIC_API_KEY missing or the API call failed)')
    return { text, txHash: undefined }
  }
  const protocol = inferenceProtocolOf(inference)
  const tool = inference.tool ?? (protocol === 'http' ? 'openai/gpt-4o-mini' : 'ask_claude')
  const res = await getPaidFetch()(inference.endpoint!, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: inferenceBody(protocol, tool, capPrompt(protocol, prompt)),
    signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(await failureReason(res))
  const text = parseInferenceText(protocol, res.headers.get('content-type') ?? '', await res.text())
  return { text, txHash: decodeSettlement(res)?.transaction }
}

// ── shared MCP parsing ─────────────────────────────────────────────────────────

interface JsonRpcResult {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }
  error?: { code: number; message: string }
}

function parseClaudeText(contentType: string, raw: string): string {
  const parsed = parseMcpBody(contentType, raw)
  if (parsed.error) throw new Error(parsed.error.message)
  const text =
    parsed.result?.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim() ?? ''
  if (!text) throw new Error('inference returned an empty completion')
  return text
}

// MCP Streamable HTTP may answer with application/json or an SSE stream.
function parseMcpBody(contentType: string, raw: string): JsonRpcResult {
  if (contentType.includes('text/event-stream')) {
    const data = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('')
    return JSON.parse(data) as JsonRpcResult
  }
  return JSON.parse(raw) as JsonRpcResult
}

function dummyMcpBody(tool: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { prompt: 'ping' } } })
}

// ── MCP data services ──────────────────────────────────────────────────────────
// An MCP *data* service's wired `tool` takes structured args (from `toolArgs`),
// not a free-text prompt. A single tools/call POST works — mcp-handler is
// stateless, same as the inference path. (v1: args are the stored defaults; the
// user's message shapes the LLM's answer, not yet the query — a planner that
// fills MCP args from the message is a follow-up.)
function mcpDataRequest(server: McpServer): {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
} {
  const args = server.toolArgs && typeof server.toolArgs === 'object' ? server.toolArgs : {}
  return {
    url: server.endpoint!,
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: server.tool, arguments: args },
    }),
  }
}

/** Parse an MCP data tool result — the data arrives as a JSON string inside
 *  result.content[].text. Throws on transport/tool errors. */
function parseMcpDataResult(contentType: string, raw: string): unknown {
  const parsed = parseMcpBody(contentType, raw)
  if (parsed.error) throw new Error(parsed.error.message)
  const text =
    parsed.result?.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim() ?? ''
  if (parsed.result?.isError) throw new Error(text || 'MCP tool returned an error')
  if (!text) throw new Error('MCP tool returned no content')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * A compact, grounded description of what each connected agent/MCP can do —
 * fed into the synthesis prompt so meta-questions ("what can I do here?",
 * "what is this?", "what's available?") are answered from the ACTUAL connected
 * set instead of the model improvising generic wallet features. (2026-07-07: a
 * Hyperliquid-only turn answered "check your wallet / send / receive / swap /
 * stake / view NFTs" — none of which the connected MCP provides.)
 *
 * Tool-level detail comes from the plannable endpoints (`smart`) when present —
 * the richest signal, one line per tool; otherwise the service's own one-line
 * description. Works for 1, 2, or 3+ connected agents. The house inference
 * engine is skipped (it writes the answer; it isn't a capability to advertise).
 */
function capabilitiesBlock(servers: McpServer[], smart: PlannableEndpoint[] = []): string {
  // Per-service tool descriptions from the planner menu (deduped, capped).
  const toolsBySlug = new Map<string, string[]>()
  for (const e of smart) {
    const d = e.description?.trim()
    if (!d) continue
    const arr = toolsBySlug.get(e.serverSlug) ?? []
    if (!arr.includes(d)) arr.push(d)
    toolsBySlug.set(e.serverSlug, arr)
  }
  const seen = new Set<string>()
  const lines: string[] = []
  for (const s of servers) {
    if (!s || isHouseInference(s) || seen.has(s.slug)) continue
    seen.add(s.slug)
    const tools = toolsBySlug.get(s.slug) ?? []
    const detail = tools.length
      ? '\n' + tools.slice(0, 8).map((t) => `    · ${truncate(t, 140)}`).join('\n')
      : s.description
        ? `\n    ${truncate(s.description, 200)}`
        : ''
    const tag = s.kind === 'inference' ? ' — inference engine (writes the answers)' : ''
    lines.push(`- **${s.name}**${tag}${detail}`)
  }
  if (lines.length === 0) return ''
  const count = lines.length
  return [
    `The user has ${count} agent${count === 1 ? '' : 's'}/MCP${count === 1 ? '' : 's'} connected this turn. This is the COMPLETE set of what you can help with here — do NOT claim capabilities beyond these (no generic "check your wallet / send / swap / stake / view NFTs" unless a connected agent below actually provides it):`,
    ...lines,
  ].join('\n')
}

function buildPrompt(message: string, contextBlocks: string[], history: ConversationTurn[] = [], ctx?: WorkingContext, userAddress?: string, capabilities = ''): string {
  const convo = answerHistoryBlock(history)
  // Structured continuity (RR2): the scope + offered items from prior turns,
  // so terse follow-ups resolve without scraping prose out of history.
  const ctxBlock = contextBlockForPlanner(ctx)
  // The connected wallet, so "my address" answers correctly — the planner
  // already gets this via $USER_ADDRESS; the ANSWER prompts never did.
  const walletLine = walletContextLine(userAddress)
  if (contextBlocks.length === 0) {
    const convoBlock = convo ? `Conversation so far:\n${convo}\n\n` : ''
    // Ground the answer in the connected agents. The instruction fires only for
    // capability/meta asks; ordinary follow-ups just gain honest grounding.
    const capBlock = capabilities
      ? `${capabilities}\n\nIf the user asks what they can do, what this is, what's available, or how to use it, answer by naming the connected agents above and summarizing what each can do — concisely, one short line per agent. Never pad the list with capabilities no connected agent provides.\n\n`
      : ''
    return `You are Yeetful, a concise assistant. Continue the conversation and answer the user's latest message directly, using the earlier turns for context.\n\n${capBlock}${walletLine ? `${walletLine}\n\n` : ''}${ctxBlock ? `${ctxBlock}\n\n` : ''}${convoBlock}User: ${message}`
  }
  return [
    `You are Yeetful, a concise assistant. Use the live data below (fetched and paid for over x402) to answer.`,
    `Cite specifics from the data. If the data doesn't cover it, say so briefly.`,
    // Even with data in hand, a capability/meta ask ("what can I do here?") must
    // describe ALL connected agents — not just whichever one the planner happened
    // to call. So the capability block travels into the data branch too.
    ...(capabilities
      ? [``, capabilities, ``, `If the user is asking what they can do / what's available / how to use this, name every connected agent above and what each can do — not only the one the data below came from.`]
      : []),
    ...(walletLine ? [``, walletLine] : []),
    ...(ctxBlock ? [``, ctxBlock] : []),
    ...(convo ? [``, `Conversation so far:`, convo] : []),
    ``,
    `DATA:`,
    contextBlocks.join('\n\n'),
    ``,
    `User question: ${message}`,
  ].join('\n')
}

/**
 * Per-receipt lines and the paid-total used to be embedded here as text; they
 * now render structurally from Message.meta (receipts + payer) — see
 * components/MessageReceipts. Only information with no structured home stays
 * in the reply: listed-only services and planner diagnostics.
 */
function infoFooter(listedOnly: McpServer[], notes: string[] = []): string {
  let footer = ''
  if (listedOnly.length > 0) {
    footer += `\n\nℹ️ Not called this turn: ${listedOnly.map((s) => s.name).join(', ')}`
  }
  if (notes.length > 0) {
    footer += `\n\n⚙️ Diagnostics:\n${notes.map((n) => `· ${n}`).join('\n')}`
  }
  return footer
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function demoReply(message: string, servers: McpServer[]): string {
  const names = servers.map((s) => s.name).join(', ') || 'none'
  return [
    `🔌 **Demo mode** — no payer available.`,
    ``,
    `You asked: “${message}”`,
    `Selected x402 servers: ${names}`,
    ``,
    `Two ways to go live:`,
    `• **Connect a wallet** (top right) with USDC on Base — you'll sign a quick payment per call and pay for your own usage.`,
    `• Or set **PRIVATE_KEY** (a funded Base burner) in \`.env.local\` so the house wallet pays.`,
    ``,
    `Either way, I'll pay each selected Data endpoint for context and the Inference endpoint to answer — all over x402 on Base.`,
  ].join('\n')
}
