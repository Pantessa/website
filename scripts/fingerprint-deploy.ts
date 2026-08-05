#!/usr/bin/env tsx
/**
 * Deploy fingerprint — does the DEPLOYED build actually serve the YeetCall
 * economics, or just contain them? preflight:house proves house asks land an
 * artifact; audit:asks proves the parse ladder. This proves the things that
 * only exist once a build is live and a REAL link row is in the DB: the fee
 * TIER a link buys, the CALL framing a creator page wears, the downside line
 * a briefing names, the share cards that render.
 *
 *   BASE=https://www.pantessa.com npm run fingerprint:deploy
 *   W_WALLET=0x…  a wallet with ≥$100 of Base ETH (the spot-guard floor)
 *   W4_WALLET=0x… a 4663 wallet holding USDG (else a whale is auto-picked)
 *   ASK="buy $5 of UNI on base"   sized to what the burner can fund
 *
 * Read-only: nothing is signed, no rows are written (every chat probe sends
 * x-yf-no-ask-log so the ask-failure queue stays a real-user queue).
 *
 * The fee assertions are venue-shaped on purpose. CoW carries the rate in
 * appData.partnerFee.bps; Uniswap v3 carries it in the router's own
 * sweepTokenWithFee; Uniswap v4 carries it in the Universal Router's
 * PAY_PORTION command (the refresh recipe's feeBps is the honest readout of
 * what got encoded). A run that can only reach one venue says so rather than
 * quietly passing on half the evidence. The v4 lane asserts claim ==
 * collection in BOTH directions: a map that says 0 must meet calldata with
 * no PAY_PORTION; a map that claims the tier must meet calldata encoding it.
 */
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { PrismaClient } from '@prisma/client'
import { composeMcps } from '../lib/intent-links'
import { SWAP_FEE_BPS, LINK_SWAP_FEE_BPS, NET_FEE_BPS_BY_BUILD_PATH, TREASURY_ADDRESS } from '../lib/fees'

const BASE = process.env.BASE ?? 'https://www.pantessa.com'
/** Sized to what the burner can fund — an ask that outruns the balance lands
 *  the funding plan, which is a correct answer but not a fee artifact. */
const SWAP_ASK = process.env.ASK ?? 'buy $5 of UNI on base'
/** Same pair, limit mode → the CoW order book (v3 has no resting orders). */
const LIMIT_ASK = process.env.LIMIT_ASK ?? 'limit sell 5 USDC for 2 UNI on base'
/** The 4663 stock lane's ask. Stocks quote against USDG; the venue that
 *  answers (v3 since Robinhood seeded pools ~Aug 2026, v4 before, LiFi for
 *  gated pools) is decoded, never assumed. Build-only — the probe wallet is
 *  a chain whale (or W4_WALLET), and nothing is ever signed. */
const V4_ASK = process.env.V4_ASK ?? 'swap 25 USDG for AAPL on robinhood'

function envLocal(key: string): string | null {
  try {
    return readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? null
  } catch {
    return null
  }
}

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `\n     ${detail}` : ''}`)
}

type ChatBody = Record<string, unknown> & {
  reply?: string
  orderRequest?: { appDataJson?: string }
  txChain?: { steps?: Array<{ label?: string; tx?: { data?: string } }>; refresh?: { params?: Record<string, string> } }
}

/** SwapRouter02.sweepTokenWithFee(token, amountMinimum, recipient, feeBips,
 *  feeRecipient) — the Uniswap lane's fee lives in the CALLDATA the wallet
 *  signs, so that is what gets read here. (The refresh recipe's feeBps only
 *  appears on link turns: an organic build omits the param and the builder
 *  falls back to the base rate, which is why its absence must never be read
 *  as "no fee".) */
function sweepFeeBips(data: string): number | null {
  const i = data.toLowerCase().indexOf('e0e189a0')
  if (i < 0) return null
  const words = data.slice(i + 8)
  const feeBips = words.slice(3 * 64, 4 * 64)
  if (feeBips.length < 64) return null
  return Number.parseInt(feeBips, 16)
}

async function driveChat(ask: string, wallet: string, servers: unknown[], slug?: string): Promise<ChatBody> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
    body: JSON.stringify({ message: ask, activeServers: servers, history: [], walletAddress: wallet, ...(slug ? { intentLinkSlug: slug } : {}) }),
  })
  return (await res.json()) as ChatBody
}

/** The rate the built artifact actually encodes — never what the prose says.
 *  null = this turn built no fee-bearing swap (funding offer, refusal,
 *  planner reply), which the caller reports as UNPROVEN rather than a pass. */
function encodedFeeBps(body: ChatBody): { bps: number | null; where: string } {
  const appData = body.orderRequest?.appDataJson
  if (typeof appData === 'string') {
    const m = appData.match(/"bps"\s*:\s*"?(\d+)"?/)
    if (m) return { bps: Number(m[1]), where: 'CoW appData.partnerFee.bps' }
  }
  for (const step of body.txChain?.steps ?? []) {
    const bips = sweepFeeBips(step.tx?.data ?? '')
    if (bips !== null) return { bps: bips, where: 'Uniswap sweepTokenWithFee calldata' }
  }
  return { bps: null, where: `no fee-bearing artifact — reply="${String(body.reply ?? '').slice(0, 110)}"` }
}

/** UniversalRouter.execute(commands, inputs, deadline) — selector 0x3593564c.
 *  The v4 fee rides the router's OWN command stream: V4_SWAP (0x10) then
 *  PAY_PORTION (0x06, the tier to the treasury) then SWEEP (0x04, the rest to
 *  the signer); a fee-free build is the single V4_SWAP. PAY_PORTION's input
 *  is abi(token, recipient, bips) — the fee lives in the CALLDATA the wallet
 *  signs, so that is what gets read, same doctrine as the v3 sweep check.
 *  (The 0x06 INSIDE the v4 actions blob is SWAP_EXACT_IN_SINGLE — different
 *  byte stream; only the top-level commands are scanned here.) */
function v4ExecuteFee(data: string): { commands: string; bips: number | null; recipient: string | null } | null {
  const d = data.toLowerCase()
  if (!d.startsWith('0x3593564c')) return null
  const args = d.slice(10)
  const word = (bytePos: number) => args.slice(bytePos * 2, bytePos * 2 + 64)
  const num = (bytePos: number) => Number.parseInt(word(bytePos), 16)
  const cmdOff = num(0)
  const inpOff = num(32)
  const commands = args.slice((cmdOff + 32) * 2, (cmdOff + 32) * 2 + num(cmdOff) * 2)
  const payIdx = (commands.match(/.{2}/g) ?? ([] as string[])).indexOf('06')
  if (payIdx < 0) return { commands: `0x${commands}`, bips: null, recipient: null }
  const arrData = inpOff + 32
  const elemOff = arrData + num(arrData + payIdx * 32)
  return { commands: `0x${commands}`, bips: num(elemOff + 96), recipient: `0x${word(elemOff + 64).slice(24)}` }
}

/** Robinhood Chain's money token — the v4 stock lane quotes against it. */
const USDG_4663 = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

/** The v4 probe wallet must COVER the ask (the builder pre-reads the sell
 *  balance and answers a funding plan when short — a correct answer but not a
 *  fee artifact). W4_WALLET wins; else the chain's own explorer names a
 *  whale EOA. */
async function usdgWallet(): Promise<string | null> {
  if (process.env.W4_WALLET) return process.env.W4_WALLET.toLowerCase()
  try {
    const r = await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${USDG_4663}/holders`)
    const items = ((await r.json()) as { items?: Array<{ address?: { hash?: string; is_contract?: boolean } }> }).items ?? []
    for (const it of items.slice(0, 8)) {
      const a = it.address
      if (a?.hash && /^0x[0-9a-fA-F]{40}$/.test(a.hash) && !a.is_contract) return a.hash.toLowerCase()
    }
  } catch {
    /* fall through to UNPROVEN */
  }
  return null
}

/** The 4663 stock lane. Tokenized stocks historically had NO v3 route (the
 *  v4-only era) — by 2026-08-05 Robinhood had seeded v3 pools across the
 *  board (AAPL/TSLA/NVDA/MSFT/AMD/PLTR all fill on v3, live-probed), so the
 *  same ask may land v3, v4, or the LiFi settlement venue depending on the
 *  day's liquidity. The economics must hold on WHICHEVER venue answers:
 *  v3 → the sweep tier; v4 → claim == collection (a fees.ts that says 0 must
 *  meet calldata with no PAY_PORTION; a map claiming the tier must meet
 *  calldata encoding exactly that tier to exactly the treasury). LiFi or a
 *  refusal → named UNPROVEN, so a routing shift gets eyes instead of a
 *  silent pass. */
async function stockFeeLane(servers: unknown[], slug: string) {
  const claim = NET_FEE_BPS_BY_BUILD_PATH['native-swap-uniswap-v4'] ?? 0
  const wallet = await usdgWallet()
  if (!wallet) {
    check('4663 stock lane: UNPROVEN (no USDG wallet — set W4_WALLET=0x…)', false)
    return
  }
  type Decoded = { venue: 'v3' | 'v4' | 'none'; commands: string; bips: number | null; recipient: string | null; reply?: string }
  const read = (body: ChatBody): Decoded => {
    for (const step of body.txChain?.steps ?? []) {
      const data = step.tx?.data ?? ''
      const ur = v4ExecuteFee(data)
      if (ur) return { venue: 'v4', ...ur }
      const sweep = sweepFeeBips(data)
      if (sweep !== null) return { venue: 'v3', commands: '', bips: sweep, recipient: null }
    }
    return { venue: 'none', commands: '', bips: null, recipient: null, reply: String(body.reply ?? '').slice(0, 100) }
  }
  const linked = read(await driveChat(V4_ASK, wallet, servers, slug))
  const organic = read(await driveChat(V4_ASK, wallet, servers))
  if (linked.venue === 'none' || organic.venue === 'none') {
    check(
      '4663 stock lane: UNPROVEN this run (no decodable fee artifact — LiFi routing or refusal)',
      false,
      `linked: ${linked.reply ?? 'decoded'}\n     organic: ${organic.reply ?? 'decoded'}`,
    )
    return
  }
  const side = (label: string, r: Decoded, want: number) => {
    if (r.venue === 'v3') {
      check(`4663 stock ${label}: v3 answered at ${want}bps (sweep calldata)`, r.bips === want, `bips=${r.bips}`)
    } else if (claim === 0) {
      check(`4663 stock ${label}: v4 answered — claims no fee, collects none`, r.bips === null, `commands=${r.commands}`)
    } else {
      check(
        `4663 stock ${label}: v4 answered at ${want}bps via PAY_PORTION to the treasury`,
        r.bips === want && r.recipient === TREASURY_ADDRESS.toLowerCase(),
        `bips=${r.bips ?? 'none'} recipient=${r.recipient ?? 'none'} commands=${r.commands}`,
      )
    }
  }
  side('link', linked, LINK_SWAP_FEE_BPS)
  side('organic', organic, SWAP_FEE_BPS)
}

async function feeLane(label: string, ask: string, wallet: string, servers: unknown[], slug: string) {
  const linked = await driveChat(ask, wallet, servers, slug)
  const organic = await driveChat(ask, wallet, servers)
  const l = encodedFeeBps(linked)
  const o = encodedFeeBps(organic)
  if (l.bps === null || o.bps === null) {
    check(`${label}: fee tier UNPROVEN this run (no artifact built)`, false, `linked: ${l.where}\n     organic: ${o.where}`)
    return
  }
  check(`${label}: a link buys the link tier (${LINK_SWAP_FEE_BPS}bps)`, l.bps === LINK_SWAP_FEE_BPS, `${l.bps}bps via ${l.where}`)
  check(`${label}: the same ask organic keeps the base rate (${SWAP_FEE_BPS}bps)`, o.bps === SWAP_FEE_BPS, `${o.bps}bps via ${o.where}`)
}

async function main() {
  const pkRaw = envLocal('PRIVATE_KEY')
  const wallet = process.env.WALLET ?? (pkRaw ? privateKeyToAccount((pkRaw.startsWith('0x') ? pkRaw : `0x${pkRaw}`) as `0x${string}`).address.toLowerCase() : null)
  if (!wallet) throw new Error('No wallet — set WALLET=0x… or run from a worktree with .env.local')
  const dbUrl = envLocal('DATABASE_URL')
  if (!dbUrl) throw new Error('No DATABASE_URL in .env.local')
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })

  // A REAL live row of each class — the tier is a DB lookup, so a fabricated
  // slug would fall open to the base rate and prove nothing.
  const creatorLink = await prisma.intentLink.findFirst({ where: { revoked: false, creator: { not: null } }, orderBy: { createdAt: 'desc' } })
  const houseLink = await prisma.intentLink.findFirst({ where: { revoked: false, creator: null } })
  if (!creatorLink || !houseLink) throw new Error('Need one live creator link and one live house link in the DB')
  const branded = await prisma.creatorHandle.findFirst({ where: { creator: creatorLink.creator! } })

  console.log(`\nDeploy fingerprint @ ${BASE} · wallet ${wallet.slice(0, 6)}…${wallet.slice(-4)}`)
  console.log(`  creator link /i/${creatorLink.id}${branded ? ` (white-labeled: ${branded.brandDomain ?? branded.handle})` : ''}`)
  console.log(`  house link   /i/${houseLink.id}\n`)

  const serverRows = async (ask: string) =>
    (await prisma.mcpServer.findMany({ where: { slug: { in: composeMcps(ask) } } })).map((r) => ({
      slug: r.slug, name: r.name, kind: r.kind, protocol: r.protocol, endpoint: r.endpoint, callable: true,
    }))
  const servers = await serverRows(SWAP_ASK)
  const v4Servers = await serverRows(V4_ASK)
  await prisma.$disconnect()

  // ── 1. the fee tier, on all three venue lanes ───────────────────────────
  await feeLane('Uniswap v3', SWAP_ASK, wallet, servers, creatorLink.id)
  await feeLane('CoW', LIMIT_ASK, wallet, servers, creatorLink.id)
  await stockFeeLane(v4Servers, creatorLink.id)

  // ── 2. the call framing + disclosure ────────────────────────────────────
  const creatorHtml = await (await fetch(`${BASE}/i/${creatorLink.id}`)).text()
  const houseHtml = await (await fetch(`${BASE}/i/${houseLink.id}`)).text()
  check(
    'creator /i reads as a posted CALL (white label included)',
    /(^|>)Call(<|\s)/.test(creatorHtml),
    branded ? 'this link is white-labeled — the brand lockup must not swallow the word' : 'unbranded creator link',
  )
  check('creator /i discloses the lifetime first-touch split', creatorHtml.includes('lifetime, first touch') && creatorHtml.includes('paid calls should say so'))
  check(
    'house /i stays pure Pantessa — no call framing, no creator fee line',
    !/>Call</.test(houseHtml) && !houseHtml.includes('lifetime, first touch') && houseHtml.includes('Intent link'),
  )

  // ── 3. the downside line the briefing owes an unguarded wallet ──────────
  const wWallet = process.env.W_WALLET ?? wallet
  const wHtml = await (await fetch(`${BASE}/w/${wWallet}`)).text()
  const named = /no stop armed/.test(wHtml)
  const priced = /costs \$[\d,.]+/.test(wHtml)
  check(
    '/w names an unarmed stop AND prices the bad day',
    named && priced,
    named || priced
      ? `noStopArmed=${named} dollarCost=${priced}`
      : `wallet ${wWallet.slice(0, 6)}… holds nothing over the guard floor — pass W_WALLET=0x… with ≥$100 of Base ETH to prove this row`,
  )

  // ── 4. the share cards (what lands in a feed) ───────────────────────────
  for (const [label, id] of [['creator', creatorLink.id], ['house', houseLink.id]] as const) {
    const r = await fetch(`${BASE}/i/${id}/opengraph-image`)
    check(`OG card renders (${label} link)`, r.status === 200 && (r.headers.get('content-type') ?? '').includes('image'), `${r.status} ${r.headers.get('content-type')}`)
  }

  // ── 5. the surfaces the launch week reads ───────────────────────────────
  const failuresPage = await fetch(`${BASE}/dashboard/failures`, { redirect: 'manual' })
  check('/dashboard/failures serves (the funded-ask queue)', failuresPage.status < 500, `status=${failuresPage.status}`)

  console.log(failures ? `\n${failures} RED — the deploy is not serving what main contains.\n` : '\nAll green — the deploy serves the economics.\n')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
