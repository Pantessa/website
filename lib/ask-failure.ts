// ─────────────────────────────────────────────────────────────────────────
//  Ask-failure log — every money-shaped ask that ended in a WALL, with a
//  funds snapshot taken at the moment of failure.
//
//  Born from a live miss (2026-07-23): "I WOULD LIKE TO BUY THIS NFT
//  <opensea url>" built a 0.007 ETH Base buy for a wallet holding 0.0005
//  ETH there — and ~$19 of USDC on Base+Arbitrum that nobody offered to
//  convert. Individual gates get fixed one by one, but the MISSES are the
//  roadmap: this module records them centrally so `had_funds = true` rows
//  become the grammar/funding-gap queue on /dashboard/failures.
//
//  Mechanics: the chat route's POST is wrapped once (no per-site
//  instrumentation across the ladder's ~20 refusal returns). After the
//  turn's JSON is built, classifyTurn() decides pure-functionally whether
//  the user got something ACTIONABLE (a signable artifact, a job, chips, a
//  connect prompt). A money-shaped ask that got none is inserted
//  immediately; the funds scan (RPC-heavy) runs in after() and updates the
//  row — a crashed scan leaves had_funds NULL ("unknown"), never false.
// ─────────────────────────────────────────────────────────────────────────

import { erc20Abi, formatUnits } from 'viem'
import { publicClientFor } from '@/lib/chains'
import prisma from '@/lib/db'
import { FUNDING_ORIGIN_WORD, readFundingShortfall, type FundingShortfall } from '@/lib/lifi-bridge'
import { usdPerToken } from '@/lib/usd-probe'

// Verb + evidence-of-money: both required, so "what is a swap?" (no digits,
// no address) and "tell me a joke" never log. The evidence side accepts
// amounts, $, addresses/ENS, marketplace URLs, all-sends, and NFT words —
// the shapes real money asks carry even when no number appears.
const MONEY_VERB_RE =
  /\b(?:send|transfer|swap|sell|buy|bridge|stake|unstake|deposit|withdraw|convert|fund|move|need|want|get\s+me|long|short|list|repay|borrow|supply|protect|mint|pay)\b/i
const MONEY_EVIDENCE_RE = /\d|\$|0x[0-9a-fA-F]{6,}|\.eth\b|\bnft\b|opensea\.io|\b(?:all|everything|max)\b|\busd[cgte]?\b|\beth\b/i

/** Pure: does this message look like it wanted money to move? */
export function moneyShaped(message: string): boolean {
  return MONEY_VERB_RE.test(message) && MONEY_EVIDENCE_RE.test(message)
}

export interface TurnClassification {
  /** Non-null = this turn failed; the string is the failure kind. */
  kind: 'planner-answer' | 'native-wall' | 'blocked' | 'error' | null
}

/**
 * Pure read of a chat turn's response body: did the user get an ACTIONABLE
 * next step? Signable artifacts, compiled jobs/schedules/policies, clarify
 * chips, and connect-wallet prompts all count as actionable — a wall is a
 * bare reply. buildPath attributes the layer that answered; its absence on
 * a bare reply means the planner (or an early refusal) wrote it.
 */
export function classifyTurn(body: Record<string, unknown> | null): TurnClassification {
  if (!body) return { kind: 'error' }
  const actionable =
    !!body.txRequest ||
    !!body.txChain ||
    !!body.orderRequest ||
    !!body.voteRequest ||
    !!body.jobId ||
    !!body.guardianPolicyId ||
    !!body.dcaScheduleId ||
    !!body.connectWallet ||
    // The native NFT gallery: a real wallet read whose rows are one tap from
    // a sell/transfer build — an answer, not a wall.
    !!(body.nfts && typeof body.nfts === 'object') ||
    !!(body.clarify && typeof body.clarify === 'object')
  if (actionable) return { kind: null }
  if (body.blocked) return { kind: 'blocked' }
  if (typeof body.error === 'string' && body.error) return { kind: 'error' }
  if (typeof body.reply !== 'string' || !body.reply) return { kind: 'error' }
  const buildPath = typeof body.buildPath === 'string' ? body.buildPath : null
  return { kind: buildPath && buildPath.startsWith('native') ? 'native-wall' : 'planner-answer' }
}

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Insert the failure row (fast, awaited by the wrapper). Returns the id. */
export async function recordAskFailure(params: {
  wallet: string | null
  prompt: string
  reply: string | null
  kind: NonNullable<TurnClassification['kind']>
  buildPath: string | null
}): Promise<string | null> {
  try {
    const row = await prisma.askFailure.create({
      data: {
        wallet: params.wallet?.toLowerCase() ?? null,
        prompt: cap(params.prompt, 600),
        reply: params.reply ? cap(params.reply, 500) : null,
        kind: params.kind,
        buildPath: params.buildPath,
      },
      select: { id: true },
    })
    return row.id
  } catch {
    return null // the log must never break a chat turn
  }
}

// ── Demand instrumentation: tokens the funding plan CANNOT spend yet ───────
// The funded=1 queue is the product-gap roadmap, but it can only measure
// demand for tokens the snapshot reads. USDT is the biggest blind spot: a
// USDT-only wallet that walls today logs had_funds=false — indistinguishable
// from a genuinely empty wallet — so "should we build USDT legs?" has no
// data. These reads are OBSERVABILITY ONLY: never funding sources, never
// offered in chips; rows count toward had_funds precisely because "walled
// while holding money we can't move" is the demand signal being measured.
// Addresses + 6-dec verified live on all three origins 2026-07-28
// (Arbitrum's on-chain symbol is USD₮0 — labeled plain USDT here).
export const FAILURE_PROBE_TOKENS: Record<number, { symbol: string; address: `0x${string}`; decimals: number }[]> = {
  1: [{ symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 }],
  42161: [{ symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 }],
  8453: [{ symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 }],
}

export interface UnsupportedHolding {
  symbol: string
  word: string
  usd: number
}

/** Read the probe tokens across the funding origins — fail-soft per chain
 *  (a dead RPC just means that chain's probe is absent this snapshot). */
export async function readUnsupportedHoldings(wallet: string): Promise<UnsupportedHolding[]> {
  const rows: UnsupportedHolding[] = []
  await Promise.all(
    Object.entries(FAILURE_PROBE_TOKENS).map(async ([chainIdStr, tokens]) => {
      const chainId = Number(chainIdStr)
      const client = publicClientFor(chainId)
      const word = FUNDING_ORIGIN_WORD[chainId]
      if (!client || !word) return
      for (const t of tokens) {
        try {
          const atoms = await client.readContract({
            address: t.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [wallet as `0x${string}`],
          })
          const usd = Number(Number(formatUnits(atoms, t.decimals)).toFixed(2))
          if (usd >= 0.5) rows.push({ symbol: t.symbol, word, usd })
        } catch {
          /* fail-soft: an unreadable probe never breaks the snapshot */
        }
      }
    }),
  )
  return rows.sort((a, b) => b.usd - a.usd)
}

/**
 * Pure assembly of the snapshot line + total. Extracted so the harness can
 * pin the counting rules: ETH origin rows never double-count against the
 * per-chain gas pricing (the funding scan grows spendable ETH rows —
 * PR #583), each chain's gas ETH is priced ONCE no matter how many token
 * rows share it (a USDC.e row used to double-price Arbitrum's gas), and
 * unsupported holdings are named with their no-path marker.
 */
export function buildFundsDetail(
  scan: Pick<FundingShortfall, 'origins' | 'gaslessOrigins' | 'allScanned' | 'failedOrigins' | 'usdgAtoms'>,
  ethUsd: number | null,
  unsupported: UnsupportedHolding[],
): { totalUsd: number; parts: string[] } {
  const parts: string[] = []
  let total = 0
  for (const o of [...scan.origins, ...scan.gaslessOrigins]) {
    // ETH rows are covered (fully, keep-back included) by the per-chain gas
    // pricing below — counting the row too would double it.
    if (o.token === 'ETH') continue
    total += o.usd
    parts.push(`$${o.usd} ${o.token} ${o.word}${scan.gaslessOrigins.includes(o) ? ' (no gas)' : ''}`)
  }
  const gasSeen = new Set<number>()
  for (const o of scan.allScanned) {
    if (o.gasEth <= 0 || gasSeen.has(o.chainId)) continue
    gasSeen.add(o.chainId)
    const usd = ethUsd ? Number((o.gasEth * ethUsd).toFixed(2)) : null
    if (usd && usd >= 0.5) {
      total += usd
      parts.push(`${Number(o.gasEth.toFixed(5))} ETH ${o.word} (~$${usd})`)
    }
  }
  const usdgUsd = Number(scan.usdgAtoms) / 1e6
  if (usdgUsd >= 0.5) {
    total += usdgUsd
    parts.push(`$${usdgUsd.toFixed(2)} USDG Robinhood`)
  }
  for (const u of unsupported) {
    total += u.usd
    parts.push(`$${u.usd} ${u.symbol} ${u.word} (no funding path yet)`)
  }
  if (scan.failedOrigins.length > 0) parts.push(`unscanned: ${scan.failedOrigins.join(', ')}`)
  return { totalUsd: Number(total.toFixed(2)), parts }
}

/**
 * The funds snapshot — what could the wallet actually have moved when it
 * hit the wall? Reuses the funding layer's origin scan (USDC + USDC.e +
 * gas ETH on Base/Ethereum/Arbitrum, USDG + gas on Robinhood Chain), prices
 * the ETH once, and probes the tokens the plan can't spend yet (USDT) so
 * the funded=1 queue measures THAT demand too. Partial reads UNDERCOUNT and
 * say so in the detail; a fully failed scan leaves had_funds NULL, never
 * false.
 */
export async function attachFundsSnapshot(failureId: string, wallet: string): Promise<void> {
  try {
    const scan = await readFundingShortfall(wallet)
    const [ethUsd, unsupported] = await Promise.all([
      usdPerToken(8453, 'ETH')
        .then((p) => p?.usd ?? null)
        .catch(() => null),
      readUnsupportedHoldings(wallet).catch(() => []),
    ])
    const { totalUsd, parts } = buildFundsDetail(scan, ethUsd, unsupported)
    await prisma.askFailure.update({
      where: { id: failureId },
      data: {
        fundsUsd: totalUsd,
        hadFunds: totalUsd >= 1,
        fundsDetail: parts.length > 0 ? cap(parts.join(' · '), 400) : 'nothing found on scanned chains',
      },
    })
  } catch {
    /* scan unavailable → had_funds stays NULL (unknown), never false */
  }
}
