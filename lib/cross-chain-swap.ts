// ─────────────────────────────────────────────────────────────────────────
//  Native cross-chain swap building — the deterministic, guardrailed path
//  from "swap 1 USDC from Base to Arbitrum" to a SIGNABLE deposit transfer.
//
//  The native Uniswap/CoW swap layer is Base-only; this is its cross-chain
//  sibling. It NEVER goes through the planner or the house model — a terse
//  "confirm" once made the house model FABRICATE a deposit address in prose
//  (live 2026-07-10, near-lost funds). Instead we parse the ask ourselves,
//  call the NEAR Intents agent's `build_swap` tool directly, and GUARDRAIL
//  the returned transfer (it must move exactly the quoted amount to the
//  API's one-time deposit address, on the origin chain) before surfacing it
//  as a Sign button. The deposit address only ever comes from the tool, and
//  the tx the user signs is the one we verified — no model text in between.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, erc20Abi, getAddress, isAddress } from 'viem'
import type { EvmTxRequest } from '@/lib/transaction-layer'
import { chainAlt, canonicalChainWord, normalizeArrows, normalizeChainWords, prettyChainWord, unknownDestinationWord } from '@/lib/chain-lexicon'

// Chain words we accept in a swap phrase (kept separate from token matching so
// a token is never mistaken for a chain). Aliases come from the shared
// typo-tolerant lexicon; captures are canonicalized before they reach the
// MCP or any keyed lookup ("Etheruem" → ethereum). The short/ambiguous
// names (sol, btc, near, ton, tron, sui, op) are safe HERE because they
// only match inside the from/to chain slots of an already-swap-shaped ask.
const CHAIN_ALT = `${chainAlt()}|sol|btc|near|ton|tron|sui|op`

const AMOUNT = '\\d+(?:\\.\\d+)?'
const TOKEN = '\\$?[A-Za-z]{2,12}|0x[0-9a-fA-F]{40}'

// "(swap|bridge|move|convert|send) <amt> <tokenA> (from|on) <chainA>"
const ORIGIN_RE = new RegExp(
  `\\b(?:swap|bridge|move|convert|send|trade)\\s+(${AMOUNT})\\s+(${TOKEN})\\s+(?:from|on)\\s+(${CHAIN_ALT})\\b`,
  'i',
)
// "… to [[<amt>] <tokenB> (on|to)] <chainB>" — the amount AND the token are
// both optional ("to arbitrum" / "to ETH on optimism" / "to 1 USDC on arb").
const DEST_RE = new RegExp(
  `\\bto\\s+(?:(?:${AMOUNT}\\s+)?(${TOKEN})\\s+(?:on|to)\\s+)?(${CHAIN_ALT})\\b`,
  'i',
)

export interface CrossChainSwapParams {
  amount: string
  originToken: string
  originChain: string
  destinationToken: string
  destinationChain: string
  /** NEAR Confidential Intents: the route between the deposit and the payout
   *  stays off the public record. Absent = the ordinary public lane. */
  confidential?: true
  /** Deliver to this address instead of the paying wallet. Only ever typed by
   *  the user on a first-party surface (the chat route refuses it from a link
   *  or an embed host); refunds always return to the paying wallet. */
  recipient?: string
}

// ── Private mode (NEAR Confidential Intents) ────────────────────────────────
//
// What it hides: the ROUTE — which deposit became which payout. What it does
// not hide: the deposit transfer on the origin chain and the payout on the
// destination chain, both ordinary public transfers. So a private swap that
// pays out to the wallet that paid in is matchable by amount and timing; the
// privacy is real only when the payout goes to a different address. Every
// reply says so (composePrivacyLines) — never sell it as more than it is.

/** The level every private build asks for. "advanced" exists; nothing in the
 *  docs says what it adds, and the two priced identically (2026-09-21). */
export const CONFIDENTIAL_LEVEL = 'basic' as const

const PRIVATE_WORDS = '(?:privately|confidentially|in\\s+private(?:\\s+mode)?|in\\s+confidential\\s+mode|(?:using|with|via|in)\\s+(?:private|confidential|incognito)\\s+mode|incognito|as\\s+a\\s+(?:private|confidential)\\s+swap|private\\s+mode|confidential\\s+mode)'
const PRIVATE_RE = new RegExp(`(?:[,;]\\s*|\\s+|^)${PRIVATE_WORDS}(?=[\\s,.;!]|$)`, 'gi')
// "private swap of 5 USDC …" / "confidential bridge 5 USDC …" — the adjective
// sits on the verb; drop it and keep the verb.
const PRIVATE_ADJ_RE = /\b(?:private|confidential)\s+(?=(?:swap|bridge|move|convert|send|trade|transfer)\b)/gi
// "… deliver[ed] to 0x…" / "pay out to 0x…" / "receive at 0x…" / "recipient 0x…".
// A bare "to 0x…" is NOT read as a recipient: that slot is the grammar's
// destination token, and a guess there would move money to a contract.
const RECIPIENT_RE =
  /(?:[,;]\s*|\s+)(?:and\s+)?(?:deliver(?:ed|ing)?(?:\s+it)?|pay(?:\s+it)?\s+out|paid\s+out|payout|receiv(?:e|ed|ing)(?:\s+it)?|arriv(?:e|ing)|land(?:ing)?|recipient(?:\s+is)?)\s*(?:to|at|in|into|on|:)?\s*(?:address\s+|wallet\s+)?(0x[0-9a-fA-F]{40})\b/i

/** A typed 0x recipient: well-formed, a good checksum when mixed-case (a bad
 *  EIP-55 checksum is a typo'd address — refuse by name, the wallet-send
 *  rule), never the zero address. Returns the checksummed form. */
export function checkRecipient(raw: string): { ok: true; address: string } | { ok: false; problem: string } {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return { ok: false, problem: `“${raw}” isn't a full 0x address — a delivery address is 0x followed by 40 hex characters.` }
  if (/^0x0{40}$/.test(raw)) return { ok: false, problem: `That's the zero address — anything delivered there is gone. Give me the address you want the funds to land at.` }
  const mixed = /[a-f]/.test(raw.slice(2)) && /[A-F]/.test(raw.slice(2))
  if (mixed && !isAddress(raw, { strict: true })) {
    return { ok: false, problem: `The delivery address ${raw} fails its checksum — one character is likely wrong. Paste it again and I'll build it.` }
  }
  return { ok: true, address: getAddress(raw.toLowerCase()) }
}

/** Pull the privacy words and the delivery clause OUT of the sentence, so the
 *  swap grammar below reads exactly what it always has. */
export function extractPrivacy(message: string): { rest: string; confidential: boolean; recipient?: string; problem?: string } {
  let rest = message
  let recipient: string | undefined
  let problem: string | undefined
  const r = rest.match(RECIPIENT_RE)
  if (r) {
    const checked = checkRecipient(r[1])
    if (checked.ok) recipient = checked.address
    else problem = checked.problem
    rest = rest.replace(r[0], ' ')
  }
  const before = rest
  rest = rest.replace(PRIVATE_ADJ_RE, '').replace(PRIVATE_RE, ' ')
  const confidential = rest !== before
  return { rest: rest.replace(/\s{2,}/g, ' ').replace(/\s+([,.;!])/g, '$1').trim(), confidential, ...(recipient ? { recipient } : {}), ...(problem ? { problem } : {}) }
}

/** Chains a private swap isn't built for: money moves INTO them over LiFi,
 *  which has no confidential lane. A private ask never quietly becomes a
 *  public bridge. (1Click lists Robinhood Chain — confidential routes
 *  included — since 2026-09-21; wiring the private lane there is its own
 *  change. Arc is still unlisted.) */
const NO_PRIVATE_LANE = new Set(['robinhood', 'arc'])

const cleanTok = (t: string) => t.replace(/^\$/, '')

// Under-specified shapes that are still clearly cross-chain moves — each
// gets an honest clarify naming EXACTLY the missing piece, never a generic
// re-ask for things already in the message (the 2026-07-22 dead-end).
// "move my USDC from base to solana" — origin present, amount missing.
const AMOUNTLESS_RE = new RegExp(
  `\\b(?:swap|bridge|move|convert|send|trade|transfer)\\s+(?:my\\s+|all\\s+(?:my\\s+)?|some\\s+)?(${TOKEN})\\s+(?:from|on)\\s+(${CHAIN_ALT})\\b`,
  'i',
)
// "bridge 5 USDC to Arbitrum" — destination present, origin missing.
const DEST_ONLY_RE = new RegExp(
  `\\b(?:swap|bridge|move|convert|send|trade|transfer)\\s+(${AMOUNT})\\s+(${TOKEN})\\s+(?:to|into|onto)\\s+(${CHAIN_ALT})\\b`,
  'i',
)

/**
 * Parse an imperative cross-chain swap. Returns the params, a `problem` when
 * it's clearly a cross-chain swap but under-specified, or null when it isn't
 * one at all (→ falls through to normal routing / quote questions).
 */
// "$1 USDC" / "$5 worth of USDC" — a dollar sign on a STABLE is the amount
// itself (1:1, the Aave grammar's rule, website#713). The origin grammar
// only reads "<amt> <token>", so "Convert $1 USDC from Base to USDG on
// Robinhood Chain" fell to the planner for a $2k wallet (prod 2026-09-04).
// Non-stables keep their dollar sign and get a clarify below — a bridge is
// sized in the token it moves, and this layer never prices one.
const DOLLAR_STABLE_RE = /\$\s?(\d+(?:\.\d+)?)(?:\s+worth)?(?:\s+(?:of|in))?\s+(usdc\.e|usdc|usdt|usdg|dai|usde)\b/gi
const DOLLAR_OTHER_RE = new RegExp(
  `\\b(?:swap|bridge|move|convert|send|trade|transfer)\\s+\\$\\s?(\\d+(?:\\.\\d+)?)(?:\\s+worth)?(?:\\s+(?:of|in))?\\s+([A-Za-z]{2,12})\\s+(?:from|on)\\s+(${CHAIN_ALT})\\b`,
  'i',
)

export function parseCrossChainSwap(rawMessage: string): CrossChainSwapParams | { problem: string } | null {
  const privacy = extractPrivacy(rawMessage)
  const parsed = parseCrossChainCore(privacy.rest)
  if (!parsed || 'problem' in parsed) return parsed
  if (!privacy.confidential && !privacy.recipient && !privacy.problem) return parsed
  // From here the sentence IS a cross-chain swap and it asked for privacy
  // and/or a delivery address — anything we can't honor refuses by name.
  if (privacy.problem) return { problem: privacy.problem }
  const lane = [parsed.originChain, parsed.destinationChain].map((c) => canonicalChainWord(c) ?? c.toLowerCase()).find((c) => NO_PRIVATE_LANE.has(c))
  if (lane) {
    return {
      problem: `Private mode and separate delivery addresses aren't available on ${prettyChainWord(lane)} yet — moves there go over a public bridge. Drop “privately”${privacy.recipient ? ' and the delivery address' : ''} and I'll build the ordinary move, or pick another chain.`,
    }
  }
  return { ...parsed, ...(privacy.confidential ? { confidential: true as const } : {}), ...(privacy.recipient ? { recipient: privacy.recipient } : {}) }
}

function parseCrossChainCore(rawMessage: string): CrossChainSwapParams | { problem: string } | null {
  const message = normalizeChainWords(normalizeArrows(rawMessage)).replace(DOLLAR_STABLE_RE, '$1 $2')
  const dollarOther = message.match(DOLLAR_OTHER_RE)
  if (dollarOther) {
    const tok = dollarOther[2].toUpperCase()
    const originWord = prettyChainWord(canonicalChainWord(dollarOther[3]) ?? dollarOther[3])
    return {
      problem: `A cross-chain move is sized in the token it moves, and I don't price ${tok} on this path — say the amount in ${tok}, e.g. “swap 0.002 ${tok} from ${originWord} to Arbitrum”.`,
    }
  }
  const o = message.match(ORIGIN_RE)
  if (!o) {
    // Wh-questions ("what's the cheapest way to move USDT from …") belong to
    // the planner's quote tools — the clarifies below are for imperatives.
    if (/^\s*(?:what|how|why|where|when|which|who)\b/i.test(message)) return null
    const al = message.match(AMOUNTLESS_RE)
    if (al) {
      const tok = cleanTok(al[1]).toUpperCase()
      const dest = message.slice((al.index ?? 0) + al[0].length).match(DEST_RE)
      const destWord = dest ? prettyChainWord(canonicalChainWord(dest[2]) ?? dest[2]) : 'Arbitrum'
      const originWord = prettyChainWord(canonicalChainWord(al[2]) ?? al[2])
      return { problem: `How much ${tok}? Say e.g. “swap 5 ${tok} from ${originWord} to ${destWord}” and I'll build it.` }
    }
    const dOnly = message.match(DEST_ONLY_RE)
    if (dOnly) {
      const tok = cleanTok(dOnly[2]).toUpperCase()
      return { problem: `Which chain should the ${dOnly[1]} ${tok} come FROM? Say e.g. “swap ${dOnly[1]} ${tok} from Base to ${prettyChainWord(canonicalChainWord(dOnly[3]) ?? dOnly[3])}” and I'll build it.` }
    }
    return null
  }
  const rest = message.slice((o.index ?? 0) + o[0].length)
  const d = rest.match(DEST_RE)
  const originToken = cleanTok(o[2])
  if (!d) {
    // Grammar missed the destination — but before re-asking for what may
    // already be in the message, try the word actually sitting in the "to …"
    // slot: a fuzzy chain typo becomes the destination, and a word we truly
    // don't know gets NAMED in the clarify (the "Etheruem" dead-end asked
    // for "the amount and pair" the user had already typed).
    const unknown = unknownDestinationWord(rest)
    const fuzzy = rest.match(/\bto\s+([A-Za-z]{5,14})\b/i)
    const fuzzyChain = fuzzy ? canonicalChainWord(fuzzy[1]) : null
    if (fuzzyChain) {
      return {
        amount: o[1],
        originToken,
        originChain: canonicalChainWord(o[3]) ?? o[3],
        destinationToken: originToken,
        destinationChain: fuzzyChain,
      }
    }
    if (unknown) {
      return {
        problem: `I don't recognize “${unknown}” as a chain. I can reach Base, Ethereum, Arbitrum, Optimism, Polygon, Solana, and ~30 more — say the destination like “swap ${o[1]} ${originToken.toUpperCase()} from ${o[3]} to Arbitrum”.`,
      }
    }
    return { problem: `Got it — ${o[1]} ${originToken.toUpperCase()} from ${o[3]}. Tell me the destination chain too, e.g. “swap ${o[1]} ${originToken.toUpperCase()} from ${o[3]} to Arbitrum”.` }
  }
  return {
    amount: o[1],
    originToken,
    // Canonicalize before the MCP call / chain-id lookups — the grammar
    // accepts typo aliases, downstream maps key on canonical words.
    originChain: canonicalChainWord(o[3]) ?? o[3],
    // Same token on the other chain unless a second token is named.
    destinationToken: d[1] ? cleanTok(d[1]) : originToken,
    destinationChain: canonicalChainWord(d[2]) ?? d[2],
  }
}

// EVM chain ids for the origin chains the MCP can BUILD on — used only to
// sanity-check the built tx's chainId (the MCP already refuses non-EVM origins).
const ORIGIN_CHAIN_IDS: Record<string, number> = {
  base: 8453,
  arbitrum: 42161,
  arb: 42161,
  ethereum: 1,
  mainnet: 1,
  optimism: 10,
  op: 10,
  polygon: 137,
  matic: 137,
  bnb: 56,
  bsc: 56,
  binance: 56,
  avalanche: 43114,
  avax: 43114,
  gnosis: 100,
  xdai: 100,
  scroll: 534352,
  // Robinhood Chain: 1Click's "hood" since 2026-09-21. Money going IN still
  // redirects onto the LiFi funding plan (lib/jobs — LiFi out-delivered NEAR
  // on every measured row, and NEAR has no liquidity into gas ETH); money
  // coming OUT builds here (USDG/ETH → any chain, ~30s vs the canonical
  // bridge's 7 days).
  robinhood: 4663,
  'robinhood chain': 4663,
  // Arc (5042): NEAR Intents lists no Arc asset (1Click tokens probed
  // 2026-09-16), so a cross-chain ask INTO Arc is redirected onto the LiFi
  // funding plan by lib/jobs (like Robinhood Chain); the id here only
  // sanity-checks a built tx's chainId.
  arc: 5042,
}

export function expectedOriginChainId(chain: string): number | null {
  return ORIGIN_CHAIN_IDS[chain.trim().toLowerCase()] ?? null
}

// ── The shape `build_swap` returns (the slices we verify) ────────────────────
interface BuiltStep {
  action?: string
  label?: string
  summary?: string
  tx?: { to?: string; data?: string; value?: string; chainId?: number }
}
/** The app-fee echo the MCP passes through from 1Click's quote response:
 *  what we asked for, and the 50/50 split 1Click actually applied. */
export interface BuiltAppFee {
  requested?: Array<{ recipient?: string; fee?: number }>
  applied?: Array<{ recipient?: string; fee?: number }> | null
  note?: string
}
export interface BuiltSwap {
  kind?: string
  appFee?: BuiltAppFee
  quote?: { sell?: { amountAtoms?: string; token?: string; chain?: string; usd?: string }; receive?: { token?: string; chain?: string }; summary?: string }
  deposit?: { address?: string; addressExpires?: string | null; deliveredTo?: string; refundsGoTo?: string }
  /** Present only when the venue ECHOED the confidential level we asked for. */
  confidential?: { level?: string; deliversToPayer?: boolean; note?: string }
  balanceCheck?: { ok?: boolean | null; note?: string }
  steps?: BuiltStep[]
  warnings?: string[]
}

/**
 * Guardrail-priced notional of the leg — the quote's own USD figure (the
 * 1Click API prices the sell side as `amountInUsd`), null when absent or
 * unparseable. Must ride guardrails.valueUsd on every offered build: a
 * signed turn with null value never counts toward money moved and never
 * ranks on the intent-links board.
 */
export function crossChainValueUsd(built: BuiltSwap): number | null {
  const usd = Number(built.quote?.sell?.usd)
  return Number.isFinite(usd) && usd > 0 ? Number(usd.toFixed(2)) : null
}

export interface GuardResult {
  ok: boolean
  /** Block reasons — when non-empty the tx must NOT be offered for signing. */
  reasons: string[]
  /** Advisory notes (e.g. low balance) — shown but not blocking. */
  warnings: string[]
  /** Operator-only notes about the venue fee — traced, never user-facing. */
  feeNotes?: string[]
  /** Net bps of the venue fee this build actually carries (0 when none). */
  feeBps?: number
  tx?: EvmTxRequest
  depositAddress?: string
  summary?: string
  addressExpires?: string | null
}

const eqAddr = (a?: string, b?: string): boolean => {
  if (!a || !b) return false
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return a.toLowerCase() === b.toLowerCase()
  }
}

/**
 * Verify a `build_swap` result before it can be signed. The one job that
 * matters for safety: the transaction the user signs must transfer EXACTLY
 * the quoted amount to the API's one-time deposit address, on the origin
 * chain — nothing the model wrote, only what the tool built and we decoded.
 */
/** The most of a quote 1Click's OWN share may take before we call the fill
 *  unusual and refuse. The venue's share is priced into the delivered
 *  amount (the parity and price guards see it); this is only a fence
 *  against a runaway number. Live 2026-09-15: 20 bps. */
export const VENUE_SHARE_MAX_BPS = 100

/**
 * Verify the venue fee on a build we asked to carry one. The user's funds are
 * never at risk from the fee itself — it comes out of the OUTPUT, so a
 * missing one costs us revenue, not them — but an EVM recipient we did NOT
 * pin means someone redirected value out of the user's swap, and that is a
 * refusal. 1Click's own protocol share arrives as a non-EVM implicit
 * account, so only 0x recipients are ours to police.
 *
 * Returns block reasons (fatal) and notes (advisory, e.g. the fee silently
 * didn't apply because the MCP hasn't been redeployed yet).
 */
export function checkCrossChainFee(
  built: BuiltSwap,
  expected: { recipient: string; bps: number } | null,
): { reasons: string[]; notes: string[] } {
  const reasons: string[] = []
  const notes: string[] = []
  const applied = built.appFee?.applied ?? []
  const isEvm = (f: { recipient?: string }) => typeof f.recipient === 'string' && /^0x[0-9a-fA-F]{40}$/.test(f.recipient)
  const bpsOf = (fs: Array<{ fee?: number }>) => fs.reduce((s, f) => s + (typeof f.fee === 'number' ? f.fee : 0), 0)
  const evmEntries = applied.filter(isEvm)
  // 1Click's own share: a non-EVM implicit account. 2026-09-15 the venue
  // started echoing it on EVERY quote (20 bps, even with no appFees asked)
  // and stopped netting it out of ours (our 20 → treasury 10 + protocol
  // 20). It is priced into the delivered amount the parity and price
  // guards already check, so it is neither a reason nor a note (a note
  // means "our fee didn't apply" to the caller, which zeroes the claimed
  // feeBps) — only a sanity fence against a runaway number.
  const protocolBps = bpsOf(applied.filter((f) => !isEvm(f)))
  if (protocolBps > VENUE_SHARE_MAX_BPS) {
    reasons.push(`The venue's own share of this quote is ${protocolBps} bps — more than the ${VENUE_SHARE_MAX_BPS} bps we accept, refusing an unusual fill.`)
  }
  if (!expected) {
    // We asked for no fee — an app fee to ANY EVM recipient is value leaving
    // the swap that nobody pinned, and we refuse rather than pass it on.
    if (evmEntries.length) reasons.push('The quote carries an app fee we did not request — refusing.')
    return { reasons, notes }
  }
  if (!applied.length) {
    notes.push('fee not applied by the venue (older MCP build) — the swap is unaffected')
    return { reasons, notes }
  }
  const ours = evmEntries.filter((f) => eqAddr(f.recipient, expected.recipient))
  const foreign = evmEntries.filter((f) => !eqAddr(f.recipient, expected.recipient))
  if (foreign.length > 0) {
    reasons.push(`The quote pays an app fee to an address we did not pin (${foreign[0].recipient}) — refusing.`)
  }
  if (ours.length === 0) {
    notes.push('fee not applied by the venue — the swap is unaffected')
  }
  const oursBps = bpsOf(ours)
  if (oursBps > expected.bps) {
    reasons.push(`The quote's app fee (${oursBps} bps to our treasury) exceeds the ${expected.bps} bps we requested — refusing.`)
  }
  return { reasons, notes }
}

export function guardCrossChainBuild(
  built: BuiltSwap,
  expected: {
    chainId: number | null
    fee?: { recipient: string; bps: number } | null
    /** Pass on every private build — the venue must echo the level. */
    confidential?: boolean
    /** Where the payout must land. Pass on every build that names one. */
    deliverTo?: string | null
    /** Where refunds must return: the paying wallet. */
    refundTo?: string | null
  },
): GuardResult {
  const reasons: string[] = []
  const warnings: string[] = []

  // A private ask the venue (or an older MCP build that drops the field) did
  // not honor would hand the user an ordinary public swap they believe is
  // private. Refuse; and refuse the mirror — privacy nobody asked for.
  const echoedLevel = built.confidential?.level
  if (expected.confidential && echoedLevel !== CONFIDENTIAL_LEVEL) {
    reasons.push('Private mode was asked for but the venue did not confirm it — a private swap never falls back to a public one.')
  }
  if (!expected.confidential && echoedLevel) {
    reasons.push('The build came back marked confidential, which was not asked for.')
  }
  // The payout address is the one value in this build the deposit calldata
  // cannot prove — it lives in the venue's quote. Bind it to what the tool
  // says it quoted; a build that names a different address (or, when a
  // separate address was asked for, names none) refuses.
  const deliveredTo = built.deposit?.deliveredTo?.trim().split(/\s+/)[0]
  if (expected.deliverTo) {
    if (deliveredTo ? !eqAddr(deliveredTo, expected.deliverTo) : expected.deliverTo !== expected.refundTo) {
      reasons.push(`The quote delivers to ${deliveredTo ?? 'an address it did not name'}, not ${expected.deliverTo}.`)
    }
  }
  if (expected.refundTo && built.deposit?.refundsGoTo && !eqAddr(built.deposit.refundsGoTo, expected.refundTo)) {
    reasons.push('Refunds on this quote would not return to your wallet.')
  }

  const step = built.steps?.[0]
  const tx = step?.tx
  const depositAddress = built.deposit?.address
  const amountAtoms = built.quote?.sell?.amountAtoms

  if (built.kind !== 'swap_ready' || !step || step.action !== 'send_transaction' || !tx?.to) {
    reasons.push('The swap did not build into a signable transaction.')
    return { ok: false, reasons, warnings }
  }
  if (!depositAddress || !isAddress(depositAddress)) {
    reasons.push('No valid one-time deposit address was returned — refusing to build a transfer to an unknown address.')
    return { ok: false, reasons, warnings }
  }
  if (!amountAtoms) {
    reasons.push('The quoted amount is missing — cannot verify the transfer amount.')
    return { ok: false, reasons, warnings }
  }
  if (expected.chainId !== null && tx.chainId !== expected.chainId) {
    reasons.push(`The built transaction targets chain ${tx.chainId ?? '?'}, not the origin chain (${expected.chainId}).`)
  }

  const data = tx.data ?? '0x'
  const value = tx.value ?? '0'
  if (data === '0x') {
    // Native transfer: the value goes straight to the deposit address.
    if (!eqAddr(tx.to, depositAddress)) {
      reasons.push('The native transfer is not addressed to the quoted deposit address.')
    }
    if (BigInt(value) !== BigInt(amountAtoms)) {
      reasons.push('The native transfer amount does not match the quote.')
    }
  } else {
    // ERC-20 transfer(depositAddress, amountIn) to the token contract.
    if (value !== '0') reasons.push('An ERC-20 transfer must carry zero native value.')
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: data as `0x${string}` })
      if (decoded.functionName !== 'transfer') {
        reasons.push(`The transaction calls "${decoded.functionName}", not transfer — refusing.`)
      } else {
        const [to, amt] = decoded.args as [string, bigint]
        if (!eqAddr(to, depositAddress)) reasons.push('The transfer recipient is not the quoted deposit address.')
        if (amt !== BigInt(amountAtoms)) reasons.push('The transfer amount does not match the quote.')
      }
    } catch {
      reasons.push('Could not decode the transfer calldata — refusing to sign an opaque transaction.')
    }
  }

  if (built.balanceCheck?.ok === false && built.balanceCheck.note) {
    warnings.push(built.balanceCheck.note)
  }

  // Fee problems that BLOCK are reasons; the rest are operator notes (traced,
  // never shown as a "⚠️ Heads up" — a fee that didn't apply is our revenue
  // problem, not something the user needs to worry about mid-swap).
  const fee = checkCrossChainFee(built, expected.fee ?? null)
  reasons.push(...fee.reasons)

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    feeNotes: fee.notes,
    // What the USER paid (the requested rate), only once the venue confirms
    // it applied — the disclosure line must never claim a fee that isn't on
    // the quote, and never omit one that is.
    feeBps: fee.notes.length === 0 && expected.fee ? expected.fee.bps : 0,
    tx: reasons.length === 0 ? { to: tx.to, data, value, chainId: tx.chainId, action: 'deposit' } : undefined,
    depositAddress,
    summary: step.summary ?? built.quote?.summary,
    addressExpires: built.deposit?.addressExpires ?? null,
  }
}

// ── Pending-action follow-ups (cancel / amend), same idea as swap-intent ─────

const CC_CANCEL_RE =
  /^(?:no[,.!]?\s*)?(?:cancel|scratch|drop|abandon|abort|forget|nevermind|never\s+mind|don'?t)(?:\s+(?:it|that|this|the))?(?:\s+(?:swap|bridge|transfer|deposit|one))?[.!\s]*$/i
const CC_AMEND_RE = new RegExp(
  `^(?:ok(?:ay)?[,.]?\\s*)?(?:actually[,.]?\\s*)?(?:make\\s+(?:it|that)|change\\s+(?:it|that)(?:\\s+to)?|do)\\s+(${AMOUNT})(?:\\s+[A-Za-z]{2,12})?(?:\\s+instead)?[.!?\\s]*$`,
  'i',
)

// "make it private" / "go private" / "turn on private mode" — and the way back.
const CC_PRIVATE_ON_RE = /^(?:ok(?:ay)?[,.]?\s*)?(?:actually[,.]?\s*)?(?:make\s+(?:it|that|this)\s+(?:private|confidential)|go\s+(?:private|confidential|incognito)|(?:turn|switch)\s+(?:on\s+)?(?:private|confidential|incognito)(?:\s+mode)?(?:\s+on)?|(?:use|enable)\s+(?:private|confidential|incognito)\s+mode|do\s+it\s+privately|privately)\b/i
const CC_PRIVATE_OFF_RE = /^(?:ok(?:ay)?[,.]?\s*)?(?:actually[,.]?\s*)?(?:make\s+(?:it|that|this)\s+public|go\s+public|(?:turn|switch)\s+off\s+(?:private|confidential|incognito)(?:\s+mode)?|(?:turn|switch)\s+(?:private|confidential|incognito)(?:\s+mode)?\s+off|disable\s+(?:private|confidential|incognito)\s+mode|not\s+private(?:ly)?)[.!\s]*$/i
const CC_DELIVER_RE = /(?:deliver(?:\s+it)?|pay(?:\s+it)?\s+out|send\s+(?:it|the\s+payout)|recipient(?:\s+is)?)\s*(?:to|at|:)?\s*(?:address\s+|wallet\s+)?(0x[0-9a-fA-F]*)/i
const CC_DELIVER_BACK_RE = /^(?:ok(?:ay)?[,.]?\s*)?(?:actually[,.]?\s*)?(?:deliver(?:\s+it)?|pay(?:\s+it)?\s+out|send\s+it)\s+(?:back\s+)?to\s+(?:my\s+(?:own\s+)?wallet|me|myself|this\s+wallet)[.!\s]*$/i

export type CrossChainFollowUp =
  | { kind: 'cancel' }
  | { kind: 'problem'; problem: string }
  | { kind: 'amend'; params: CrossChainSwapParams }
  | { kind: 'noop' }

/**
 * Resolve a follow-up against a pending cross-chain swap (already built +
 * awaiting signature). Conservative: cancel, an amount amendment, or noop
 * (an affirmation like "confirm"/"yes" — the button is already there, so we
 * just re-point at it, never re-fabricate). Anything else returns null → the
 * message routes normally.
 */
export function parseCrossChainFollowUp(
  message: string,
  pending: { kind: string; data: Record<string, string> } | undefined,
): CrossChainFollowUp | null {
  if (!pending || pending.kind !== 'xchain') return null
  const text = message.trim()
  if (CC_CANCEL_RE.test(text)) return { kind: 'cancel' }
  const base: CrossChainSwapParams = {
    amount: pending.data.amount ?? '',
    originToken: pending.data.originToken ?? '',
    originChain: pending.data.originChain ?? '',
    destinationToken: pending.data.destinationToken ?? '',
    destinationChain: pending.data.destinationChain ?? '',
    ...(pending.data.confidential === '1' ? { confidential: true as const } : {}),
    ...(pending.data.recipient && /^0x[0-9a-fA-F]{40}$/.test(pending.data.recipient) ? { recipient: pending.data.recipient } : {}),
  }
  // Privacy amendments — the sign card's Private switch sends these exact
  // sentences (components/PrivateSwapToggle), so the switch and a typed ask
  // are one code path. A delivery address implies private mode: a payout to
  // a second address over the PUBLIC lane is a labeled trail between the two.
  const deliver = text.match(CC_DELIVER_RE)
  if (deliver) {
    const checked = checkRecipient(deliver[1])
    if (!checked.ok) return { kind: 'problem', problem: checked.problem }
    return { kind: 'amend', params: { ...base, confidential: true, recipient: checked.address } }
  }
  if (CC_DELIVER_BACK_RE.test(text)) {
    const { recipient: _drop, ...mine } = base
    return { kind: 'amend', params: mine }
  }
  if (CC_PRIVATE_OFF_RE.test(text)) {
    const { confidential: _c, recipient: _r, ...pub } = base
    return { kind: 'amend', params: pub }
  }
  if (CC_PRIVATE_ON_RE.test(text) && text.length <= 60) return { kind: 'amend', params: { ...base, confidential: true } }
  const amend = text.match(CC_AMEND_RE)
  if (amend) {
    // A new size keeps the privacy choice — "make it 2" must not quietly
    // turn a private swap public.
    return { kind: 'amend', params: { ...base, amount: amend[1] } }
  }
  // "confirm" / "yes" / "go ahead" against an already-built swap → the button
  // is right there; don't build a second deposit address, just say so.
  if (/^(?:ok(?:ay)?|yes|yep|yeah|confirm|go(?:\s+ahead)?|do\s+it|proceed|send\s+it|sign)[.!\s]*$/i.test(text)) {
    return { kind: 'noop' }
  }
  return null
}

export function crossChainPending(params: CrossChainSwapParams, depositAddress: string, summary: string) {
  return {
    kind: 'xchain',
    summary,
    data: {
      amount: params.amount,
      originToken: params.originToken,
      originChain: params.originChain,
      destinationToken: params.destinationToken,
      destinationChain: params.destinationChain,
      depositAddress,
      // 8 keys — the working-context sanitizer's cap. Keep it at 8.
      ...(params.confidential ? { confidential: '1' } : {}),
      ...(params.recipient ? { recipient: params.recipient } : {}),
    },
  }
}

/** What the sign card's Private switch reads (rides on txRequest.privacy). */
export interface SwapPrivacy {
  confidential: boolean
  /** Set when the payout goes somewhere other than the paying wallet. */
  recipient?: string
  /** False on a link or an embed: only you, typing, choose where money lands. */
  canDeliverElsewhere: boolean
}

/** The honest lines a private build adds to its reply. */
export function composePrivacyLines(params: CrossChainSwapParams, wallet: string): string[] {
  if (!params.confidential) return []
  const elsewhere = Boolean(params.recipient && params.recipient.toLowerCase() !== wallet.toLowerCase())
  return [
    `- **Private mode:** on — the route between your deposit and the payout stays off the public record (NEAR Confidential Intents). Same single signature.`,
    elsewhere
      ? `- **Still public:** your deposit on ${prettyChainWord(params.originChain)} and the payout on ${prettyChainWord(params.destinationChain)} are ordinary transfers. What's hidden is that they belong together. Refunds return to your wallet, not the delivery address.`
      : `- **Still public:** your deposit and the payout are ordinary transfers, and both touch this wallet — anyone can match them by amount and timing. For real privacy, deliver to an address that isn't linked to this one: say “deliver it to 0x…”.`,
  ]
}
