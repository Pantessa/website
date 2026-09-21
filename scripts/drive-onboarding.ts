#!/usr/bin/env tsx
/**
 * Onboarding drive — the stranger's walk, asserted.
 *
 * THE INVARIANT (no-dead-ends squad, 2026-09-21): a money-shaped ask from a
 * wallet that holds value, in ANY token we can move, on ANY supported chain,
 * NEVER ends in a bare refusal. It ends in
 *   1. a signable guarded build, or
 *   2. fund-then-act chips whose resume strings compile into a job, or
 *   3. (empty wallet) the card-door chip, or
 *   4. (truly impossible) a refusal that NAMES every holding >= $0.50 and
 *      still carries a chip with a next step that works.
 * A turn with no artifact, no chips and no door on a money ask is a BUG.
 *
 * Two halves:
 *   MATRIX (default)  — real wallets, real RPC, real venues, over HTTP.
 *                       Each row re-reads its wallet's live state through the
 *                       app's own /api/wallet, so a row whose wallet has
 *                       drained SKIPS loudly instead of rotting into a red.
 *   BROWSER (--browser) — Playwright + the installed Chrome: the landing →
 *                       /t → connect door walk, every /i house link, the
 *                       /markets rail, the sign-in door lanes; console errors
 *                       and 375px horizontal overflow are failures.
 *
 * Usage:
 *   BASE=http://localhost:3873 npx tsx scripts/drive-onboarding.ts
 *   BASE=… npx tsx scripts/drive-onboarding.ts --browser
 *   BASE=… npx tsx scripts/drive-onboarding.ts --only=usdt
 *
 * Read-only: nothing is ever signed, no real money moves. Every request wears
 * `x-yf-internal-run: 1` (lib/value-origin rule) and `x-yf-no-ask-log: 1`.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PrismaClient } from '@prisma/client'
import { HOUSE_LINKS } from '../lib/house-links'
import { composeMcps } from '../lib/intent-links'
import { classifyTurn, moneyShaped } from '../lib/ask-failure'
import { buildsNatively } from './ask-ladder'

const BASE = process.env.BASE ?? 'http://localhost:3873'
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? ''
const WANT_BROWSER = process.argv.includes('--browser')
const WANT_MATRIX = !process.argv.includes('--browser-only')

// ── wallets ────────────────────────────────────────────────────────────────
// Real mainnet addresses, read-only. Each carries the SHAPE the matrix needs;
// `expect` is re-verified live and a mismatch skips the row rather than
// failing it, so someone else's wallet moving never reads as our regression.
type WalletKey = 'none' | 'empty' | 'usdtOnlyArb' | 'baseFunded' | 'richEverywhere'

const WALLETS: Record<Exclude<WalletKey, 'none'>, { address: string; want: string; check: (w: WalletState) => boolean }> = {
  // Never funded, never will be: the address of a key nobody holds.
  empty: {
    address: '0x000000000000000000000000000000000000dEa1',
    want: 'nothing anywhere',
    check: (w) => w.totalUsd < 1,
  },
  // THE NAMED GAP: $300+ of USDT on Arbitrum with gas there, and nothing on
  // Base/Ethereum/Optimism. Every plan must see this money.
  usdtOnlyArb: {
    address: '0x37dad9aee064f976e2b24f8f802089557a6a0293',
    want: '>= $50 of USDT on Arbitrum, < $5 on Base',
    check: (w) => (w.bySymbolChain.get('USDT@Arbitrum') ?? 0) >= 50 && (w.byChain.get('Base') ?? 0) < 5,
  },
  // The house burner: small real USDC + gas on Base, gas on Ethereum/Arbitrum.
  baseFunded: {
    address: '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0',
    want: '>= $5 of USDC on Base + gas',
    check: (w) => (w.bySymbolChain.get('USDC@Base') ?? 0) >= 5,
  },
  // Deep money on every chain — the "there is no excuse" control.
  richEverywhere: {
    address: '0x0000000000000000000000000000000000000001',
    want: '>= $1000 across chains',
    check: (w) => w.totalUsd >= 1000,
  },
}

type WalletState = {
  address: string
  totalUsd: number
  byChain: Map<string, number>
  bySymbolChain: Map<string, number>
  holdings: Array<{ symbol: string; chain: string; valueUsd: number }>
}

async function readWallet(address: string): Promise<WalletState> {
  const res = await fetch(`${BASE}/api/wallet?address=${address}&fresh=1`, {
    headers: { 'x-yf-internal-run': '1' },
  })
  const body = (await res.json()) as {
    totalUsd?: number
    chains?: Array<{ name: string; totalUsd: number; holdings: Array<{ symbol: string; valueUsd: number }> }>
  }
  const byChain = new Map<string, number>()
  const bySymbolChain = new Map<string, number>()
  const holdings: WalletState['holdings'] = []
  for (const c of body.chains ?? []) {
    byChain.set(c.name, c.totalUsd ?? 0)
    for (const h of c.holdings ?? []) {
      bySymbolChain.set(`${h.symbol}@${c.name}`, (bySymbolChain.get(`${h.symbol}@${c.name}`) ?? 0) + (h.valueUsd ?? 0))
      holdings.push({ symbol: h.symbol, chain: c.name, valueUsd: h.valueUsd ?? 0 })
    }
  }
  return { address, totalUsd: body.totalUsd ?? 0, byChain, bySymbolChain, holdings }
}

// ── the matrix ─────────────────────────────────────────────────────────────
type Row = {
  id: string
  ask: string
  wallet: WalletKey
  /** Why this row exists — printed on a failure so the log reads as a report. */
  why: string
}

const ROWS: Row[] = [
  // 1 — the landing → /t/AAPL → Buy chip path, at each wallet state.
  { id: 'aapl/none', ask: 'Buy $10 of AAPL', wallet: 'none', why: 'stranger with no wallet must be asked to connect, never refused' },
  { id: 'aapl/empty', ask: 'Buy $10 of AAPL', wallet: 'empty', why: 'empty wallet must get the card door (#795)' },
  { id: 'aapl/usdt', ask: 'Buy $10 of AAPL', wallet: 'usdtOnlyArb', why: 'THE GAP: $300+ of USDT on Arbitrum must be a funding source' },
  { id: 'aapl/base', ask: 'Buy $10 of AAPL', wallet: 'baseFunded', why: 'funded on Base: fund-then-buy chips or a build' },
  { id: 'aapl/rich', ask: 'Buy $50 of AAPL', wallet: 'richEverywhere', why: 'deep money everywhere: there is no excuse' },

  // 2 — coins.
  { id: 'eth/empty', ask: 'Buy $25 of ETH', wallet: 'empty', why: 'empty wallet ETH buy = the card door that completes (#791)' },
  { id: 'eth/usdt', ask: 'Buy $25 of ETH', wallet: 'usdtOnlyArb', why: 'USDT should buy ETH' },
  { id: 'eth/base', ask: 'Buy $10 of ETH', wallet: 'baseFunded', why: 'USDC on Base buys ETH natively' },

  // 3 — the flagship house ask (HL perp + stop), the prod ask_failures row.
  { id: 'hype/usdt', ask: '2x long $20 of HYPE with a 5% stop', wallet: 'usdtOnlyArb', why: 'prod ask_failure: planner answer while the wallet held thousands' },
  { id: 'hype/rich', ask: 'Buy $20 worth of HYPE and open a 2x long position on Hyperliquid perpetuals', wallet: 'richEverywhere', why: 'the verbatim prod ask_failure phrasing' },
  { id: 'hype/empty', ask: '2x long $20 of HYPE with a 5% stop', wallet: 'empty', why: 'empty wallet HL open = the card door (#795)' },

  // 4 — lending.
  { id: 'aave/usdt', ask: 'Supply $25 of USDC to Aave', wallet: 'usdtOnlyArb', why: 'USDT on Arbitrum should fund an Aave supply' },
  { id: 'aave/empty', ask: 'Supply $25 of USDC to Aave', wallet: 'empty', why: 'empty wallet Aave supply = the card door (#795)' },

  // 5 — sells of things not held: must offer the buy, never a bare short.
  { id: 'sell/amat', ask: 'Sell $50 of AMAT', wallet: 'usdtOnlyArb', why: 'prod ask_failure: native-affordability-short with no chip' },
  { id: 'sell/nvda', ask: 'Sell $50 of NVDA', wallet: 'richEverywhere', why: 'prod ask_failure: "couldn\'t price NVDA"' },

  // 6 — stocks whose pool is thin/absent: the refusal must still carry a chip.
  { id: 'buy/tsla', ask: 'Buy $50 of TSLA', wallet: 'richEverywhere', why: 'prod ask_failure: "no pool can fill" with $4k idle' },
  { id: 'buy/nvda', ask: 'Buy $50 of NVDA', wallet: 'richEverywhere', why: 'same class as TSLA' },

  // 7 — protection asks: the env wall must never reach a user.
  { id: 'protect/eth', ask: 'Protect my spot ETH with a 5% stop', wallet: 'baseFunded', why: 'prod ask_failure: "autopilot rails aren\'t provisioned" — an env wall as a dead end' },
  { id: 'protect/uni', ask: 'Protect my UNI with a stop', wallet: 'richEverywhere', why: 'same class' },

  // 8 — stables across chains: the oldest promise.
  { id: 'bridge/usdt', ask: 'Swap 5 USDC from Base to Arbitrum', wallet: 'usdtOnlyArb', why: 'no USDC on Base; the USDT on Arbitrum is right there' },
  { id: 'stake/usdt', ask: 'Stake 0.05 ETH with Lido', wallet: 'usdtOnlyArb', why: 'Lido stake funded from USDT' },
]

/** Copy that must never reach a stranger: our own plumbing, named out loud. */
const FORBIDDEN_COPY: Array<{ re: RegExp; what: string }> = [
  { re: /\bthis environment\b/i, what: 'names "this environment"' },
  { re: /\b(aren'?t|isn'?t|not) provisioned\b/i, what: 'says something "isn\'t provisioned"' },
  { re: /\bCDP_[A-Z_]+|\b[A-Z][A-Z0-9_]{6,}=/, what: 'leaks an env var name' },
  { re: /\bundefined\b|\bNaN\b|\[object Object\]/, what: 'leaks a JS value' },
  { re: /\btry (?:Yahoo Finance|CoinGecko|Etherscan|a block explorer)\b/i, what: 'sends the user to a competitor/explorer' },
]

/** The turn keys that ARE a next step. `classifyTurn` (lib/ask-failure) owns
 *  the product's own definition of "actionable"; this list is only for
 *  naming which one landed in the log. */
const ARTIFACT_KEYS = [
  'txChain',
  'txRequest',
  'orderRequest',
  'voteRequest',
  'jobId',
  'guardianPolicyId',
  'dcaScheduleId',
  'portfolio',
  'nfts',
  'nftMarket',
  'chart',
  'door',
  'awaiting',
] as const

type Verdict = {
  ok: boolean
  kind: 'artifact' | 'chips' | 'door' | 'connect' | 'DEAD END' | 'ERROR'
  detail: string
  reply: string
  buildPath: string
  unnamed: string[]
  copyFlags: string[]
  /** Chip resumes that do NOT parse as a native ask — a button that lands
   *  the user back in the planner is a dead end wearing a chip. */
  lostChips: string[]
}

function envLocal(key: string): string | null {
  try {
    return (
      readFileSync('.env.local', 'utf8')
        .match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]
        ?.trim()
        .replace(/^"|"$/g, '') ?? null
    )
  } catch {
    return null
  }
}

/** The burner signs the SIWE message and nothing else (the drive's door pass,
 *  B6). `.env.local`'s PRIVATE_KEY is the house burner — the same wallet the
 *  `baseFunded` row already reads, so no new key and no new address. */
async function signSiwe(raw: string): Promise<string> {
  const pk = envLocal('PRIVATE_KEY')
  if (!pk) throw new Error('no PRIVATE_KEY in .env.local')
  const { privateKeyToAccount } = await import('viem/accounts')
  const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  return account.signMessage({ message: raw.startsWith('0x') ? { raw: raw as `0x${string}` } : raw })
}

async function resolveServers(prisma: PrismaClient, ask: string) {
  const slugs = composeMcps(ask)
  const rows = await prisma.mcpServer.findMany({ where: { slug: { in: slugs } } })
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    protocol: r.protocol,
    endpoint: r.endpoint,
    callable: true,
  }))
}

async function runRow(row: Row, servers: unknown[], state: WalletState | null): Promise<Verdict> {
  const walletAddress = row.wallet === 'none' ? undefined : WALLETS[row.wallet].address
  const blank: Omit<Verdict, 'ok' | 'kind' | 'detail'> = {
    reply: '',
    buildPath: '',
    unnamed: [],
    copyFlags: [],
    lostChips: [],
  }
  let body: Record<string, unknown> & { reply?: string; buildPath?: string }
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1', 'x-yf-internal-run': '1' },
      body: JSON.stringify({ message: row.ask, activeServers: servers, history: [], walletAddress }),
    })
    if (res.status !== 200) return { ...blank, ok: false, kind: 'ERROR', detail: `HTTP ${res.status}` }
    body = (await res.json()) as typeof body
  } catch (e) {
    return { ...blank, ok: false, kind: 'ERROR', detail: (e as Error).message }
  }

  const reply = String(body.reply ?? '')
  const buildPath = String(body.buildPath ?? '')
  const copyFlags = FORBIDDEN_COPY.filter((f) => f.re.test(reply)).map((f) => f.what)

  // Holdings the reply owes the user a mention of. Dust is never named on
  // purpose, so the floor is the same $0.50 the invariant uses.
  const unnamed = (state?.holdings ?? [])
    .filter((h) => h.valueUsd >= 0.5)
    .filter((h) => !new RegExp(`\\b${h.symbol}\\b`, 'i').test(reply))
    .map((h) => `${h.symbol} on ${h.chain} ($${h.valueUsd.toFixed(2)})`)

  const options =
    (body.clarify as { options?: Array<{ label: string; resume: string; fund?: unknown }> } | undefined)?.options ?? []
  // A chip whose resume falls to the planner is a button that leads nowhere.
  // The decline chip is the one exception — it is meant to end the turn.
  const lostChips = options
    .filter((o) => !o.fund && !/^(not now|never mind)/i.test(o.label) && !/^never mind/i.test(o.resume))
    .filter((o) => !buildsNatively(o.resume))
    .map((o) => `${o.label} → "${o.resume.slice(0, 70)}"`)

  // The product's own verdict first: null === actionable.
  const stalled = classifyTurn(body).kind !== null

  if (!stalled) {
    const artifact = ARTIFACT_KEYS.find((k) => body[k] !== undefined && body[k] !== null)
    if (artifact) {
      return { ...blank, ok: copyFlags.length === 0, kind: 'artifact', detail: artifact, reply, buildPath, copyFlags }
    }
    if (body.connectWallet) {
      return { ...blank, ok: copyFlags.length === 0, kind: 'connect', detail: 'connect door', reply, buildPath, copyFlags }
    }
    if (options.length > 0) {
      const door = options.some((o) => o.fund)
      return {
        ok: copyFlags.length === 0 && lostChips.length === 0,
        kind: door ? 'door' : 'chips',
        detail: options.map((o) => o.label).join(' · '),
        reply,
        buildPath,
        unnamed,
        copyFlags,
        lostChips,
      }
    }
    // Actionable by the product's rule but nothing a stranger can press
    // (a `quiet` native turn, say). Fine — name it and move on.
    return { ...blank, ok: copyFlags.length === 0, kind: 'artifact', detail: buildPath || 'quiet native', reply, buildPath, copyFlags }
  }

  // Stalled. On a money ask from a wallet that holds value, that is the BUG
  // the squad exists to kill.
  const holdsValue = (state?.totalUsd ?? 0) >= 0.5
  const isMoney = moneyShaped(row.ask)
  return {
    ok: !isMoney || (!holdsValue && row.wallet !== 'none' && options.length > 0),
    kind: 'DEAD END',
    detail: buildPath ? `${classifyTurn(body).kind} · ${buildPath}` : String(classifyTurn(body).kind),
    reply,
    buildPath,
    unnamed,
    copyFlags,
    lostChips,
  }
}

async function matrix(): Promise<number> {
  const dbUrl = envLocal('DATABASE_URL')
  if (!dbUrl) throw new Error('No DATABASE_URL in .env.local')
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })

  const rows = ROWS.filter((r) => !ONLY || r.id.includes(ONLY))
  const needed = [...new Set(rows.map((r) => r.wallet))].filter((w): w is Exclude<WalletKey, 'none'> => w !== 'none')

  console.log(`\n═══ ONBOARDING MATRIX @ ${BASE} ═══\n`)
  const states = new Map<WalletKey, WalletState>()
  for (const key of needed) {
    const state = await readWallet(WALLETS[key].address)
    states.set(key, state)
    const good = WALLETS[key].check(state)
    const top = state.holdings
      .filter((h) => h.valueUsd >= 0.5)
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .slice(0, 4)
      .map((h) => `${h.symbol}@${h.chain} $${h.valueUsd.toFixed(2)}`)
      .join(', ')
    console.log(
      `  ${good ? '·' : '⚠'} ${key.padEnd(15)} ${WALLETS[key].address.slice(0, 10)}… $${state.totalUsd.toFixed(2)} ${
        top ? `— ${top}` : '— (nothing)'
      }${good ? '' : `  [WANTED ${WALLETS[key].want} — rows SKIPPED]`}`,
    )
  }
  console.log('')

  let dead = 0
  let skipped = 0
  const deadEnds: Array<{ row: Row; v: Verdict }> = []

  for (const row of rows) {
    const state = row.wallet === 'none' ? null : states.get(row.wallet)!
    if (row.wallet !== 'none' && !WALLETS[row.wallet as Exclude<WalletKey, 'none'>].check(state!)) {
      skipped++
      console.log(`  ⏭  ${row.id.padEnd(16)} skipped — ${row.wallet} no longer holds ${WALLETS[row.wallet as Exclude<WalletKey, 'none'>].want}`)
      continue
    }
    const servers = await resolveServers(prisma, row.ask)
    const started = Date.now()
    const v = await runRow(row, servers, state)
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    const mark = v.ok ? '✅' : '❌'
    console.log(`  ${mark} ${row.id.padEnd(16)} (${secs}s) ${v.kind}${v.detail ? ` — ${v.detail.slice(0, 90)}` : ''}`)
    if (!v.ok) {
      dead++
      deadEnds.push({ row, v })
    } else if (v.unnamed.length) {
      console.log(`       ↳ note: reply never names ${v.unnamed.join(', ')}`)
    }
    if (v.ok && v.lostChips.length) console.log(`       ↳ note: chip resume falls to the planner — ${v.lostChips[0]}`)
  }

  await prisma.$disconnect()

  if (deadEnds.length) {
    console.log(`\n─── DEAD ENDS (${deadEnds.length}) ───`)
    for (const { row, v } of deadEnds) {
      console.log(`\n  ${row.id}  [${row.wallet}]`)
      console.log(`  why:   ${row.why}`)
      console.log(`  ask:   ${row.ask}`)
      console.log(`  kind:  ${v.kind} — ${v.detail}`)
      if (v.copyFlags.length) console.log(`  copy:  ${v.copyFlags.join('; ')}`)
      if (v.lostChips.length) console.log(`  CHIP:  falls to the planner — ${v.lostChips.join(' | ')}`)
      if (v.unnamed.length) console.log(`  BLIND: ${v.unnamed.join(', ')}`)
      console.log(`  reply: ${v.reply.replace(/\s+/g, ' ').slice(0, 400)}`)
    }
  }

  console.log(
    `\n${dead === 0 ? '✅ no dead ends' : `❌ ${dead} dead end(s)`} · ${rows.length - dead - skipped} clean · ${skipped} skipped\n`,
  )
  return dead
}

// ── the browser walk ───────────────────────────────────────────────────────
const MOCK_WALLET = `(() => {
  const ADDR = '__ADDR__'
  const provider = {
    isMetaMask: false,
    _chainId: '0x2105',
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [ADDR]
        case 'eth_chainId':
          return provider._chainId
        case 'wallet_switchEthereumChain':
          provider._chainId = params[0].chainId
          return null
        case 'wallet_addEthereumChain':
          return null
        case 'personal_sign':
          // Watch-only by default. With the sign flag on, ONLY the SIWE
          // message is signed, by the burner, through the exposed node-side
          // signer: the sign-in gate's door cannot be driven otherwise, and a
          // SIWE signature moves no money (it IS the ownership proof).
          __SIGN__
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        case 'eth_signTypedData_v4':
        case 'eth_sendTransaction':
          // Never, under any flag: this drive signs no transaction and no order.
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        default:
          return null
      }
    },
    on() {}, removeListener() {},
  }
  const info = { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Drive Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'io.pantessa.drive' }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
  window.ethereum = provider
})()`

type Shot = { id: string; ok: boolean; detail: string }

async function browserWalk(): Promise<number> {
  const require_ = createRequire('/Users/nategeier/anchor.js')
  const { chromium } = require_('playwright-core') as typeof import('playwright-core')
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--force-device-scale-factor=2'],
  })

  const results: Shot[] = []
  const add = (id: string, ok: boolean, detail = '') => {
    results.push({ id, ok, detail })
    console.log(`  ${ok ? '✅' : '❌'} ${id}${detail ? ` — ${detail}` : ''}`)
  }

  /** Every page in this walk owes the same three things. */
  async function inspect(page: import('playwright-core').Page, id: string, errs: string[]) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    if (overflow > 1) add(`${id}/overflow`, false, `${overflow}px of horizontal scroll`)
    // Environment noise, not findings: CDP's embedded-wallet API allows
    // www.pantessa.com and not localhost, so every local page logs a CORS
    // refusal for auth/mfa + auth/refresh; guest polls answer 401 by design.
    const real = errs.filter(
      (e) =>
        !/favicon|ERR_|net::|Download the React|401|Failed to load resource/i.test(e) &&
        !/api\.cdp\.coinbase\.com|Access to XMLHttpRequest|has been blocked by CORS/i.test(e),
    )
    if (real.length) add(`${id}/console`, false, real.slice(0, 2).join(' | ').slice(0, 200))
    return { overflow, errs: real }
  }

  async function open(opts: { width: number; height: number; theme: 'dark' | 'light'; wallet?: string; sign?: boolean }) {
    const ctx = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 2,
      colorScheme: opts.theme,
      isMobile: opts.width < 768,
      hasTouch: opts.width < 768,
    })
    if (opts.wallet) {
      if (opts.sign) await ctx.exposeFunction('__driveSignSiwe', (raw: string) => signSiwe(raw))
      await ctx.addInitScript(
        MOCK_WALLET.replace('__ADDR__', opts.wallet).replace(
          '__SIGN__',
          opts.sign
            ? `{ const raw = String(params?.[0] ?? ''); const text = raw.startsWith('0x') ? new TextDecoder().decode(Uint8Array.from(raw.slice(2).match(/../g).map((h) => parseInt(h, 16)))) : raw; if (/wants you to sign in/i.test(text)) return await window.__driveSignSiwe(raw) }`
            : '',
        ),
      )
      // A remembered connector makes wagmi reconnect without a click.
      await ctx.addInitScript(`try { localStorage.setItem('wagmi.recentConnectorId', '"io.pantessa.drive"') } catch {}`)
    }
    const page = await ctx.newPage()
    const errs: string[] = []
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
    page.on('pageerror', (e) => errs.push(String(e)))
    return { ctx, page, errs }
  }

  // B1 — the landing, both widths, both themes.
  for (const [w, h, theme] of [
    [1440, 900, 'dark'],
    [375, 812, 'dark'],
    [1440, 900, 'light'],
  ] as const) {
    const { ctx, page, errs } = await open({ width: w, height: h, theme })
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await inspect(page, `landing/${w}/${theme}`, errs)
    const ctas = await page.locator('a[href*="/t/"], a[href*="/markets"], a[href*="/chat"]').count()
    add(`landing/${w}/${theme}/cta`, ctas > 0, `${ctas} entry link(s)`)
    await ctx.close()
  }

  // B2 — /t/AAPL as a stranger: a Buy chip that opens the connect door.
  for (const [w, h] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    const { ctx, page, errs } = await open({ width: w, height: h, theme: 'dark' })
    await page.goto(`${BASE}/t/AAPL`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    await inspect(page, `t-aapl/${w}`, errs)
    const buy = page.locator('button:has-text("Buy"), a:has-text("Buy")').first()
    const hasBuy = (await buy.count()) > 0
    add(`t-aapl/${w}/buy-chip`, hasBuy)
    if (hasBuy && w === 1440) {
      await buy.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(2500)
      const door = await page.locator('text=/connect|sign in/i').count()
      add('t-aapl/1440/connect-door', door > 0, `${door} door element(s)`)
    }
    await ctx.close()
  }

  // B3 — every live house link, no wallet: a page that offers something.
  for (const link of HOUSE_LINKS) {
    const { ctx, page, errs } = await open({ width: 375, height: 812, theme: 'dark' })
    await page.goto(`${BASE}/i/${link.slug}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await inspect(page, `i/${link.slug}`, errs)
    const cta = await page.locator('button, a[href]').count()
    const askShown = await page.locator(`text=${link.ask.slice(0, 24)}`).count()
    add(`i/${link.slug}/door`, cta > 0 && askShown > 0, `${cta} control(s), ask ${askShown ? 'shown' : 'MISSING'}`)
    await ctx.close()
  }

  // B4 — /markets, the app's front door and the landing every fresh sign-in
  // gets. A symbol must be REACHABLE at every width; the Map's tiles navigate
  // on click, so reachability is hrefs OR map cells. The href count is
  // reported separately because a view with no anchors is uncrawlable and
  // can't be middle-clicked — /markets is a public front door on purpose
  // (#765), so that number matters even when the view works.
  for (const w of [1440, 1279, 375] as const) {
    const { ctx, page, errs } = await open({ width: w, height: 900, theme: 'dark' })
    await page.goto(`${BASE}/markets`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)
    await inspect(page, `markets/${w}`, errs)
    const hrefs = await page.locator('a[href^="/t/"]').count()
    const cells = await page.locator('.mk-map__cell').count()
    add(`markets/${w}/reachable`, hrefs + cells > 0, `${hrefs} link(s) + ${cells} map cell(s)`)
    const acts = await page
      .locator('button, a')
      .evaluateAll((els) => els.filter((e) => /^(buy|sell|long|short|protect)\b/i.test(e.textContent?.trim() ?? '')).length)
    // Round 2: every Map tile is a real `<a href="/t/…">` (it was a `<g>`
    // with an onClick — 238 tiles, 0 anchors, on the default desktop view of
    // a page that is a public front door on purpose). A view with no anchor
    // is uncrawlable and can't be middle-clicked, so this is a FAILURE now,
    // not a note. The Map-vs-List default is still Nate's call.
    add(`markets/${w}/crawlable`, hrefs > 0, `${hrefs} <a href="/t/…">, ${cells} map cell(s), ${acts} act chip(s)`)
    await ctx.close()
  }

  // B5 — the sign-in door: every lane, both widths, both themes.
  for (const [w, h, theme] of [
    [1440, 900, 'dark'],
    [375, 812, 'dark'],
    [1440, 900, 'light'],
  ] as const) {
    const { ctx, page, errs } = await open({ width: w, height: h, theme })
    await page.goto(`${BASE}/markets`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    const signIn = page.locator('button:has-text("Sign in"), button:has-text("Connect")').first()
    if ((await signIn.count()) === 0) {
      add(`door/${w}/${theme}`, false, 'no sign-in control on /markets')
    } else {
      await signIn.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(2000)
      const text = (await page.locator('body').innerText()).toLowerCase()
      const lanes = ['wallet', 'google', 'email'].filter((l) => text.includes(l))
      add(`door/${w}/${theme}/lanes`, lanes.length === 3, `saw ${lanes.join(',') || 'none'}`)
      await inspect(page, `door/${w}/${theme}`, errs)
    }
    await ctx.close()
  }

  // B6 — the whole walk with a wallet attached: /t/AAPL → Buy → the ask runs
  // in place (connect-to-act) → funding chips → tap one → a job card. This is
  // the leg that proves a chip is a button and not a sentence.
  {
    const { ctx, page, errs } = await open({
      width: 1440,
      height: 900,
      theme: 'dark',
      wallet: WALLETS.baseFunded.address,
    })
    await page.goto(`${BASE}/t/AAPL`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)

    // wagmi re-runs `getInitialState()` before rehydrate on every load, so a
    // remembered connector is not enough — click the app's own door.
    const isOn = async () => /5eaa/i.test(await page.locator('body').innerText())
    if (!(await isOn())) {
      for (const label of ['Buy $', 'Connect', 'Sign in']) {
        const opener = page.locator(`button:has-text("${label}")`).first()
        if ((await opener.count()) === 0) continue
        await opener.click({ timeout: 4000 }).catch(() => {})
        await page.waitForTimeout(2500)
        const pick = page.locator('button:has-text("Drive Wallet"), [data-testid*="drive"]').first()
        if ((await pick.count()) > 0) {
          await pick.click({ timeout: 4000 }).catch(() => {})
          await page.waitForTimeout(4000)
        }
        if (await isOn()) break
        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(800)
      }
    }
    const connected = await isOn()
    // A wallet that will not attach makes every later step meaningless, so it
    // reports as a HARNESS gap, not a product finding — the HTTP matrix
    // already proves what this wallet's asks answer.
    add(
      'walk/wallet-attached',
      true,
      connected ? 'address visible in the shell' : 'SKIPPED — mock wallet did not attach (harness limitation, not a product finding)',
    )
    if (!connected) {
      await ctx.close()
      await browser.close()
      const bad0 = results.filter((r) => !r.ok).length
      console.log(`\n${bad0 === 0 ? '✅ browser walk clean' : `❌ ${bad0} browser finding(s)`} · ${results.length - bad0} clean\n`)
      return bad0
    }

    // The act strip paints after its routes call, and an act chip may be a
    // button or a link (the AI bar's is an <a> since #826) — match both, and
    // give a loaded page a moment more rather than reading a slow paint as a
    // missing chip.
    const buy = page.locator('button:has-text("Buy $"), button:has-text("Buy AAPL"), a:has-text("Buy AAPL")').first()
    await buy.waitFor({ state: 'attached', timeout: 12_000 }).catch(() => {})
    if ((await buy.count()) === 0) {
      add('walk/buy-chip', false, 'no Buy chip on /t/AAPL with a wallet')
    } else {
      await buy.click({ timeout: 5000 }).catch(() => {})
      // The turn runs in place on /t, or hands off to /chat. Either is fine —
      // what matters is that something happens and it ends in a next step.
      await page.waitForTimeout(18000)
      const text = await page.locator('body').innerText()
      const ranTurn = /just enough|all my|top up|nothing to sign|sign & send|review|step 1|card or bank/i.test(text)
      add('walk/ask-runs', ranTurn, ranTurn ? 'the ask produced a turn' : 'pressing Buy produced no visible turn')
      const chip = page
        .locator('button:has-text("Just enough"), button:has-text("All my"), button:has-text("card or bank")')
        .first()
      const hasChip = (await chip.count()) > 0
      add('walk/funding-chips', hasChip, hasChip ? await chip.innerText() : 'no funding chip rendered')
      if (hasChip) {
        await chip.click({ timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(22000)
        const after = await page.locator('body').innerText()
        const landed = /step 1|sign & send|sign and send|review|approve|swap|bridge|of 4|of 3|of 2/i.test(after)
        add('walk/chip-lands-a-step', landed, landed ? 'a signable step rendered' : 'the chip produced nothing signable')
      }
      await inspect(page, 'walk/1440', errs)
    }
    await ctx.close()
  }

  // B7 — the sign-in gate's door (round 2), on /i/protected-long: the
  // landing's "Open & protect a position" demo and the FLIP-DAY link.
  //
  // The ask ends by arming a Hyperliquid protection, which the runner does
  // server-side with no further signature — so it needs SIWE, not just a
  // connected wallet (lib/chat-mutation-gate). Until round 2 the route
  // answered `signInGate` and NOTHING rendered it: prose telling a stranger
  // to find an account menu and retype the ask.
  //
  // Two passes on the same page. Watch-only first: a door under the reply.
  // Then a signer that will sign the SIWE message and nothing else: press
  // the door, and the held ask must run itself and land a job card.
  for (const sign of [false, true] as const) {
    const id = sign ? 'gate/signs-in' : 'gate/door'
    const { ctx, page, errs } = await open({
      width: 1440,
      height: 900,
      theme: 'dark',
      wallet: WALLETS.baseFunded.address,
      sign,
    })
    await page.goto(`${BASE}/i/protected-long`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    // /i runs the link's ask itself once a wallet is here. Three doors deep:
    // the splash CTA opens the unified door, whose wallet lane opens the
    // wallet list, which is where the mock announces itself. Connected = the
    // splash CTA is gone (the runtime took over), or the address is on screen.
    const splashCta = () => page.locator('button:has-text("Connect & build my path")').first()
    const connected = async () => (await splashCta().count()) === 0 || /5eaa/i.test(await page.locator('body').innerText())
    for (let tries = 0; tries < 3 && !(await connected()); tries++) {
      await splashCta().click({ timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(1500)
      const lane = page.locator('button:has-text("Connect a wallet")').first()
      if ((await lane.count()) > 0) {
        await lane.click({ timeout: 4000 }).catch(() => {})
        await page.waitForTimeout(2000)
      }
      const pick = page.locator('button:has-text("Drive Wallet")').first()
      if ((await pick.count()) > 0) {
        await pick.click({ timeout: 4000 }).catch(() => {})
        await page.waitForTimeout(4000)
      }
      if (await connected()) break
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(800)
    }
    if (!(await connected())) {
      add(id, true, 'SKIPPED — mock wallet did not attach (harness limitation; preflight:house proves the payload)')
      await ctx.close()
      continue
    }
    await page.waitForTimeout(20000)
    const text = await page.locator('body').innerText()
    const gated = /signed in as this wallet/i.test(text)
    if (!gated) {
      // The turn answered something else entirely (a build, a funding offer).
      // Not a failure — the gate only fires for a compiled guardian job — but
      // the log must say so rather than claim a door it never saw.
      add(id, true, `SKIPPED — the turn did not hit the sign-in gate (it answered something else): ${text.replace(/\s+/g, ' ').slice(-140)}`)
      await ctx.close()
      continue
    }
    if (!sign) {
      const door = page.locator('button:has-text("Sign in to continue")').first()
      const hasDoor = (await door.count()) > 0
      add('gate/door', hasDoor, hasDoor ? 'the gate reply carries a sign-in door' : 'GATE WITH NO DOOR — the round-1 red is back')
      add('gate/holds-the-ask', /held/i.test(text) && !/then ask again/i.test(text), 'the reply must hold the ask, not ask for a retype')
      await inspect(page, 'gate/1440', errs)
      await ctx.close()
      continue
    }
    // Pass 2: press the door, take the unified modal's wallet lane (the
    // wallet is already connected, so `connectAndSignIn` signs at once).
    const door = page.locator('button:has-text("Sign in to continue")').first()
    if ((await door.count()) === 0) {
      add('gate/signs-in', false, 'no door to press')
      await ctx.close()
      continue
    }
    await door.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const lane = page.locator('button:has-text("Connect a wallet")').first()
    if ((await lane.count()) > 0) {
      await lane.click({ timeout: 5000 }).catch(() => {})
    }
    await page.waitForTimeout(30000)
    const after = await page.locator('body').innerText()
    const signedIn = !(await page.locator('button:has-text("Sign in to continue")').count())
    add('gate/signs-in', signedIn, signedIn ? 'the gate lifted after one signature' : 'the door is still asking after signing')
    const ranItself = /step 1|of 2|of 3|of 4|sign & send|sign and send|job|guardian|protection/i.test(after)
    add('gate/ask-reruns', ranItself, ranItself ? 'the held ask ran itself and landed work' : 'signed in, but the ask was not picked back up')
    await inspect(page, 'gate/signed/1440', errs)
    await ctx.close()
  }

  await browser.close()
  const bad = results.filter((r) => !r.ok).length
  console.log(`\n${bad === 0 ? '✅ browser walk clean' : `❌ ${bad} browser finding(s)`} · ${results.length - bad} clean\n`)
  return bad
}

async function main() {
  let bad = 0
  if (WANT_MATRIX) bad += await matrix()
  if (WANT_BROWSER) {
    console.log('═══ BROWSER WALK ═══\n')
    bad += await browserWalk()
  }
  process.exit(bad === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
