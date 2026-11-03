// scripts/tenant-pins.ts — the TENANT lane's pins (five-million, 2026-11-03).
//
// PURE half (tenantPurePins): every TenantRefusal the policy engine can say,
// reached on purpose; approvals; trading hours (incl. an overnight window);
// the sandbox; the validator naming each bad field; the desk plan → order
// mapping; the swap-candidate rule; desk-key shapes; and source pins on the
// four doors (the desk route resolves the caller on every tool; each relay
// re-gates a tenant leg BEFORE it relays).
//
// LIVE half (tenantLivePins, `--live <base>`): the README demo against a real
// `next start` — an owner signs in (SIWE), creates a tenant, proposes the
// sample policy, activates it, mints a dk_ key, and the desk answers through
// /api/broker/mcp: allowed / CHAIN_DENIED / VENUE_DENIED / awaiting one
// approval → approve → proceeds / a paused key refused by name / a retail
// open untouched — plus the tenant pause, a revoked key, an unknown key, the
// agent-signed execute binding its job, and the relays refusing a tenant leg.
// DB fixtures (the sandbox flip, the relay jobs) need DATABASE_URL in the
// environment — pass the TEST DB inline; nothing here reads .env.local's.
//
//   npm run pins:tenant                                     (pure)
//   DATABASE_URL=… npx tsx scripts/tenant-pins.ts --live http://localhost:4401
//   … --live <base> --burner   (owner = the PRIVATE_KEY burner from .env.local)
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { evaluateTenantPolicy, validatePolicyDoc, withinHours, SAMPLE_POLICY, TESTNET_CHAIN_IDS } from '../lib/tenant/policy'
import { ordersOfPlan, orderOfLeg, orderOfPlan, venueOfBuildPath, swapCandidates } from '../lib/tenant/order'
import { judge, serverHlNetwork } from '../lib/tenant/gate'
import { consentFreeSigner, policySigningWallets } from '../lib/broker-tenant'
import { registerSigner, type SignerRegistrationDeps } from '../lib/tenant/signers'
import { deskKeyPresented, generateDeskKey, hashDeskKey, liveSignerNonces, mintSignerChallenge, signerChallengeText, signerNonceOk } from '../lib/tenant/store'
import { DESK_KEY_RE, type TenantOrder, type TenantPolicyDoc } from '../lib/tenant/spec'

type Check = (name: string, ok: boolean, extra?: string) => void

const ACTIVE = { status: 'active' as const, sandbox: false }
const order = (o: Partial<TenantOrder> = {}): TenantOrder => ({
  venue: 'uniswap-v3',
  op: 'swap',
  chainId: 8453,
  tokens: ['USDC', 'ETH'],
  side: 'buy',
  usd: 25,
  deskId: 'macro',
  at: Date.UTC(2026, 10, 3, 15, 0), // Tue 2026-11-03 15:00Z = 10:00 New York
  spentTodayUsd: 0,
  ...o,
})

/** A fuller document than the sample: every rule kind the engine reads. */
const RICH: TenantPolicyDoc = {
  version: 1,
  default: 'deny',
  venues: [
    { venue: 'uniswap-v3', chains: [8453], ops: ['swap'], tokens: ['USDC', 'ETH', 'cbBTC'], sides: ['buy', 'sell'], maxOrderUsd: 500, maxPriceImpactBps: 50 },
    { venue: 'hyperliquid', ops: ['perp-open', 'perp-close'], tokens: ['HYPE', 'ETH'], sides: ['long'], maxLeverage: 3, maxOrderUsd: 1000 },
    { venue: 'lido' },
  ],
  desks: [
    { id: 'macro', perOrderUsd: 400, perDayUsd: 1000, approvals: { overUsd: 250, approvers: 2 }, hours: { tz: 'America/New_York', from: '09:30', to: '16:00', days: [1, 2, 3, 4, 5] } },
    { id: 'night', hours: { tz: 'UTC', from: '22:00', to: '06:00', days: [1] } },
  ],
}

export async function tenantPurePins(check: Check): Promise<void> {
  const ev = (o: Partial<TenantOrder>, doc: TenantPolicyDoc | null = RICH, ctx: Parameters<typeof evaluateTenantPolicy>[1] = ACTIVE) => evaluateTenantPolicy(doc, ctx, order(o))
  const reason = (v: ReturnType<typeof evaluateTenantPolicy>) => (v.allowed ? (v.needsApproval ? `allowed+approval(${v.approvers})` : 'allowed') : v.reason)

  // ── every refusal, reached ─────────────────────────────────────────────
  check('tenant policy: an order the rules admit is allowed', reason(ev({})) === 'allowed', reason(ev({})))
  check('tenant policy: KEY_PAUSED names the KEY when the key is the pause', reason(ev({}, RICH, { status: 'paused', sandbox: false, pausedBy: 'key' })) === 'KEY_PAUSED')
  check('tenant policy: TENANT_PAUSED when the tenant is paused (and for any paused context without attribution)', reason(ev({}, RICH, { status: 'paused', sandbox: false, pausedBy: 'tenant' })) === 'TENANT_PAUSED' && reason(ev({}, RICH, { status: 'paused', sandbox: false })) === 'TENANT_PAUSED')
  check('tenant policy: NO_POLICY when the tenant has no active document', reason(ev({}, null)) === 'NO_POLICY')
  check('tenant policy: DESK_UNKNOWN for a desk id the policy does not name', reason(ev({ deskId: 'rates' })) === 'DESK_UNKNOWN')
  check('tenant policy: VENUE_DENIED for a venue no rule names (default-deny)', reason(ev({ venue: 'cow' })) === 'VENUE_DENIED')
  check('tenant policy: CHAIN_DENIED for a chain the rule excludes', reason(ev({ chainId: 42161 })) === 'CHAIN_DENIED')
  check('tenant policy: CHAIN_DENIED for a chain the VENUE does not run on even when the rule omits chains (lido on Base)', reason(ev({ venue: 'lido', op: 'stake', chainId: 8453, tokens: ['ETH'] })) === 'CHAIN_DENIED' && reason(ev({ venue: 'lido', op: 'stake', chainId: 1, tokens: ['ETH'], side: null })) === 'allowed')
  check('tenant policy: CHAIN_DENIED for an on-chain venue with no chain at all (the desk refuses what it cannot judge)', reason(ev({ chainId: null })) === 'CHAIN_DENIED')
  check('tenant policy: CHAIN_DENIED for an off-chain venue claiming an EVM chain', reason(ev({ venue: 'hyperliquid', op: 'perp-open', chainId: 8453, tokens: ['HYPE'], side: 'long' })) === 'CHAIN_DENIED')
  check('tenant policy: OP_DENIED for an op the rule does not list', reason(ev({ op: 'limit' })) === 'OP_DENIED')
  check('tenant policy: TOKEN_DENIED when ANY touched token is off the list', reason(ev({ tokens: ['USDC', 'PEPE'] })) === 'TOKEN_DENIED')
  check('tenant policy: TOKEN_DENIED when the order names no tokens and the rule lists them', reason(ev({ tokens: [] })) === 'TOKEN_DENIED')
  check('tenant policy: tokens compare case-insensitively (cbBTC listed, CBBTC touched)', reason(ev({ tokens: ['USDC', 'CBBTC'] })) === 'allowed')
  check('tenant policy: SIDE_DENIED for a side the rule does not list (a short on a long-only perp rule)', reason(ev({ venue: 'hyperliquid', op: 'perp-open', chainId: null, tokens: ['HYPE'], side: 'short' })) === 'SIDE_DENIED')
  check('tenant policy: SIDE_DENIED for an order with no side under a rule that lists sides', reason(ev({ side: null })) === 'SIDE_DENIED')
  check('tenant policy: UNPRICED — usd null is REFUSED, never warned through', reason(ev({ usd: null })) === 'UNPRICED' && reason(ev({ usd: Number.NaN })) === 'UNPRICED')
  check('tenant policy: a perp CLOSE is risk-reducing — unpriced passes, size caps never trap a desk in a position', reason(ev({ venue: 'hyperliquid', op: 'perp-close', chainId: null, tokens: ['HYPE'], side: 'long', usd: null })) === 'allowed' && reason(ev({ venue: 'hyperliquid', op: 'perp-close', chainId: null, tokens: ['HYPE'], side: 'long', usd: 9_999 })) === 'allowed')
  check('tenant policy: OVER_ORDER from the RULE\'s maxOrderUsd', reason(ev({ deskId: 'night', at: Date.UTC(2026, 10, 2, 23, 0), usd: 600 })) === 'OVER_ORDER')
  check('tenant policy: OVER_ORDER from the DESK\'s perOrderUsd (desk 400 < rule 500)', reason(ev({ usd: 450 })) === 'OVER_ORDER')
  check('tenant policy: OVER_DAY — the desk\'s perDayUsd against what it signed today', reason(ev({ usd: 200, spentTodayUsd: 900 })) === 'OVER_DAY' && reason(ev({ usd: 100, spentTodayUsd: 900 })) === 'allowed')
  check('tenant policy: OVER_LEVERAGE above the rule\'s maxLeverage (3x)', reason(ev({ venue: 'hyperliquid', op: 'perp-open', chainId: null, tokens: ['HYPE'], side: 'long', leverage: 5 })) === 'OVER_LEVERAGE' && reason(ev({ venue: 'hyperliquid', op: 'perp-open', chainId: null, tokens: ['HYPE'], side: 'long', leverage: 3 })) === 'allowed')
  check('tenant policy: OVER_IMPACT above the rule\'s maxPriceImpactBps; an unmeasured impact (plan stage) passes', reason(ev({ priceImpactBps: 80 })) === 'OVER_IMPACT' && reason(ev({ priceImpactBps: 20 })) === 'allowed' && reason(ev({ priceImpactBps: null })) === 'allowed')
  check('tenant policy: OUTSIDE_HOURS — Tue 20:00 New York is after the 09:30–16:00 window; Sat is no trading day', reason(ev({ at: Date.UTC(2026, 10, 4, 1, 0) })) === 'OUTSIDE_HOURS' && reason(ev({ at: Date.UTC(2026, 10, 7, 15, 0) })) === 'OUTSIDE_HOURS')
  check('tenant policy: an overnight window (22:00–06:00, Mondays) admits Mon 23:00 and the Tue 02:00 tail, refuses Tue 23:00', withinHours(RICH.desks[1].hours!, Date.UTC(2026, 10, 2, 23, 0)) && withinHours(RICH.desks[1].hours!, Date.UTC(2026, 10, 3, 2, 0)) && !withinHours(RICH.desks[1].hours!, Date.UTC(2026, 10, 3, 23, 0)))
  check('tenant policy: a zone the runtime cannot read fails CLOSED', !withinHours({ tz: 'Mars/Olympus', from: '00:00', to: '23:59', days: [0, 1, 2, 3, 4, 5, 6] }, Date.now()))
  check('tenant policy: SANDBOX_ONLY for a mainnet chain on a sandbox tenant; Base Sepolia (84532) passes', reason(evaluateTenantPolicy(SAMPLE_POLICY, { status: 'active', sandbox: true }, order({ venue: 'cow', tokens: ['USDC', 'ETH'] }))) === 'SANDBOX_ONLY' && TESTNET_CHAIN_IDS.has(84532) && reason(evaluateTenantPolicy({ ...SAMPLE_POLICY, venues: [{ venue: 'transfer', chains: [84532] }] }, { status: 'active', sandbox: true }, order({ venue: 'transfer', op: 'transfer', chainId: 84532, tokens: ['USDC'], side: null }))) === 'allowed')
  const hlo = order({ venue: 'hyperliquid', op: 'perp-open', chainId: null, tokens: ['HYPE'], side: 'long' })
  check('tenant policy: Hyperliquid passes the PURE engine on a sandbox (no chain id) — the gate decides it by network', reason(evaluateTenantPolicy(RICH, { status: 'active', sandbox: true }, hlo)) === 'allowed')
  check('tenant gate (F4): under the sandbox an HL order whose network is UNKNOWN (every plan-stage order) is the server\'s HL network — mainnet here — and refuses SANDBOX_ONLY; a stated mainnet leg refuses; a testnet leg passes', process.env.HL_GUARDIAN_TESTNET !== 'true' && serverHlNetwork() === 'mainnet' && reason(judge({ ...ctxOf(RICH), sandbox: true }, hlo)) === 'SANDBOX_ONLY' && reason(judge({ ...ctxOf(RICH), sandbox: true }, { ...hlo, network: 'mainnet' })) === 'SANDBOX_ONLY' && reason(judge({ ...ctxOf(RICH), sandbox: true }, { ...hlo, network: 'testnet' })) === 'allowed' && reason(judge(ctxOf(RICH), hlo)) === 'allowed')
  check('tenant gate (F4): a guardian arm (perp-close, no network) on a sandbox tenant → SANDBOX_ONLY too', reason(judge({ ...ctxOf(RICH), sandbox: true }, { ...hlo, op: 'perp-close', usd: null })) === 'SANDBOX_ONLY')
  check('tenant policy: shape before money — a Base-only desk asked for Arbitrum AND unpriced hears CHAIN_DENIED', reason(ev({ chainId: 42161, usd: null })) === 'CHAIN_DENIED')

  // ── approvals ──────────────────────────────────────────────────────────
  check('tenant approvals: over the desk\'s approvals.overUsd → allowed, needsApproval, approvers N', reason(ev({ usd: 300 })) === 'allowed+approval(2)')
  check('tenant approvals: AT the threshold needs none (over is strictly over)', reason(ev({ usd: 250 })) === 'allowed')
  const two = evaluateTenantPolicy({ ...RICH, venues: [{ venue: 'uniswap-v3', chains: [8453], maxOrderUsd: 500 }, ...RICH.venues.slice(1)] }, ACTIVE, order({ usd: 300 }))
  check('tenant approvals: the verdict carries the governing rule and desk', two.allowed && two.rule.venue === 'uniswap-v3' && two.desk.id === 'macro')

  // ── several rules for one venue: the first whose SHAPE admits governs ──
  const multi: TenantPolicyDoc = { ...SAMPLE_POLICY, venues: [{ venue: 'uniswap-v3', chains: [1], maxOrderUsd: 50 }, { venue: 'uniswap-v3', chains: [8453], maxOrderUsd: 500 }] }
  check('tenant policy: two uniswap-v3 rules — Base takes the Base rule ($500 cap), Ethereum the Ethereum rule ($50 cap)', reason(evaluateTenantPolicy(multi, ACTIVE, order({ usd: 100 }))) === 'allowed' && reason(evaluateTenantPolicy(multi, ACTIVE, order({ usd: 100, chainId: 1 }))) === 'OVER_ORDER')

  // ── the README demo, pure ──────────────────────────────────────────────
  const demo = (o: Partial<TenantOrder>, sandbox = false) => reason(judge({ ...ctxOf(SAMPLE_POLICY), sandbox }, { ...order(o), candidates: o.venue ? [o.venue] : swapCandidates(o.chainId ?? 8453) }))
  check('tenant demo (pure): "Buy $25 of ETH on Base" → allowed (the cascade lands on uniswap-v3)', demo({ venue: undefined, chainId: 8453 }) === 'allowed')
  check('tenant demo (pure): "Buy $25 of ETH on Arbitrum" → CHAIN_DENIED', demo({ venue: undefined, chainId: 42161 }) === 'CHAIN_DENIED')
  check('tenant demo (pure): "Long $25 of HYPE" → VENUE_DENIED', demo({ venue: 'hyperliquid', op: 'perp-open', chainId: null, tokens: ['HYPE'], side: 'long' }) === 'VENUE_DENIED')
  check('tenant demo (pure): "Buy $400 of ETH on Base" → allowed, awaiting 1 approval', demo({ venue: undefined, usd: 400 }) === 'allowed+approval(1)')
  check('tenant demo (pure): on a SANDBOX tenant the same Base buy → SANDBOX_ONLY', demo({ venue: undefined }, true) === 'SANDBOX_ONLY')
  const cowOnly: TenantPolicyDoc = { ...SAMPLE_POLICY, venues: [SAMPLE_POLICY.venues[0]] }
  const cowJudge = judge(ctxOf(cowOnly), { ...order({}), candidates: swapCandidates(8453) })
  check('tenant gate: a swap the job cascade would build on v3/v4 under a CoW-only policy → VENUE_DENIED naming the candidates', !cowJudge.allowed && cowJudge.reason === 'VENUE_DENIED' && /uniswap-v3 \/ uniswap-v4/.test(cowJudge.detail) && /admitted: cow/.test(cowJudge.detail), cowJudge.allowed ? '' : cowJudge.detail)
  const unread = judge(ctxOf(RICH), order({ usd: 50 }), { spendUnreadable: true })
  check('tenant gate: an UNREADABLE day spend (the blotter threw) refuses OVER_DAY by name on a desk with a day cap — never a guessed $0', !unread.allowed && unread.reason === 'OVER_DAY' && /unreadable/.test(unread.detail), unread.allowed ? '' : unread.detail)
  check('tenant gate: an unreadable spend does not matter to a desk with no day cap, nor to a risk-reducing close, nor outrank an earlier refusal', judge(ctxOf(RICH), order({ deskId: 'night', at: Date.UTC(2026, 10, 2, 23, 0) }), { spendUnreadable: true }).allowed && judge(ctxOf(RICH), order({ venue: 'hyperliquid', op: 'perp-close', chainId: null, tokens: ['HYPE'], side: 'long', usd: null }), { spendUnreadable: true }).allowed && reason(judge(ctxOf(RICH), order({ chainId: 42161 }), { spendUnreadable: true })) === 'CHAIN_DENIED')
  check('tenant gate: a revoked key never moves a leg (KEY_PAUSED, says revoked)', (() => { const v = judge({ ...ctxOf(SAMPLE_POLICY), keyRevoked: true }, order({})); return !v.allowed && v.reason === 'KEY_PAUSED' && /revoked/.test(v.detail) })())

  // ── the validator names the field ──────────────────────────────────────
  const val = (doc: unknown) => validatePolicyDoc(doc)
  const fieldOf = (doc: unknown) => { const v = val(doc); return v.ok ? 'ok' : v.field }
  check('tenant validator: the sample policy and the rich one validate', val(SAMPLE_POLICY).ok && val(RICH).ok)
  check('tenant validator: tokens normalize (symbols UPPER, 0x lower)', (() => { const v = val({ ...SAMPLE_POLICY, venues: [{ venue: 'uniswap-v3', tokens: ['eth', '0xABCDEF0123456789ABCDEF0123456789ABCDEF01'] }] }); return v.ok && v.doc.venues[0].tokens!.join(',') === 'ETH,0xabcdef0123456789abcdef0123456789abcdef01' })())
  check('tenant validator: an unknown venue → venues[0].venue', fieldOf({ ...SAMPLE_POLICY, venues: [{ venue: 'binance' }] }) === 'venues[0].venue')
  check('tenant validator: an unknown op → venues[0].ops[1]', fieldOf({ ...SAMPLE_POLICY, venues: [{ venue: 'cow', ops: ['swap', 'margin'] }] }) === 'venues[0].ops[1]')
  check('tenant validator: a chain the venue does not run on (CoW on Optimism) → venues[0].chains[0]', fieldOf({ ...SAMPLE_POLICY, venues: [{ venue: 'cow', chains: [10] }] }) === 'venues[0].chains[0]')
  check('tenant validator: chains on an off-chain venue (Hyperliquid) → venues[0].chains', fieldOf({ ...SAMPLE_POLICY, venues: [{ venue: 'hyperliquid', chains: [1] }] }) === 'venues[0].chains')
  check('tenant validator: an unknown side → venues[0].sides[0]', fieldOf({ ...SAMPLE_POLICY, venues: [{ venue: 'cow', sides: ['up'] }] }) === 'venues[0].sides[0]')
  check('tenant validator: an unknown rule key → venues[0].maxSlippage', fieldOf({ ...SAMPLE_POLICY, venues: [{ venue: 'cow', maxSlippage: 5 }] }) === 'venues[0].maxSlippage')
  check('tenant validator: a bad desk id shape → desks[0].id', fieldOf({ ...SAMPLE_POLICY, desks: [{ id: 'Macro Desk' }] }) === 'desks[0].id')
  check('tenant validator: a duplicate desk id → desks[1].id', fieldOf({ ...SAMPLE_POLICY, desks: [{ id: 'macro' }, { id: 'macro' }] }) === 'desks[1].id')
  check('tenant validator: no desks → desks', fieldOf({ ...SAMPLE_POLICY, desks: [] }) === 'desks')
  check('tenant validator: a zone the runtime cannot read → desks[0].hours.tz', fieldOf({ ...SAMPLE_POLICY, desks: [{ id: 'macro', hours: { tz: 'Mars/Olympus', from: '09:00', to: '17:00', days: [1] } }] }) === 'desks[0].hours.tz')
  check('tenant validator: a bad clock → desks[0].hours.to; a bad weekday → desks[0].hours.days[0]', fieldOf({ ...SAMPLE_POLICY, desks: [{ id: 'macro', hours: { tz: 'UTC', from: '09:00', to: '25:00', days: [1] } }] }) === 'desks[0].hours.to' && fieldOf({ ...SAMPLE_POLICY, desks: [{ id: 'macro', hours: { tz: 'UTC', from: '09:00', to: '17:00', days: [7] } }] }) === 'desks[0].hours.days[0]')
  check('tenant validator: approvals shape → desks[0].approvals.approvers', fieldOf({ ...SAMPLE_POLICY, desks: [{ id: 'macro', approvals: { overUsd: 250, approvers: 0 } }] }) === 'desks[0].approvals.approvers')
  check('tenant validator: default must be deny, version must be 1, an unknown top-level key is refused', fieldOf({ ...SAMPLE_POLICY, default: 'allow' }) === 'default' && fieldOf({ ...SAMPLE_POLICY, version: 2 }) === 'version' && fieldOf({ ...SAMPLE_POLICY, allowAll: true }) === 'allowAll')
  check('tenant validator: a negative cap → venues[0].maxOrderUsd; hooks must be https → hooks.preTrade', fieldOf({ ...SAMPLE_POLICY, venues: [{ venue: 'cow', maxOrderUsd: -5 }] }) === 'venues[0].maxOrderUsd' && fieldOf({ ...SAMPLE_POLICY, hooks: { preTrade: 'http://x' } }) === 'hooks.preTrade')
  check('tenant validator: the error names the field in its own words', (() => { const v = val({ ...SAMPLE_POLICY, venues: [{ venue: 'binance' }] }); return !v.ok && /^venues\[0\]\.venue: unknown venue "binance"/.test(v.error) })())

  // ── the desk's plan → the gate's order ─────────────────────────────────
  const base = ordersOfPlan({ ask: 'Buy $25 of ETH on Base' }, 'macro')
  const b0 = base?.[0]
  check('tenant order: "Buy $25 of ETH on Base" → a uniswap-v3-led swap on 8453, $25, buy, USDC → ETH, the cascade as candidates', !!b0 && b0.venue === 'uniswap-v3' && b0.chainId === 8453 && b0.usd === 25 && b0.side === 'buy' && b0.tokens.join(',') === 'USDC,ETH' && b0.op === 'swap' && (b0.candidates ?? []).includes('uniswap-v4'), JSON.stringify(b0))
  const arb = orderOfPlan({ ask: 'Buy $25 of ETH on Arbitrum' }, 'macro')
  check('tenant order: "Buy $25 of ETH on Arbitrum" → chain 42161', arb?.chainId === 42161, JSON.stringify(arb))
  const hype = orderOfPlan({ ask: 'Long $25 of HYPE on Hyperliquid' }, 'macro')
  check('tenant order: "Long $25 of HYPE on Hyperliquid" → hyperliquid perp-open, long, $25, no chain', hype?.venue === 'hyperliquid' && hype.op === 'perp-open' && hype.side === 'long' && hype.usd === 25 && hype.chainId === null, JSON.stringify(hype))
  check('tenant order: an ask with no chain the jobs registry claims compiles to NOTHING (the gate refuses what it cannot judge)', ordersOfPlan({ ask: 'Buy $25 of ETH' }, 'macro') === null)
  check('tenant order: a policy-pool plan lands every swap on the policy-pool venue', ordersOfPlan({ ask: 'Buy $5 of ETH on Base', venue: 'policy-pool' }, 'macro')?.[0]?.venue === 'policy-pool')
  check('tenant order: build paths map to venues (v3, v4, lifi, cow, near, hl, aave, morpho, lido, opensea, transfer); planner/manual map to none', [['native-swap-uniswap', 'uniswap-v3'], ['native-swap-uniswap-v4', 'uniswap-v4'], ['native-swap-lifi', 'lifi'], ['native-swap-cow', 'cow'], ['native-cross-chain-leg', 'near-intents'], ['native-hl-exec', 'hyperliquid'], ['native-hl-deposit', 'hyperliquid'], ['native-aave-op', 'aave-v4'], ['native-morpho-lend', 'morpho'], ['native-lido', 'lido'], ['native-nft-buy', 'opensea'], ['native-transfer', 'transfer'], ['native-swap-policy-pool', 'policy-pool']].every(([p, v]) => venueOfBuildPath(p) === v) && venueOfBuildPath('planner') === null && venueOfBuildPath('manual') === null)
  const v4Leg = orderOfLeg({ builder: 'native-swap', kind: 'sign', params: { amountHuman: '25', sellToken: 'USDC', buyToken: 'ETH', chainId: 8453 }, artifact: { buildPath: 'native-swap-uniswap-v4', txChain: { steps: [{ tx: { chainId: 8453 } }] } }, valueUsd: 24.9 }, 'macro')
  check('tenant order (leg): a built swap is judged on the venue that BUILT it (v4 stamped), the artifact\'s chain, the guard\'s dollars', v4Leg?.venue === 'uniswap-v4' && v4Leg.candidates?.join(',') === 'uniswap-v4' && v4Leg.chainId === 8453 && v4Leg.usd === 24.9, JSON.stringify(v4Leg))
  const hlLeg = orderOfLeg({ builder: 'native-hl-exec', kind: 'sign', params: { kind: 'open', coin: 'HYPE', isBuy: true, notionalUsd: 25, leverage: 2 }, artifact: { orderRequest: { protocol: 'hyperliquid', hl: { isTestnet: false, nonce: 1 } } }, valueUsd: 25.1 }, 'macro')
  check('tenant order (leg): an HL order leg carries its network (mainnet), leverage and side', hlLeg?.network === 'mainnet' && hlLeg.leverage === 2 && hlLeg.side === 'long' && hlLeg.chainId === null && hlLeg.usd === 25.1, JSON.stringify(hlLeg))
  const depLeg = orderOfLeg({ builder: 'native-hl-exec', kind: 'sign', params: { kind: 'deposit', amountUsdc: 20 }, artifact: { txRequest: { chainId: 42161 }, buildPath: 'native-hl-deposit' }, valueUsd: 20 }, 'macro')
  check('tenant order (leg): the HL Bridge2 deposit is a hyperliquid transfer, off-chain, network from its Arbitrum tx', depLeg?.venue === 'hyperliquid' && depLeg.op === 'transfer' && depLeg.chainId === null && depLeg.network === 'mainnet', JSON.stringify(depLeg))
  check('tenant order: a wait step is never judged', orderOfLeg({ builder: 'wait', kind: 'wait', params: {} }, 'macro') === null)

  // ── desk keys ──────────────────────────────────────────────────────────
  const k = generateDeskKey()
  check('tenant keys: a minted key is dk_ + base64url, matches DESK_KEY_RE, prefix = its first 11 chars, only sha256 stored', DESK_KEY_RE.test(k.secret) && k.prefix === k.secret.slice(0, 11) && k.prefix.startsWith('dk_') && k.hash === createHash('sha256').update(k.secret).digest('hex') && hashDeskKey(k.secret) === k.hash && k.hash !== k.secret)
  check('tenant keys: two mints never collide', generateDeskKey().secret !== generateDeskKey().secret)
  check('tenant keys: the header reader — none / a yf_ key (retail) / a dk_ key (tenant) / garbage (retail-other)', deskKeyPresented(null).kind === 'none' && deskKeyPresented({ authorization: 'Bearer yf_' + 'a'.repeat(64) }).kind === 'other' && deskKeyPresented({ authorization: `Bearer ${k.secret}` }).kind === 'desk' && deskKeyPresented(new Headers({ Authorization: `Bearer ${k.secret}` })).kind === 'desk' && deskKeyPresented({ authorization: 'Basic abc' }).kind === 'other')

  // ── B1: signers are PROVEN, and both lists bind ────────────────────────
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = (() => { try { return readFileSync('.env.local', 'utf8').match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '') } catch { return undefined } })() ?? 'tenant-pins-pure-secret'
  const A = '0x' + 'a'.repeat(40)
  const Bw = '0x' + 'b'.repeat(40)
  const sig = { signers: [A], policy: RICH }
  check('tenant signers (B1): the consent-free shortcut needs the wallet in tenant.signers — and, when the ACTIVE policy names signing wallets, in that list too', consentFreeSigner(sig, A) && !consentFreeSigner(sig, Bw) && !consentFreeSigner({ signers: [A], policy: { ...RICH, signing: { lane: 'safe', wallets: [Bw] } } }, A) && consentFreeSigner({ signers: [A], policy: { ...RICH, signing: { lane: 'safe', wallets: [A.toUpperCase().replace('0X', '0x')] } } }, A) && policySigningWallets({ policy: RICH }) === null)
  const ch = mintSignerChallenge({ id: 'tid', slug: 'acme' }, A, 1_800_000_000_000)
  const life = Date.parse(ch.expiresAt) - 1_800_000_000_000
  check('tenant signers (B1): the challenge is ASCII, names the tenant slug, the address and a nonce, and lives at most 15 minutes (10–15, per 5-minute bucket)', ch.message === signerChallengeText('acme', A, ch.nonce) && /^[\x20-\x7e]+$/.test(ch.message) && ch.message.startsWith('Pantessa tenant acme: register 0x') && life > 10 * 60_000 && life <= 15 * 60_000, String(life))
  check('tenant signers (B1): a POST with no nonce (the console\'s shape) is matched against the challenges still live — the minted one among them, none once expired', liveSignerNonces({ id: 'tid' }, A, 1_800_000_000_000 + 60_000).includes(ch.nonce) && !liveSignerNonces({ id: 'tid' }, A, Date.parse(ch.expiresAt) + 1).includes(ch.nonce) && liveSignerNonces({ id: 'tid' }, A, 1_800_000_000_000).length <= 3)
  check('tenant signers (B1): a nonce verifies only for its tenant + address + window', signerNonceOk({ id: 'tid' }, A, ch.nonce, 1_800_000_000_000).ok && !signerNonceOk({ id: 'other' }, A, ch.nonce, 1_800_000_000_000).ok && !signerNonceOk({ id: 'tid' }, Bw, ch.nonce, 1_800_000_000_000).ok && !signerNonceOk({ id: 'tid' }, A, ch.nonce, 1_800_000_000_000 + 16 * 60_000).ok && !signerNonceOk({ id: 'tid' }, A, 'nope', 1_800_000_000_000).ok)

  // ── registration FAILS CLOSED: no burn row, no signer (QA round 3, point 2) ─
  await signerFailClosedPins(check)

  // ── source pins: the four doors ────────────────────────────────────────
  const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const route = code('app/api/broker/[transport]/route.ts')
  const tools = [...route.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1])
  const gated = [...route.matchAll(/tenantOf\(extra, '([a-z_]+)'\)/g)].map((m) => m[1])
  check('tenant desk (source): EVERY registered desk tool resolves the caller through tenantOf (a dk_ key is never ignored by a tool)', tools.length >= 10 && tools.every((t) => gated.includes(t)), `tools=${tools.join(',')} gated=${gated.join(',')}`)
  check('tenant desk (source): every tool taking an intent_id checks the intent belongs to the caller (assertIntentCaller) before acting', (route.match(/assertIntentCaller\(intent_id, tenant\)/g) ?? []).length >= 7)
  check('tenant desk (source): broker_next and broker_done gate the SERVED leg (gateServedLeg) for a tenant', (route.match(/gateServedLeg\(tenant, await desk(Next|Done)\(/g) ?? []).length === 2)
  const bt = code('lib/broker-tenant.ts')
  check('tenant desk (source): a door refusal (paused key/tenant, revoked key) is a blotter row too — the firm sees the attempt', /blot\(ctx, 'policy_verdict', \{ stage: 'door'/.test(bt) && /caller\.tenantId\) await blot\(/.test(bt))
  const exec = code('lib/broker-exec.ts')
  check('tenant desk (source): execute takes the signer consent ONLY for a PROVEN signer the policy also names, with no signature given; everyone else still proves the wallet; an auto step always needs the wallet\'s own consent', /const signerConsent = !!tenantRow && consentFreeSigner\(tenantRow, row\.wallet\)/.test(exec) && /if \(consent === 'personal_sign'\) await assertWalletProof\(/.test(exec) && /consent, wallet: row\.wallet/.test(exec) && /consent === 'tenant-signer' && compiled\.steps\.some\(\(st\) => st\.kind === 'auto'\)/.test(exec))
  const patchSrc = code('app/api/tenants/[id]/route.ts')
  check('tenant signers (source, B1): PATCH refuses to ADD a signer (only removal); POST …/signers runs registerSigner — personal_sign or EIP-1271 verified, the nonce BURNED before the signer is added', /const added = list\.filter\(\(w\) => !current\.has\(w\)\)[\s\S]{0,120}if \(added\.length\)/.test(patchSrc) && /registerSigner\(\{ tenant: gate\.tenant/.test(code('app/api/tenants/[id]/signers/route.ts')) && (() => { const sg = code('lib/tenant/signers.ts'); return /recoverMessageAddress\(\{ message, signature: input\.signature \}\)/.test(sg) && /client\.verifyMessage\(\{ address/.test(sg) && sg.indexOf('if (!proof)') < sg.indexOf('deps\n    .burn(') && sg.indexOf('if (!burned)') < sg.indexOf('deps.addSigner(') && /burn: recordBlotterOnce/.test(sg) && /status: 503/.test(sg) })())
  check('tenant desk (source): execute re-gates the COMPILED job before createJob, and createJob stamps the tenant + key in the SAME insert (no post-create update)', /regateIntent\(tenantRow, row, 'execute', compiled\)[\s\S]*await createJob\(row\.wallet, compiled, 'broker', \{ internal: call\?\.internal === true, \.\.\.\(tenantRow \? \{ tenantId: tenantRow\.tenantId, deskKeyId: tenantRow\.keyId \} : \{\}\) \}\)/.test(exec) && !/bindJobToTenant/.test(exec))
  const runner = code('lib/jobs-runner.ts')
  const create = runner.slice(runner.indexOf('export async function createJob('), runner.indexOf('export async function getJobWithSteps('))
  check('tenant runner (source): createJob takes { tenantId, deskKeyId } and writes them inside prisma.job.create', /tenantId\?: string \| null; deskKeyId\?: string \| null/.test(create) && /prisma\.job\.create\(\{[\s\S]*tenantId: opts\?\.tenantId \?\? null,\s*deskKeyId: opts\?\.deskKeyId \?\? null,/.test(create))
  const built = runner.indexOf('const built = await buildSignArtifact(fresh.wallet, step.builder')
  const offerGate = runner.indexOf('gateTenantOffer(fresh, step,')
  check('tenant runner (source, B1): the AUTO branch (the guardian arm) meets gateTenantOffer before anything runs server-side', /if \(fresh\.tenantId\) \{\s*const \{ gateTenantOffer \} = await import\('@\/lib\/tenant\/gate'\)\s*const refused = await gateTenantOffer\(fresh, step, \{ artifact: \{\}, valueUsd: null \}\)\s*if \(refused\) return\s*\}\s*if \(step\.builder === 'native-hl-guardian'\) \{\s*const armed = await armGuardianPolicy\(/.test(runner))
  check('tenant runner (source, F3): a tenant leg\'s stale re-arm and every gate refusal write an explicit JSON null (Prisma.DbNull), never undefined', /artifact: fresh\.tenantId \? Prisma\.DbNull : undefined/.test(runner) && /status: 'failed', artifact: Prisma\.DbNull/.test(code('lib/tenant/gate.ts')) && /artifact: Prisma\.DbNull/.test(bt))
  check('tenant REST (source, F3): GET /api/jobs/:id re-checks a tenant job (recheckTenantJob) before serving and strips every artifact on a refusal', (() => { const jr = code('app/api/jobs/[id]/route.ts'); return /if \(job\.tenantId\) \{[\s\S]{0,120}recheckTenantJob\(job\)/.test(jr) && /artifact: null/.test(jr) && jr.indexOf('recheckTenantJob(job)') < jr.lastIndexOf('return NextResponse.json({ job })') })())
  check('tenant withdraw (source, F3): a tenant pause, a key pause and a key revoke each withdraw the open offers', /if \(data\.status === 'paused'\) await withdrawTenantOffers\(/.test(patchSrc) && (() => { const kr = code('app/api/tenants/[id]/keys/[keyId]/route.ts'); return /if \(body\.paused\) await withdrawTenantOffers\(/.test(kr) && /withdrawTenantOffers\(\{ tenantId: id, keyId, deskId: key\.deskId \}, 'KEY_REVOKED'/.test(kr) })())
  check('tenant store (source, F5): the sandbox is derived at resolve time from the OWNER\'s effective plan, and the column refreshed', /sandbox: tenant\.sandbox \|\| !eff\.mainnet/.test(code('lib/tenant/store.ts')) && /if \(!mainnet && !tenant\.sandbox\) data\.sandbox = true/.test(code('lib/tenant/store.ts')))
  check('tenant gate (source, F6): the day cap counts signed + OPEN offers (openOffersUsd), the order\'s own intent/job excluded', /spentTodayUsd\(ctx\.tenantId, order\.deskId\),\s*openOffersUsd\(ctx\.tenantId, order\.deskId, \{ intentId: ids\.intentId \?\? null, jobId: ids\.jobId \?\? null \}\)/.test(code('lib/tenant/gate.ts')))
  check('tenant runner (source): the OFFER site re-gates a tenant leg right after it is built — before affordability and before it is ever stored as offered (the Jobs REST channel never serves an un-gated tenant leg)', built > 0 && offerGate > built && offerGate < runner.indexOf('const verdict = await checkAffordability(fresh.wallet, built.artifact') && offerGate < runner.indexOf("status: 'offered',", built) && /if \(fresh\.tenantId\) \{\s*const \{ gateTenantOffer \} = await import\('@\/lib\/tenant\/gate'\)[\s\S]{0,260}if \(refused\) return/.test(runner))
  const hl = code('app/api/hl/submit/route.ts')
  const hlGate = hl.indexOf('joinTenantLeg(from')
  check('tenant relay (source): /api/hl/submit joins + re-gates a tenant leg AFTER the signer is recovered and BEFORE the venue relay', hlGate > hl.indexOf('signer.toLowerCase() !== from.toLowerCase()') && hlGate < hl.indexOf('fetch(`${apiUrl}/exchange`') && /relayGate\(tenantLeg, 'hl-submit'/.test(hl) && /status: 403/.test(hl.slice(hlGate, hlGate + 600)))
  const cow = code('app/api/cow/submit/route.ts')
  const cowGate = cow.indexOf('joinTenantLeg(from')
  check('tenant relay (source): /api/cow/submit re-gates a tenant order BEFORE it reaches the book', cowGate > 0 && cowGate < cow.indexOf('fetch(`${apiBase}/api/v1/orders`') && /relayGate\(tenantLeg, 'cow-submit'/.test(cow))
  const rf = code('app/api/tx/refresh/route.ts')
  const rfGate = rf.indexOf('joinTenantLeg(from')
  check('tenant relay (source, B2): hl/submit and cow/submit NEVER join by wallet — no link-lane join, no link booking; only the server-built job step (joinTenantLeg) joins', [hl, cow].every((src) => !/joinTenantLink\b|bookLinkSigned|linkGate\(/.test(src) && /joinTenantLeg\(from/.test(src)) && !/export async function joinTenantLink\(/.test(code('lib/tenant/gate.ts')))
  check('tenant relay (source): tx/refresh joins a link leg by the recipe\'s own linkSlug before any rebuild', (() => { const j = rf.indexOf('joinTenantLinkBySlug(linkSlug'); return j > 0 && j < rf.indexOf('buildUniswapSwap(') })())
  check('tenant relay (source): /api/tx/refresh re-gates a tenant step BEFORE any rebuild, and refuses with the card\'s withhold shape', rfGate > 0 && rfGate < rf.indexOf('buildLifiBridgeLeg(') && rfGate < rf.indexOf('buildUniswapSwap(') && /blocked: true, blockKind: 'policy'/.test(rf.slice(rfGate, rfGate + 700)))
}

async function signerFailClosedPins(check: Check): Promise<void> {
  const acct = privateKeyToAccount(generatePrivateKey())
  const address = acct.address.toLowerCase()
  const tenant = { id: 'tid-fc', slug: 'acme', signers: ['0x' + 'c'.repeat(40)] }
  const ch = mintSignerChallenge(tenant, address)
  const signature = await acct.signMessage({ message: ch.message })
  const run = async (burn: SignerRegistrationDeps['burn'], isBurned: SignerRegistrationDeps['isBurned'] = async () => false) => {
    const added: string[][] = []
    let burns = 0
    const r = await registerSigner({ tenant, by: '0x' + 'd'.repeat(40), address, signature, chainId: null }, { isBurned, burn: async (once, e) => { burns++; return burn(once, e) }, addSigner: async (_t, signers) => { added.push(signers) } })
    return { r, added, burns }
  }
  const failed = await run(async () => null)
  check('tenant signers (fail closed): the burn write FAILS (recordBlotterOnce → null) → 503 in words, reason BLOTTER_UNAVAILABLE, and the signer is NOT added', !failed.r.ok && failed.r.status === 503 && failed.r.reason === 'BLOTTER_UNAVAILABLE' && /nothing was registered/.test(failed.r.error) && failed.added.length === 0 && failed.burns === 1, JSON.stringify(failed.r).slice(0, 200))
  const threw = await run(async () => { throw new Error('blotter down') })
  check('tenant signers (fail closed): the burn write THROWS → 503, the signer is NOT added', !threw.r.ok && threw.r.status === 503 && threw.added.length === 0)
  const dup = await run(async () => ({ written: false, seq: 7 }))
  check('tenant signers (fail closed): the burn finds the nonce already on the chain (written:false, under the lock) → 409, the signer is NOT added', !dup.r.ok && dup.r.status === 409 && dup.added.length === 0)
  const seen = await run(async () => ({ written: true, seq: 8 }), async () => true)
  check('tenant signers (fail closed): a nonce already burned (fast path) → 409 before any burn or add', !seen.r.ok && seen.r.status === 409 && seen.burns === 0 && seen.added.length === 0)
  let burnedOnce = ''
  const good = await run(async (once) => { burnedOnce = once; return { written: true, seq: 9, hash: 'h' } })
  check('tenant signers (fail closed): a burn that LANDS (keyed signer-nonce:<nonce>) → 200, the signer added after it', good.r.ok && good.r.status === 200 && good.r.proof === 'personal_sign' && good.added.length === 1 && good.added[0].includes(address) && burnedOnce === `signer-nonce:${ch.nonce}`, JSON.stringify(good.r).slice(0, 160))
  const imp = privateKeyToAccount(generatePrivateKey())
  const forged = await registerSigner({ tenant, by: '0x' + 'd'.repeat(40), address, signature: await imp.signMessage({ message: ch.message }), chainId: null }, { isBurned: async () => false, burn: async () => ({ written: true, seq: 1 }), addSigner: async () => { throw new Error('must not add') } })
  check('tenant signers (fail closed): a signature by anyone else → 403 before any burn', !forged.ok && forged.status === 403)
}

function ctxOf(policy: TenantPolicyDoc) {
  return { tenantId: 't', tenantSlug: 'acme', deskId: 'macro', keyId: 'k', plan: 'free', sandbox: false, status: 'active' as const, policy, policyVersion: 1, signingLane: 'wallet' as const, signers: [] }
}

/* ── the live drive ──────────────────────────────────────────────────── */

function getCookie(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

async function signIn(base: string, account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await fetch(`${base}/api/auth/nonce`, { headers: { 'x-yf-internal-run': '1' } })
  const nonceCookie = getCookie(nonceRes, 'yf_siwe_nonce')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(base).host, nonce, uri: base, version: '1' })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = getCookie(res, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${res.status})`)
  return session
}

/** One MCP client per credential (Streamable HTTP, SSE frames). */
function deskClient(base: string, bearer: string | null) {
  let id = 0
  let session: string | null = null
  const rpc = async (method: string, params?: unknown) => {
    const res = await fetch(`${base}/api/broker/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-yf-internal-run': '1',
        'x-yf-no-ask-log': '1',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    })
    session = res.headers.get('mcp-session-id') ?? session
    const raw = await res.text()
    const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).find((l) => l.includes(`"id":${id}`))
    return data ? JSON.parse(data).result : (() => { try { return JSON.parse(raw).result } catch { return undefined } })()
  }
  let ready: Promise<unknown> | null = null
  const init = () => (ready ??= rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tenant-pins', version: '0' } }).then(() => rpc('notifications/initialized')))
  return async (name: string, args: Record<string, unknown> = {}) => {
    await init()
    const result = await rpc('tools/call', { name, arguments: args })
    const text: string = result?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
    let payload: any = text
    try { payload = JSON.parse(text) } catch { /* prose */ }
    return { isError: !!result?.isError, payload }
  }
}

export interface LiveOpts {
  /** Use the PRIVATE_KEY burner as the owner (README's demo); default = a fresh wallet. */
  burner?: boolean
  log?: (line: string) => void
}

export async function tenantLivePins(base: string, check: Check, opts: LiveOpts = {}): Promise<void> {
  const log = opts.log ?? ((l: string) => console.log(l))
  const J = { 'content-type': 'application/json', 'x-yf-internal-run': '1' }
  let owner: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey())
  if (opts.burner) {
    const pk = readFileSync('.env.local', 'utf8').match(/^PRIVATE_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '')
    if (!pk) throw new Error('--burner needs PRIVATE_KEY in .env.local')
    owner = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  }
  const cookie = await signIn(base, owner)
  const H = { ...J, cookie }
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = H) => {
    const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    let json: any = null
    try { json = await res.json() } catch { /* empty */ }
    return { status: res.status, json }
  }
  log(`  · owner ${owner.address.toLowerCase()}${opts.burner ? ' (the burner)' : ' (fresh)'}`)

  // ── 1. the tenant, the policy (maker-checker), the key ────────────────
  const anon = await api('POST', '/api/tenants', { slug: 'nope-anon', name: 'x' }, J)
  check('tenant live: POST /api/tenants without a SIWE session → 401', anon.status === 401)
  let slug = `drive-${Math.random().toString(36).slice(2, 10)}`
  let created = await api('POST', '/api/tenants', { slug, name: 'Drive Desk (tenant pins)' })
  let tenantId: string | undefined = created.json?.tenant?.id
  if (created.status === 403 && opts.burner) {
    // The burner already runs its plan's tenants: reuse its drive tenant.
    const list = await api('GET', '/api/tenants')
    const reuse = (list.json?.tenants ?? []).find((t: { slug: string }) => t.slug.startsWith('drive-'))
    check('tenant live: a second tenant over the owner\'s plan cap → 403 naming the entitlement', created.json?.entitlement === 'tenants', JSON.stringify(created.json).slice(0, 160))
    tenantId = reuse?.id
    if (reuse?.slug) slug = reuse.slug
    log(`  · plan cap reached — reusing ${reuse?.slug ?? 'none'}`)
    if (tenantId) {
      const t = await api('GET', `/api/tenants/${tenantId}`)
      for (const k of t.json?.keys ?? []) if (!k.revoked) await api('DELETE', `/api/tenants/${tenantId}/keys/${k.id}`)
      await api('PATCH', `/api/tenants/${tenantId}`, { status: 'active' })
    }
  } else {
    check('tenant live: an owner creates a tenant → 201, sandbox by default (the free plan has no mainnet)', created.status === 201 && !!tenantId && created.json?.tenant?.sandbox === true && created.json?.tenant?.slug === slug, JSON.stringify(created.json).slice(0, 200))
    const again = await api('POST', '/api/tenants', { slug: `${slug}-2`, name: 'Second' })
    check('tenant live: a second tenant over the owner\'s plan cap → 403 naming the entitlement', again.status === 403 && again.json?.entitlement === 'tenants', JSON.stringify(again.json).slice(0, 160))
    const badSlug = await api('POST', '/api/tenants', { slug: 'Bad Slug!', name: 'x' })
    check('tenant live: a bad slug → 400 naming the field', badSlug.status === 400 && badSlug.json?.field === 'slug')
  }
  if (!tenantId) return void check('tenant live: a tenant to drive', false, JSON.stringify(created.json).slice(0, 200))
  const T = `/api/tenants/${tenantId}`

  const stranger = await signIn(base, privateKeyToAccount(generatePrivateKey()))
  const peek = await api('GET', T, undefined, { ...J, cookie: stranger })
  check('tenant live: a signed-in stranger reading the tenant → 404 (same answer as no tenant)', peek.status === 404)

  const noPolicyKey = await api('POST', `${T}/keys`, { deskId: 'macro' })
  const hadActive = noPolicyKey.status !== 409
  if (!opts.burner || !hadActive) check('tenant live: minting a key before any ACTIVE policy → 409 NO_POLICY', noPolicyKey.status === 409 && noPolicyKey.json?.reason === 'NO_POLICY', JSON.stringify(noPolicyKey.json).slice(0, 160))
  else if (noPolicyKey.json?.secret) await api('DELETE', `${T}/keys/${noPolicyKey.json.id}`)

  const bad = await api('POST', `${T}/policy`, { document: { ...SAMPLE_POLICY, venues: [{ venue: 'cow', chains: [10] }] } })
  check('tenant live: proposing a chain outside the venue\'s own chains → 400 naming venues[0].chains[0]', bad.status === 400 && bad.json?.field === 'venues[0].chains[0]', JSON.stringify(bad.json).slice(0, 160))
  const proposed = await api('POST', `${T}/policy`, { document: SAMPLE_POLICY, note: 'tenant pins: the README demo policy' })
  const version = proposed.json?.version
  check('tenant live: the sample policy (CoW + Uniswap v3 on Base, $500/order, desk macro, approvals over $250) is proposed as the next version', proposed.status === 201 && Number.isInteger(version) && proposed.json?.state === 'proposed', JSON.stringify(proposed.json).slice(0, 160))
  const approved = await api('POST', `${T}/policy/${version}/approve`)
  check('tenant live: the proposer activates it (the plan has no maker-checker entitlement) → active', approved.status === 200 && approved.json?.state === 'active', JSON.stringify(approved.json).slice(0, 160))
  const twice = await api('POST', `${T}/policy/${version}/approve`)
  check('tenant live: approving an already-active version → 409', twice.status === 409)
  const reject = await api('POST', `${T}/policy`, { document: SAMPLE_POLICY })
  const rejected = await api('POST', `${T}/policy/${reject.json?.version}/reject`, { note: 'pins' })
  check('tenant live: a proposal can be rejected; the active version stands', rejected.status === 200 && rejected.json?.state === 'rejected')

  const wrongDesk = await api('POST', `${T}/keys`, { deskId: 'rates' })
  check('tenant live: a key for a desk the ACTIVE policy does not name → 400 DESK_UNKNOWN', wrongDesk.status === 400 && wrongDesk.json?.reason === 'DESK_UNKNOWN')
  const minted = await api('POST', `${T}/keys`, { deskId: 'macro', label: 'tenant pins' })
  const secret: string = minted.json?.secret ?? ''
  const keyId: string = minted.json?.id ?? ''
  check('tenant live: a dk_ desk key is minted for desk macro — the secret shown once, prefix = first 11 chars', minted.status === 201 && DESK_KEY_RE.test(secret) && minted.json?.prefix === secret.slice(0, 11), JSON.stringify({ ...minted.json, secret: secret ? '<dk_…>' : null }).slice(0, 200))
  const overKeys = await api('POST', `${T}/keys`, { deskId: 'macro' })
  check('tenant live: a second live key over the plan\'s keysPerTenant → 403 naming the entitlement', overKeys.status === 403 && overKeys.json?.entitlement === 'keysPerTenant', JSON.stringify(overKeys.json).slice(0, 160))
  const listed = await api('GET', T)
  check('tenant live: GET the tenant never returns a key hash or a secret', listed.status === 200 && !JSON.stringify(listed.json).includes(secret) && !JSON.stringify(listed.json).includes(hashDeskKey(secret)) && listed.json?.policy?.version === version)

  const desk = deskClient(base, secret)
  const retail = deskClient(base, null)

  // ── 2. the sandbox, then mainnet (the stub entitlements never allow it) ─
  const sandboxed = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', agent: 'tenant-pins' })
  const sandboxNow = listed.json?.tenant?.sandbox === true
  if (sandboxNow) check('tenant live: on a SANDBOX tenant "Buy $25 of ETH on Base" → SANDBOX_ONLY by name, gate policy', sandboxed.isError && sandboxed.payload?.reason === 'SANDBOX_ONLY' && sandboxed.payload?.gate === 'policy', JSON.stringify(sandboxed.payload).slice(0, 200))
  const mainnet = await api('PATCH', T, { sandbox: false })
  check('tenant live: PATCH sandbox:false without the mainnet entitlement → 403 naming it', mainnet.status === 403 ? mainnet.json?.entitlement === 'mainnet' : mainnet.status === 200, JSON.stringify(mainnet.json).slice(0, 160))
  let prisma: (typeof import('../lib/db'))['default'] | null = null
  if (!process.env.DATABASE_URL) {
    log('  ⚪ tenant live: no DATABASE_URL in the environment — the plan fixture, the execute binding and the relay fixtures are skipped')
    return
  }
  prisma = (await import('../lib/db')).default
  if (!process.env.SESSION_SECRET) {
    const sec = readFileSync('.env.local', 'utf8').match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '')
    if (sec) process.env.SESSION_SECRET = sec
  }
  const { signJobToken } = await import('../lib/job-token')
  const host = (() => { try { return new URL(process.env.DATABASE_URL!).host } catch { return '?' } })()
  // QA F5: the sandbox is derived from the OWNER's effective plan at every
  // call, so the demo needs a mainnet plan, not a flipped column. FIXTURE: an
  // active 'agent' subscription row for the owner (TEST DB), restored after.
  const ownerLower = owner.address.toLowerCase()
  const priorSub = await prisma.subscription.findUnique({ where: { ownerAddress: ownerLower } })
  await prisma.subscription.upsert({ where: { ownerAddress: ownerLower }, create: { ownerAddress: ownerLower, plan: 'agent', status: 'active' }, update: { plan: 'agent', status: 'active' } })
  log(`  · FIXTURE: an active 'agent' subscription for ${ownerLower} on the TEST DB (${host}) — the Agent plan includes mainnet; restored at the end`)
  const offSandbox = await api('PATCH', T, { sandbox: false })
  check('tenant live: on the Agent plan PATCH sandbox:false → 200 (mainnet is in the plan)', offSandbox.status === 200 && offSandbox.json?.tenant?.sandbox === false, JSON.stringify(offSandbox.json).slice(0, 160))
  const restoreSub = async () => {
    if (priorSub) await prisma!.subscription.update({ where: { ownerAddress: ownerLower }, data: { plan: priorSub.plan, status: priorSub.status } }).catch(() => {})
    else await prisma!.subscription.delete({ where: { ownerAddress: ownerLower } }).catch(() => {})
  }
  const activate = async (document: unknown, note: string) => {
    const v = await api('POST', `${T}/policy`, { document, note })
    const on = await api('POST', `${T}/policy/${v.json?.version}/approve`)
    return on.status === 200 && on.json?.state === 'active'
  }
  const fixtureJob = async (wallet: string, chainId: number, recipe: Record<string, string>) =>
    prisma!.job.create({
      data: {
        wallet, title: 'tenant pins fixture', source: 'broker', originEnv: process.env.VERCEL_ENV ?? 'dev', isInternal: true, status: 'waiting_signature', tenantId, deskKeyId: keyId,
        steps: { create: [{ seq: 0, kind: 'sign', builder: 'native-swap', title: 'Buy $25 of ETH', status: 'offered', params: { amountHuman: '25', sellToken: 'USDC', buyToken: 'ETH', chainId }, valueUsd: 25, artifact: { buildPath: 'native-swap-uniswap', txChain: { summary: 'fixture', steps: [{ label: 'swap', tx: { chainId } }], refresh: { kind: 'uniswap-swap', stepIndex: 0, params: recipe } } } }] },
      },
      include: { steps: true },
    })
  const getJob = (id: string, wallet: string) => api('GET', `/api/jobs/${id}?t=${encodeURIComponent(signJobToken(id, wallet))}`, undefined, J)
  const artifactOf = async (jobId: string) => (await prisma!.jobStep.findFirst({ where: { jobId, seq: 0 }, select: { artifact: true } }))?.artifact ?? null

  // ── 3b. QA F6: an offered-but-unsettled leg RESERVES the day cap ───────
  const capDoc = { ...SAMPLE_POLICY, desks: [{ id: 'macro', perOrderUsd: 500, perDayUsd: 40, approvals: { overUsd: 250, approvers: 1 } }] }
  check('tenant live (F6): a $40/day desk policy is activated', await activate(capDoc, 'tenant pins: $40/day'))
  const wr = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
  const reserved = await fixtureJob(wr, 8453, { sellToken: 'USDC', buyToken: 'ETH', amountHuman: '25', chainId: '8453' })
  const { recordBlotter } = await import('../lib/tenant/blotter')
  await recordBlotter({ tenantId, kind: 'offered', jobId: reserved.id, deskId: 'macro', keyId, venue: 'uniswap-v3', chainId: 8453, valueUsd: 25, payload: { lane: 'agent', seq: 0, offerKey: 'tenant-pins-reserve', fixture: true } })
  const overDay = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', agent: 'tenant-pins' })
  check('tenant live (F6): with a $25 leg already OFFERED (live job, unsigned) a second $25 order → OVER_DAY on a $40/day desk', overDay.isError && overDay.payload?.reason === 'OVER_DAY', JSON.stringify(overDay.payload).slice(0, 220))
  await prisma.job.update({ where: { id: reserved.id }, data: { status: 'canceled' } })
  const released = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', agent: 'tenant-pins' })
  check('tenant live (F6): the offer\'s job canceled → the reservation is released and the same order is admitted', !released.isError && released.payload?.state === 'open', JSON.stringify(released.payload).slice(0, 200))
  check('tenant live: the sample policy is active again', await activate(SAMPLE_POLICY, 'tenant pins: the sample policy again'))

  // ── 3. the README demo, over the wire ─────────────────────────────────
  const ok25 = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', agent: 'tenant-pins', agent_key: 'self-chosen-key-ignored' })
  check('tenant live: "Buy $25 of ETH on Base" → allowed: state open, tenant verdict allowed on uniswap-v3', !ok25.isError && ok25.payload?.state === 'open' && ok25.payload?.tenant?.verdict === 'allowed' && (ok25.payload?.tenant?.venues ?? []).includes('uniswap-v3'), JSON.stringify(ok25.payload).slice(0, 240))
  const arb = await desk('broker_open', { ask: 'Buy $25 of ETH on Arbitrum', agent: 'tenant-pins' })
  check('tenant live: "Buy $25 of ETH on Arbitrum" → CHAIN_DENIED, intent refused, the desk\'s own words', arb.isError && arb.payload?.reason === 'CHAIN_DENIED' && arb.payload?.state === 'refused' && /Refused by the drive-|Refused by the /.test(arb.payload?.say ?? ''), JSON.stringify(arb.payload).slice(0, 240))
  const hype = await desk('broker_open', { ask: 'Long $25 of HYPE on Hyperliquid', agent: 'tenant-pins' })
  check('tenant live: "Long $25 of HYPE on Hyperliquid" → VENUE_DENIED', hype.isError && hype.payload?.reason === 'VENUE_DENIED', JSON.stringify(hype.payload).slice(0, 200))
  const over = await desk('broker_open', { ask: 'Buy $600 of ETH on Base', agent: 'tenant-pins' })
  check('tenant live: "Buy $600 of ETH on Base" → OVER_ORDER ($500 cap)', over.isError && over.payload?.reason === 'OVER_ORDER', JSON.stringify(over.payload).slice(0, 200))
  const big = await desk('broker_open', { ask: 'Buy $400 of ETH on Base', agent: 'tenant-pins' })
  const bigId: string = big.payload?.intentId
  check('tenant live: "Buy $400 of ETH on Base" → allowed, awaiting 1 approval (state awaiting_approval, approval needed 1 have 0)', !big.isError && big.payload?.state === 'awaiting_approval' && big.payload?.tenant?.approval?.needed === 1 && big.payload?.tenant?.approval?.have === 0, JSON.stringify(big.payload).slice(0, 260))
  const early = await desk('broker_handoff', { intent_id: bigId })
  check('tenant live: broker_handoff before the approval → APPROVAL_PENDING, 0 of 1', early.isError && early.payload?.reason === 'APPROVAL_PENDING' && early.payload?.approvals?.have === 0, JSON.stringify(early.payload).slice(0, 200))
  const st0 = await desk('broker_status', { intent_id: bigId })
  check('tenant live: broker_status reads awaiting_approval with the count', !st0.isError && st0.payload?.state === 'awaiting_approval' && st0.payload?.tenant?.approval?.needed === 1, JSON.stringify(st0.payload).slice(0, 200))
  const strangerApprove = await api('POST', `${T}/intents/${bigId}/approve`, undefined, { ...J, cookie: stranger })
  check('tenant live: a non-admin approving → 404', strangerApprove.status === 404)
  const approve = await api('POST', `${T}/intents/${bigId}/approve`)
  check('tenant live: the owner approves → satisfied, the intent back to open', approve.status === 200 && approve.json?.satisfied === true && approve.json?.state === 'open', JSON.stringify(approve.json).slice(0, 200))
  const dup = await api('POST', `${T}/intents/${bigId}/approve`)
  check('tenant live: the same admin approving twice → 409 (DISTINCT approvers)', dup.status === 409)
  const handoff = await desk('broker_handoff', { intent_id: bigId })
  check('tenant live: after the approval broker_handoff proceeds → a /i sign link', !handoff.isError && /\/i\/[A-Za-z0-9]+$/.test(handoff.payload?.url ?? ''), JSON.stringify(handoff.payload).slice(0, 200))
  const under = await api('POST', `${T}/intents/${ok25.payload?.intentId}/approve`)
  check('tenant live: approving an under-threshold intent → 409 (it needs none)', under.status === 409)

  // ── 4. identity: the key IS the agent; tenant and retail never cross ──
  const peekRetail = await retail('broker_status', { intent_id: ok25.payload?.intentId })
  check('tenant live: a RETAIL caller reading a tenant intent → TENANT_MISMATCH', peekRetail.isError && peekRetail.payload?.reason === 'TENANT_MISMATCH', JSON.stringify(peekRetail.payload).slice(0, 160))
  const retailOpen = await retail('broker_open', { ask: 'Buy $15 of AAPL', agent: 'tenant-pins-retail' })
  check('tenant live: a retail broker_open with no key behaves as before — an action quote, state open, no tenant field', !retailOpen.isError && retailOpen.payload?.state === 'open' && retailOpen.payload?.plan?.quote?.kind === 'action' && retailOpen.payload?.tenant === undefined, JSON.stringify(retailOpen.payload).slice(0, 200))
  const cross = await desk('broker_status', { intent_id: retailOpen.payload?.intentId })
  check('tenant live: a tenant key reading a RETAIL intent → NOT_ON_TENANT_DESK', cross.isError && cross.payload?.reason === 'NOT_ON_TENANT_DESK', JSON.stringify(cross.payload).slice(0, 160))
  const fake = deskClient(base, `dk_${'x'.repeat(40)}`)
  const fakeOpen = await fake('broker_open', { ask: 'Buy $25 of ETH on Base' })
  check('tenant live: an unknown dk_ key is REFUSED (KEY_UNKNOWN) — never demoted to the retail desk', fakeOpen.isError && fakeOpen.payload?.reason === 'KEY_UNKNOWN', JSON.stringify(fakeOpen.payload).slice(0, 160))
  const send = await desk('broker_send', { ask: 'Buy $5 of ETH on Base', recipient: owner.address, agent_key: 'x-sender-key' })
  check('tenant live: broker_send on a tenant desk → NOT_ON_TENANT_DESK', send.isError && send.payload?.reason === 'NOT_ON_TENANT_DESK', JSON.stringify(send.payload).slice(0, 160))
  const row = await prisma.brokerIntent.findUnique({ where: { id: ok25.payload?.intentId }, select: { agentKey: true, tenantId: true, deskKeyId: true, agentKeyHash: true } })
  check('tenant live: the intent is bound to the KEY (agent_key = tenant:<keyId>, the self-chosen one ignored), tenant + key ids stored, no public track record', row?.agentKey === `tenant:${keyId}` && row?.tenantId === tenantId && row?.deskKeyId === keyId && row?.agentKeyHash === null, JSON.stringify(row))

  // ── 5. the agent-signed lane: execute binds the job to the tenant ─────
  const agent = privateKeyToAccount(generatePrivateKey())
  const ex = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', wallet: agent.address, agent: 'tenant-pins' })
  if (!ex.isError && ex.payload?.intentId) {
    const { deskExecuteConsentMessage } = await import('../lib/broker-exec')
    const issuedAt = new Date().toISOString()
    const sig = await agent.signMessage({ message: deskExecuteConsentMessage(ex.payload.intentId, agent.address, issuedAt) })
    const run = await desk('broker_execute', { intent_id: ex.payload.intentId, wallet_signature: sig, issued_at: issuedAt, agent_key: 'ignored-for-tenants' })
    const job = run.payload?.jobId ? await prisma.job.findUnique({ where: { id: run.payload.jobId }, select: { tenantId: true, deskKeyId: true } }) : null
    check('tenant live: broker_execute (consent-signed) compiles the job and binds it to the tenant + desk key', !run.isError && run.payload?.state === 'executing' && job?.tenantId === tenantId && job?.deskKeyId === keyId, JSON.stringify(run.isError ? run.payload : { state: run.payload?.state, job }).slice(0, 240))
    const next = await desk('broker_next', { intent_id: ex.payload.intentId })
    check('tenant live: broker_next for the tenant needs no agent_key (the key IS the identity) and answers a leg or an honest wait', !next.isError && typeof next.payload?.next === 'object', JSON.stringify(next.payload).slice(0, 200))
    if (run.payload?.jobId) await prisma.job.update({ where: { id: run.payload.jobId }, data: { status: 'canceled' } }).catch(() => {})
  } else check('tenant live: an execute-ready open', false, JSON.stringify(ex.payload).slice(0, 200))

  // ── 5b. custody consent: a PROVEN signer needs no personal_sign (QA B1) ─
  // A Safe (any smart account) cannot personal_sign at execute; on a tenant
  // desk a custody address that PROVED control to be registered is the consent.
  const custodyAcct = privateKeyToAccount(generatePrivateKey())
  const custody = custodyAcct.address.toLowerCase()
  const unreg = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', wallet: custody, agent: 'tenant-pins' })
  const unregExec = await desk('broker_execute', { intent_id: unreg.payload?.intentId })
  check('tenant live: an UNREGISTERED wallet executing with no consent signature → refused by name (wallet_signature)', !unreg.isError && unregExec.isError && /wallet_signature/.test(String(unregExec.payload?.say ?? unregExec.payload)), JSON.stringify(unregExec.payload).slice(0, 200))
  const patchAdd = await api('PATCH', T, { signers: [custody] })
  check('tenant live (B1): PATCH can no longer ADD a signer — 400 naming the proof door', patchAdd.status === 400 && patchAdd.json?.reason === 'SIGNER_DENIED' && /signers\/challenge/.test(patchAdd.json?.error ?? ''), JSON.stringify(patchAdd.json).slice(0, 200))
  const strangerChal = await api('GET', `${T}/signers/challenge?address=${custody}`, undefined, { ...J, cookie: stranger })
  check('tenant live (B1): a non-admin cannot mint a signer challenge (404)', strangerChal.status === 404)
  const chal = await api('GET', `${T}/signers/challenge?address=${custody}`)
  const chalMsg: string = chal.json?.challenge ?? ''
  check('tenant live (B1): GET …/signers/challenge answers `challenge` (+ expiresAt): names this tenant + this address + a nonce, ASCII only, ≤15 minutes', chal.status === 200 && /^Pantessa tenant [a-z0-9-]+: register 0x[0-9a-f]{40} as a signer\. Nonce \d{13}-[0-9a-f]{24}\.$/.test(chalMsg) && chalMsg.includes(custody) && /^[\x20-\x7e]+$/.test(chalMsg) && Date.parse(chal.json?.expiresAt) - Date.now() <= 15 * 60_000 + 5_000, chalMsg)
  const imp = privateKeyToAccount(generatePrivateKey())
  const impPost = await api('POST', `${T}/signers`, { address: custody, signature: await imp.signMessage({ message: chalMsg }) })
  check('tenant live (B1): a signature by anyone but the address itself → 403 SIGNER_DENIED, nothing registered', impPost.status === 403 && impPost.json?.reason === 'SIGNER_DENIED', JSON.stringify(impPost.json).slice(0, 200))
  const otherChal = await api('GET', `${T}/signers/challenge?address=${imp.address.toLowerCase()}`)
  const crossPost = await api('POST', `${T}/signers`, { address: custody, nonce: otherChal.json?.nonce, signature: await custodyAcct.signMessage({ message: chalMsg }) })
  check('tenant live (B1): a nonce minted for ANOTHER address → 400', crossPost.status === 400 && crossPost.json?.field === 'nonce', JSON.stringify(crossPost.json).slice(0, 160))
  const goodSig = await custodyAcct.signMessage({ message: chalMsg })
  const proven = await api('POST', `${T}/signers`, { address: custody, signature: goodSig })
  check('tenant live (B1): POST …/signers { address, signature } — the address\'s own personal_sign over the challenge registers it (proof personal_sign)', proven.status === 200 && proven.json?.proof === 'personal_sign' && (proven.json?.tenant?.signers ?? []).includes(custody), JSON.stringify(proven.json).slice(0, 200))
  const replay = await api('POST', `${T}/signers`, { address: custody, signature: goodSig })
  check('tenant live (B1): the same challenge twice → 409 (single-use)', replay.status === 409, JSON.stringify(replay.json).slice(0, 160))
  const regRow = await prisma.blotterRow.findFirst({ where: { tenantId, kind: 'tenant_updated', payload: { path: ['nonce'], equals: chal.json?.nonce } }, select: { payload: true } })
  check('tenant live (B1): the registration is a tenant_updated row carrying proof: personal_sign', (regRow?.payload as { proof?: string } | undefined)?.proof === 'personal_sign', JSON.stringify(regRow?.payload ?? null).slice(0, 160))
  const regOpen = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', wallet: custody, agent: 'tenant-pins' })
  const regExec = await desk('broker_execute', { intent_id: regOpen.payload?.intentId })
  const regJob = regExec.payload?.jobId ? await prisma.job.findUnique({ where: { id: regExec.payload.jobId }, select: { wallet: true, tenantId: true, deskKeyId: true } }) : null
  check('tenant live: a PROVEN signer\'s intent executes with NO consent signature — the job is the custody wallet\'s, bound to the tenant', !regExec.isError && regExec.payload?.state === 'executing' && regJob?.wallet === custody && regJob?.tenantId === tenantId && regJob?.deskKeyId === keyId, JSON.stringify(regExec.isError ? regExec.payload : regJob).slice(0, 220))
  if (regExec.payload?.jobId) await prisma.job.update({ where: { id: regExec.payload.jobId }, data: { status: 'canceled' } }).catch(() => {})
  const badOpen = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', wallet: custody, agent: 'tenant-pins' })
  const stranger2 = privateKeyToAccount(generatePrivateKey())
  const badIssued = new Date().toISOString()
  const { deskExecuteConsentMessage: consentText } = await import('../lib/broker-exec')
  const badSig = await stranger2.signMessage({ message: consentText(badOpen.payload?.intentId ?? '', custody, badIssued) })
  const badExec = await desk('broker_execute', { intent_id: badOpen.payload?.intentId, wallet_signature: badSig, issued_at: badIssued })
  check('tenant live: a consent signature that IS given is still verified — a registered signer with a stranger\'s signature is refused', badExec.isError && /recovers to/.test(String(badExec.payload?.say ?? badExec.payload)), JSON.stringify(badExec.payload).slice(0, 200))
  const outside = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', wallet: agent.address, agent: 'tenant-pins' })
  check('tenant live: with signers registered, an intent for a wallet OUTSIDE them → SIGNER_DENIED', outside.isError && outside.payload?.reason === 'SIGNER_DENIED', JSON.stringify(outside.payload).slice(0, 160))
  // B1: the tenant-signer consent never carries an AUTO step (the guardian arm).
  check('tenant live (B1): a policy admitting Hyperliquid is activated', await activate({ ...SAMPLE_POLICY, venues: [...SAMPLE_POLICY.venues, { venue: 'hyperliquid' }] }, 'tenant pins: + hyperliquid'))
  const armOpen = await desk('broker_open', { ask: 'protect my HYPE long with a 5% stop', wallet: custody, agent: 'tenant-pins' })
  const armExec = await desk('broker_execute', { intent_id: armOpen.payload?.intentId })
  check("tenant live (B1): a job with an AUTO step (a guardian arm) is refused under the tenant-signer consent — SIGNER_DENIED, \"auto steps need the wallet's own consent\"", !armOpen.isError && armExec.isError && armExec.payload?.reason === 'SIGNER_DENIED' && /auto steps need the wallet's own consent/.test(armExec.payload?.detail ?? ''), JSON.stringify(armOpen.isError ? armOpen.payload : armExec.payload).slice(0, 220))
  // B1: the policy's maker-checked signing.wallets binds as well.
  check('tenant live (B1): a policy naming a DIFFERENT signing wallet is activated', await activate({ ...SAMPLE_POLICY, signing: { lane: 'wallet', wallets: [stranger2.address.toLowerCase()] } }, 'tenant pins: signing.wallets'))
  const notNamed = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', wallet: custody, agent: 'tenant-pins' })
  check('tenant live (B1): a registered signer the ACTIVE policy\'s signing.wallets does not name → SIGNER_DENIED', notNamed.isError && notNamed.payload?.reason === 'SIGNER_DENIED' && /signing wallets the active policy/.test(notNamed.payload?.detail ?? ''), JSON.stringify(notNamed.payload).slice(0, 200))
  check('tenant live: the sample policy is active again', await activate(SAMPLE_POLICY, 'tenant pins: the sample policy again'))
  const removed = await api('PATCH', T, { signers: [] })
  check('tenant live (B1): PATCH may still REMOVE signers', removed.status === 200 && (removed.json?.tenant?.signers ?? []).length === 0, JSON.stringify(removed.json).slice(0, 160))

  // ── 5c. the runner's offer site: a policy activated AFTER execute governs
  //        every leg not yet offered (the Jobs REST channel included) ───────
  const late = privateKeyToAccount(generatePrivateKey())
  const lateOpen = await desk('broker_open', { ask: 'Buy $25 of ETH on Base', wallet: late.address, agent: 'tenant-pins' })
  const { deskExecuteConsentMessage: lateConsent } = await import('../lib/broker-exec')
  const lateIssued = new Date().toISOString()
  const lateRun = await desk('broker_execute', { intent_id: lateOpen.payload?.intentId, wallet_signature: await late.signMessage({ message: lateConsent(lateOpen.payload?.intentId ?? '', late.address, lateIssued) }), issued_at: lateIssued })
  const lateJobId: string | undefined = lateRun.payload?.jobId
  const lateJob0 = lateJobId ? await prisma.job.findUnique({ where: { id: lateJobId }, include: { steps: true } }) : null
  check('tenant runner (live): the job broker_execute creates carries tenant_id + desk_key_id from its first row; its first build passed the offer gate (allowed, then withheld only for funds)', !!lateJob0 && lateJob0.tenantId === tenantId && lateJob0.deskKeyId === keyId && lateJob0.status !== 'canceled' && lateJob0.steps[0]?.status !== 'failed', JSON.stringify(lateJob0 ? { status: lateJob0.status, tenantId: lateJob0.tenantId, steps: lateJob0.steps.map((x) => [x.status, (x.result as { error?: string } | null)?.error?.slice(0, 60)]) } : lateRun.payload).slice(0, 260))
  // F3: an OFFERED artifact (a fixture job: a built Base uniswap-v3 leg) is
  // served by the Jobs REST channel while the policy admits it…
  const wo = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
  const offeredJob = await fixtureJob(wo, 8453, { sellToken: 'USDC', buyToken: 'ETH', amountHuman: '25', chainId: '8453' })
  const served = await getJob(offeredJob.id, wo)
  check('tenant REST (F3): GET /api/jobs/:id?t= serves a tenant job\'s offered artifact while the active policy admits it', served.status === 200 && !!served.json?.job?.steps?.[0]?.artifact, `${served.status} ${JSON.stringify(served.json).slice(0, 160)}`)
  const denyDoc = { ...SAMPLE_POLICY, venues: [SAMPLE_POLICY.venues[0]] } // CoW only — the job's uniswap-v3 leg is now outside the policy
  const denyV = await api('POST', `${T}/policy`, { document: denyDoc, note: 'tenant pins: deny uniswap-v3 after execute' })
  const denyOn = await api('POST', `${T}/policy/${denyV.json?.version}/approve`)
  check('tenant runner (live): a CoW-only policy is activated AFTER the execute', denyOn.status === 200 && denyOn.json?.state === 'active', JSON.stringify(denyOn.json).slice(0, 160))
  if (lateJobId) {
    // FIXTURE: age the withheld step past the runner's 90s hold-down so the next advance rebuilds it now.
    await prisma.$executeRaw`UPDATE job_steps SET updated_at = now() - interval '5 minutes' WHERE job_id = ${lateJobId}`
    log(`  · FIXTURE: job ${lateJobId}'s withheld step aged past the 90s hold-down (TEST DB) so broker_next rebuilds it under the new policy`)
    const lateNext = await desk('broker_next', { intent_id: lateOpen.payload?.intentId })
    const lateJob = await prisma.job.findUnique({ where: { id: lateJobId }, include: { steps: true } })
    const lateIntent = await prisma.brokerIntent.findUnique({ where: { id: lateOpen.payload?.intentId }, select: { state: true } })
    const s0 = lateJob?.steps.find((x) => x.seq === 0)
    check('tenant runner (live): the next OFFER refuses under the new policy — the step fails VENUE_DENIED unoffered, the job is canceled, the intent refused, and broker_next serves no leg', lateJob?.status === 'canceled' && s0?.status === 'failed' && (s0?.result as { policyRefused?: string } | null)?.policyRefused === 'VENUE_DENIED' && s0?.artifact == null && lateIntent?.state === 'refused' && !lateNext.payload?.next?.leg, JSON.stringify({ job: lateJob?.status, step: s0?.status, result: s0?.result, intent: lateIntent?.state, next: lateNext.payload?.next ?? lateNext.payload }).slice(0, 320))
  }
  // …and once the policy denies it, the REST channel serves NOTHING: the leg is
  // re-judged before serving, refused, its artifact wiped to an explicit null.
  const withdrawn = await getJob(offeredJob.id, wo)
  const offeredRow = await prisma.job.findUnique({ where: { id: offeredJob.id }, select: { status: true } })
  check('tenant REST (F3): under the new policy GET /api/jobs/:id?t= serves no artifact — 403 with tenantRefusal VENUE_DENIED, the job canceled, the stored artifact an explicit NULL', withdrawn.status === 403 && withdrawn.json?.tenantRefusal?.reason === 'VENUE_DENIED' && (withdrawn.json?.job?.steps ?? []).every((x: { artifact?: unknown }) => x.artifact == null) && offeredRow?.status === 'canceled' && (await artifactOf(offeredJob.id)) === null, `${withdrawn.status} ${JSON.stringify(withdrawn.json?.tenantRefusal ?? withdrawn.json).slice(0, 200)}`)
  check('tenant live: the sample policy is active again', await activate(SAMPLE_POLICY, 'tenant pins: the sample policy again'))

  // ── 6. the relays: a tenant leg is re-gated from the server's own job row ─
  const w = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
  const recipe = { sellToken: 'USDC', buyToken: 'ETH', amountHuman: '25', chainId: '42161' }
  const fixture = await prisma.job.create({
    data: {
      wallet: w, title: 'tenant pins relay fixture', source: 'broker', originEnv: process.env.VERCEL_ENV ?? 'dev', isInternal: true, status: 'waiting_signature', tenantId, deskKeyId: keyId,
      steps: {
        create: [
          { seq: 0, kind: 'sign', builder: 'native-swap', title: 'Buy $25 of ETH on Arbitrum', status: 'offered', params: { amountHuman: '25', sellToken: 'USDC', buyToken: 'ETH', chainId: 42161 }, valueUsd: 25, artifact: { buildPath: 'native-swap-uniswap', txChain: { summary: 'fixture', steps: [{ label: 'swap', tx: { chainId: 42161 } }], refresh: { kind: 'uniswap-swap', stepIndex: 0, params: recipe } } } },
        ],
      },
    },
  })
  const refresh = await api('POST', '/api/tx/refresh', { kind: 'uniswap-swap', ...recipe, from: w }, J)
  check('tenant relay (live): /api/tx/refresh of a TENANT step on Arbitrum → 403 CHAIN_DENIED + the card\'s withhold shape, nothing rebuilt', refresh.status === 403 && refresh.json?.reason === 'CHAIN_DENIED' && refresh.json?.blocked === true && refresh.json?.blockKind === 'policy', JSON.stringify(refresh.json).slice(0, 220))
  const retailRefresh = await api('POST', '/api/tx/refresh', { kind: 'uniswap-swap', ...recipe, amountHuman: '26', from: w }, J)
  check('tenant relay (live): a refresh that matches NO tenant step stays retail (not a 403)', retailRefresh.status !== 403, `${retailRefresh.status} ${JSON.stringify(retailRefresh.json).slice(0, 120)}`)
  const { COW_CANONICAL_APP_DATA_HASHES } = await import('../lib/cow')
  const appData = [...COW_CANONICAL_APP_DATA_HASHES][0]
  const cowOrder = { sellToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', buyToken: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', receiver: w, sellAmount: '25000000', buyAmount: '1', validTo: Math.floor(Date.now() / 1000) + 600, appData, feeAmount: '0', kind: 'sell', partiallyFillable: false, sellTokenBalance: 'erc20', buyTokenBalance: 'erc20' }
  await prisma.jobStep.create({ data: { jobId: fixture.id, seq: 1, kind: 'sign', builder: 'native-swap', title: 'CoW fixture', status: 'offered', params: { amountHuman: '25', sellToken: 'USDC', buyToken: 'ETH', chainId: 42161 }, valueUsd: 25, artifact: { orderRequest: { protocol: 'cow', chainId: 42161, typedData: { message: cowOrder } } } } })
  const cowRes = await api('POST', '/api/cow/submit', { chainId: 42161, order: cowOrder, signature: `0x${'1'.repeat(130)}`, from: w }, J)
  check('tenant relay (live): /api/cow/submit of a TENANT order on Arbitrum → 403 CHAIN_DENIED before the book', cowRes.status === 403 && cowRes.json?.reason === 'CHAIN_DENIED', JSON.stringify(cowRes.json).slice(0, 220))

  // ── 6b. the LINK lane (QA B2) ──────────────────────────────────────────
  // tx/refresh rebuilds carry the server-built recipe's linkSlug → joined + re-gated.
  const lslug = `tp${Math.random().toString(36).slice(2, 10)}`
  const linkIntent = await prisma.brokerIntent.create({
    data: { id: `tp${Math.random().toString(36).slice(2, 10)}`, ask: 'Buy $25 of ETH on Arbitrum', wallet: null, agent: 'tenant-pins', agentKey: `tenant:${keyId}`, state: 'handed_off', plan: { ask: 'Buy $25 of ETH on Arbitrum' }, linkSlug: lslug, isInternal: true, tenantId, deskKeyId: keyId },
  })
  const linkRefresh = await api('POST', '/api/tx/refresh', { kind: 'uniswap-swap', sellToken: 'USDC', buyToken: 'ETH', amountHuman: '25', chainId: '42161', linkSlug: lslug, from: privateKeyToAccount(generatePrivateKey()).address }, J)
  check('tenant relay (live, link lane): a refresh recipe carrying a tenant link\'s slug is re-gated → 403 CHAIN_DENIED + the withhold shape', linkRefresh.status === 403 && linkRefresh.json?.reason === 'CHAIN_DENIED' && linkRefresh.json?.blocked === true, JSON.stringify(linkRefresh.json).slice(0, 220))
  await prisma.brokerIntent.update({ where: { id: linkIntent.id }, data: { state: 'closed' } }).catch(() => {})
  // CoW / HL submissions are NEVER joined by wallet: a SANDBOX tenant that names
  // a retail wallet in a handed-off intent can neither refuse nor book that
  // wallet's own orders.
  const owner2 = privateKeyToAccount(generatePrivateKey())
  const cookie2 = await signIn(base, owner2)
  const H2 = { ...J, cookie: cookie2 }
  const t2 = await api('POST', '/api/tenants', { slug: `drive-sbx-${Math.random().toString(36).slice(2, 8)}`, name: 'Sandbox Desk (tenant pins)' }, H2)
  const T2 = `/api/tenants/${t2.json?.tenant?.id}`
  const t2Doc = { ...SAMPLE_POLICY, venues: [...SAMPLE_POLICY.venues, { venue: 'hyperliquid' as const }] }
  const t2v = await api('POST', `${T2}/policy`, { document: t2Doc }, H2)
  await api('POST', `${T2}/policy/${t2v.json?.version}/approve`, undefined, H2)
  const t2key = await api('POST', `${T2}/keys`, { deskId: 'macro' }, H2)
  const desk2 = deskClient(base, t2key.json?.secret ?? null)
  const hlSandbox = await desk2('broker_open', { ask: 'Long $25 of HYPE on Hyperliquid', agent: 'tenant-pins' })
  check('tenant live (F4): a SANDBOX tenant whose policy admits Hyperliquid opens an HL order → SANDBOX_ONLY (the server\'s HL network is mainnet)', t2.json?.tenant?.sandbox === true && hlSandbox.isError && hlSandbox.payload?.reason === 'SANDBOX_ONLY', JSON.stringify(hlSandbox.payload).slice(0, 200))
  const R = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
  const named = await prisma.brokerIntent.create({
    data: { id: `tp${Math.random().toString(36).slice(2, 10)}`, ask: 'Buy $25 of ETH on Base', wallet: R, agent: 'tenant-pins', state: 'handed_off', plan: { ask: 'Buy $25 of ETH on Base' }, linkSlug: `tp${Math.random().toString(36).slice(2, 10)}`, isInternal: true, tenantId: t2.json?.tenant?.id, deskKeyId: t2key.json?.id ?? null },
  })
  const rowsBefore = await prisma.blotterRow.count({ where: { tenantId: t2.json?.tenant?.id } })
  const retailCow = { ...cowOrder, sellToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', buyToken: '0x4200000000000000000000000000000000000006', receiver: R, validTo: Math.floor(Date.now() / 1000) + 600 }
  const retailCowRes = await api('POST', '/api/cow/submit', { chainId: 8453, order: retailCow, signature: `0x${'2'.repeat(130)}`, from: R }, J)
  const rowsAfter = await prisma.blotterRow.count({ where: { tenantId: t2.json?.tenant?.id } })
  check('tenant relay (live, B2): the retail wallet a sandbox tenant NAMED submits its own CoW order on Base → NOT refused by the tenant (no tenant reason) and NOTHING booked in that tenant\'s blotter', retailCowRes.json?.reason === undefined && !/desk policy/.test(String(retailCowRes.json?.error ?? '')) && rowsAfter === rowsBefore, `${retailCowRes.status} ${JSON.stringify(retailCowRes.json).slice(0, 160)} rows ${rowsBefore}→${rowsAfter}`)
  await prisma.brokerIntent.update({ where: { id: named.id }, data: { state: 'closed' } }).catch(() => {})

  // ── 7. pause, resume, revoke — and what is out is WITHDRAWN (QA F3) ────
  const wl = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
  const liveJob = await fixtureJob(wl, 8453, { sellToken: 'USDC', buyToken: 'ETH', amountHuman: '25', chainId: '8453' })
  const bigLink = await prisma.brokerIntent.findUnique({ where: { id: bigId }, select: { linkSlug: true, state: true } })
  const paused = await api('PATCH', `${T}/keys/${keyId}`, { paused: true })
  check('tenant live: an admin pauses the key', paused.status === 200 && paused.json?.paused === true)
  const liveAfter = await prisma.job.findUnique({ where: { id: liveJob.id }, select: { status: true } })
  const bigAfter = await prisma.brokerIntent.findUnique({ where: { id: bigId }, select: { state: true } })
  const bigLinkRow = bigLink?.linkSlug ? await prisma.intentLink.findUnique({ where: { id: bigLink.linkSlug }, select: { revoked: true } }) : null
  check('tenant live (F3): pausing the key WITHDRAWS its open offers — the live job canceled, its artifact an explicit NULL', liveAfter?.status === 'canceled' && (await artifactOf(liveJob.id)) === null, JSON.stringify({ job: liveAfter?.status, artifact: await artifactOf(liveJob.id) }).slice(0, 160))
  check('tenant live (F3): pausing the key closes its live handed-off links — the $400 sign link revoked, the intent closed', bigLink?.state === 'handed_off' && bigLinkRow?.revoked === true && bigAfter?.state === 'closed', JSON.stringify({ before: bigLink?.state, revoked: bigLinkRow?.revoked, after: bigAfter?.state }))
  const pausedOpen = await desk('broker_open', { ask: 'Buy $25 of ETH on Base' })
  check('tenant live: a PAUSED key → broker_open refused by name (KEY_PAUSED)', pausedOpen.isError && pausedOpen.payload?.reason === 'KEY_PAUSED', JSON.stringify(pausedOpen.payload).slice(0, 160))
  const pausedStatus = await desk('broker_status', { intent_id: ok25.payload?.intentId })
  check('tenant live: a paused key still answers broker_status (an agent mid-flight can look)', !pausedStatus.isError && pausedStatus.payload?.intentId === ok25.payload?.intentId)
  // A leg that slipped out while the key was paused (a race) is refused at the relay AND at the REST channel.
  const racer = await fixtureJob(w, 42161, recipe)
  const relayPaused = await api('POST', '/api/tx/refresh', { kind: 'uniswap-swap', ...recipe, from: w }, J)
  check('tenant relay (live): with the key paused the tenant step\'s relay → 403 KEY_PAUSED', relayPaused.status === 403 && relayPaused.json?.reason === 'KEY_PAUSED', JSON.stringify(relayPaused.json).slice(0, 160))
  const racerFresh = await fixtureJob(wl, 8453, { sellToken: 'USDC', buyToken: 'ETH', amountHuman: '25', chainId: '8453' })
  const restPaused = await getJob(racerFresh.id, wl)
  check('tenant REST (F3): with the key paused GET /api/jobs/:id?t= serves NOTHING — 403 KEY_PAUSED, the artifact nulled', restPaused.status === 403 && restPaused.json?.tenantRefusal?.reason === 'KEY_PAUSED' && (await artifactOf(racerFresh.id)) === null, `${restPaused.status} ${JSON.stringify(restPaused.json?.tenantRefusal ?? restPaused.json).slice(0, 160)}`)
  await prisma.job.update({ where: { id: racer.id }, data: { status: 'canceled' } }).catch(() => {})
  await api('PATCH', `${T}/keys/${keyId}`, { paused: false })
  const tJob = await fixtureJob(wl, 8453, { sellToken: 'USDC', buyToken: 'ETH', amountHuman: '25', chainId: '8453' })
  const tPause = await api('PATCH', T, { status: 'paused' })
  const tJobAfter = await prisma.job.findUnique({ where: { id: tJob.id }, select: { status: true } })
  const tPausedOpen = await desk('broker_open', { ask: 'Buy $25 of ETH on Base' })
  check('tenant live: a PAUSED tenant → TENANT_PAUSED', tPause.status === 200 && tPausedOpen.isError && tPausedOpen.payload?.reason === 'TENANT_PAUSED', JSON.stringify(tPausedOpen.payload).slice(0, 160))
  check('tenant live (F3): pausing the TENANT withdraws every live job\'s offers (canceled, artifact NULL)', tJobAfter?.status === 'canceled' && (await artifactOf(tJob.id)) === null, JSON.stringify(tJobAfter))
  await api('PATCH', T, { status: 'active' })
  const patchRows = await prisma.blotterRow.groupBy({ by: ['kind'], where: { tenantId, kind: { in: ['tenant_paused', 'tenant_resumed', 'tenant_updated'] } }, _count: { _all: true } }).catch(() => [])
  const patchKinds = Object.fromEntries(patchRows.map((r) => [r.kind, r._count._all]))
  check('tenant live: PATCH /api/tenants/:id writes its own blotter rows — tenant_paused, tenant_resumed, and tenant_updated (signers / sandbox)', (patchKinds.tenant_paused ?? 0) >= 1 && (patchKinds.tenant_resumed ?? 0) >= 1 && (patchKinds.tenant_updated ?? 0) >= 1, JSON.stringify(patchKinds))
  const resumed = await desk('broker_open', { ask: 'Buy $25 of ETH on Base' })
  check('tenant live: resumed key + tenant → the desk trades again', !resumed.isError && resumed.payload?.state === 'open', JSON.stringify(resumed.payload).slice(0, 160))
  const close = await desk('broker_close', { intent_id: resumed.payload?.intentId })
  check('tenant live: broker_close with the key (no agent_key needed) walks away', !close.isError && close.payload?.state === 'closed', JSON.stringify(close.payload).slice(0, 160))
  // F5: a DOWNGRADE puts the tenant back in the sandbox at the next call, whatever the column says.
  await prisma.subscription.update({ where: { ownerAddress: ownerLower }, data: { status: 'canceled' } })
  const downgraded = await desk('broker_open', { ask: 'Buy $25 of ETH on Base' })
  const colAfter = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { sandbox: true, plan: true } })
  check('tenant live (F5): the owner\'s plan lapses → the next desk call is SANDBOX_ONLY on Base, and the sticky column is refreshed (sandbox true, plan free)', downgraded.isError && downgraded.payload?.reason === 'SANDBOX_ONLY' && colAfter?.sandbox === true && colAfter?.plan === 'free', JSON.stringify({ reason: downgraded.payload?.reason, col: colAfter }))
  await restoreSub()
  const revokeJob = await fixtureJob(wl, 8453, { sellToken: 'USDC', buyToken: 'ETH', amountHuman: '25', chainId: '8453' })
  const revoked = await api('DELETE', `${T}/keys/${keyId}`)
  const revokedOpen = await desk('broker_open', { ask: 'Buy $25 of ETH on Base' })
  check('tenant live: a REVOKED key → KEY_REVOKED (never retail)', revoked.status === 200 && revoked.json?.revoked === true && revokedOpen.isError && revokedOpen.payload?.reason === 'KEY_REVOKED', JSON.stringify(revokedOpen.payload).slice(0, 160))
  const revokeJobAfter = await prisma.job.findUnique({ where: { id: revokeJob.id }, select: { status: true } })
  check('tenant live (F3): revoking the key withdraws its open offers (canceled, artifact NULL)', revokeJobAfter?.status === 'canceled' && (await artifactOf(revokeJob.id)) === null, JSON.stringify(revokeJobAfter))
  const racer2 = await fixtureJob(w, 42161, recipe)
  const relayRevoked = await api('POST', '/api/tx/refresh', { kind: 'uniswap-swap', ...recipe, from: w }, J)
  check('tenant relay (live): the revoked key\'s job step never moves → 403', relayRevoked.status === 403 && relayRevoked.json?.reason === 'KEY_PAUSED', JSON.stringify(relayRevoked.json).slice(0, 160))
  await prisma.job.updateMany({ where: { id: { in: [fixture.id, racer2.id] } }, data: { status: 'canceled' } }).catch(() => {})
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

const isMain = (() => { try { return process.argv[1] && /tenant-pins\.ts$/.test(process.argv[1]) } catch { return false } })()
if (isMain) {
  let pass = 0
  let fail = 0
  const check: Check = (name, ok, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${name}${extra && (!ok || process.argv.includes('--verbose')) ? ` — ${extra}` : ''}`)
    ok ? pass++ : fail++
  }
  ;(async () => {
    console.log('— tenant (pure)')
    await tenantPurePins(check)
    const i = process.argv.indexOf('--live')
    if (i > 0) {
      const base = process.argv[i + 1] ?? process.env.BASE ?? 'http://localhost:4401'
      console.log(`— tenant (live @ ${base})`)
      await tenantLivePins(base, check, { burner: process.argv.includes('--burner') })
    }
    console.log(`\n${pass} passed, ${fail} failed\n`)
    process.exit(fail ? 1 : 0)
  })().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
