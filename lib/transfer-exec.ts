// ─────────────────────────────────────────────────────────────────────────
//  Native transfer layer — the deterministic, guardrailed path from "send
//  1 USDC on arbitrum to 0x…" to a SIGNABLE artifact. ERC-20 and native
//  ETH, on the first-class registry chains. The riskiest primitive in the
//  whole layer (value leaves to an ARBITRARY recipient, irreversibly), so
//  everything is pinned:
//    · parse is deterministic regex — send/transfer verb, an explicit
//      amount + token, an explicit 0x/ENS recipient, and an EXPLICIT chain
//      word (a transfer must never guess its chain). NFT-shaped sends
//      ("send my Pudgy #2489 to 0x…") belong to lib/nft-layer and are
//      declined here by the same mentionsNft gate that layer claims with.
//    · calldata is locally encoded, then re-decoded by an independent
//      guard: transfer(to, amount) on the exact token, recipient and amount
//      exactly as asked. Native sends pin value === asked atoms, empty data.
//    · balance is read live before offering — never a send the wallet
//      can't fund.
//    · the venue-neutral policy gate runs at TRANSFER_POLICY_HOST. It is
//      deliberately NOT in NATIVE_VENUE_HOSTS: an arbitrary-recipient send
//      is exactly what a curated allowlist should get to gate; the
//      SpendPolicyFix card offers the allow when a curated account blocks.
//  Used by chat (single ask → SendTxButton) and the jobs runner
//  ('native-transfer' steps in "swap … then send …" chains).
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, encodeFunctionData, erc20Abi, formatUnits, parseUnits } from 'viem'
import { normalize } from 'viem/ens'
import { chainById, publicClientFor } from '@/lib/chains'
import { chainAlt, canonicalChainWord, normalizeChainWords } from '@/lib/chain-lexicon'
import { resolveToken, tokenDecimals, tokenLabel } from '@/lib/cow'
import { ensureTokenList } from '@/lib/token-list'
import { usdPerToken } from '@/lib/usd-probe'
import { buildReport, policyCheck, type GuardrailCheck, type GuardrailReport } from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'
import { mentionsNft } from '@/lib/nft-layer'
import type { EvmTxRequest } from '@/lib/transaction-layer'

/** Spend-attribution host for native sends. NOT always-allowed on purpose —
 *  see the header. Labeled in lib/venue-hosts so the fix-it UI reads well. */
export const TRANSFER_POLICY_HOST = 'transfer.yeetful.com'

export interface TransferSegment {
  /** Human token amount, or the literal 'all' ("send all my USDC…") —
   *  resolved from the LIVE balance at build time: ERC-20 sends the full
   *  balance, native ETH keeps a per-chain gas reserve back so the send
   *  itself can still pay. Jobs benefit for free: a job's step builds fresh
   *  at sign time, so "all" is sized AFTER the earlier steps moved money. */
  amountHuman: string
  token: string
  /** 0x address or ENS name, exactly as typed. */
  to: string
  chainId: number
  chainName: string
}

// Mirrors the jobs compiler's SWAP_SEG_CHAINS — a compiled/built transfer
// must name a first-class chain explicitly, never inherit one.
const TRANSFER_CHAINS: Record<string, { id: number; name: string }> = {
  base: { id: 8453, name: 'Base' },
  arbitrum: { id: 42161, name: 'Arbitrum' },
  arb: { id: 42161, name: 'Arbitrum' },
  ethereum: { id: 1, name: 'Ethereum' },
  mainnet: { id: 1, name: 'Ethereum' },
  robinhood: { id: 4663, name: 'Robinhood Chain' },
  'robinhood chain': { id: 4663, name: 'Robinhood Chain' },
}

// Typo-tolerant native-chain words from the shared lexicon ("Etheruem",
// "arbitum" are real users, live 2026-07-22); captures canonicalize before
// the TRANSFER_CHAINS lookup.
const CHAIN_WORDS = chainAlt(['base', 'ethereum', 'arbitrum', 'robinhood'])
const RECIPIENT = String.raw`(0x[0-9a-fA-F]{40}|[a-zA-Z0-9][a-zA-Z0-9-]*\.eth)`
// A send's amount slot: an explicit number, or an all-flavored phrase
// ("all my", "all of the", "my entire") that resolves to the live balance
// at build time. Normalized to the 'all' sentinel by amountOf().
const AMOUNT_OR_ALL = String.raw`(\d+(?:\.\d+)?|all(?:\s+(?:of\s+)?(?:my|the))?|my\s+entire)`
const amountOf = (raw: string) => (/^\d/.test(raw) ? raw : 'all')
// "send (the) 1 USDC on arbitrum to 0x…" — chain mid, Nate's phrasing.
const TRANSFER_MID_RE = new RegExp(
  String.raw`\b(?:send|transfer)\s+(?:the\s+)?${AMOUNT_OR_ALL}\s+\$?([A-Za-z]{2,12})(?:\s+balance)?\s+(?:on\s+(${CHAIN_WORDS})\s+)?to\s+${RECIPIENT}(?:\s+on\s+(${CHAIN_WORDS}))?\b`,
  'i',
)

// ── Multi-clause sends — ONE recipient, several (amount, token, chain)
//    clauses ("send all my USDC on arbitrum and an additional 5 USDC on
//    base to 0x…", live ask 2026-07-23). Each clause names its OWN chain —
//    a multi-send never guesses which chain a clause meant — and the whole
//    ask compiles into one job, one sign step per clause (each step's
//    build re-reads that chain's live balance when it's the user's turn).
// Lazy body up to the FIRST "to <recipient>" — trailing words after the
// recipient ("…to 0x… please") don't break the read.
const MULTI_SEND_RE = new RegExp(String.raw`\b(?:send|transfer)\s+(?:the\s+)?(.+?)\s+to\s+${RECIPIENT}`, 'i')
// Clauses separate on "and"/"plus" OR a bare comma ("send 1 USDC on base, 2
// USDC on arbitrum to 0x…" — a list, no conjunction). The comma branch
// demands whitespace AFTER the comma so a thousands separator is never a
// split point: "1,000 USDC" has no space and stays one amount.
const MULTI_CLAUSE_SPLIT = /\s*,?\s+(?:and|plus)\s+(?:an\s+additional\s+|another\s+|an\s+extra\s+|also\s+)?|\s*,\s+/i
const MULTI_CLAUSE_RE = new RegExp(
  String.raw`^${AMOUNT_OR_ALL}\s+\$?([A-Za-z]{2,12})(?:\s+balance)?(?:\s+(?:on|from)\s+(${CHAIN_WORDS}))?$`,
  'i',
)

/**
 * Deterministic read of a MULTI-clause send (≥2 clauses, one shared
 * recipient). Returns the per-clause segments, a `problem` when it's
 * clearly a multi-send with an unreadable/chainless clause, or null when
 * the message isn't one (single sends stay with parseTransferSegment).
 */
export function parseMultiSendSegments(segment: string): TransferSegment[] | { problem: string } | null {
  if (mentionsNft(segment)) return null
  const m = normalizeChainWords(segment).trim().match(MULTI_SEND_RE)
  if (!m) return null
  const [, body, to] = m
  const clauses = body
    .split(MULTI_CLAUSE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean)
  if (clauses.length < 2) return null
  const out: TransferSegment[] = []
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i].match(MULTI_CLAUSE_RE)
    if (!c) {
      // Nothing send-shaped anywhere → not ours at all; one odd clause among
      // real ones → honest problem, never a half-compiled multi-send.
      if (out.length === 0 && i === 0) return null
      return { problem: `I read this as one send with ${clauses.length} parts, but part ${i + 1} ("${clauses[i].slice(0, 60)}") isn't an amount + token + chain I can build. Phrase each part like "5 USDC on Base".` }
    }
    const amountHuman = amountOf(c[1])
    const token = c[2]
    if (amountHuman !== 'all' && !(Number(amountHuman) > 0)) return { problem: `Part ${i + 1}: the amount must be greater than zero.` }
    const rawChain = c[3]?.toLowerCase().replace(/\s+/g, ' ')
    const chainWord = rawChain ? canonicalChainWord(rawChain) ?? rawChain : undefined
    const chain = chainWord ? TRANSFER_CHAINS[chainWord] : null
    if (!chain) {
      return {
        problem: `Which chain should the ${token.toUpperCase()} in part ${i + 1} leave from? Each part of a multi-send names its own chain — e.g. "send all my USDC on Arbitrum and 5 USDC on Base to ${to.slice(0, 10)}…".`,
      }
    }
    out.push({ amountHuman, token, to, chainId: chain.id, chainName: chain.name })
  }
  return out
}

/**
 * Deterministic read of a fungible send. Returns the segment, a `problem`
 * when it's clearly a send this layer must answer but can't build yet
 * (missing chain), or null when the message isn't a token send at all.
 * `fallbackChainId` covers chat's chain-picker selection (message beats
 * picker, like the swap layer) — job segments pass nothing and stay strict:
 * a compiled step must never guess its chain.
 */
// "send $5 to nate.eth" — a DOLLAR send names no token: the dollar IS the
// chain's stable (USDC; USDG on Robinhood Chain). Squad 2026-08-18 ask
// inventory: this fell to the planner. An explicit stable word may ride
// along ("send $5 usdc to …").
const DOLLAR_SEND_RE = new RegExp(
  String.raw`\b(?:send|transfer)\s+\$(\d+(?:\.\d+)?)(?:\s+(?:in\s+|of\s+)?(usdc|usdg|usdt|dai))?\s+(?:on\s+(${CHAIN_WORDS})\s+)?to\s+${RECIPIENT}(?:\s+on\s+(${CHAIN_WORDS}))?\b`,
  'i',
)
// "send 5 USDC to @nate" — a creator handle is NOT a payable address (the
// inbox addresses INTENTS to handles; tokens need a 0x/ENS). Named refusal.
const HANDLE_SEND_RE = new RegExp(String.raw`\b(?:send|transfer)\s+(?:the\s+)?(?:\$?\d+(?:\.\d+)?|all(?:\s+(?:of\s+)?(?:my|the))?|my\s+entire)\s+\$?[A-Za-z]{0,12}.{0,24}?\bto\s+(@[a-zA-Z0-9_]{2,32})\b`, 'i')

/** The chain chips a chain-less send offers — every resume round-trips
 *  parseTransferSegment (chip = contract). */
export function transferChainChips(amountWord: string, token: string, to: string): { label: string; resume: string }[] {
  const tok = token.toUpperCase()
  const chains: [string, string][] = tok === 'USDG' ? [['Robinhood Chain', 'robinhood']] : [['Base', 'base'], ['Ethereum', 'ethereum'], ['Arbitrum', 'arbitrum']]
  return chains.map(([label, word]) => ({ label: `${label}`, resume: `send ${amountWord === 'all your' ? 'all my' : amountWord} ${tok} on ${word} to ${to}` }))
}

export function parseTransferSegment(
  segment: string,
  opts?: { fallbackChainId?: number | null },
): TransferSegment | { problem: string; chips?: { label: string; resume: string }[] } | null {
  // NFT-shaped sends ("send my Pudgy #2489 to 0x…") belong to the NFT layer.
  if (mentionsNft(segment)) return null
  const normalized = normalizeChainWords(segment)
  const handle = normalized.match(HANDLE_SEND_RE)
  if (handle) {
    return {
      problem: `${handle[1]} is a Pantessa handle, not a payable address — tokens need a 0x address or an ENS name (“send 5 USDC on Base to nate.eth”). To hand ${handle[1]} something to SIGN instead, mint the ask as a link addressed to them from /links.`,
    }
  }
  let m = normalized.match(TRANSFER_MID_RE)
  let dollarToken: string | null = null
  if (!m) {
    const d = normalized.match(DOLLAR_SEND_RE)
    if (!d) return null
    // Re-shape onto the mid-form tuple: [_, amount, token, chainMid, to, chainTail]
    const stableWord = d[2]?.toUpperCase() ?? (/robinhood/i.test(`${d[3] ?? ''} ${d[5] ?? ''}`) ? 'USDG' : 'USDC')
    dollarToken = stableWord
    m = [d[0], d[1], stableWord, d[3], d[4], d[5]] as unknown as RegExpMatchArray
  }
  const [, amountRaw, token, chainMid, to, chainTail] = m
  const amountHuman = amountOf(amountRaw)
  if (amountHuman !== 'all' && !(Number(amountHuman) > 0)) return null
  const amountWord = amountHuman === 'all' ? 'all your' : amountHuman
  const rawChainWord = (chainMid ?? chainTail)?.toLowerCase().replace(/\s+/g, ' ')
  const chainWord = rawChainWord ? canonicalChainWord(rawChainWord) ?? rawChainWord : rawChainWord
  let chain = chainWord ? TRANSFER_CHAINS[chainWord] : null
  if (!chain && opts?.fallbackChainId) {
    const picked = Object.values(TRANSFER_CHAINS).find((c) => c.id === opts.fallbackChainId)
    if (picked) chain = picked
  }
  if (!chain) {
    return {
      problem: `${dollarToken ? `$${amountHuman} is ${amountHuman} ${dollarToken} here. ` : ''}Which chain should ${amountWord} ${token.toUpperCase()} leave from? Name it explicitly — e.g. "send ${amountWord} ${token.toUpperCase()} on Base to ${to.slice(0, 10)}…" — a transfer must never guess its chain.`,
      chips: transferChainChips(amountWord, token, to),
    }
  }
  return { amountHuman, token, to, chainId: chain.id, chainName: chain.name }
}

export interface TransferBuilt {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  refusal?: string
  tx: EvmTxRequest
  note: string
}

/** Resolve an ENS name (mainnet) or pass a 0x address through. */
async function resolveRecipient(to: string): Promise<`0x${string}` | null> {
  if (/^0x[0-9a-fA-F]{40}$/.test(to)) return to as `0x${string}`
  if (/\.eth$/i.test(to)) {
    const client = publicClientFor(1)
    if (!client) return null
    try {
      return (await client.getEnsAddress({ name: normalize(to) })) ?? null
    } catch {
      return null
    }
  }
  return null
}

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** Gas kept back by an all-ETH send, per chain (mainnet gas is real money;
 *  L2/Orbit floors are cents). Scale mirrors lib/lifi-bridge's
 *  ORIGIN_MIN_GAS_ETH signing floors. */
const ALL_SEND_GAS_RESERVE_ETH: Record<number, number> = { 1: 0.002, 8453: 0.0002, 42161: 0.0002, 4663: 0.0002 }

/** Build a guarded fungible transfer for the USER to sign. */
export async function buildTransferArtifact(params: TransferSegment, from: string): Promise<TransferBuilt | { problem: string }> {
  const chain = chainById(params.chainId)
  const client = publicClientFor(params.chainId)
  if (!chain || !client) return { problem: `No RPC client configured for chain ${params.chainId}.` }

  const to = await resolveRecipient(params.to)
  if (!to) return { problem: `I couldn't resolve “${params.to}” to an address — give me a 0x address (or a registered ENS name).` }
  if (to.toLowerCase() === from.toLowerCase()) return { problem: 'That recipient is your own wallet — nothing to send.' }
  if (/^0x0{40}$/.test(to)) return { problem: 'That is the zero address — sending there burns the tokens. Refusing.' }

  const native = params.token.toUpperCase() === 'ETH'
  const wantAll = params.amountHuman === 'all'
  let tx: EvmTxRequest
  let atoms: bigint
  let decimals: number
  let label: string
  let balance: bigint

  if (native) {
    decimals = 18
    label = 'ETH'
    balance = await client.getBalance({ address: from as `0x${string}` })
    if (wantAll) {
      // An all-ETH send keeps a gas reserve back so the send itself (and a
      // stray follow-up) can still pay — floors mirror the funding layer's
      // ORIGIN_MIN_GAS_ETH scale.
      const reserve = parseUnits(String(ALL_SEND_GAS_RESERVE_ETH[params.chainId] ?? 0.0002), 18)
      atoms = balance - reserve
      if (atoms <= BigInt(0)) {
        return { problem: `Your ${formatUnits(balance, 18)} ETH on ${params.chainName} doesn't clear the ~${ALL_SEND_GAS_RESERVE_ETH[params.chainId] ?? 0.0002} ETH gas reserve an all-send keeps back — nothing to send.` }
      }
    } else {
      atoms = parseUnits(params.amountHuman, 18)
    }
    tx = { to, data: '0x', value: atoms.toString(), chainId: params.chainId, action: 'transfer' }
  } else {
    await ensureTokenList(params.chainId).catch(() => {}) // dynamic symbols (AAPL/UNI/…) resolve from the official list
    const addr = resolveToken(params.token, params.chainId)
    if (!addr) return { problem: `I don't know the token "${params.token.toUpperCase()}" on ${params.chainName} — I only send tokens I can resolve to a pinned contract.` }
    const knownDec = tokenDecimals(params.token, params.chainId)
    const readDec =
      knownDec ?? (await client.readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: 'decimals' }).catch(() => null))
    if (readDec == null) return { problem: `I couldn't read the decimals of ${params.token.toUpperCase()} on ${params.chainName} — refusing to guess an amount.` }
    decimals = Number(readDec)
    label = tokenLabel(params.token, params.chainId)
    balance = (await client
      .readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [from as `0x${string}`] })
      .catch(() => null)) as bigint | null ?? BigInt(-1)
    if (balance < BigInt(0)) return { problem: `I couldn't read your ${label} balance on ${params.chainName} — not offering a send I can't verify.` }
    if (wantAll && balance <= BigInt(0)) return { problem: `You don't hold any ${label} on ${params.chainName} — nothing to send.` }
    atoms = wantAll ? balance : parseUnits(params.amountHuman, decimals)
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, atoms] })
    tx = { to: addr as `0x${string}`, data, value: '0', chainId: params.chainId, action: 'transfer' }
  }
  if (atoms <= BigInt(0)) return { problem: 'The amount must be greater than zero.' }
  // Every note below quotes the RESOLVED amount — an 'all' send is pinned to
  // the exact atoms just read, and the user sees that number before signing.
  const amountShown = wantAll ? formatUnits(atoms, decimals) : params.amountHuman
  const allSuffix = wantAll ? ` (your full balance${native ? ', minus the gas reserve' : ''})` : ''

  // Live-balance check — never offer a send the wallet can't fund.
  const balanceCheck: GuardrailCheck = {
    id: 'balance',
    level: 'block',
    ok: balance >= atoms,
    note:
      balance >= atoms
        ? `Live balance verified: ${formatUnits(balance, decimals)} ${label} on ${params.chainName} covers the send.`
        : `Your wallet holds ${formatUnits(balance, decimals)} ${label} on ${params.chainName} — fewer than the ${amountShown} asked.`,
  }

  // Independent calldata pin — re-decode what was just encoded; an opaque or
  // drifted payload is refused, never offered.
  const pinCheck: GuardrailCheck = await (async () => {
    if (native) {
      const ok = tx.to.toLowerCase() === to.toLowerCase() && tx.data === '0x' && BigInt(tx.value ?? '0') === atoms
      return { id: 'transfer-guard', level: 'block' as const, ok, note: ok ? `Native send pinned: ${amountShown} ETH${allSuffix} to ${to}, no calldata.` : 'The built native send does not match the ask — refusing.' }
    }
    try {
      const dec = decodeFunctionData({ abi: erc20Abi, data: tx.data as `0x${string}` })
      const [decTo, decAmt] = dec.args as [string, bigint]
      const ok = dec.functionName === 'transfer' && decTo.toLowerCase() === to.toLowerCase() && decAmt === atoms
      return {
        id: 'transfer-guard',
        level: 'block' as const,
        ok,
        note: ok
          ? `Calldata decoded and verified: transfer(${to}, ${amountShown} ${label}${allSuffix}) on the pinned ${label} contract — nothing else.`
          : 'The built calldata does not match the asked recipient/amount — refusing.',
      }
    } catch {
      return { id: 'transfer-guard', level: 'block' as const, ok: false, note: 'Could not decode the transfer calldata — refusing to offer an opaque transaction.' }
    }
  })()

  const leaveCheck: GuardrailCheck = {
    id: 'recipient',
    level: 'warn',
    ok: true,
    note: `${amountShown} ${label}${allSuffix} LEAVES your wallet to ${to}${params.to.toLowerCase() !== to.toLowerCase() ? ` (${params.to})` : ''} — transfers are irreversible.`,
  }

  // Price for the policy gate + money-moved. Fail-soft null: the policy
  // check then decides (unpriceable + policy on = refused, never bypassed).
  const probe = await usdPerToken(params.chainId, native ? 'ETH' : params.token).catch(() => null)
  const valueUsd = probe ? Number((Number(amountShown) * probe.usd).toFixed(2)) : null

  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const { check: polCheck, violation } = policyCheck(valueUsd, policy, grant ? await spentTodayUsd(grant.id) : 0, TRANSFER_POLICY_HOST)
  if (violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: TRANSFER_POLICY_HOST,
      serviceName: 'Native transfer',
      amountUsd: 0,
      ok: false,
      note: `blocked: ${violation} (token send)`,
    }).catch(() => {})
  }

  const guardrails = buildReport(valueUsd, [balanceCheck, pinCheck, leaveCheck, polCheck], violation ? { violation, valueUsd, host: TRANSFER_POLICY_HOST } : null)
  const blocked = !guardrails.ok
  return {
    summary: `Send ${amountShown} ${label}${allSuffix} to ${shortAddr(to)} on ${params.chainName}.`,
    guardrails,
    blocked,
    ...(blocked ? { refusal: guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ') } : {}),
    tx,
    note: valueUsd != null ? `Worth ~$${valueUsd.toLocaleString()} (${probe?.via}).` : 'No live price found for this token — value untracked.',
  }
}
