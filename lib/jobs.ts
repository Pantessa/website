// ─────────────────────────────────────────────────────────────────────────
//  Multi-step jobs — the orchestration primitive (HANDOFF-multistep-jobs.md).
//
//  COMPILER (pure, this file's top half): one compound ask → a FIXED
//  sequence of steps, each backed by an existing native parser. The plan is
//  compiled once, at creation — the runner executes and re-guards; it never
//  re-plans. A segment no native layer can parse fails the WHOLE compile
//  with an honest explanation (jobs are deterministic or they are nothing).
//
//  Step kinds:
//   · sign — a guarded artifact the user's wallet signs. Built FRESH at
//     offer time by the same builders chat uses; the JobCard embeds the
//     existing sign buttons.
//   · wait — a settlement predicate the runner polls. Waits ARE the
//     verification layer: the next step's build re-checks balances anyway,
//     so a lying completion just fails closed one step later.
//   · auto — a server-side action under an EXISTING consent (guardian arm
//     needs an active approveAgent delegation). Jobs never widen authority.
//
//  SEGMENT REGISTRY: every step kind the compiler understands is one entry
//  in JOB_SEGMENT_PARSERS — an ordered list of {label, parse}. Adding a new
//  chainable action (a new native layer, a new MCP-backed builder) is one
//  entry here + one builder branch in lib/jobs-runner.ts:buildSignArtifact;
//  the refusal copy lists itself from the registry so it never goes stale.
//  Order matters: earlier entries claim first (cross-chain before
//  same-chain, NFT sends before fungible sends).
// ─────────────────────────────────────────────────────────────────────────

import { parseAaveOp, parseAaveSupply, type AaveOpParams, type AaveSupplyParams } from '@/lib/aave-supply'
import { parseMorphoLend, parseMorphoOp } from '@/lib/morpho-supply'
import { parseCrossChainSwap, type CrossChainSwapParams } from '@/lib/cross-chain-swap'
import { chainAlt, canonicalChainWord, normalizeChainWords } from '@/lib/chain-lexicon'
import { parseHlIntent, type HlIntent, type HlOrderIntent } from '@/lib/hyperliquid-exec'
import { parseGuardianArm, type GuardianArmAsk } from '@/lib/hl-guardian'
import { parseLidoStake } from '@/lib/lido-stake'
import { fundingAltUsdcFor, GAS_LEG_USD } from '@/lib/lifi-bridge'
import { parseNftAsk } from '@/lib/nft-layer'
import { parseMultiSendSegments, parseTransferSegment } from '@/lib/transfer-exec'
import { pairStockToken, stockChipLabel } from '@/lib/stock-pairing'
import type { ClarifyRequest } from '@/lib/clarify'

export interface CompiledStep {
  kind: 'sign' | 'wait' | 'auto'
  /** build_path-style attribution; 'wait' for wait steps. */
  builder: string
  title: string
  params: Record<string, unknown>
  /** wait steps: what the runner polls. {kind:'oneclick', fromStep} |
   *  {kind:'hl-credit', minUsd} — fromStep indexes the step whose artifact
   *  carries the deposit address. */
  waitPredicate?: Record<string, unknown>
}

export interface CompiledJob {
  title: string
  steps: CompiledStep[]
}

// ── Robinhood funding plan ──────────────────────────────────────────────────
// "Fund robinhood chain with $12 from base including gas, then buy $10 of
// AAPL" — the exact resume string the chat route's funding-offer chips emit
// (prepareSwapTurn detects an unfunded Robinhood Chain buy and proposes the
// plan). Deterministic on purpose: the chip IS the contract, so the parse
// stays narrow — "fund robinhood … with $X from <origin> [using usdc.e |
// using eth]" and nothing looser. Origins: Base, Ethereum, Arbitrum (the
// LiFi-probed set); the "using" clause picks a registry-known bridged
// variant or native ETH.

export interface RobinhoodFundingAsk {
  /** Total dollars of origin funds to convert (gas leg included when flagged). */
  fundUsd: number
  /** True when a gas leg (origin funds → native ETH on 4663) must come first. */
  gasIncluded: boolean
  /** The origin chain the funds leave from. */
  originChainId: number
  originWord: string
  /** The origin-side sell asset: 'USDC', a registry-known bridged variant
   *  ('USDC.e' via "using usdc.e"), or native 'ETH' ("using eth"). Both
   *  legs sell it. */
  token: string
}

// Typo-tolerant chain words (shared lexicon) — captures canonicalize
// before the keyed lookups below.
const FUND_RE = new RegExp(
  String.raw`\bfund\s+robin\s?hoo?d(?:\s?chain)?\s+with\s+\$?(\d+(?:\.\d+)?)\s+from\s+(${chainAlt(['base', 'ethereum', 'arbitrum'])})\b`,
  'i',
)

const FUND_ORIGINS: Record<string, { id: number; word: string }> = {
  base: { id: 8453, word: 'Base' },
  ethereum: { id: 1, word: 'Ethereum' },
  mainnet: { id: 1, word: 'Ethereum' },
  arb: { id: 42161, word: 'Arbitrum' },
  arbitrum: { id: 42161, word: 'Arbitrum' },
}

export function parseRobinhoodFunding(segment: string): RobinhoodFundingAsk | null {
  const m = normalizeChainWords(segment).match(FUND_RE)
  if (!m) return null
  const fundUsd = Number(m[1])
  if (!Number.isFinite(fundUsd) || fundUsd <= 0) return null
  const originWord = m[2].toLowerCase().replace(/\s+/g, ' ')
  const origin = FUND_ORIGINS[canonicalChainWord(originWord) ?? originWord]
  if (!origin) return null
  return {
    fundUsd,
    gasIncluded: /\bincluding\s+gas\b/i.test(segment),
    originChainId: origin.id,
    originWord: origin.word,
    token: /\busing\s+usdc\.?e\b/i.test(segment) ? 'USDC.e' : /\busing\s+eth\b/i.test(segment) ? 'ETH' : 'USDC',
  }
}

// The buy segment that follows a funding segment ("buy $10 of AAPL"). Only
// consulted once a funding step compiled — a bare "buy $X of Y" elsewhere
// belongs to the swap layer, not the jobs compiler.
const FUND_BUY_RE = /\bbuy\s+\$?(\d+(?:\.\d+)?)(?:\s+worth)?\s+of\s+([A-Za-z]{1,10})\b/i

// ── Same-chain swap segment ────────────────────────────────────────────────
// "swap 20 USDC for WETH on Arbitrum" — the exact follow-up the funding
// plan's chips emit for sell-token shortfalls. Narrow on purpose: the verb,
// an amount, both tokens, and an EXPLICIT first-class chain word. The
// "for|into|to <token>" connector keeps it disjoint from the cross-chain
// grammar (which demands from|on right after the first token).

export interface SameChainSwapSegment {
  amountHuman: string
  sellToken: string
  buyToken: string
  chainId: number
  chainName: string
}

const SWAP_SEG_CHAINS: Record<string, { id: number; name: string }> = {
  base: { id: 8453, name: 'Base' },
  arbitrum: { id: 42161, name: 'Arbitrum' },
  arb: { id: 42161, name: 'Arbitrum' },
  ethereum: { id: 1, name: 'Ethereum' },
  mainnet: { id: 1, name: 'Ethereum' },
  robinhood: { id: 4663, name: 'Robinhood Chain' },
  'robinhood chain': { id: 4663, name: 'Robinhood Chain' },
}

const SWAP_SEG_RE = new RegExp(
  `\\bswap\\s+(\\d+(?:\\.\\d+)?)\\s+\\$?([A-Za-z]{2,12})\\s+(?:for|into|to)\\s+\\$?([A-Za-z]{2,12})\\s+on\\s+(${chainAlt(['base', 'ethereum', 'arbitrum', 'robinhood'])})\\b`,
  'i',
)

export function parseSameChainSwapSegment(segment: string): SameChainSwapSegment | null {
  const m = normalizeChainWords(segment).match(SWAP_SEG_RE)
  if (!m) return null
  const segWord = m[4].toLowerCase().replace(/\s+/g, ' ')
  const chain = SWAP_SEG_CHAINS[canonicalChainWord(segWord) ?? segWord]
  if (!chain) return null
  return { amountHuman: m[1], sellToken: m[2], buyToken: m[3], chainId: chain.id, chainName: chain.name }
}

/** Split a compound ask into segments on then/;/→ connectors. */
export function splitJobSegments(message: string): string[] {
  return message
    .split(/\s*(?:→|;|,?\s*(?:and\s+)?\bthen\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ── Segment registry ───────────────────────────────────────────────────────

/** The NFT an earlier segment named — lets "buy X then send it to 0x…"
 *  resolve the pronoun deterministically within ONE compound ask. */
export interface JobNftContext {
  ref: string
  tokenId: string | null
  contract: string | null
  chainId: number | null
}

export interface JobSegmentCtx {
  /** 0-based index of the segment in the compound ask. */
  index: number
  /** True once a Robinhood funding segment compiled earlier in the ask. */
  fundingSeen: boolean
  /** The last NFT an earlier segment named, or null. */
  nft: JobNftContext | null
  /** The FULL compound ask — clarify resume strings restate it with the
   *  ambiguous piece resolved, so a chip click round-trips this compiler. */
  message: string
}

export interface JobSegmentCompiled {
  steps: CompiledStep[]
  title: string
  /** Set to flag later segments (the funding parser gates the buy parser). */
  fundingSeen?: boolean
  /** Set when the segment named an NFT (threads pronoun follow-ups). */
  nft?: JobNftContext
}

export interface JobSegmentParser {
  id: string
  /** Plural noun phrase for the self-listing refusal copy ("token sends").
   *  Omit to keep an entry out of the copy (context-gated parsers). */
  label?: string
  parse: (seg: string, ctx: JobSegmentCtx) => JobSegmentCompiled | { problem: string } | { clarify: ClarifyRequest } | null
}

// ── Stock pairing at COMPILE time ──────────────────────────────────────────
// The 2026-07-21 "AAPLE" job: the buy segment compiled unvalidated and only
// failed at RUN time — step 3, after the funding legs had moved real money.
// Every Robinhood-bound token now pairs here, before the job exists: obvious
// names rewrite to the ticker, a suspected misspelling ASKS first (clarify
// chips whose resumes restate the whole compound ask, corrected — a chip
// click round-trips compileJobAsk), and nothing close refuses outright.
function pairJobStockToken(raw: string, ctx: JobSegmentCtx): { token: string } | { problem: string } | { clarify: ClarifyRequest } {
  const paired = pairStockToken(raw, 4663)
  if (paired.kind === 'ok') return { token: raw.toUpperCase() }
  if (paired.kind === 'paired') return { token: paired.symbol }
  if (paired.kind === 'unknown') {
    return { problem: `Robinhood Chain doesn't list "${raw}" — it carries 100 tokenized stocks (AAPL, NVDA, TSLA, …). Nothing was built.` }
  }
  const wordRe = new RegExp(`\\b${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const options = paired.candidates.map((c) => ({ label: stockChipLabel(c), resume: ctx.message.replace(wordRe, c.symbol) }))
  if (options.length < 2) options.push({ label: 'None of these — cancel', resume: 'Never mind — don’t build anything.' })
  return {
    clarify: {
      question:
        paired.candidates.length === 1
          ? `"${raw}" isn't listed on Robinhood Chain — did you mean ${stockChipLabel(paired.candidates[0])}?`
          : `"${raw}" matches a few Robinhood Chain stocks — which did you mean?`,
      options: options.slice(0, 4),
    },
  }
}

// "send it to 0x…" / "transfer the nft to name.eth" — only consulted when an
// earlier segment in the same ask named an NFT (ctx.nft).
const NFT_PRONOUN_SEND_RE = /^(?:and\s+)?(?:send|transfer|gift)\s+(?:it|that|this|the\s+nft)\s+to\s+(0x[0-9a-fA-F]{40}|[a-zA-Z0-9][a-zA-Z0-9-]*\.eth)\s*[.!?]*\s*$/i

const shortRecipient = (to: string) => (to.startsWith('0x') ? `${to.slice(0, 6)}…${to.slice(-4)}` : to)
const sendAmountWord = (amountHuman: string) => (amountHuman === 'all' ? 'all your' : amountHuman)

/**
 * Every chainable action, in claim order. To make a new dapp/MCP action
 * chainable: add an entry here (narrow parser → CompiledSteps) and a
 * matching builder branch in lib/jobs-runner.ts:buildSignArtifact. Problems
 * are returned BARE — the compiler prefixes "Step N: ".
 */
export const JOB_SEGMENT_PARSERS: JobSegmentParser[] = [
  {
    id: 'robinhood-funding',
    label: 'Robinhood Chain funding plans',
    parse: (seg) => {
      const fund = parseRobinhoodFunding(seg)
      if (!fund) return null
      // A bridged-variant ask only compiles where the registry knows the
      // token — "using usdc.e" from Base would otherwise become a job whose
      // every build refuses. Native ETH exists on every origin.
      if (fund.token !== 'USDC' && fund.token !== 'ETH' && fundingAltUsdcFor(fund.originChainId)?.symbol !== fund.token) {
        return { problem: `${fund.originWord} has no ${fund.token} in the chain registry — only Arbitrum's bridged USDC.e is supported.` }
      }
      const usdgUsd = Math.max(0, Number((fund.fundUsd - (fund.gasIncluded ? GAS_LEG_USD : 0)).toFixed(2)))
      if (usdgUsd <= 0) {
        return { problem: `$${fund.fundUsd} isn't enough to fund Robinhood Chain${fund.gasIncluded ? ` — the gas leg alone is ~$${GAS_LEG_USD}` : ''}.` }
      }
      const steps: CompiledStep[] = []
      const arrivalFrom: number[] = []
      if (fund.gasIncluded) {
        steps.push({ kind: 'sign', builder: 'native-lifi-fund', title: `Bridge ~$${GAS_LEG_USD} of gas ETH → Robinhood Chain (from ${fund.originWord})`, params: { leg: 'gas', usd: GAS_LEG_USD, origin: fund.originChainId, token: fund.token } })
        arrivalFrom.push(steps.length - 1)
      }
      steps.push({ kind: 'sign', builder: 'native-lifi-fund', title: `Move $${usdgUsd} of ${fund.originWord} ${fund.token} → USDG on Robinhood Chain`, params: { leg: 'usdg', usd: usdgUsd, origin: fund.originChainId, token: fund.token } })
      arrivalFrom.push(steps.length - 1)
      steps.push({
        kind: 'wait',
        builder: 'wait',
        title: 'Funds arrive on Robinhood Chain',
        params: {},
        waitPredicate: { kind: 'chain-arrival', fromSteps: arrivalFrom },
      })
      return { steps, title: `Fund Robinhood Chain with $${fund.fundUsd} from ${fund.originWord}`, fundingSeen: true }
    },
  },
  {
    // Context-gated: only consulted once a funding segment compiled, and the
    // arrivalFrom indices above are relative to THIS ask — a bare "buy $X of
    // Y" in any other compound ask never lands here. No label on purpose.
    id: 'robinhood-fund-buy',
    parse: (seg, ctx) => {
      if (!ctx.fundingSeen) return null
      const buy = seg.match(FUND_BUY_RE)
      if (!buy) return null
      const buyUsd = Number(buy[1])
      // Pair the ticker BEFORE the job exists — "AAPLE" must ask here, not
      // fail at step 3 after the funding legs already moved money.
      const paired = pairJobStockToken(buy[2], ctx)
      if (!('token' in paired)) return paired
      const buyToken = paired.token
      const title = `Buy ~$${buyUsd} of ${buyToken} with the arrived USDG`
      return { steps: [{ kind: 'sign', builder: 'native-lifi-swap', title, params: { buyUsd, buyToken, sellToken: 'USDG', chainId: 4663 } }], title: `Buy $${buyUsd} of ${buyToken}` }
    },
  },
  {
    // NFT buys, sends, and listings — BEFORE the fungible transfer entry, so
    // "send my Pudgy Penguin #2489 to 0x…" claims here (the mentionsNft gate
    // keeps token sends out), and ALL run before the cross-chain parse: a
    // send names an explicit 0x/ENS recipient, which the bridge grammar would
    // otherwise half-claim as a malformed destination ("send 1 USDC on base
    // to nate.eth" must be a send, not a bridge problem). Builders re-anchor
    // ownership / live listings on-chain at offer time.
    id: 'nft',
    label: 'NFT buys/transfers/listings',
    parse: (seg, ctx) => {
      // "…then send it to 0x…" — the pronoun follow-up of an earlier NFT
      // segment in the SAME ask (a just-bought NFT has no other name yet).
      // Requires prior NFT context; a bare "send it to 0x…" never lands here.
      if (ctx.nft) {
        const pronoun = seg.match(NFT_PRONOUN_SEND_RE)
        if (pronoun) {
          const ask = { kind: 'transfer', ...ctx.nft, amount: '1', to: pronoun[1] }
          const title = `Send ${ctx.nft.ref} to ${pronoun[1]}`
          return { steps: [{ kind: 'sign', builder: 'native-nft-transfer', title, params: ask }], title, nft: ctx.nft }
        }
      }
      const ask = parseNftAsk(seg)
      if (!ask) return null
      if (ask.kind === 'problem') return { problem: ask.problem }
      const nft: JobNftContext = { ref: ask.ref, tokenId: ask.tokenId, contract: ask.contract, chainId: ask.chainId }
      if (ask.kind === 'buy') {
        // The wait IS the chain step: a follow-up transfer's ownership check
        // would refuse while the fill is still confirming.
        const title = `Buy ${ask.ref} on OpenSea${ask.maxPriceEth ? ` (≤ ${ask.maxPriceEth} ETH)` : ''}`
        return {
          steps: [
            { kind: 'sign', builder: 'native-nft-buy', title, params: ask as unknown as Record<string, unknown> },
            { kind: 'wait', builder: 'wait', title: `${ask.ref} lands in your wallet`, params: {}, waitPredicate: { kind: 'nft-owned', fromStep: 0 } },
          ],
          title,
          nft,
        }
      }
      if (ask.kind === 'transfer') {
        const title = `Send ${ask.ref} to ${ask.to}`
        return { steps: [{ kind: 'sign', builder: 'native-nft-transfer', title, params: ask as unknown as Record<string, unknown> }], title, nft }
      }
      const title = `List ${ask.ref} on OpenSea${ask.priceEth ? ` for ${ask.priceEth} ETH` : ' at floor'}`
      return { steps: [{ kind: 'sign', builder: 'native-nft-list', title, params: ask as unknown as Record<string, unknown> }], title, nft }
    },
  },
  {
    // Fungible sends — "send the 1 USDC on arbitrum to 0x…". The chain word
    // is mandatory (a compiled transfer never guesses its chain) and the
    // recipient must be an explicit 0x address or ENS name — which is also
    // why sitting ahead of the cross-chain entry is safe: a real bridge ask
    // ("swap 1 USDC from base to arbitrum") has no such recipient.
    id: 'transfer',
    label: 'token sends',
    parse: (seg) => {
      // Multi-clause first: "send all my USDC on arbitrum and an additional
      // 5 USDC on base to 0x…" — ONE recipient, one sign step per clause,
      // each step's build re-reading its own chain's live balance ('all'
      // resolves at sign time, never at compile time).
      const multi = parseMultiSendSegments(seg)
      if (multi && 'problem' in multi) return { problem: multi.problem }
      if (multi) {
        const steps: CompiledStep[] = multi.map((t) => ({
          kind: 'sign',
          builder: 'native-transfer',
          title: `Send ${sendAmountWord(t.amountHuman)} ${t.token.toUpperCase()} to ${shortRecipient(t.to)} on ${t.chainName}`,
          params: t as unknown as Record<string, unknown>,
        }))
        const parts = multi.map((t) => `${sendAmountWord(t.amountHuman)} ${t.token.toUpperCase()} (${t.chainName})`).join(' + ')
        return { steps, title: `Send ${parts} to ${shortRecipient(multi[0].to)}` }
      }
      const t = parseTransferSegment(seg)
      if (!t) return null
      if ('problem' in t) return { problem: t.problem }
      const title = `Send ${sendAmountWord(t.amountHuman)} ${t.token.toUpperCase()} to ${shortRecipient(t.to)} on ${t.chainName}`
      return { steps: [{ kind: 'sign', builder: 'native-transfer', title, params: t as unknown as Record<string, unknown> }], title }
    },
  },
  {
    id: 'cross-chain-swap',
    label: 'cross-chain swaps/bridges',
    parse: (seg) => {
      const cc = parseCrossChainSwap(seg)
      if (!cc) return null
      if ('problem' in cc) return { problem: cc.problem }
      const ccp = cc as CrossChainSwapParams
      const title = `Bridge ${ccp.amount} ${ccp.originToken.toUpperCase()} (${ccp.originChain}) → ${ccp.destinationToken.toUpperCase()} (${ccp.destinationChain})`
      return {
        steps: [
          { kind: 'sign', builder: 'native-cross-chain', title, params: ccp as unknown as Record<string, unknown> },
          { kind: 'wait', builder: 'wait', title: 'Solver settles the swap', params: {}, waitPredicate: { kind: 'oneclick', fromStep: 0 } },
        ],
        title,
      }
    },
  },
  {
    // Same-chain swap segments — the funding plan's follow-up when the
    // shortfall was a swap's sell token ("fund Arbitrum, then swap 20 USDC
    // for WETH on Arbitrum"). Runs AFTER the cross-chain parse (a "from X to
    // Y" phrasing is a bridge, never this) and demands the chain word — a
    // compiled job step must never guess its chain.
    id: 'same-chain-swap',
    label: 'same-chain swaps',
    parse: (seg, ctx) => {
      const sameSwap = parseSameChainSwapSegment(seg)
      if (!sameSwap) return null
      // Robinhood-bound legs pair their tokens at compile time (obvious
      // names rewrite, suspected typos ask) — same rule as the fund-buy.
      if (sameSwap.chainId === 4663) {
        const sell = pairJobStockToken(sameSwap.sellToken, ctx)
        if (!('token' in sell)) return sell
        const buy = pairJobStockToken(sameSwap.buyToken, ctx)
        if (!('token' in buy)) return buy
        sameSwap.sellToken = sell.token
        sameSwap.buyToken = buy.token
      }
      const title = `Swap ${sameSwap.amountHuman} ${sameSwap.sellToken.toUpperCase()} → ${sameSwap.buyToken.toUpperCase()} on ${sameSwap.chainName}`
      return { steps: [{ kind: 'sign', builder: 'native-swap', title, params: sameSwap as unknown as Record<string, unknown> }], title }
    },
  },
  {
    id: 'hyperliquid',
    label: 'Hyperliquid deposits/orders',
    parse: (seg) => {
      const hl = parseHlIntent(seg)
      if (!hl) return null
      if (hl.kind === 'deposit') {
        const title = `Deposit ${hl.amountUsdc} USDC to Hyperliquid`
        return {
          steps: [
            { kind: 'sign', builder: 'native-hl-exec', title, params: hl as unknown as Record<string, unknown> },
            { kind: 'wait', builder: 'wait', title: 'Hyperliquid credits the deposit', params: {}, waitPredicate: { kind: 'hl-credit', minUsd: Math.min(hl.amountUsdc * 0.9, hl.amountUsdc - 0.5) } },
          ],
          title,
        }
      }
      const o = hl as HlOrderIntent
      const title =
        o.kind === 'close'
          ? `Close ${o.coin} on Hyperliquid`
          : `${o.leverage ? `${o.leverage}x ` : ''}${o.isBuy ? 'Long' : 'Short'} ${o.notionalUsd ? `$${o.notionalUsd} of ` : `${o.sizeUnits} `}${o.coin} on Hyperliquid`
      return { steps: [{ kind: 'sign', builder: 'native-hl-exec', title, params: hl as unknown as Record<string, unknown> }], title }
    },
  },
  {
    id: 'lido-stake',
    label: 'Lido stakes',
    parse: (seg) => {
      const lido = parseLidoStake(seg)
      if (!lido) return null
      if ('problem' in lido) return { problem: lido.problem }
      const title =
        lido.amount === 'max'
          ? `Stake the ETH on Lido${lido.receive === 'wstETH' ? ' (wstETH)' : ''}`
          : `Stake ${lido.amount} ETH on Lido${lido.receive === 'wstETH' ? ' (wstETH)' : ''}`
      return { steps: [{ kind: 'sign', builder: 'native-lido', title, params: lido as unknown as Record<string, unknown> }], title }
    },
  },
  {
    // Aave supply/repay segments — the ops a funding plan lands on. The
    // compiler has no selected-set context, so only EXPLICIT Aave asks
    // compile ("supply 20 USDC to aave"); weak/bare verbs stay chat-only.
    // Aave v4 builds run on Ethereum — a named other chain refuses honestly.
    id: 'aave-supply',
    label: 'Aave supplies/repays',
    parse: (seg) => {
      const aaveSup = parseAaveSupply(seg)
      if (!aaveSup || 'problem' in aaveSup || !aaveSup.explicitAave || aaveSup.weak) return null
      if (aaveSup.otherChain) return { problem: `Aave v4 builds run on Ethereum — I can't supply on ${aaveSup.otherChain}.` }
      const title = `Supply ${aaveSup.amount} ${aaveSup.token.toUpperCase()} to Aave v4`
      return { steps: [{ kind: 'sign', builder: 'native-aave-supply', title, params: { token: aaveSup.token, amount: aaveSup.amount } }], title }
    },
  },
  {
    id: 'aave-repay',
    label: 'Aave supplies/repays',
    parse: (seg) => {
      const aaveOp = parseAaveOp(seg)
      if (!aaveOp || 'problem' in aaveOp || aaveOp.op !== 'repay' || !aaveOp.explicitAave || aaveOp.weak) return null
      if (aaveOp.otherChain) return { problem: `Aave v4 builds run on Ethereum — I can't repay on ${aaveOp.otherChain}.` }
      const title = aaveOp.max ? `Repay the full ${aaveOp.token.toUpperCase()} debt on Aave v4` : `Repay ${aaveOp.amount} ${aaveOp.token.toUpperCase()} on Aave v4`
      return { steps: [{ kind: 'sign', builder: 'native-aave-repay', title, params: { token: aaveOp.token, amount: aaveOp.amount, max: aaveOp.max } }], title }
    },
  },
  {
    // Morpho lend/repay segments — the same discipline as the Aave entries:
    // the compiler has no selected-set context, so only EXPLICIT Morpho asks
    // compile ("lend 100 USDC on morpho"); weak/bare verbs stay chat-only.
    // The chain rides the segment (Base default, Ethereum on request); any
    // other named chain refuses honestly.
    id: 'morpho-lend',
    label: 'Morpho lends/repays',
    parse: (seg) => {
      const lend = parseMorphoLend(seg)
      if (!lend || 'problem' in lend || !lend.explicitMorpho || lend.weak) return null
      if (lend.otherChain) return { problem: `Morpho builds run on Base or Ethereum — I can't lend on ${lend.otherChain}.` }
      const title = `Lend ${lend.amount} ${lend.token.toUpperCase()} on Morpho (${lend.chainId === 1 ? 'Ethereum' : 'Base'})`
      return { steps: [{ kind: 'sign', builder: 'native-morpho-lend', title, params: { token: lend.token, amount: lend.amount, chainId: lend.chainId } }], title }
    },
  },
  {
    id: 'morpho-repay',
    label: 'Morpho lends/repays',
    parse: (seg) => {
      const mop = parseMorphoOp(seg)
      if (!mop || 'problem' in mop || mop.op !== 'repay' || !mop.explicitMorpho || mop.weak) return null
      if (mop.otherChain) return { problem: `Morpho builds run on Base or Ethereum — I can't repay on ${mop.otherChain}.` }
      const title = mop.max
        ? `Repay the full ${mop.token.toUpperCase()} debt on Morpho (${mop.chainId === 1 ? 'Ethereum' : 'Base'})`
        : `Repay ${mop.amount} ${mop.token.toUpperCase()} on Morpho (${mop.chainId === 1 ? 'Ethereum' : 'Base'})`
      return { steps: [{ kind: 'sign', builder: 'native-morpho-repay', title, params: { token: mop.token, amount: mop.amount, max: mop.max, chainId: mop.chainId } }], title }
    },
  },
  {
    id: 'guardian',
    label: 'guardian protection',
    parse: (seg) => {
      const arm = parseGuardianArm(seg)
      if (!arm) return null
      const title = `Arm ${arm.kind === 'stop_loss' ? 'stop-loss' : 'take-profit'} on ${arm.coin} (${arm.triggerMode === 'price' ? `px ${arm.triggerValue}` : `${arm.triggerValue}%`})`
      return { steps: [{ kind: 'auto', builder: 'native-hl-guardian', title, params: arm as unknown as Record<string, unknown> }], title }
    },
  },
]

/** The registry's own refusal listing — dedup'd, in claim order. */
const compilableKinds = (): string => {
  const labels = [...new Set(JOB_SEGMENT_PARSERS.map((p) => p.label).filter((l): l is string => !!l))]
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}` : labels[0] ?? ''
}

/**
 * Compile a compound ask, or explain exactly which segment can't be. Returns
 * null when the message isn't job-shaped (fewer than 2 parseable segments —
 * single asks belong to the native layers directly).
 */
export function compileJobAsk(message: string): CompiledJob | { problem: string } | { clarify: ClarifyRequest } | null {
  const segments = splitJobSegments(message)
  // Single asks belong to the native layers — EXCEPT segments that are
  // multi-step on their own: a lone Robinhood funding segment (the MCP-path
  // fallback's bridge-only chips carry no follow-up; the legs + arrival
  // wait are already a job), and a multi-clause send ("send all my USDC on
  // arbitrum and 5 USDC on base to 0x…" — one sentence, two chains, two
  // signatures = a job even without a "then").
  const loneMultiStep = (seg: string) => !!parseRobinhoodFunding(seg) || parseMultiSendSegments(seg) !== null
  if (segments.length < 2 && !(segments.length === 1 && loneMultiStep(segments[0]))) return null

  const steps: CompiledStep[] = []
  const titles: string[] = []
  let fundingSeen = false
  let nftSeen: JobNftContext | null = null
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    let matched = false
    for (const parser of JOB_SEGMENT_PARSERS) {
      const res = parser.parse(seg, { index: i, fundingSeen, nft: nftSeen, message })
      if (!res) continue
      if ('clarify' in res) return res // ask BEFORE the job exists — a chip click re-enters here resolved
      if ('problem' in res) return { problem: `Step ${i + 1}: ${res.problem}` }
      // Wait predicates reference steps by index. Entries author them LOCAL
      // to their own steps array (fromStep/fromSteps count from 0 within the
      // entry); the compiler rebases onto the job's absolute indices here, so
      // entries stay position-independent ("deposit … then fund robinhood …"
      // must not corrupt the funding legs' arrival pointers).
      const base = steps.length
      for (const s of res.steps) {
        const pred = s.waitPredicate as { fromStep?: number; fromSteps?: number[] } | undefined
        if (pred) {
          s.waitPredicate = {
            ...pred,
            ...(typeof pred.fromStep === 'number' ? { fromStep: base + pred.fromStep } : {}),
            ...(Array.isArray(pred.fromSteps) ? { fromSteps: pred.fromSteps.map((n) => base + n) } : {}),
          }
        }
        steps.push(s)
      }
      titles.push(res.title)
      if (res.fundingSeen) fundingSeen = true
      if (res.nft) nftSeen = res.nft
      matched = true
      break
    }
    if (matched) continue

    // First segment already not ours → this isn't a job ask at all; let the
    // native layers / router handle the message. But once ANY segment
    // compiled, an unparseable later segment is an honest hard stop — a job
    // with a guessed step is worse than no job.
    if (steps.length === 0) return null
    return {
      problem:
        `I can compile steps that are ${compilableKinds()} — ` +
        `step ${i + 1} ("${seg.slice(0, 80)}") isn't one of those yet, so I won't guess. ` +
        `Amounts must be explicit (e.g. "deposit 20 usdc to hyperliquid").`,
    }
  }

  // A "job" of one real action + its waits is just that action — let the
  // native layer own it directly. Two exceptions mirror the gate at the
  // top: a lone Robinhood funding segment IS the job (legs + arrival wait),
  // and a lone segment that compiled to ≥2 sign/auto steps (a multi-clause
  // send) IS one too — two chains, two signatures.
  const actionSteps = steps.filter((s) => s.kind !== 'wait').length
  if (titles.length < 2 && actionSteps < 2 && !(titles.length === 1 && fundingSeen)) return null
  return { title: titles.join(' → '), steps }
}

export type { HlIntent, GuardianArmAsk, CrossChainSwapParams, AaveSupplyParams, AaveOpParams }
