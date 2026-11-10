#!/usr/bin/env tsx
/**
 * The Hyperliquid builder-dex (HIP-3) drill — does a sentence like
 * "Long $25 of SP500 on Hyperliquid" really build, and does the VENUE take
 * what the order layer builds?
 *
 * TWO MODES. Read which one you are in before you run it.
 *
 *   (default)  MAINNET, READ-ONLY. Parses the ask, runs the real turn builder
 *              (lib/hyperliquid-exec buildHlExecTurn) against the live venue
 *              for a wallet, and prints what it WOULD sign: the market it
 *              resolved, the asset id, every guard check, the steps on the
 *              card. No key is loaded for signing, nothing is signed, nothing
 *              is sent. Safe to run any time.
 *
 *                npx tsx scripts/hl-hip3-drill.ts
 *                npx tsx scripts/hl-hip3-drill.ts --ask "2x long $25 of GOLD on hyperliquid" --wallet 0x…
 *
 *   --testnet  TESTNET, MOCK FUNDS, EVERYTHING SIGNED. The burner
 *              (PRIVATE_KEY in .env.local) opens and closes real testnet
 *              positions on the `xyz` builder dex — a cross-margin market and
 *              an isolated-only one — through the LOCAL relay
 *              (/api/hl/submit of a `next start` on this branch), which
 *              re-guards every action before the venue sees it. Testnet books
 *              are thin, so a throwaway maker account (funded from the
 *              burner's mock USDC, refunded at the end) rests the liquidity.
 *
 *                HL_GUARDIAN_TESTNET=true npx next start -p 4420      # the relay
 *                npx tsx scripts/hl-hip3-drill.ts --testnet --base http://localhost:4420
 *                … --delegated     also run the consent + approved-agent door (what MetaMask takes)
 *
 *              Mock USDC: POST {"type":"claimDrip","user":"0x…"} to
 *              https://api.hyperliquid-testnet.xyz/info (1,000 per address;
 *              the address must exist on mainnet).
 *
 * There is NO mainnet signing mode in this file on purpose. The live drill is
 * the product itself: the owner asks the sentence in /chat and signs the card.
 */
import fs from 'node:fs'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import {
  buildHlExecTurn,
  hlConsentMessage,
  hlDexTransferArtifacts,
  hlFreshNonce,
  parseHlIntent,
  type HlExecTurn,
  type HlIntent,
  type HlWireAction,
  type HlWireOrderAction,
} from '../lib/hyperliquid-exec'
import { formatPx } from '../lib/hl-guardian'
import { HL_BUILDER_DEXES, hlAssetId, hlDexOf, hlTickerOf, splitHlAssetId } from '../lib/hl-dex'

// ── args / env ──────────────────────────────────────────────────────────────
const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const has = (name: string) => process.argv.includes(`--${name}`)
const TESTNET = has('testnet')
const DELEGATED = has('delegated')
const BASE = arg('base', 'http://localhost:4420')
const USD = Number(arg('usd', '12'))
const CROSS_MARKET = arg('cross', 'NVDA')
const ISOLATED_MARKET = arg('isolated', 'JPY')

const say = (s: string) => console.log(`\n▸ ${s}`)
const note = (s: string) => console.log(`  ${s}`)
const die = (s: string): never => {
  console.error(`\n✖ ${s}`)
  process.exit(1)
}
const trace = (e: unknown) => {
  const label = (e as { label?: string } | null)?.label
  if (label) note(`· ${label}`)
}

function loadEnv(): Record<string, string> {
  if (!fs.existsSync('.env.local')) return {}
  return Object.fromEntries(
    fs
      .readFileSync('.env.local', 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
  )
}

function printTurn(turn: HlExecTurn): void {
  console.log(`\n  reply: ${turn.reply}`)
  if (turn.connectWallet) note(`connect door: "${turn.connectLabel}" re-runs "${turn.connectAsk}"`)
  if (turn.clarify) note(`chips: ${turn.clarify.options.map((o) => `[${o.label}] → "${o.resume}"`).join('  ')}`)
  const hl = (turn.orderRequest as { hl?: Record<string, unknown> } | undefined)?.hl
  if (hl) {
    const action = hl.action as HlWireOrderAction
    const o = action.orders[0]
    const split = splitHlAssetId(o.a)
    note(`order action: a=${o.a}${split?.dexIndex != null ? ` (= 100000 + ${split.dexIndex} × 10000 + ${split.localIndex})` : ''} ${o.b ? 'BUY' : 'SELL'} ${o.s} @ ≤/≥ ${o.p} ${o.r ? 'reduce-only ' : ''}IOC${action.builder ? ` · builder fee f=${action.builder.f} → ${action.builder.b}` : ' · no builder field'}`)
    const steps = [hl.feeApproval ? 'approve the builder-fee cap' : null, hl.dexTransfer ? `move $${(hl.dexTransfer as { amount: string }).amount} USDC into the ${(hl.dexTransfer as { dex: string }).dex} dex` : null, hl.pre ? `set leverage (${JSON.stringify((hl.pre as { action: unknown }).action)})` : null, 'the order'].filter(Boolean)
    note(`signatures on the card, in order: ${steps.join(' → ')}`)
  }
  for (const c of turn.guardrails?.checks ?? []) note(`${c.ok ? '✓' : c.level === 'block' ? '✗' : '!'} ${c.id}: ${c.note}`)
}

// ════════════════════════════════════════════════════════════════════════════
//  MAINNET — read-only build
// ════════════════════════════════════════════════════════════════════════════
async function mainnetDry(): Promise<void> {
  const env = loadEnv()
  const ask = arg('ask', 'Long $25 of SP500 on Hyperliquid')
  // The ADDRESS only (a public value) — no signer is ever constructed here.
  const burnerAddr = env.PRIVATE_KEY ? privateKeyToAccount((env.PRIVATE_KEY.startsWith('0x') ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`) as `0x${string}`).address : undefined
  const wallet = arg('wallet', burnerAddr ?? '')
  console.log(`MAINNET · READ-ONLY — nothing is signed and nothing is sent.\nask: "${ask}"`)

  const intent = parseHlIntent(ask)
  if (!intent) return die('the Hyperliquid grammar does not read that sentence')
  note(`parsed: ${JSON.stringify(intent)}`)

  say('no wallet → the connect door, never a wall')
  printTurn(await buildHlExecTurn(intent, undefined, trace, ask))

  if (wallet) {
    say(`a wallet (${wallet}) → the build`)
    try {
      printTurn(await buildHlExecTurn(intent, wallet, trace, ask))
    } catch (e) {
      note(`build threw: ${(e as Error).message}`)
    }
  }

  say('an account with nothing on Hyperliquid → the honest collateral refusal (the chat route turns this into the funded job)')
  try {
    printTurn(await buildHlExecTurn(intent, '0x00000000000000000000000000000000deadbeef', trace, ask))
  } catch (e) {
    note(`build threw: ${(e as Error).message}`)
  }

  if (intent.kind === 'open' || intent.kind === 'close') {
    say('the venue\'s own asset id for this market, from real fills (the explorer)')
    await explorerAssetId(false, intent.coin)
  }
}

/** Find a recent real fill on the market and read the asset id its ORDER
 *  carried, from the venue's explorer — the id scheme, seen, not derived. */
async function explorerAssetId(isTestnet: boolean, coinInput: string): Promise<void> {
  const host = isTestnet ? 'hyperliquid-testnet' : 'hyperliquid'
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet }) })
  const ticker = hlTickerOf(coinInput).toUpperCase()
  const dexs = (await info.perpDexs()) as ({ name: string } | null)[]
  for (const dex of [hlDexOf(coinInput), ...Object.keys(HL_BUILDER_DEXES)].filter((d, i, a): d is string => !!d && a.indexOf(d) === i)) {
    const meta = await info.meta({ dex }).catch(() => null)
    const row = meta ? meta.universe.findIndex((u) => u.name.toUpperCase() === `${dex}:${ticker}`.toUpperCase()) : -1
    if (!meta || row < 0) continue
    const coin = meta.universe[row].name
    const slot = dexs.findIndex((d) => d?.name === dex)
    const expected = hlAssetId(slot, row)
    note(`${coin}: dex "${dex}" is slot ${slot} of perpDexs, the market is row ${row} of its universe → id ${expected}`)
    const trades = (await fetch(`https://api.${host}.xyz/info`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'recentTrades', coin }) }).then((r) => r.json())) as { hash: string }[]
    for (const t of trades.filter((x) => !/^0x0+$/.test(x.hash)).slice(0, 4)) {
      const tx = (await fetch(`https://rpc.${host}.xyz/explorer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'txDetails', hash: t.hash }) })
        .then((r) => r.json())
        .catch(() => null)) as { tx?: { action?: { type?: string; orders?: { a: number }[]; builder?: { f: number } } } } | null
      const a = tx?.tx?.action
      if (a?.type !== 'order' || !a.orders?.length) continue
      const ids = [...new Set(a.orders.map((o) => o.a))]
      note(`real fill ${t.hash.slice(0, 18)}… carried a=${ids.join(',')}${a.builder ? ` with a builder fee f=${a.builder.f}` : ''} ${ids.includes(expected) ? '✓ matches' : '(a multi-market order)'}`)
    }
    return
  }
  note(`${ticker} is not on a builder dex this layer builds on — nothing to show`)
}

// ════════════════════════════════════════════════════════════════════════════
//  TESTNET — the whole path, signed, through the local relay
// ════════════════════════════════════════════════════════════════════════════
const TESTNET_SIG_CHAIN = 421614 // Arbitrum Sepolia — what a testnet wallet would be on

interface RelayAnswer {
  ok: boolean
  status: number
  body: Record<string, unknown>
}
async function relay(body: Record<string, unknown>): Promise<RelayAnswer> {
  const res = await fetch(`${BASE}/api/hl/submit`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1' }, body: JSON.stringify(body) })
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

type L1 = { action: HlWireAction; nonce: number; typedData: { domain: object; types: object; primaryType: string; message: object }; expected: { coin: string; kind?: string; isBuy?: boolean; leverage?: number } }

/** One L1 action through the relay: the wallet's own typed-data signature, or
 *  (--delegated) a personal_sign consent that the approved agent acts on. */
async function signL1(taker: PrivateKeyAccount, step: L1, delegated: boolean): Promise<RelayAnswer> {
  if (delegated) {
    const consent = hlConsentMessage({ from: taker.address, action: step.action, nonce: step.nonce, isTestnet: true, expected: step.expected })
    const consentSignature = await taker.signMessage({ message: consent })
    return relay({ mode: 'delegated', action: step.action, nonce: step.nonce, isTestnet: true, expected: step.expected, consentSignature, from: taker.address })
  }
  const signature = await taker.signTypedData(step.typedData as Parameters<typeof taker.signTypedData>[0])
  return relay({ action: step.action, nonce: step.nonce, isTestnet: true, expected: step.expected, signature, from: taker.address })
}

/** Run every signature a built card carries, in the card's order. */
async function signCard(taker: PrivateKeyAccount, turn: HlExecTurn, delegated: boolean): Promise<RelayAnswer> {
  const order = turn.orderRequest as { typedData: L1['typedData']; hl: { action: HlWireAction; nonce: number; expected: { coin: string; kind: string; isBuy: boolean }; pre?: L1; dexTransfer?: { dex: string; amount: string }; feeApproval?: unknown } } | undefined
  if (!order) return die(`nothing signable was built: ${turn.reply}`)
  const hl = order.hl
  if (hl.feeApproval) note('(card carries a builder-fee approval — the testnet treasury is unfunded, so this should not happen)')
  if (hl.dexTransfer) {
    // Signed "at tap time" — and a script taps in the same millisecond the order was built in, so the nonce is
    // taken the way the card takes it: never one the order or the leverage step already carries.
    const { action, typedData } = hlDexTransferArtifacts({ from: taker.address, dex: hl.dexTransfer.dex, amount: hl.dexTransfer.amount, nonce: hlFreshNonce([hl.nonce, hl.pre?.nonce]), signatureChainId: TESTNET_SIG_CHAIN, isTestnet: true })
    const signature = await taker.signTypedData({ ...typedData, message: { ...typedData.message, nonce: BigInt(action.nonce) } } as Parameters<typeof taker.signTypedData>[0])
    const moved = await relay({ action, nonce: action.nonce, isTestnet: true, signature, from: taker.address })
    note(`move $${hl.dexTransfer.amount} → ${hl.dexTransfer.dex} dex: relay ${moved.status} ${JSON.stringify(moved.body)}`)
    if (!moved.ok) return moved
  }
  if (hl.pre) {
    const lev = await signL1(taker, { action: hl.pre.action, nonce: hl.pre.nonce, typedData: hl.pre.typedData, expected: { coin: hl.expected.coin, leverage: hl.pre.expected.leverage } }, delegated)
    note(`leverage ${JSON.stringify(hl.pre.action)}: relay ${lev.status} ${JSON.stringify(lev.body)}`)
    if (!lev.ok) return lev
  }
  const placed = await signL1(taker, { action: hl.action, nonce: hl.nonce, typedData: order.typedData, expected: hl.expected }, delegated)
  note(`order: relay ${placed.status} ${JSON.stringify(placed.body)}`)
  return placed
}

/** The one-time "enable trading" approval, through the relay's own door: it
 *  mints a trade-only agent for the wallet, the wallet signs the venue's
 *  approveAgent, and from then on a personal_sign consent is enough. The
 *  relay must run with HL_GUARDIAN_TESTNET=true or it would mint a MAINNET
 *  agent — refused here before anything is signed. */
async function ensureAgent(taker: PrivateKeyAccount): Promise<void> {
  say('the delegated door: approving a trade-only Pantessa agent on the testnet account')
  const created = (await fetch(`${BASE}/api/hl/delegation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: taker.address, signatureChainId: TESTNET_SIG_CHAIN }) }).then((r) => r.json())) as {
    active?: boolean
    id?: string
    agentAddress?: string
    typedData?: { domain: object; types: object; primaryType: string; message: Record<string, unknown> }
    error?: string
  }
  if (created.active) return note(`agent already approved: ${created.agentAddress}`)
  if (!created.id || !created.typedData) return die(`the delegation door answered ${JSON.stringify(created)}`)
  if (created.typedData.message.hyperliquidChain !== 'Testnet') return die('the relay is not in testnet mode (start it with HL_GUARDIAN_TESTNET=true) — refusing to approve a MAINNET agent from a drill')
  const signature = await taker.signTypedData({ ...created.typedData, message: { ...created.typedData.message, nonce: BigInt(created.typedData.message.nonce as number) } } as Parameters<typeof taker.signTypedData>[0])
  const activated = await fetch(`${BASE}/api/hl/delegation`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: created.id, from: taker.address, signature }) })
  if (!activated.ok) return die(`the venue refused the agent approval: ${await activated.text()}`)
  note(`agent approved: ${created.agentAddress} (can trade, can never withdraw — venue-enforced)`)
}

async function testnetDrill(): Promise<void> {
  const env = loadEnv()
  if (!env.PRIVATE_KEY) return die('PRIVATE_KEY is not in .env.local')
  const taker = privateKeyToAccount((env.PRIVATE_KEY.startsWith('0x') ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`) as `0x${string}`)
  const transport = new HttpTransport({ isTestnet: true })
  const info = new InfoClient({ transport })
  const takerExch = new ExchangeClient({ transport, wallet: taker })
  console.log(`TESTNET · MOCK FUNDS — every action is signed and goes through the relay at ${BASE}${DELEGATED ? ' (direct door, then the delegated door)' : ''}.\ntaker ${taker.address}`)

  const health = await fetch(`${BASE}/api/hl/delegation?wallet=${taker.address}`).then((r) => r.status, () => 0)
  if (health !== 200) return die(`no relay at ${BASE} (GET /api/hl/delegation answered ${health || 'nothing'}). Start one: HL_GUARDIAN_TESTNET=true npx next start -p <port>`)

  const usdcToken = await info.spotMeta().then((m) => {
    const t = m.tokens.find((x) => x.index === 0)!
    return `${t.name}:${t.tokenId}`
  })
  const bal = async (who: `0x${string}`) => {
    const [main, xyz] = await Promise.all([info.clearinghouseState({ user: who }), info.clearinghouseState({ user: who, dex: 'xyz' })])
    return { main: Number(main.withdrawable), xyz: Number(xyz.withdrawable), xyzPositions: xyz.assetPositions.map((p) => `${p.position.coin} ${p.position.szi} (${p.position.leverage.type} ${p.position.leverage.value}x)`) }
  }
  const before = await bal(taker.address)
  note(`taker before: main $${before.main} · xyz $${before.xyz} · ${before.xyzPositions.join(', ') || 'flat'} · mode ${JSON.stringify(await info.userAbstraction({ user: taker.address }))}`)
  if (before.main + before.xyz < 150) return die('the taker needs ~150 mock USDC on testnet — claim the drip (see the header)')

  // ── The maker: a throwaway account that rests the liquidity our IOCs hit ──
  say('funding a throwaway maker from the taker\'s mock USDC (returned at the end)')
  const maker = privateKeyToAccount(generatePrivateKey())
  const makerExch = new ExchangeClient({ transport, wallet: maker })
  note(`maker ${maker.address}`)
  await takerExch.usdSend({ destination: maker.address, amount: '120' })
  await makerExch.sendAsset({ destination: maker.address, sourceDex: '', destinationDex: 'xyz', token: usdcToken, amount: '115', fromSubAccount: '' })
  note(`maker funded: ${JSON.stringify(await bal(maker.address))}`)

  const dexSlot = ((await info.perpDexs()) as ({ name: string } | null)[]).findIndex((d) => d?.name === 'xyz')
  const meta = await info.meta({ dex: 'xyz' })
  const market = (ticker: string) => {
    const row = meta.universe.findIndex((u) => u.name === `xyz:${ticker}`)
    if (row < 0) die(`testnet lists no xyz:${ticker}`)
    return { coin: `xyz:${ticker}`, row, id: hlAssetId(dexSlot, row), szDecimals: meta.universe[row].szDecimals, isolatedOnly: meta.universe[row].onlyIsolated === true }
  }
  const resting: { a: number; o: number }[] = []
  /** Rest a tight two-sided book round the mark so a ≤1% IOC both ways fills. */
  const makeBook = async (ticker: string, usdEach: number) => {
    const m = market(ticker)
    const active = await info.activeAssetData({ user: maker.address, coin: m.coin })
    const mark = Number(active.markPx)
    const size = (Math.ceil((usdEach / mark) * 10 ** m.szDecimals) / 10 ** m.szDecimals).toFixed(m.szDecimals)
    await makerExch.updateLeverage({ asset: m.id, isCross: !m.isolatedOnly, leverage: 3 }).catch(() => {})
    for (const [isBuy, px] of [[true, mark * 0.999], [false, mark * 1.001]] as const) {
      const res = await makerExch
        .order({ orders: [{ a: m.id, b: isBuy, p: formatPx(px, m.szDecimals), s: size, r: false, t: { limit: { tif: 'Gtc' } } }], grouping: 'na' })
        .catch((e: Error) => ({ response: { data: { statuses: [{ error: e.message }] } } }))
      const st = res.response.data.statuses[0] as { resting?: { oid: number }; filled?: { oid: number }; error?: string }
      note(`maker ${isBuy ? 'bid' : 'ask'} ${size} ${m.coin} @ ${formatPx(px, m.szDecimals)} → ${JSON.stringify(st)}`)
      if (st.resting) resting.push({ a: m.id, o: st.resting.oid })
    }
    const book = (await fetch('https://api.hyperliquid-testnet.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'l2Book', coin: m.coin }) }).then((r) => r.json())) as { levels: { px: string; sz: string }[][] }
    note(`book now: best bid ${book.levels[0][0]?.px ?? '—'} · best ask ${book.levels[1][0]?.px ?? '—'} (mark ${mark})`)
    // The build prices off the venue's MID, and `allMids` trails a fresh quote by a block or two: a build made
    // in that gap carries a price the relay then (rightly) refuses at submit ("strays >100bps from mark").
    // Wait until the mid the build will read sits inside the quotes just rested.
    for (let i = 0; i < 20; i++) {
      const mid = Number((await info.allMids({ dex: 'xyz' }))[m.coin])
      if (Math.abs(mid - mark) / mark < 0.003) break
      await new Promise((r) => setTimeout(r, 500))
    }
    return m
  }

  const results: string[] = []
  const run = async (label: string, ask: string, delegated: boolean, expect: (r: RelayAnswer, turn: HlExecTurn) => string | null) => {
    say(`${label}: "${ask}"${delegated ? '  [delegated door]' : ''}`)
    const intent = parseHlIntent(ask) as HlIntent | null
    if (!intent) return die(`the grammar does not read "${ask}"`)
    const turn = await buildHlExecTurn(intent, taker.address, trace, ask, { isTestnet: true })
    printTurn(turn)
    if (!turn.orderRequest) {
      const bad = expect({ ok: false, status: 0, body: { error: turn.reply } }, turn)
      results.push(`${bad ? '✗' : '✓'} ${label}${bad ? ` — ${bad}` : ''}`)
      return
    }
    const answer = await signCard(taker, turn, delegated)
    const bad = expect(answer, turn)
    results.push(`${bad ? '✗' : '✓'} ${label}${bad ? ` — ${bad}` : ''}`)
  }
  const filled = (r: RelayAnswer) => (r.ok && r.body.status === 'filled' ? null : `expected a fill, got ${r.status} ${JSON.stringify(r.body)}`)

  try {
    /** Start from the state a new Pantessa user is in: collateral in the MAIN
     *  perp balance, nothing in the dex — so the build must carry the move. */
    const emptyTheDex = async () => {
      const leftover = Math.floor((await bal(taker.address)).xyz * 100) / 100
      if (leftover < 0.01) return
      await takerExch.sendAsset({ destination: taker.address, sourceDex: 'xyz', destinationDex: '', token: usdcToken, amount: leftover.toFixed(2), fromSubAccount: '' })
      note(`moved the taker's free $${leftover} back to the main balance — the dex starts empty`)
    }
    if (DELEGATED) await ensureAgent(taker)

    for (const [ticker, modeLabel] of [[CROSS_MARKET, 'cross-margin market'], [ISOLATED_MARKET, 'isolated-only market']] as const) {
      say(`── xyz:${ticker} (${modeLabel}) ──`)
      const m = await makeBook(ticker, USD * 4)
      note(`asset id ${m.id} = 100000 + ${dexSlot} × 10000 + ${m.row}${m.isolatedOnly ? ' · isolated-only' : ''}`)
      // A position left by an earlier run would turn the open into an add; close it first through the product path.
      const stale = (await info.clearinghouseState({ user: taker.address, dex: 'xyz' })).assetPositions.find((p) => p.position.coin === m.coin)
      if (stale && Number(stale.position.szi) !== 0) await run(`close a position left on ${ticker} by an earlier run`, `close my ${ticker} position on hyperliquid`, false, filled)
      await emptyTheDex()
      // A multiple the account is NOT already at, so the leverage step has something to set.
      const current = (await info.activeAssetData({ user: taker.address, coin: m.coin })).leverage
      const lev = current.value === 2 ? 3 : 2
      note(`account leverage on ${ticker} now: ${current.type} ${current.value}x → the ask names ${lev}x`)

      await run(`open ${ticker} — collateral in the main balance, so the card moves it, sets leverage, then orders`, `${lev}x long $${USD} of ${ticker} on hyperliquid`, false, (r, turn) => {
        const hl = (turn.orderRequest as { hl?: { dexTransfer?: unknown; pre?: { action: { isCross: boolean; asset: number } }; action: HlWireOrderAction } } | undefined)?.hl
        if (!hl?.dexTransfer) return 'the card carried no move into the dex'
        if (!hl.pre) return 'the card carried no leverage step'
        if (hl.pre.action.isCross !== !m.isolatedOnly) return `leverage mode is ${hl.pre.action.isCross ? 'cross' : 'isolated'} on a ${modeLabel}`
        if (hl.action.orders[0].a !== m.id || hl.pre.action.asset !== m.id) return `asset id ${hl.action.orders[0].a} ≠ ${m.id}`
        return filled(r)
      })
      const pos = (await info.clearinghouseState({ user: taker.address, dex: 'xyz' })).assetPositions.find((p) => p.position.coin === m.coin)?.position
      note(`venue position: ${pos ? `${pos.coin} ${pos.szi} · ${pos.leverage.type} ${pos.leverage.value}x · margin $${pos.marginUsed} · liq ${pos.liquidationPx}` : 'NONE'}`)
      results.push(`${pos && Number(pos.szi) > 0 && pos.leverage.value === lev && pos.leverage.type === (m.isolatedOnly ? 'isolated' : 'cross') ? '✓' : '✗'} the venue shows the ${ticker} long at ${lev}x ${m.isolatedOnly ? 'isolated' : 'cross'} in the xyz dex's own ledger`)

      await run(`add to ${ticker} at the same ${lev}x — the account is already there, so no leverage step`, `${lev}x long $${USD} of ${ticker} on hyperliquid`, DELEGATED, (r, turn) => {
        const hl = (turn.orderRequest as { hl?: { dexTransfer?: unknown; pre?: unknown } } | undefined)?.hl
        if (hl?.pre) return 'the card set leverage again though the account was already there'
        return filled(r)
      })
      await run(`close ${ticker} — reduce-only, sized from the dex's own position`, `close my ${ticker} position on hyperliquid`, DELEGATED, (r, turn) => {
        const o = (turn.orderRequest as { hl?: { action: HlWireOrderAction } } | undefined)?.hl?.action.orders[0]
        if (!o?.r || o.b) return 'the close was not a reduce-only sell'
        return filled(r)
      })
      const after = (await info.clearinghouseState({ user: taker.address, dex: 'xyz' })).assetPositions.find((p) => p.position.coin === m.coin)?.position
      results.push(`${!after || Number(after.szi) === 0 ? '✓' : '✗'} ${ticker} is flat on the venue after the close`)
    }

    // ── The relay refuses what the guard forbids, before the venue sees it ──
    say('tampered actions die at the relay')
    const m = market(CROSS_MARKET)
    const good = await buildHlExecTurn(parseHlIntent(`long $${USD} of ${CROSS_MARKET} on hyperliquid`) as HlIntent, taker.address, () => {}, undefined, { isTestnet: true })
    const goodHl = (good.orderRequest as { hl: { action: HlWireOrderAction; nonce: number; expected: { coin: string; kind: string; isBuy: boolean } } }).hl
    const { hlActionTypedData } = await import('../lib/hyperliquid-exec')
    const tamper = async (label: string, action: HlWireOrderAction) => {
      const typedData = hlActionTypedData(action, goodHl.nonce, true)
      const signature = await taker.signTypedData(typedData as Parameters<typeof taker.signTypedData>[0])
      const r = await relay({ action, nonce: goodHl.nonce, isTestnet: true, expected: goodHl.expected, signature, from: taker.address })
      note(`${label}: relay ${r.status} ${JSON.stringify(r.body)}`)
      results.push(`${r.status === 403 && /Refused at submit/.test(String(r.body.error)) ? '✓' : '✗'} ${label} → refused at the relay`)
    }
    await tamper('an order whose asset id is the NEXT market on the dex', { ...goodHl.action, orders: [{ ...goodHl.action.orders[0], a: m.id + 1 }] })
    await tamper('an order whose asset id is the same row on the MAIN book', { ...goodHl.action, orders: [{ ...goodHl.action.orders[0], a: m.row }] })
    await tamper('an order whose asset id is the same row on ANOTHER dex slot', { ...goodHl.action, orders: [{ ...goodHl.action.orders[0], a: hlAssetId(dexSlot + 1, m.row) }] })
    const stranger = hlDexTransferArtifacts({ from: taker.address, dex: 'xyz', amount: '1', nonce: Date.now(), signatureChainId: TESTNET_SIG_CHAIN, isTestnet: true })
    for (const [label, action] of [
      ['a move whose destination is someone else', { ...stranger.action, destination: maker.address.toLowerCase() }],
      ['a move into a dex outside the registry', { ...stranger.action, destinationDex: 'felix' }],
      ['a move of a token that is not USDC', { ...stranger.action, token: 'HYPE:0x0d01dc56dcaaca66ad901c959b4011ec' }],
    ] as const) {
      const { hlSendAssetTypedData } = await import('../lib/hyperliquid-exec')
      const td = hlSendAssetTypedData(action)
      const signature = await taker.signTypedData({ ...td, message: { ...td.message, nonce: BigInt(action.nonce) } } as Parameters<typeof taker.signTypedData>[0])
      const r = await relay({ action, nonce: action.nonce, isTestnet: true, signature, from: taker.address })
      note(`${label}: relay ${r.status} ${JSON.stringify(r.body)}`)
      results.push(`${r.status === 403 && /Refused at submit/.test(String(r.body.error)) ? '✓' : '✗'} ${label} → refused at the relay`)
    }

    say('what the explorer recorded for our fills')
    const fills = (await fetch('https://api.hyperliquid-testnet.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'userFills', user: taker.address }) }).then((r) => r.json())) as { coin: string; dir: string; sz: string; px: string; hash: string; fee: string; builderFee?: string }[]
    for (const f of fills.slice(0, 6)) {
      const tx = (await fetch('https://rpc.hyperliquid-testnet.xyz/explorer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'txDetails', hash: f.hash }) }).then((r) => r.json()).catch(() => null)) as { tx?: { user?: string; action?: { orders?: { a: number }[] } } } | null
      note(`${f.dir} ${f.sz} ${f.coin} @ ${f.px} · fee ${f.fee}${f.builderFee ? ` (builder ${f.builderFee})` : ''} · tx ${f.hash} · a=${tx?.tx?.action?.orders?.map((o) => o.a).join(',') ?? '?'} signed by ${tx?.tx?.user ?? '?'}`)
    }
  } finally {
    // ── Hand the mock funds back and leave the books as they were ──
    say('cleanup')
    // One by one: an order someone else already took fails its cancel, and must not strand the rest.
    let cancelled = 0
    for (const c of resting) await makerExch.cancel({ cancels: [c] }).then(() => cancelled++, () => {})
    note(`cancelled ${cancelled} of ${resting.length} maker orders (the rest were filled)`)
    const makerState = await info.clearinghouseState({ user: maker.address, dex: 'xyz' })
    for (const p of makerState.assetPositions) note(`maker still holds ${p.position.coin} ${p.position.szi} (testnet — left as is)`)
    const makerFree = Math.floor(Number(makerState.withdrawable) * 100) / 100
    if (makerFree >= 0.01) await makerExch.sendAsset({ destination: maker.address, sourceDex: 'xyz', destinationDex: '', token: usdcToken, amount: makerFree.toFixed(2), fromSubAccount: '' }).catch((e: Error) => note(`maker move back: ${e.message}`))
    const makerMain = Math.floor(Number((await info.clearinghouseState({ user: maker.address })).withdrawable) * 100) / 100
    if (makerMain >= 1) await makerExch.usdSend({ destination: taker.address, amount: makerMain.toFixed(2) }).then(() => note(`maker returned $${makerMain} to the taker`), (e: Error) => note(`maker refund: ${e.message}`))
    const takerFree = Math.floor((await bal(taker.address)).xyz * 100) / 100
    if (takerFree >= 0.01) await takerExch.sendAsset({ destination: taker.address, sourceDex: 'xyz', destinationDex: '', token: usdcToken, amount: takerFree.toFixed(2), fromSubAccount: '' }).catch((e: Error) => note(`taker move back: ${e.message}`))
    note(`taker after: ${JSON.stringify(await bal(taker.address))}`)
  }

  console.log(`\n── result ──\n${results.join('\n')}`)
  const failed = results.filter((r) => r.startsWith('✗')).length
  console.log(`\n${results.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

;(TESTNET ? testnetDrill() : mainnetDry()).catch((e) => die(e instanceof Error ? (e.stack ?? e.message) : String(e)))
