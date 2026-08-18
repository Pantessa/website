// ─────────────────────────────────────────────────────────────────────────
//  MOSAIC exec — the I/O shell around lib/mosaic.ts (which stays pure).
//
//  Owns: the Alchemy multichain portfolio read, dominant-chain pick,
//  token-list validation (the same list the swap builder resolves against —
//  an unknown tile refuses HERE, not at sign time; the AAPLE lesson), the
//  compile round-trip through lib/jobs.ts, and job creation. The turn this
//  returns mirrors the jobs gate exactly: jobId + jobToken + buildPath, so
//  /i links, the embed, and chat all inherit the JobCard sign flow with
//  zero new client code.
// ─────────────────────────────────────────────────────────────────────────

import { alchemyEnabled, getMultichainPortfolio } from './alchemy'
import { compileJobAsk, stampSwapFeeTier } from './jobs'
import { createJob, advanceJob } from './jobs-runner'
import { signJobToken } from './job-token'
import { ensureTokenList, dynamicTokenBySymbol } from './token-list'
import {
  MOSAIC_CHAIN_IDS,
  MOSAIC_CHAIN_LABELS,
  mosaicStableFor,
  planMosaic,
  type MosaicAsk,
  type MosaicChainWord,
  type MosaicHolding,
  type MosaicPlan,
  type MosaicRow,
} from './mosaic'

/** Tiles that plan even when the public token list is unreachable — the
 *  majors the swap cascade is known to resolve on the EVM majors.
 *  Everything else validates against the live list (fail-closed: list down
 *  + exotic tile = named refusal, never a sign-time surprise). Robinhood
 *  Chain is stricter on purpose: only USDG and ETH are core there — every
 *  stock tile must resolve in the warm 4663 list (the AAPLE lesson). */
const CORE_TILES = new Set(['ETH', 'WETH', 'USDC', 'WSTETH', 'CBBTC', 'WBTC', 'DAI', 'USDT'])

const CHAIN_WORDS: MosaicChainWord[] = ['base', 'ethereum', 'arbitrum', 'robinhood']

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface MosaicTurn {
  reply: string
  jobId?: string
  jobToken?: string
  clarify?: { question: string; options: { label: string; resume: string }[] }
  connectWallet?: boolean
  buildPath: string
}

/**
 * The chat turn: portfolio read → pure plan → compile round-trip → job.
 * Every failure path is a named sentence; nothing silent, nothing built
 * without a plan the reply just showed.
 */
export async function mosaicTurnFor(
  parsed: MosaicAsk,
  wallet: string,
  trace?: (e: unknown) => void,
  swapFeeBps?: number,
  /** Our own harness/drill turn (lib/internal-run.ts) — stamps the job. */
  internalRun = false,
): Promise<MosaicTurn> {
  if (!alchemyEnabled()) {
    return {
      reply: '🧩 The portfolio read is not configured on this deploy, so I can\'t see what you hold — tiling needs the live picture.',
      buildPath: 'native-mosaic',
    }
  }

  const portfolio = await getMultichainPortfolio(wallet).catch(() => null)
  if (!portfolio) {
    trace?.({ type: 'note', level: 'warn', label: 'mosaic layer: portfolio read failed — answering honestly, no plan' })
    return {
      reply: "🧩 I couldn't read your wallet just now — nothing to tile against. Try again in a minute.",
      buildPath: 'native-mosaic',
    }
  }

  // Chain scope: explicit word wins; otherwise the chain where the shape's
  // own tokens (plus the stable rail) hold the most value.
  const named = new Set(parsed.slices.map((s) => s.token))
  const chainUsd = (word: MosaicChainWord) =>
    portfolio.holdings.reduce((a, h) => {
      if (h.chain !== MOSAIC_CHAIN_LABELS[word]) return a
      const sym = h.symbol.toUpperCase()
      if (!named.has(sym) && sym !== mosaicStableFor(word)) return a
      return a + (h.valueUsd ?? 0)
    }, 0)

  const chainWord: MosaicChainWord =
    parsed.chainWord ?? CHAIN_WORDS.reduce((best, w) => (chainUsd(w) > chainUsd(best) ? w : best), 'base' as MosaicChainWord)
  const chainId = MOSAIC_CHAIN_IDS[chainWord]
  const chainLabel = MOSAIC_CHAIN_LABELS[chainWord]

  // Tile validation against the SAME list the swap builder resolves from.
  // List unreachable → core tiles still plan, exotics refuse by name.
  let listWarm = true
  await ensureTokenList(chainId).catch(() => {
    listWarm = false
  })
  const stable = mosaicStableFor(chainWord)
  const unknown: string[] = []
  for (const s of parsed.slices) {
    if (s.token === 'ETH' || s.token === stable) continue
    // The EVM majors get a hand-pinned core even when the list is down;
    // Robinhood Chain does not — every stock tile resolves or refuses.
    if (chainWord !== 'robinhood' && CORE_TILES.has(s.token)) continue
    const hit = dynamicTokenBySymbol(s.token, chainId)
    if (!hit) unknown.push(s.token)
  }
  if (unknown.length > 0) {
    return {
      reply: listWarm
        ? `🧩 ${unknown.join(', ')} ${unknown.length > 1 ? "aren't" : "isn't"} a token I can trade on ${chainLabel} — the shape refuses rather than guessing an address. Check the symbol or drop the tile.`
        : chainWord === 'robinhood'
          ? `🧩 The Robinhood Chain token list is unreachable right now, so I can only take ${stable} and ETH tiles — ${unknown.join(', ')} will have to wait a minute.`
          : `🧩 The ${chainLabel} token list is unreachable right now, so I can only tile the majors (ETH, USDC, wstETH, cbBTC, WBTC, DAI) — ${unknown.join(', ')} will have to wait a minute.`,
      buildPath: 'native-mosaic',
    }
  }

  // Chain-scoped holdings for the pure planner, plus the off-chain note.
  const holdings: MosaicHolding[] = portfolio.holdings
    .filter((h) => h.chain === chainLabel)
    .map((h) => ({
      symbol: h.symbol.toUpperCase(),
      balance: parseFloat(h.balance) || 0,
      priceUsd: h.priceUsd,
      valueUsd: h.valueUsd,
      native: h.native,
    }))
  const offChainNamedUsd = portfolio.holdings.reduce((a, h) => {
    if (h.chain === chainLabel) return a
    const sym = h.symbol.toUpperCase()
    if (!named.has(sym)) return a
    return a + (h.valueUsd ?? 0)
  }, 0)

  const plan = planMosaic({ slices: parsed.slices, chainWord, holdings, offChainNamedUsd })

  if (plan.kind === 'problem') {
    trace?.({ type: 'note', level: 'warn', label: `mosaic layer: shape refused — ${plan.problem.slice(0, 140)}` })
    return { reply: `🧩 ${plan.problem}`, buildPath: 'native-mosaic' }
  }

  const table = shapeTable(plan.rows)
  const noteLines = plan.notes.map((n) => `- ${n}`).join('\n')

  if (plan.kind === 'quiet') {
    trace?.({ type: 'status', label: `mosaic layer claimed the turn: already in shape on ${chainLabel} — planner bypassed` })
    return {
      reply:
        `🧩 **Already in shape.** ${usd(plan.movableUsd)} movable on ${chainLabel} sits within the band of your mosaic:\n\n${table}\n` +
        (noteLines ? `${noteLines}\n` : '') +
        `Nothing worth moving — a tile only fires when the delta beats the gas.`,
      buildPath: 'native-mosaic',
    }
  }

  // Single-leg shapes ride the chip contract (the chip IS the sentence, and
  // it lands on the swap gate) — the jobs compiler only takes 2+ segments.
  if (plan.legs.length === 1) {
    trace?.({ type: 'status', label: `mosaic layer claimed the turn: 1-leg tile on ${chainLabel} — offering the move as a chip` })
    return {
      reply:
        `🧩 **One move gets you there.** ${usd(plan.movableUsd)} movable on ${chainLabel}:\n\n${table}\n` +
        (noteLines ? `${noteLines}\n` : ''),
      clarify: {
        question: 'Run it?',
        options: [
          { label: plan.legs[0], resume: plan.legs[0] },
          { label: 'Not now', resume: 'Never mind — leave my funds where they are.' },
        ],
      },
      buildPath: 'native-mosaic',
    }
  }

  // The round-trip pin: every leg is same-chain-swap grammar, so the joined
  // sentence MUST compile. A miss here is a bug the harness pins against —
  // refuse honestly, never hand the planner a half-claimed money ask.
  const joined = plan.legs.join(' then ')
  const compiled = compileJobAsk(joined)
  if (!compiled || 'problem' in compiled || 'clarify' in compiled) {
    const why = compiled && 'problem' in compiled ? compiled.problem : 'a leg failed to compile'
    trace?.({ type: 'note', level: 'warn', label: `mosaic layer: leg round-trip FAILED (${why.slice(0, 120)}) — refusing, nothing built` })
    return {
      reply: `🧩 The plan didn't survive its own compile check (${why}) — nothing was built. This is a bug worth reporting, not a wallet problem.`,
      buildPath: 'native-mosaic',
    }
  }

  const titled = { ...compiled, title: `Tile the wallet on ${chainLabel} (${plan.legs.length} legs)` }
  const job = await createJob(wallet, stampSwapFeeTier(titled, swapFeeBps ?? 0), 'chat', { internal: internalRun })
  await advanceJob(job).catch(() => {})

  trace?.({
    type: 'status',
    label: `mosaic layer claimed the turn: ${plan.legs.length}-leg tile on ${chainLabel}, ~${usd(plan.totalMoveUsd)} moving — planner bypassed`,
  })

  return {
    reply:
      `🧩 **Tiling ${usd(plan.movableUsd)} on ${chainLabel}** — ${plan.legs.length} legs, ~${usd(plan.totalMoveUsd)} moving. Sells settle first, then the buys:\n\n${table}\n` +
      (noteLines ? `${noteLines}\n` : '') +
      `Every leg is built and guard-checked when it's offered, signed one by one — stop any time. Prices float between now and each signature: this is a shape, not a promise.`,
    jobId: job.id,
    jobToken: signJobToken(job.id),
    buildPath: 'native-mosaic',
  }
}

/** The shape table — GFM, pre-formatted strings only (the tile value
 *  contract): current → target with the move column carrying the verdict. */
function shapeTable(rows: MosaicRow[]): string {
  const lines = ['| tile | now | target | move |', '| --- | --- | --- | --- |']
  for (const r of rows) {
    const move =
      r.action === 'buy'
        ? `buy ${usd(r.deltaUsd)}`
        : r.action === 'sell'
          ? `sell ${usd(-r.deltaUsd)}`
          : r.action === 'skip'
            ? 'within band'
            : '—'
    lines.push(`| ${r.token} | ${usd(r.heldUsd)} | ${r.pct}% · ${usd(r.targetUsd)} | ${move} |`)
  }
  return lines.join('\n')
}
