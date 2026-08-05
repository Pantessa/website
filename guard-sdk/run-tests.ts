#!/usr/bin/env tsx
// @yeetful/guard — self-contained unit suite. Every check either ports a pin
// from the app's standing harness (scripts/test-api.ts) or replays the
// attack the module was built against. No network, no keys, no DB.
import { encodeFunctionData, erc20Abi } from 'viem'
import { checkGrant, grantViolation, GrantError, hostAllowed, type GrantPolicy } from './src/spend-grant'
import { buildReport, policyCheck, policyCheckInflow, recipientCheck, validityCheck, MAX_VALID_SEC } from './src/tx-guardrails'
import {
  approveAgentArtifacts,
  buildGuardianClose,
  evaluatePolicy,
  formatPx,
  formatSz,
  guardGuardianClose,
  planForExistingPolicy,
  splitSignature,
  type GuardianGuardContext,
  type GuardianPolicyParams,
  type GuardianPosition,
} from './src/hl-guardian'
import { guardCrossChainBuild, type BuiltSwap } from './src/cross-chain-guard'
import { assertTokenIdentity, type ContractReader } from './src/token-identity'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`)
}

async function main() {
  console.log('— spend-grant (policy core)')
  const grant: GrantPolicy = {
    id: 'g1',
    allow: ['api.example.com'],
    perCallUsd: 5,
    perDayUsd: 20,
    expiresAt: new Date(Date.now() + 86_400_000),
    status: 'active',
    spendPolicyEnabled: true,
  }
  check('allowlist: exact host passes, foreign refuses, wildcard opens', hostAllowed('api.example.com', grant.allow) && !hostAllowed('evil.example.com', grant.allow) && hostAllowed('anything.xyz', ['*']))
  check('caps: per-call and daily both enforce', grantViolation(grant, 'api.example.com', 6, 0) === 'OVER_PER_CALL' && grantViolation(grant, 'api.example.com', 5, 16) === 'BUDGET_EXCEEDED' && grantViolation(grant, 'api.example.com', 4, 0) === null)
  check('lifetime cap enforces when set', grantViolation({ ...grant, totalUsd: 10 }, 'api.example.com', 5, 0, 6) === 'BUDGET_EXCEEDED')
  check('kill switches survive the master switch being OFF', grantViolation({ ...grant, spendPolicyEnabled: false, paused: true }, 'x.y', 999, 0) === 'ACCOUNT_FROZEN' && grantViolation({ ...grant, spendPolicyEnabled: false, status: 'revoked' }, 'x.y', 999, 0) === 'REVOKED' && grantViolation({ ...grant, spendPolicyEnabled: false }, 'x.y', 999, 0) === null)
  check(
    'a BROKEN gate refuses — never authorizes-by-crash (POLICY_ERROR)',
    grantViolation({ ...grant, expiresAt: 'not-a-date' as unknown as Date }, 'api.example.com', 1, 0) === 'POLICY_ERROR',
  )
  check('checkGrant throws typed GrantError', (() => { try { checkGrant({ ...grant, status: 'revoked' }, 'api.example.com', 1, 0); return false } catch (e) { return e instanceof GrantError && e.code === 'REVOKED' } })())

  console.log('— tx-guardrails (venue-neutral checks)')
  check('recipient: proceeds must return to the requesting wallet', recipientCheck('0xAb', '0xab').ok && !recipientCheck('0xAb', '0xCd').ok)
  const now = Math.floor(Date.now() / 1000)
  check('validity: expired and signable-forever both refuse', !validityCheck(now - 1, now).ok && !validityCheck(now + MAX_VALID_SEC + 10, now).ok && validityCheck(now + 600, now).ok)
  check('unpriceable action under an enabled policy REFUSES (caps never bypassed by pricing failure)', (() => { const r = policyCheck(null, grant, 0, 'api.example.com'); return !r.check.ok && r.violation === 'VALUE_UNKNOWN' })())
  check('self-signed exemption: owner signature IS the consent for cap-class violations only', policyCheck(999, grant, 0, 'api.example.com', 0, { selfSigned: true }).violation === null && policyCheck(999, { ...grant, paused: true }, 0, 'api.example.com', 0, { selfSigned: true }).violation === 'ACCOUNT_FROZEN')
  check('inflow gate: sales are never spend-gated, but kill switches survive direction', policyCheckInflow(1800, grant).check.ok && !policyCheckInflow(1800, { ...grant, paused: true }).check.ok)
  check('report: one failed block-level check fails the build; warns never do', !buildReport(1, [{ id: 'x', level: 'block', ok: false, note: '' }]).ok && buildReport(1, [{ id: 'x', level: 'warn', ok: false, note: '' }]).ok)

  console.log('— hl-guardian (delegated-execution guard)')
  const sl: GuardianPolicyParams = { coin: 'SYRUP', side: 'long', kind: 'stop_loss', triggerMode: 'price_move_pct', triggerValue: 10 }
  const pos: GuardianPosition = { coin: 'SYRUP', szi: 700, entryPx: 0.14175 }
  check('stop-loss fires DOWN only (long, 10% from entry)', !evaluatePolicy(sl, pos, 0.12876).fired && evaluatePolicy(sl, pos, 0.1275).fired && !evaluatePolicy(sl, pos, 0.15).fired)
  check('take-profit fires UP; a mis-stored trigger can never fire the wrong way', evaluatePolicy({ ...sl, kind: 'take_profit', triggerValue: 25 }, pos, 0.1772).fired && !evaluatePolicy({ ...sl, kind: 'take_profit', triggerValue: 25 }, pos, 0.13).fired)
  check('px/sz formatting mirrors the venue rules (5 sig figs, floor sizes)', formatPx(0.127512345, 0) === '0.12751' && formatSz(699.999, 0) === '699')
  const close = buildGuardianClose(sl, pos, 42, 0.1275, 0)
  check('close is derived, not chosen: sell to close long, reduce-only IOC, live size', close.orders[0].b === false && close.orders[0].r === true && close.orders[0].s === '700' && close.orders[0].t.limit.tif === 'Ioc')
  const ctx: GuardianGuardContext = { delegationStatus: 'active', delegationExpiresAt: new Date(Date.now() + 3600_000), killSwitchPaused: false, policyFlipWon: true, markPx: 0.1275, assetIndex: 42, szDecimals: 0 }
  check('guard green path: a derived close passes all ten checks', guardGuardianClose(sl, pos, close, ctx).ok)
  check('guard refuses each tamper: grow-the-position, wrong asset, oversize, stray price, double fire, frozen account', (() => {
    const notReduce = { ...close, orders: [{ ...close.orders[0], r: false }] as [typeof close.orders[0]] }
    const wrongAsset = { ...close, orders: [{ ...close.orders[0], a: 7 }] as [typeof close.orders[0]] }
    const oversize = { ...close, orders: [{ ...close.orders[0], s: '900' }] as [typeof close.orders[0]] }
    const strayPx = { ...close, orders: [{ ...close.orders[0], p: '0.2' }] as [typeof close.orders[0]] }
    return (
      !guardGuardianClose(sl, pos, notReduce, ctx).ok &&
      !guardGuardianClose(sl, pos, wrongAsset, ctx).ok &&
      !guardGuardianClose(sl, pos, oversize, ctx).ok &&
      !guardGuardianClose(sl, pos, strayPx, ctx).ok &&
      !guardGuardianClose(sl, pos, close, { ...ctx, policyFlipWon: false }).ok &&
      !guardGuardianClose(sl, pos, close, { ...ctx, killSwitchPaused: true }).ok
    )
  })())
  check('same-terms dupe AFFIRMS; a conflict names both terms', planForExistingPolicy('active', 'stop_loss', 'SYRUP', { triggerMode: 'price_move_pct', triggerValue: 10 }, { triggerMode: 'price_move_pct', triggerValue: 10 }).action === 'affirm' && (() => { const p = planForExistingPolicy('active', 'stop_loss', 'SYRUP', { triggerMode: 'price_move_pct', triggerValue: 10 }, { triggerMode: 'price_move_pct', triggerValue: 5 }); return p.action === 'refuse' && /10%/.test(p.message) && /5%/.test(p.message) })())
  const art = approveAgentArtifacts({ agentAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', nonce: 1720000000000, validUntil: 1730000000000, signatureChainId: 8453, isTestnet: false })
  check('approveAgent: signed payload and submitted action derive from ONE builder (no drift)', art.typedData.primaryType === 'HyperliquidTransaction:ApproveAgent' && (art.action.agentName as string).includes('valid_until 1730000000000') && art.action.agentAddress === (art.typedData.message.agentAddress as string))
  check('splitSignature: malformed input throws, v normalizes to 27/28', (() => { try { splitSignature('0xdead'); return false } catch { /* expected */ } return splitSignature(`0x${'ab'.repeat(64)}00`).v === 27 })())

  console.log('— cross-chain guard (the fabricated-address class)')
  const DEPOSIT = '0x1111111111111111111111111111111111111111'
  const TOKEN = '0x2222222222222222222222222222222222222222'
  const goodData = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEPOSIT, BigInt(5_000_000)] })
  const built: BuiltSwap = {
    kind: 'swap_ready',
    quote: { sell: { amountAtoms: '5000000', usd: '5.00' } },
    deposit: { address: DEPOSIT },
    steps: [{ action: 'send_transaction', tx: { to: TOKEN, data: goodData, value: '0', chainId: 8453 } }],
  }
  check('green path: exact amount to the quoted one-time address passes', guardCrossChainBuild(built, { chainId: 8453 }).ok)
  const swapped = { ...built, steps: [{ action: 'send_transaction', tx: { ...built.steps![0].tx!, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: ['0x3333333333333333333333333333333333333333', BigInt(5_000_000)] }) } }] }
  check('a swapped recipient REFUSES (the #374 near-miss, decoded from calldata)', !guardCrossChainBuild(swapped, { chainId: 8453 }).ok)
  const inflated = { ...built, steps: [{ action: 'send_transaction', tx: { ...built.steps![0].tx!, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEPOSIT, BigInt(6_000_000)] }) } }] }
  check('an inflated amount REFUSES', !guardCrossChainBuild(inflated, { chainId: 8453 }).ok)
  const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [DEPOSIT, BigInt(5_000_000)] })
  check('a non-transfer call REFUSES (approve is not a deposit)', !guardCrossChainBuild({ ...built, steps: [{ action: 'send_transaction', tx: { ...built.steps![0].tx!, data: approveData } }] }, { chainId: 8453 }).ok)
  check('wrong origin chain REFUSES', !guardCrossChainBuild(built, { chainId: 1 }).ok)
  const foreignFee: BuiltSwap = { ...built, appFee: { applied: [{ recipient: '0x4444444444444444444444444444444444444444', fee: 20 }] } }
  check('a fee paid to an unpinned EVM recipient REFUSES (the venue never validates — we do)', !guardCrossChainBuild(foreignFee, { chainId: 8453, fee: { recipient: '0x5555555555555555555555555555555555555555', bps: 20 } }).ok)

  console.log('— token identity binding (the consistent-liar class)')
  const fakeChain = (symbol: string, decimals: number): ContractReader => ({
    readContract: async ({ functionName }) => (functionName === 'symbol' ? symbol : decimals),
  })
  check('matching identity passes (incl. the ETH/WETH alias)', await assertTokenIdentity(fakeChain('USDC', 6), TOKEN, 'USDC', 6).then(() => true, () => false) && await assertTokenIdentity(fakeChain('WETH', 18), TOKEN, 'ETH', 18).then(() => true, () => false))
  check('the attack: a REAL market whose asset is WETH, claimed as USDC → refused', await assertTokenIdentity(fakeChain('WETH', 18), TOKEN, 'USDC', 6).then(() => false, (e: Error) => /WETH on-chain, not USDC/.test(e.message)))
  check('a wrong decimals claim refuses (never size against a wrong scale)', await assertTokenIdentity(fakeChain('USDC', 18), TOKEN, 'USDC', 6).then(() => false, () => true))
  check('an unreadable token refuses (fail-closed, never fail-open)', await assertTokenIdentity({ readContract: async () => { throw new Error('rpc down') } }, TOKEN, 'USDC', 6).then(() => false, (e: Error) => /refusing to build against it/.test(e.message)))

  console.log(`\n${failures === 0 ? '✅ all green' : `❌ ${failures} failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
