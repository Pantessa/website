#!/usr/bin/env tsx
/**
 * Deploy fingerprint — does the DEPLOYED build actually serve the YeetCall
 * economics, or just contain them? preflight:house proves house asks land an
 * artifact; audit:asks proves the parse ladder. This proves the things that
 * only exist once a build is live and a REAL link row is in the DB: the fee
 * TIER a link buys, the CALL framing a creator page wears, the downside line
 * a briefing names, the share cards that render.
 *
 *   BASE=https://www.yeetful.com npm run fingerprint:deploy
 *   W_WALLET=0x…  a wallet with ≥$100 of Base ETH (the spot-guard floor)
 *   ASK="buy $5 of UNI on base"   sized to what the burner can fund
 *
 * Read-only: nothing is signed, no rows are written (every chat probe sends
 * x-yf-no-ask-log so the ask-failure queue stays a real-user queue).
 *
 * The fee assertions are venue-shaped on purpose. CoW carries the rate in
 * appData.partnerFee.bps; Uniswap v3 carries it in the router's own
 * sweepTokenWithFee (the refresh recipe's feeBps is the honest readout of
 * what got encoded). A run that can only reach one venue says so rather than
 * quietly passing on half the evidence.
 */
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { PrismaClient } from '@prisma/client'
import { composeMcps } from '../lib/intent-links'
import { SWAP_FEE_BPS, LINK_SWAP_FEE_BPS } from '../lib/fees'

const BASE = process.env.BASE ?? 'https://www.yeetful.com'
/** Sized to what the burner can fund — an ask that outruns the balance lands
 *  the funding plan, which is a correct answer but not a fee artifact. */
const SWAP_ASK = process.env.ASK ?? 'buy $5 of UNI on base'
/** Same pair, limit mode → the CoW order book (v3 has no resting orders). */
const LIMIT_ASK = process.env.LIMIT_ASK ?? 'limit sell 5 USDC for 2 UNI on base'

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

  const servers = (await prisma.mcpServer.findMany({ where: { slug: { in: composeMcps(SWAP_ASK) } } })).map((r) => ({
    slug: r.slug, name: r.name, kind: r.kind, protocol: r.protocol, endpoint: r.endpoint, callable: true,
  }))
  await prisma.$disconnect()

  // ── 1. the fee tier, on both venue lanes ────────────────────────────────
  await feeLane('Uniswap v3', SWAP_ASK, wallet, servers, creatorLink.id)
  await feeLane('CoW', LIMIT_ASK, wallet, servers, creatorLink.id)

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
    'house /i stays pure Yeetful — no call framing, no creator fee line',
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
