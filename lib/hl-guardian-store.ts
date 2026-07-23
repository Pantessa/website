// ─────────────────────────────────────────────────────────────────────────
//  Hyperliquid Guardian — the I/O half. Key custody (AES-256-GCM at rest),
//  HL info/exchange clients, delegation lifecycle, and the cron sweep that
//  evaluates every armed policy and executes fired ones through the pure
//  guard in lib/hl-guardian.ts.
//
//  Custody: one fresh agent keypair per delegation, generated here, encrypted
//  with GUARDIAN_KEY_SECRET before it touches the DB, decrypted only inside
//  the sweep for the milliseconds it takes to sign. The venue enforces the
//  ceiling (an agent key can trade, never withdraw); our guard narrows it to
//  "reduce-only close of the pinned coin".
// ─────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { ExchangeClient, HttpTransport, InfoClient, MAINNET_API_URL, TESTNET_API_URL } from '@nktkas/hyperliquid'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import prisma from '@/lib/db'
import { getActiveGrant } from '@/lib/grant-store'
import { newTurnId, recordTraceLine } from '@/lib/route-trace'
import {
  approveAgentArtifacts,
  buildGuardianClose,
  evaluatePolicy,
  guardGuardianClose,
  planForExistingPolicy,
  splitSignature,
  GUARDIAN_DELEGATION_DAYS,
  type GuardianPolicyParams,
  type GuardianPosition,
} from '@/lib/hl-guardian'

// ── Network ────────────────────────────────────────────────────────────────

export function guardianIsTestnet(): boolean {
  return process.env.HL_GUARDIAN_TESTNET === 'true'
}

function apiUrl(): string {
  return guardianIsTestnet() ? TESTNET_API_URL : MAINNET_API_URL
}

const transport = () => new HttpTransport({ isTestnet: guardianIsTestnet() })

export const hlInfo = () => new InfoClient({ transport: transport() })

// ── Key custody ────────────────────────────────────────────────────────────

function custodyKey(): Buffer {
  const s = process.env.GUARDIAN_KEY_SECRET
  if (!s || s.length < 16) throw new Error('GUARDIAN_KEY_SECRET must be set (≥16 chars) to run the guardian.')
  return createHash('sha256').update(s).digest()
}

export function encryptAgentKey(pk: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', custodyKey(), iv)
  const ct = Buffer.concat([cipher.update(pk, 'utf8'), cipher.final()])
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`
}

export function decryptAgentKey(enc: string): `0x${string}` {
  const [v, ivHex, tagHex, ctHex] = enc.split(':')
  if (v !== 'v1' || !ivHex || !tagHex || !ctHex) throw new Error('unrecognized agent key ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', custodyKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const pk = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8')
  return pk as `0x${string}`
}

// ── Delegation lifecycle ───────────────────────────────────────────────────

/** The wallet's current delegation row (any status), newest first. */
export async function getDelegation(wallet: string) {
  return prisma.hlGuardianDelegation.findFirst({
    where: { wallet: wallet.toLowerCase() },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Start a delegation: mint a fresh agent keypair, persist it encrypted as
 * `pending`, and hand back the EXACT typed data the user's wallet must sign
 * (plus the matching /exchange action body, kept server-side on the row via
 * re-derivation — nonce and validUntil are stored).
 */
export async function createDelegation(wallet: string, signatureChainId: number) {
  const w = wallet.toLowerCase()
  // One live delegation per wallet: retire any pending leftovers first.
  await prisma.hlGuardianDelegation.updateMany({ where: { wallet: w, status: 'pending' }, data: { status: 'revoked' } })
  const pk = generatePrivateKey()
  const agentAddress = privateKeyToAccount(pk).address.toLowerCase()
  const nonce = Date.now()
  const validUntil = nonce + GUARDIAN_DELEGATION_DAYS * 86_400_000
  const row = await prisma.hlGuardianDelegation.create({
    data: {
      wallet: w,
      agentAddress,
      agentKeyEnc: encryptAgentKey(pk),
      hlChain: guardianIsTestnet() ? 'Testnet' : 'Mainnet',
      status: 'pending',
      nonce: BigInt(nonce),
      sigChainId: signatureChainId,
      expiresAt: new Date(validUntil),
    },
  })
  const { typedData } = approveAgentArtifacts({ agentAddress, nonce, validUntil, signatureChainId, isTestnet: guardianIsTestnet() })
  return { id: row.id, agentAddress, typedData }
}

/**
 * Complete the delegation: submit the user-signed approveAgent action to
 * /exchange. The signature is the user's consent artifact — the action body
 * is re-derived from the stored row, so what activates is exactly what was
 * offered for signature.
 */
export async function activateDelegation(id: string, wallet: string, signature: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.hlGuardianDelegation.findUnique({ where: { id } })
  if (!row || row.wallet !== wallet.toLowerCase()) return { ok: false, error: 'delegation not found' }
  if (row.status !== 'pending') return { ok: false, error: `delegation is ${row.status}` }
  const { action } = approveAgentArtifacts({
    agentAddress: row.agentAddress,
    nonce: Number(row.nonce),
    validUntil: row.expiresAt.getTime(),
    signatureChainId: row.sigChainId,
    isTestnet: row.hlChain === 'Testnet',
  })
  const res = await fetch(`${apiUrl()}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, nonce: Number(row.nonce), signature: splitSignature(signature) }),
  })
  const body = (await res.json().catch(() => null)) as { status?: string; response?: unknown } | null
  if (!res.ok || body?.status !== 'ok') {
    return { ok: false, error: typeof body?.response === 'string' ? body.response : `exchange rejected approveAgent (HTTP ${res.status})` }
  }
  await prisma.hlGuardianDelegation.update({ where: { id }, data: { status: 'active', approvedAt: new Date() } })
  return { ok: true }
}

/** Local revoke: the loop stands down immediately. (The venue-side approval
 *  also dies at its valid_until; users can additionally remove the agent in
 *  the HL app — we surface both facts in the UI.) */
export async function revokeDelegation(wallet: string): Promise<void> {
  await prisma.hlGuardianDelegation.updateMany({
    where: { wallet: wallet.toLowerCase(), status: { in: ['pending', 'active'] } },
    data: { status: 'revoked' },
  })
  await prisma.hlGuardianPolicy.updateMany({
    where: { wallet: wallet.toLowerCase(), status: 'active' },
    data: { status: 'paused' },
  })
}

// ── Positions (for the UI picker + the sweep) ──────────────────────────────

export interface LivePosition extends GuardianPosition {
  side: 'long' | 'short'
  positionValueUsd: number
  unrealizedPnl: number
  liquidationPx: number | null
  leverage: number
  markPx: number | null
}

export async function fetchPositions(wallet: string): Promise<LivePosition[]> {
  const info = hlInfo()
  const [state, mids] = await Promise.all([
    info.clearinghouseState({ user: wallet as `0x${string}` }),
    info.allMids(),
  ])
  return state.assetPositions
    .map((ap) => ap.position)
    .filter((p) => Number(p.szi) !== 0)
    .map((p) => ({
      coin: p.coin,
      szi: Number(p.szi),
      entryPx: Number(p.entryPx),
      side: Number(p.szi) > 0 ? ('long' as const) : ('short' as const),
      positionValueUsd: Number(p.positionValue),
      unrealizedPnl: Number(p.unrealizedPnl),
      liquidationPx: p.liquidationPx != null ? Number(p.liquidationPx) : null,
      leverage: Number(p.leverage?.value ?? 1),
      markPx: mids[p.coin] != null ? Number(mids[p.coin]) : null,
    }))
}

// ── The sweep (called by /api/cron/hl-guardian) ────────────────────────────

export interface SweepSummary {
  checked: number
  fired: number
  closed: number
  blocked: number
  errors: number
  skipped: number
  notes: string[]
}

function policyParams(p: {
  coin: string
  side: string
  kind: string
  triggerMode: string
  triggerValue: number
}): GuardianPolicyParams {
  return {
    coin: p.coin,
    side: p.side as 'long' | 'short',
    kind: p.kind as 'stop_loss' | 'take_profit',
    triggerMode: p.triggerMode as 'price_move_pct' | 'price',
    triggerValue: p.triggerValue,
  }
}

/**
 * One evaluation pass over every armed policy. Bounded (≤30s route budget):
 * meta + mids fetched once, one clearinghouseState per wallet, and only
 * FIRED policies do any further work. Every consequential decision lands in
 * hl_guardian_runs; heartbeat + execution trace to route_trace_lines with
 * the native negative-seq convention.
 */
export async function runGuardianSweep(): Promise<SweepSummary> {
  const summary: SweepSummary = { checked: 0, fired: 0, closed: 0, blocked: 0, errors: 0, skipped: 0, notes: [] }
  // Env fence: local + prod share one Neon DB, so only sweep policies whose
  // delegation belongs to THIS env's network — never chew another env's rows.
  const envChain = guardianIsTestnet() ? 'Testnet' : 'Mainnet'
  const policies = await prisma.hlGuardianPolicy.findMany({
    where: { status: 'active', delegation: { hlChain: envChain } },
    include: { delegation: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
  if (policies.length === 0) return summary

  const info = hlInfo()
  const [meta, mids] = await Promise.all([info.meta(), info.allMids()])
  const byWallet = new Map<string, typeof policies>()
  for (const p of policies) {
    const list = byWallet.get(p.wallet) ?? []
    list.push(p)
    byWallet.set(p.wallet, list)
  }

  const now = new Date()
  for (const [wallet, walletPolicies] of byWallet) {
    let positions: GuardianPosition[] = []
    try {
      const state = await info.clearinghouseState({ user: wallet as `0x${string}` })
      positions = state.assetPositions.map((ap) => ({
        coin: ap.position.coin,
        szi: Number(ap.position.szi),
        entryPx: Number(ap.position.entryPx),
      }))
    } catch (e) {
      summary.errors++
      summary.notes.push(`clearinghouseState failed for ${wallet.slice(0, 8)}…: ${(e as Error).message}`)
      continue
    }

    for (const row of walletPolicies) {
      summary.checked++
      await prisma.hlGuardianPolicy.update({ where: { id: row.id }, data: { lastChecked: now } }).catch(() => {})
      const params = policyParams(row)
      const pos = positions.find((p) => p.coin === row.coin)

      // Position gone or flipped → the guardian's job here is over.
      if (!pos || pos.szi === 0 || (params.side === 'long') !== pos.szi > 0) {
        await prisma.hlGuardianPolicy.update({ where: { id: row.id }, data: { status: 'done' } })
        await recordRun(row, 'noop_position_gone', 'Position closed or flipped outside the guardian — policy retired.', null, null, null)
        continue
      }

      const markPx = mids[row.coin] != null ? Number(mids[row.coin]) : null
      if (!markPx) {
        summary.errors++
        summary.notes.push(`no mid for ${row.coin}`)
        continue
      }
      const verdict = evaluatePolicy(params, pos, markPx)
      if (!verdict.fired) continue
      summary.fired++

      // Kill switch: an account freeze stands the guardian down (recorded
      // once per freeze, not once per tick).
      const grant = await getActiveGrant(wallet)
      if (grant?.paused) {
        const last = await prisma.hlGuardianRun.findFirst({ where: { policyId: row.id }, orderBy: { createdAt: 'desc' } })
        if (last?.action !== 'skipped_kill') {
          await recordRun(row, 'skipped_kill', `Trigger is live but the account kill switch is ON — standing down. ${verdict.reason}`, null, null, null)
        }
        summary.skipped++
        continue
      }

      // Atomic single-fire: whoever flips active→triggered owns the close.
      const flip = await prisma.hlGuardianPolicy.updateMany({ where: { id: row.id, status: 'active' }, data: { status: 'triggered' } })
      const flipWon = flip.count === 1
      if (!flipWon) {
        summary.skipped++
        continue
      }

      const turnId = newTurnId()
      let seq = -1000
      const trace = (event: unknown) => recordTraceLine(turnId, seq++, event, 'agent')
      trace({ type: 'status', label: `guardian: ${row.kind} on ${row.coin} fired — ${verdict.reason}` })

      try {
        const assetIndex = meta.universe.findIndex((u) => u.name === row.coin)
        if (assetIndex < 0) throw new Error(`${row.coin} not in perp universe`)
        const szDecimals = meta.universe[assetIndex].szDecimals
        const action = buildGuardianClose(params, pos, assetIndex, markPx, szDecimals)
        const guard = guardGuardianClose(params, pos, action, {
          delegationStatus: row.delegation.status,
          delegationExpiresAt: row.delegation.expiresAt,
          killSwitchPaused: grant?.paused ?? false,
          policyFlipWon: flipWon,
          markPx,
          assetIndex,
          szDecimals,
        })

        if (!guard.ok) {
          const bad = guard.checks.filter((c) => !c.ok && c.level === 'block').map((c) => `${c.id}: ${c.note}`)
          trace({ type: 'error', label: `guardian: guard REFUSED the close — ${bad.join(' · ')}` })
          await prisma.hlGuardianPolicy.update({ where: { id: row.id }, data: { status: 'error' } })
          await recordRun(row, 'blocked', `Guard refused: ${bad.join(' · ')}`, action, guard, null)
          summary.blocked++
          continue
        }

        trace({ type: 'status', label: `guardian: guard passed (${guard.checks.length} checks) — closing ${action.orders[0].s} ${row.coin} reduce-only, ~$${guard.valueUsd}` })
        // Second half of the env fence: same network, DIFFERENT env secret
        // (a local-dev row on mainnet). Not ours — re-arm and step aside for
        // the env that owns it; never mark it errored.
        let agentKey: `0x${string}`
        try {
          agentKey = decryptAgentKey(row.delegation.agentKeyEnc)
        } catch {
          await prisma.hlGuardianPolicy.update({ where: { id: row.id }, data: { status: 'active' } })
          trace({ type: 'note', level: 'info', label: 'guardian: agent key encrypted by another env — standing aside' })
          summary.skipped++
          continue
        }
        const agentAccount = privateKeyToAccount(agentKey)
        const exchange = new ExchangeClient({ transport: transport(), wallet: agentAccount })
        const res = await exchange.order({ orders: action.orders, grouping: action.grouping })
        const status = res.response.data.statuses[0]

        if (status && typeof status === 'object' && 'filled' in status) {
          const filled = status.filled as { totalSz: string; avgPx: string; oid: number }
          const valueUsd = Number((Number(filled.totalSz) * Number(filled.avgPx)).toFixed(2))
          await prisma.hlGuardianPolicy.update({ where: { id: row.id }, data: { status: 'done' } })
          await recordRun(row, 'closed', `${verdict.reason} — filled ${filled.totalSz} @ ${filled.avgPx} (oid ${filled.oid})`, action, guard, valueUsd, { filled })
          trace({ type: 'receipt', receipt: { summary: `guardian closed ${filled.totalSz} ${row.coin} @ ${filled.avgPx} ($${valueUsd})` } })
          summary.closed++
        } else {
          // IOC missed (or venue error string) — re-arm and try next tick.
          const err = status && typeof status === 'object' && 'error' in status ? String((status as { error: unknown }).error) : 'IOC unfilled'
          await prisma.hlGuardianPolicy.update({ where: { id: row.id }, data: { status: 'active' } })
          await recordRun(row, 'retry', `Close attempt did not fill (${err}) — re-armed for next tick.`, action, guard, null, { status })
          trace({ type: 'note', level: 'warn', label: `guardian: close did not fill (${err}) — re-armed` })
          summary.errors++
        }
      } catch (e) {
        const msg = (e as Error).message
        await prisma.hlGuardianPolicy.update({ where: { id: row.id }, data: { status: 'error' } }).catch(() => {})
        await recordRun(row, 'error', `Sweep error after trigger: ${msg}`, null, null, null)
        trace({ type: 'error', label: `guardian: ${msg}` })
        summary.errors++
      }
    }
  }
  return summary
}

async function recordRun(
  policy: { id: string; wallet: string },
  action: string,
  reason: string,
  orderJson: unknown,
  guardReport: unknown,
  valueUsd: number | null,
  hlResponse?: unknown,
) {
  await prisma.hlGuardianRun
    .create({
      data: {
        policyId: policy.id,
        wallet: policy.wallet,
        action,
        reason,
        orderJson: orderJson === null ? undefined : (orderJson as object),
        guardReport: guardReport === null ? undefined : (guardReport as object),
        hlResponse: hlResponse === undefined ? undefined : (hlResponse as object),
        valueUsd,
      },
    })
    .catch(() => {})
}

// ── Arming (shared by the /api/guardian/policies route and the chat layer) ──

import { evaluatePolicy as evalForArm, type GuardianArmAsk } from '@/lib/hl-guardian'

export type ArmResult =
  | { ok: true; resumed?: boolean; policy: { id: string; coin: string; side: string; kind: string; triggerMode: string; triggerValue: number }; positionNote: string }
  | { ok: false; status: number; error: string }

/**
 * Validate + arm one guardian policy against the LIVE position. One rulebook
 * for every surface: an active unexpired delegation, an open position on the
 * coin, a trigger that doesn't fire the instant it's armed, and no duplicate
 * armed policy of the same kind on the coin.
 */
export async function armGuardianPolicy(wallet: string, ask: GuardianArmAsk): Promise<ArmResult> {
  const w = wallet.toLowerCase()
  if (!Number.isFinite(ask.triggerValue) || ask.triggerValue <= 0 || (ask.triggerMode === 'price_move_pct' && ask.triggerValue >= 100)) {
    return { ok: false, status: 400, error: 'The trigger must be a positive number (a percent below 100, or an absolute price).' }
  }
  const delegation = await getDelegation(w)
  if (!delegation || delegation.status !== 'active' || delegation.expiresAt <= new Date()) {
    return { ok: false, status: 409, error: 'No active guardian delegation — approve the guardian agent first.' }
  }
  let positions
  try {
    positions = await fetchPositions(w)
  } catch (e) {
    return { ok: false, status: 502, error: `Hyperliquid read failed: ${(e as Error).message}` }
  }
  const pos = positions.find((p) => p.coin === ask.coin)
  if (!pos) return { ok: false, status: 400, error: `No open ${ask.coin} perp position on this account.` }

  if (pos.markPx != null) {
    const verdict = evalForArm({ coin: ask.coin, side: pos.side, kind: ask.kind, triggerMode: ask.triggerMode, triggerValue: ask.triggerValue }, pos, pos.markPx)
    if (verdict.fired) {
      return { ok: false, status: 400, error: `That trigger would fire immediately (${verdict.reason}). Set it past the current mark.` }
    }
  }
  const positionNote = `${pos.coin} ${pos.side} ${pos.leverage}x · entry ${pos.entryPx} · mark ${pos.markPx ?? '—'} · uPnL $${pos.unrealizedPnl.toFixed(2)}`
  const dupe = await prisma.hlGuardianPolicy.findFirst({
    where: { wallet: w, coin: ask.coin, kind: ask.kind, status: { in: ['active', 'paused', 'triggered'] } },
  })
  if (dupe) {
    const plan = planForExistingPolicy(dupe.status, ask.kind, ask.coin)
    if (plan.action === 'refuse') return { ok: false, status: 409, error: plan.message }
    // Paused → resume as the freshly-validated ask: trigger, side, and
    // delegation re-derived live (a stale side would dead-letter the sweep's
    // lost-flip check; the arm validations above already ran on this trigger).
    const row = await prisma.hlGuardianPolicy.update({
      where: { id: dupe.id },
      data: { status: 'active', triggerMode: ask.triggerMode, triggerValue: ask.triggerValue, side: pos.side, delegationId: delegation.id },
    })
    return {
      ok: true,
      resumed: true,
      policy: { id: row.id, coin: row.coin, side: row.side, kind: row.kind, triggerMode: row.triggerMode, triggerValue: row.triggerValue },
      positionNote,
    }
  }

  const row = await prisma.hlGuardianPolicy.create({
    data: { delegationId: delegation.id, wallet: w, coin: ask.coin, side: pos.side, kind: ask.kind, triggerMode: ask.triggerMode, triggerValue: ask.triggerValue },
  })
  return {
    ok: true,
    policy: { id: row.id, coin: row.coin, side: row.side, kind: row.kind, triggerMode: row.triggerMode, triggerValue: row.triggerValue },
    positionNote,
  }
}
