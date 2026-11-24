#!/usr/bin/env tsx
/**
 * THE JOBS AUDIT DRIVE (squad lane1, lane AUDIT, 2026-11-17).
 *
 * Nate: "the one it suggested as a default for a new account broke ... I just
 * don't want broken suggestions happening anymore."
 *
 * Every job sentence the product OFFERS (a button, a chip, an empty state, a
 * docs example, a composer's output), plus one sentence per segment parser in
 * lib/jobs.ts JOB_SEGMENT_PARSERS, run through the REAL server for four
 * wallet states:
 *   a  empty      a never-funded address (nothing anywhere)
 *   b  otherChain funded on ONE chain (USDT on Arbitrum) that is not the one
 *                 most sentences name (Base)
 *   c  burner     the funded drive wallet (.env.local PRIVATE_KEY, small USDC
 *                 + gas on Base; the same wallet drive-onboarding reads)
 *   d  rich       deep money everywhere (the "no excuse" control)
 *
 * Two doors per run:
 *   POST /api/jobs { ask, dryRun: true }  — compiles + builds step 1, creates
 *                                           nothing (the docs playground door)
 *   POST /api/chat                        — what the UI sends; a compiled job
 *                                           IS created here and step 1 offered
 *
 * Auth: a session JWT minted locally from .env.local SESSION_SECRET for each
 * wallet (the same token a real SIWE returns; scripts/pregtm-deadend-crawl.ts
 * does the same). Local TEST server only. Every request carries
 * `x-yf-internal-run: 1` + `x-yf-no-ask-log: 1`. NOTHING is signed or
 * broadcast. Every job row the chat door creates is read back and DELETED by
 * id (job_steps cascade) before the drive moves on.
 *
 * THE BUG this gates: an (a) or (b) chat run that ends in a CREATED job whose
 * first sign step FAILED (the 2026-11-17 prod row: "Try a 4-step job" from an
 * empty wallet). Exit 1 when any such run exists.
 *
 *   BASE=http://localhost:4803 npx tsx scripts/jobs-audit-drive.ts
 *   flags: --only=<substring of id>  --wallets=a,b  --no-dry  --no-chat
 *          --json=<path>  (writes every record)  --conc=3
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { JOB_OFFER_ORIGINS, fundBuySentence } from '../lib/job-offers'

// ── the inventory ──────────────────────────────────────────────────────────
export type InventoryEntry = {
  id: string
  ask: string
  /** Where the product offers it (file:line), or why it is here. */
  where: string
  /** The file the sentence must still appear in (pins check it). Omitted for
   *  composer outputs and parser representatives. */
  file?: string
  /** 'offered' = the product shows it; 'composer' = a composer builds this
   *  exact shape; 'parser' = a representative for a segment parser only. */
  kind: 'offered' | 'composer' | 'parser'
  /** The chain the sentence spends from, when it names one. */
  names?: string
  /** Segment parsers (lib/jobs.ts JOB_SEGMENT_PARSERS ids) this sentence covers. */
  parsers?: string[]
}

export const INVENTORY: InventoryEntry[] = [
  // ── empty states / default buttons ──
  { id: 'jobs-door', kind: 'offered', where: 'lib/first-run.ts:37 JOBS_DOOR.ask = lib/job-offers JOB_OFFER_EXAMPLE (shown as TEXT; the rail button is jobOfferFor per wallet)', names: 'Base', ask: 'Fund Robinhood Chain with $12.5 from Base including gas, then buy $10 of AAPL', parsers: ['robinhood-funding', 'robinhood-fund-buy'] },
  { id: 'p-hl-deposit-stop', kind: 'parser', where: 'lib/jobs.ts hyperliquid deposit + guardian (was the JobsPanel + HL splash empty-state sentence until lane OFFERS removed it)', names: 'Arbitrum (HL deposit)', ask: 'deposit 12 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop', parsers: ['hyperliquid', 'guardian'] },
  { id: 'api-jobs-example', kind: 'offered', file: 'app/api/jobs/route.ts', where: 'app/api/jobs/route.ts:49 the 400 error example', names: 'Arbitrum (HL deposit)', ask: 'deposit 12 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop' },
  { id: 'nightshift', kind: 'offered', file: 'components/NightShift.tsx', where: 'components/NightShift.tsx:124 the Jobs tile (a link only for a wallet that can run it)', names: 'Base', ask: 'Fund Robinhood Chain with $12.5 from Base including gas, then buy $10 of AAPL' },
  { id: 'p-bridge-send', kind: 'parser', where: 'lib/jobs.ts cross-chain-swap + transfer (the NightShift tile until lane OFFERS replaced it)', names: 'Base', ask: 'Swap 1 USDC from Base to Arbitrum, then send the 1 USDC on Arbitrum to nate.eth', parsers: ['cross-chain-swap', 'transfer'] },
  // ── landing / hero ──
  { id: 'hero-reel-fund', kind: 'offered', file: 'lib/markets-copy.ts', where: 'lib/markets-copy.ts:331 HERO_REEL beat 2 (+ app/docs/first-five-minutes/page.tsx:114, a JobOfferLine example)', names: 'Base', ask: 'Fund Robinhood Chain with $50 from Base including gas, then buy $40 of AAPL' },
  { id: 'hero-reel-hype', kind: 'offered', file: 'lib/markets-copy.ts', where: 'lib/markets-copy.ts:340 HERO_REEL beat 3 (+ components/typed-asks.ts:19 STARTER_ASKS)', ask: '2X long $12 of HYPE, then protect my HYPE long with a 5% stop' },
  { id: 'venue-band-compound', kind: 'offered', file: 'lib/markets-copy.ts', where: 'lib/markets-copy.ts:398 VENUE_BAND.compound', ask: '2x Long $12 of ETH on Hyperliquid, then protect my ETH long with a 5% stop' },
  { id: 'house-protected-long', kind: 'offered', file: 'lib/house-links.ts', where: 'lib/house-links.ts:38 house link /i/protected-long (+ lib/machine-runs.ts:167)', ask: 'I want a 2X Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop' },
  { id: 'tour-uni-stop', kind: 'offered', file: 'lib/home-tour/autopilots.ts', where: 'lib/home-tour/autopilots.ts:47 + lib/home-tour/ask.ts:23 (landing tour chips "Long UNI 2x with a stop")', ask: '2x Long $25 of UNI on Hyperliquid, then protect my UNI long with a 10% stop' },
  { id: 'tour-desk-sdk', kind: 'offered', file: 'components/home/tour/sides/b/snippets.ts', where: 'components/home/tour/sides/b/snippets.ts:56 SDK_SNIPPET (code, not a button) + app/docs/desk/page.tsx:142', ask: '2x Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop' },
  { id: 'docs-desk-sdk', kind: 'offered', file: 'app/docs/desk/page.tsx', where: 'app/docs/desk/page.tsx:142 the desk SDK example (same sentence as the tour snippet)', ask: '2x Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop' },
  // ── docs ──
  // RE-PINNED 2026-11-24 (docs-clean qa): the docs landing's 4-step text ask is gone (the landing was rewritten);
  // /docs/jobs carries the 4-step shape now, with a deposit that fits what the bridge delivers.
  { id: 'docs-index-curl', kind: 'offered', file: 'app/docs/page.tsx', where: 'app/docs/page.tsx:95 docs index curl dryRun example', names: 'Base', ask: 'swap 5 usdc from base to arbitrum, then deposit 5 usdc to hyperliquid' },
  { id: 'docs-jobs-4step', kind: 'offered', file: 'app/docs/jobs/page.tsx', where: 'app/docs/jobs/page.tsx:16 /docs/jobs ASK (the curl and the sample)', names: 'Base', ask: 'bridge 10 usdc from base to arbitrum, then deposit 9 usdc to hyperliquid, then 2x long $12 of eth on hyperliquid, then protect my eth long with a 5% stop' },
  // ── composers (lib/order-ticket, lib/symbol-venues composeCompound) ──
  { id: 'ticket-long-stop', kind: 'composer', where: 'lib/order-ticket.ts:270 perp + stop shape (UNI, 2x, $25, 10%)', ask: '2x Long $25 of UNI on Hyperliquid, then protect my UNI long with a 10% stop' },
  { id: 'ticket-short-stop', kind: 'composer', where: 'lib/order-ticket.ts:270 perp + stop shape (HYPE short)', ask: 'Short $25 of HYPE on Hyperliquid, then protect my HYPE short with a 5% stop' },
  { id: 'compound-dep-long-stop', kind: 'composer', where: 'lib/symbol-venues.ts:744 composeCompound preset Deposit → Long → Stop (ETH, 2x, $50)', names: 'Arbitrum (HL deposit)', ask: 'Deposit 25 USDC to Hyperliquid, then 2x long $50 of ETH on Hyperliquid, then protect my ETH long with a 5% stop' },
  { id: 'compound-buy-stake', kind: 'composer', where: 'lib/symbol-venues.ts:741 composeCompound preset Buy → Stake (ETH)', names: 'Ethereum', ask: 'Swap 50 USDC for ETH on Ethereum, then stake all the swapped ETH on Lido', parsers: ['same-chain-swap'] },
  { id: 'compound-buy-supply', kind: 'composer', where: 'lib/symbol-venues.ts:743 composeCompound preset Buy → Supply on Aave (LINK)', names: 'Ethereum', ask: 'Swap 50 USDC for LINK on Ethereum, then supply $50 of LINK to Aave', parsers: ['aave-supply'] },
  // ── one representative per segment parser not already covered ──
  { id: 'p-eth-move', kind: 'parser', where: 'lib/jobs.ts robinhood-funding (ETH move); audit-asks funding move chip', names: 'Optimism + Arbitrum', ask: 'Move $6 of ETH from optimism to robinhood chain, then Move $4 of ETH from arbitrum to robinhood chain', parsers: ['robinhood-funding'] },
  { id: 'p-gas-leg', kind: 'parser', where: 'lib/jobs.ts robinhood-funding (gas-only leg); audit-asks funding chip', names: 'Base + Arbitrum', ask: 'Fund robinhood chain gas from base using eth, then Fund robinhood chain with $10.5 from arbitrum, then buy $10 of ETH', parsers: ['robinhood-funding', 'robinhood-fund-buy'] },
  { id: 'p-nft-buy', kind: 'parser', where: 'lib/jobs.ts nft; audit-asks funding-plan nft chip', names: 'Base', ask: 'Swap 7.5 USDC for ETH on Base, then buy the nft https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198', parsers: ['nft', 'same-chain-swap'] },
  { id: 'p-dollar-buy', kind: 'parser', where: 'lib/jobs.ts dollar-buy; audit-asks MK2/EXEC row', names: 'Base', ask: 'Buy $50 of ETH on Base, then stake all the swapped ETH on Lido', parsers: ['dollar-buy', 'lido-stake'] },
  { id: 'p-aave-repay', kind: 'parser', where: 'lib/jobs.ts aave-repay (representative)', names: 'Base → Ethereum', ask: 'Swap 10 USDC from Base to USDC on Ethereum, then repay 10 USDC on Aave', parsers: ['cross-chain-swap', 'aave-repay'] },
  { id: 'p-morpho-lend', kind: 'parser', where: 'lib/jobs.ts morpho-lend (representative)', names: 'Arbitrum → Base', ask: 'Swap 10 USDC from Arbitrum to USDC on Base, then lend 10 USDC on Morpho', parsers: ['cross-chain-swap', 'morpho-lend'] },
  { id: 'p-morpho-repay', kind: 'parser', where: 'lib/jobs.ts morpho-repay (representative)', names: 'Arbitrum → Base', ask: 'Swap 10 USDC from Arbitrum to USDC on Base, then repay 10 USDC on Morpho', parsers: ['cross-chain-swap', 'morpho-repay'] },
]

/** Builders each parser emits — the pins check every JOB_SEGMENT_PARSERS id
 *  is here and that an inventory sentence compiles to one of its builders. */
export const PARSER_BUILDERS: Record<string, string[]> = {
  'robinhood-funding': ['native-lifi-fund'],
  'robinhood-fund-buy': ['native-lifi-swap'],
  nft: ['native-nft-buy', 'native-nft-transfer', 'native-nft-list'],
  transfer: ['native-transfer'],
  'cross-chain-swap': ['native-cross-chain'],
  'same-chain-swap': ['native-swap'],
  'dollar-buy': ['native-swap'],
  hyperliquid: ['native-hl-exec'],
  'lido-stake': ['native-lido'],
  'aave-supply': ['native-aave-supply', 'native-weth-wrap'],
  'aave-repay': ['native-aave-repay'],
  'morpho-lend': ['native-morpho-lend'],
  'morpho-repay': ['native-morpho-repay'],
  guardian: ['native-hl-guardian'],
}

/** "then" rows of scripts/audit-asks.ts (the corpus of asks the product
 *  surfaces), read from the file's text: the corpus is not exported and that
 *  file is not this lane's. */
export function auditAsksThenRows(root = process.cwd()): Array<{ ask: string; source: string; line: number }> {
  const text = readFileSync(join(root, 'scripts/audit-asks.ts'), 'utf8')
  const out: Array<{ ask: string; source: string; line: number }> = []
  const re = /ask:\s*'((?:[^'\\]|\\.)*)'\s*,\s*source:\s*'((?:[^'\\]|\\.)*)'\s*,\s*expect:\s*'(\w[\w-]*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const ask = m[1].replace(/\\'/g, "'")
    if (!/,\s*then\b/i.test(ask)) continue
    // Only rows the corpus expects to ACT: a 'clarify-ok' row is a legacy
    // phrasing the product no longer offers (its origin clarify is the answer).
    if (m[3] !== 'action') continue
    out.push({ ask, source: m[2].replace(/\\'/g, "'"), line: text.slice(0, m.index).split('\n').length })
  }
  return out
}

/** Every sentence lib/job-offers.ts jobOfferFor can emit (each origin, with
 *  and without the gas leg), built from its own emitter, never retyped. */
export function jobOfferEntries(): InventoryEntry[] {
  return JOB_OFFER_ORIGINS.flatMap((origin) =>
    [true, false].map((gas): InventoryEntry => ({
      id: `offer-${origin}-${gas ? 'gas' : 'nogas'}`,
      kind: 'offered',
      where: `lib/job-offers.ts fundBuySentence(${origin}, ${gas}) via jobOfferFor (the JOBS rail / JobsPanel / NightShift button for a wallet that can run it)`,
      ask: fundBuySentence(origin, gas),
    })),
  )
}

/** The whole list the drive runs: the hand inventory, the job-offers catalog,
 *  then every audit-asks "then" row not already in it (case-insensitive). The
 *  drive runs a sentence once, under the first id that offers it. */
export function driveList(root = process.cwd()): InventoryEntry[] {
  const key = (a: string) => a.toLowerCase().replace(/\.$/, '')
  const seen = new Set<string>()
  const base: InventoryEntry[] = []
  for (const e of [...INVENTORY, ...jobOfferEntries()]) {
    if (seen.has(key(e.ask))) continue
    seen.add(key(e.ask))
    base.push(e)
  }
  const extra: InventoryEntry[] = []
  for (const r of auditAsksThenRows(root)) {
    if (seen.has(key(r.ask))) continue
    seen.add(key(r.ask))
    extra.push({ id: `aa-${r.line}`, kind: 'offered', where: `scripts/audit-asks.ts:${r.line} (${r.source})`, ask: r.ask })
  }
  return [...base, ...extra]
}

// ── the drive ──────────────────────────────────────────────────────────────
type WalletKey = 'a' | 'b' | 'c' | 'd'
const WALLET_DESC: Record<WalletKey, string> = {
  a: 'empty (never funded)',
  b: 'funded on Arbitrum only (USDT)',
  c: 'burner (drive wallet)',
  d: 'rich control',
}

export type DryRecord = { status: number; compiled: boolean; title?: string; steps?: string; first?: 'built' | 'refused' | 'none'; words?: string; unfillable?: string; error?: string }
export type ChatRecord = {
  status: number
  outcome: string
  jobCreated: boolean
  jobStatus?: string
  firstStep?: 'offered' | 'withheld' | 'failed' | 'pending' | 'none'
  stepTitle?: string
  words: string
  chips: string[]
  buildPath?: string
  /** Top-level keys of the chat answer (what the client could render). */
  keys?: string[]
}
export type RunRecord = { id: string; ask: string; wallet: WalletKey; dry?: DryRecord; chat?: ChatRecord; bug: boolean }

function envLocal(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  try {
    const line = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith(key + '='))
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : undefined
  } catch {
    return undefined
  }
}

const clip = (s: string, n = 220) => s.replace(/\s+/g, ' ').trim().slice(0, n)

async function main() {
  const BASE = process.env.BASE ?? 'http://localhost:4803'
  const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? ''
  const WANT = (process.argv.find((a) => a.startsWith('--wallets='))?.slice(10) ?? 'a,b,c,d').split(',') as WalletKey[]
  const NO_DRY = process.argv.includes('--no-dry')
  const NO_CHAT = process.argv.includes('--no-chat')
  // --strict: a job CREATED with its first step withheld (unaffordable, waiting)
  // also counts — the squad's invariant refuses those before creation too.
  const STRICT = process.argv.includes('--strict')
  const JSON_OUT = process.argv.find((a) => a.startsWith('--json='))?.slice(7)
  const CONC = Number(process.argv.find((a) => a.startsWith('--conc='))?.slice(7) ?? 3)

  const secret = envLocal('SESSION_SECRET')
  const pk = envLocal('PRIVATE_KEY')
  const dbUrl = envLocal('DATABASE_URL')
  if (!secret || !pk || !dbUrl) throw new Error('SESSION_SECRET, PRIVATE_KEY and DATABASE_URL must be in .env.local')
  if (!/ep-tiny-butterfly/.test(dbUrl) && !process.env.JOBS_AUDIT_ANY_DB) throw new Error('DATABASE_URL is not the TEST database (ep-tiny-butterfly…) — refusing to create job rows elsewhere')

  const { privateKeyToAccount } = await import('viem/accounts')
  const { SignJWT } = await import('jose')
  const { PrismaClient } = await import('@prisma/client')
  const { composeMcps } = await import('../lib/intent-links')
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })

  const burner = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`).address
  const ADDR: Record<WalletKey, string> = {
    // Checksummed: the chat route drops a mis-checksummed address as "no wallet"
    // (drive-onboarding's 0x…dEa1 spelling reads as a stranger, not an empty wallet).
    a: '0x000000000000000000000000000000000000deA1',
    b: '0x37dad9aee064f976e2b24f8f802089557a6a0293',
    c: burner,
    d: '0x0000000000000000000000000000000000000001',
  }
  const jwt: Partial<Record<WalletKey, string>> = {}
  for (const k of WANT) {
    jwt[k] = await new SignJWT({ address: ADDR[k].toLowerCase() }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('2h').sign(new TextEncoder().encode(secret))
  }
  const headers = (k: WalletKey) => ({
    'content-type': 'application/json',
    'x-yf-internal-run': '1',
    'x-yf-no-ask-log': '1',
    cookie: `yf_session=${jwt[k]}`,
  })

  // Wallet facts, read through the app's own view (printed, not asserted).
  console.log(`\n═══ JOBS AUDIT @ ${BASE} ═══\n`)
  for (const k of WANT) {
    try {
      const res = await fetch(`${BASE}/api/wallet?address=${ADDR[k]}&fresh=1`, { headers: { 'x-yf-internal-run': '1' } })
      const body = (await res.json()) as { totalUsd?: number; chains?: Array<{ name: string; totalUsd: number; holdings: Array<{ symbol: string; valueUsd: number }> }> }
      const top = (body.chains ?? [])
        .flatMap((c) => (c.holdings ?? []).map((h) => ({ s: `${h.symbol}@${c.name}`, v: h.valueUsd ?? 0 })))
        .filter((h) => h.v >= 0.5)
        .sort((x, y) => y.v - x.v)
        .slice(0, 5)
        .map((h) => `${h.s} $${h.v.toFixed(2)}`)
        .join(', ')
      console.log(`  ${k} ${WALLET_DESC[k].padEnd(32)} ${ADDR[k].slice(0, 10)}… $${(body.totalUsd ?? 0).toFixed(2)}${top ? ` — ${top}` : ''}`)
    } catch (e) {
      console.log(`  ${k} ${WALLET_DESC[k].padEnd(32)} ${ADDR[k].slice(0, 10)}… (wallet read failed: ${(e as Error).message})`)
    }
  }
  console.log('')

  const list = driveList().filter((e) => !ONLY || e.id.includes(ONLY))
  const serverCache = new Map<string, unknown[]>()
  async function serversFor(ask: string) {
    const slugs = composeMcps(ask)
    const key = slugs.slice().sort().join(',')
    if (!serverCache.has(key)) {
      const rows = await prisma.mcpServer.findMany({ where: { slug: { in: slugs } } })
      serverCache.set(key, rows.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, protocol: r.protocol, endpoint: r.endpoint, callable: true })))
    }
    return serverCache.get(key)!
  }

  async function post(path: string, k: WalletKey, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 120_000)
    try {
      const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: headers(k), body: JSON.stringify(body), signal: ctl.signal })
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { status: res.status, json }
    } finally {
      clearTimeout(t)
    }
  }

  async function dryRun(e: InventoryEntry, k: WalletKey): Promise<DryRecord> {
    try {
      const { status, json } = await post('/api/jobs', k, { ask: e.ask, dryRun: true })
      if (status !== 200) return { status, compiled: false, error: clip(String(json.error ?? JSON.stringify(json))) }
      const steps = (json.steps as Array<{ kind: string; builder: string }>) ?? []
      const prev = (json.firstSignPreview ?? {}) as { refused?: string; artifact?: unknown }
      return {
        status,
        compiled: true,
        title: String(json.title ?? ''),
        steps: steps.map((s) => (s.kind === 'wait' ? 'wait' : s.builder.replace(/^native-/, ''))).join(' → '),
        first: prev.refused ? 'refused' : prev.artifact ? 'built' : 'none',
        words: prev.refused ? clip(prev.refused) : undefined,
        unfillable: json.unfillable ? clip(String(json.unfillable)) : undefined,
      }
    } catch (err) {
      return { status: 0, compiled: false, error: (err as Error).message }
    }
  }

  async function chat(e: InventoryEntry, k: WalletKey): Promise<ChatRecord> {
    let res: { status: number; json: Record<string, unknown> }
    try {
      res = await post('/api/chat', k, { message: e.ask, activeServers: await serversFor(e.ask), history: [], walletAddress: ADDR[k] })
    } catch (err) {
      return { status: 0, outcome: 'ERROR', jobCreated: false, words: (err as Error).message, chips: [] }
    }
    const j = res.json
    const reply = String(j.reply ?? j.error ?? '')
    const clar = (j.clarify as { options?: Array<{ label: string; resume: string; fund?: unknown }> } | undefined)?.options ?? []
    const chips = clar.map((o) => `${o.label}${o.fund ? ' [fund door]' : ''} → "${clip(o.resume, 110)}"`)
    const rec: ChatRecord = { status: res.status, outcome: '', jobCreated: false, words: clip(reply), chips, buildPath: j.buildPath ? String(j.buildPath) : undefined, keys: Object.keys(j).filter((x) => j[x] != null && x !== 'reply') }
    const jobId = typeof j.jobId === 'string' ? j.jobId : null
    if (jobId) {
      rec.jobCreated = true
      const job = await prisma.job.findUnique({ where: { id: jobId }, include: { steps: { orderBy: { seq: 'asc' } } } })
      if (job) {
        rec.jobStatus = job.status
        const first = job.steps.find((s) => s.kind === 'sign')
        if (!first) rec.firstStep = 'none'
        else {
          const result = (first.result ?? {}) as { error?: string; withheld?: boolean }
          rec.stepTitle = first.title
          rec.firstStep = first.status === 'offered' ? 'offered' : first.status === 'failed' ? 'failed' : result.withheld ? 'withheld' : 'pending'
          const why = result.error ?? job.failReason ?? ''
          if (why) rec.words = clip(`${why}`)
        }
        // Clean up: this run created it (its id came back in our response).
        await prisma.job.delete({ where: { id: jobId } }).catch((err) => console.warn(`  ⚠ cleanup of job ${jobId} failed: ${(err as Error).message}`))
      }
      rec.outcome = `job · ${rec.firstStep ?? '?'}`
    } else if (j.connectWallet) rec.outcome = 'connect door'
    else if (j.door) rec.outcome = 'refused + door'
    else if (j.signInRequired || /sign[- ]in/i.test(String(j.gate ?? ''))) rec.outcome = 'sign-in gate'
    else if (j.txChain || j.txRequest || j.orderRequest) rec.outcome = 'single build (no job)'
    else if (clar.length) rec.outcome = clar.some((o) => o.fund) ? 'refused + fund door' : 'refused + chips'
    else if (res.status !== 200) rec.outcome = `HTTP ${res.status}`
    else rec.outcome = 'refused (words only)'
    return rec
  }

  const tasks: Array<{ e: InventoryEntry; k: WalletKey }> = []
  for (const e of list) for (const k of WANT) tasks.push({ e, k })
  const records: RunRecord[] = []
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const { e, k } = tasks[next++]
      const r: RunRecord = { id: e.id, ask: e.ask, wallet: k, bug: false }
      if (!NO_DRY) r.dry = await dryRun(e, k)
      if (!NO_CHAT) r.chat = await chat(e, k)
      r.bug = (k === 'a' || k === 'b') && !!r.chat?.jobCreated && (r.chat.firstStep === 'failed' || (STRICT && r.chat.firstStep === 'withheld'))
      records.push(r)
      const d = r.dry ? (r.dry.compiled ? `dry ${r.dry.first}${r.dry.unfillable ? ' (unfillable)' : ''}` : `dry ✗ ${r.dry.status}`) : ''
      console.log(`  ${r.bug ? '❌' : '·'} ${e.id.padEnd(24)} ${k}  ${d.padEnd(22)} chat: ${r.chat?.outcome ?? '-'}${r.chat?.words ? ` — ${clip(r.chat.words, 110)}` : ''}`)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, CONC) }, worker))
  await prisma.$disconnect()

  // ── the table ──
  const order = new Map(list.map((e, i) => [e.id, i]))
  records.sort((x, y) => (order.get(x.id)! - order.get(y.id)!) || x.wallet.localeCompare(y.wallet))
  console.log('\n─── MATRIX (chat door: what the UI does) ───')
  console.log(`  ${'id'.padEnd(24)} ${WANT.map((k) => k.padEnd(28)).join(' ')}`)
  for (const e of list) {
    const cells = WANT.map((k) => {
      const r = records.find((x) => x.id === e.id && x.wallet === k)
      return (r?.chat?.outcome ?? (r?.dry ? (r.dry.compiled ? `dry:${r.dry.first}` : 'dry:✗') : '-')).padEnd(28)
    })
    console.log(`  ${e.id.padEnd(24)} ${cells.join(' ')}`)
  }
  const bugs = records.filter((r) => r.bug)
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), wallets: ADDR, inventory: list, records }, null, 2))
  console.log(`\n${bugs.length === 0 ? '✅ no (a)/(b) run ended in a created job with a failed step' : `❌ ${bugs.length} (a)/(b) run(s) created a job whose first step FAILED:`}`)
  for (const b of bugs) console.log(`   ${b.id} [${b.wallet}] "${clip(b.ask, 90)}"\n     → ${b.chat?.stepTitle}: ${b.chat?.words}`)
  process.exit(bugs.length ? 1 : 0)
}

if (process.argv[1] && /jobs-audit-drive\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error('✖', (e as Error).stack ?? e)
    process.exit(2)
  })
}
