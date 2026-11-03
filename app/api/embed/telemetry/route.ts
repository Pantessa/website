import { recordCreatorPaidOnchain } from '@/lib/creator-paid'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { resolveEmbedKey, sightingOrigin } from '@/lib/embed-key'
import { isBuildPath } from '@/lib/build-path'
import { INTENT_SLUG_RE } from '@/lib/intent-links'
import type { OriginKind } from '@/lib/value-origin'
import { COUNTED_VERIFICATIONS, verifyTurnNow, extractTxHash, chainIdOfTurn } from '@/lib/link-receipt-verify'
import { jobStepMoneyAlreadyBooked } from '@/lib/job-step-money'
import { grantEarnedAnswers } from '@/lib/earned-answers'
import { sanitizeFillSymbols } from '@/lib/fill-symbols'
import { isIndexSymbol } from '@/lib/viz/flow'
import { readOrigin, type OriginFeed } from '@/lib/broker-origin'
import { planNamesPolicyPool, policyPoolOriginFor } from '@/lib/policy-pool/venue'
import { policyPoolConfig } from '@/lib/policy-pool/config'
import { recordPolicyPoolEvent } from '@/lib/policy-pool/ledger'
import { recordTenantTurn } from '@/lib/tenant/blotter'
import { claimReferralFromViaCookie } from '@/lib/share-referral'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-turn embed telemetry — the client posts one compact beacon after each
// embedded chat turn (and again when something gets signed):
//   { key, sessionId, page?, prompt?, outcome, artifact?, chain?, detail?, txUrl?, valueUsd?, buildPath?, jobId?, symbols? }
// KEYED embeds only: telemetry is a feature of the embed key (it's what the
// owner dashboard renders); keyless mounts record nothing here — with ONE
// exception: FIRST-PARTY beacons ({ firstParty: true }, no key) from
// yeetful.com's own chat record value-bearing outcomes (tx-built / signed)
// under embedKeyId '' so the "money moved" metric counts the whole product.
// First-party rows carry NO prompt (chat asks stay private) — only the
// side-tagged symbols the trade moved (lib/fill-symbols.ts) — and are only
// accepted when the reported origin matches this deployment's own host —
// a keyless third-party embed still records nothing. Public + self-reported
// by design (it runs on host sites) — inputs are clamped and allowlisted,
// and a bad beacon is dropped with a 202, never an error.

const OUTCOMES = new Set(['answered', 'clarify', 'tx-built', 'signed', 'refused', 'credit-gate', 'error'])
const FIRST_PARTY_OUTCOMES = new Set(['tx-built', 'signed'])
const ARTIFACTS = new Set(['cow-order', 'hl-order', 'tx', 'tx-chain', 'vote', 'job', 'job-step', 'opensea-listing'])

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

/** Notional USD of the built/signed transaction — self-reported, so clamp to
 * a sane range and round to cents. Undefined on anything non-numeric. */
const usd = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(Math.min(v, 1e9) * 100) / 100 : undefined

/** True when the beacon's origin is THIS deployment (www/apex tolerant) —
 * the gate that keeps keyless third-party embeds out of the first-party lane. */
function isOwnOrigin(origin: string, req: NextRequest): boolean {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim().toLowerCase()
  if (!host) return false
  try {
    const beaconHost = new URL(origin).host.toLowerCase()
    const bare = (h: string) => h.replace(/^www\./, '')
    return bare(beaconHost) === bare(host)
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const key = typeof body.key === 'string' ? body.key : ''
  const resolved = await resolveEmbedKey(key)
  const sessionId = typeof body.sessionId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.sessionId) ? body.sessionId : null
  const outcome = typeof body.outcome === 'string' && OUTCOMES.has(body.outcome) ? body.outcome : null
  const origin = sightingOrigin(body.page, req.headers.get('referer'))

  // Internal-run marker (2026-08-11 audit: prod-pointed drills write rows the
  // origin filters can't see — the first-party lane REQUIRES a real origin).
  // Self-reported on purpose: flagging yourself internal only removes the row
  // from our own scoreboard, so there is nothing to gain by spoofing it.
  // Every prod-pointed script sends the header on every request (standing
  // rule, lib/value-origin.ts); the harness- sessionId prefix is the belt for
  // fixtures that predate the header.
  const internalRun =
    req.headers.get('x-yf-internal-run') === '1' ||
    body.internalRun === true ||
    (sessionId?.startsWith('harness-') ?? false)

  // First-party lane: yeetful.com's own chat, keyless by nature. Only
  // value-bearing outcomes, only from our own origin, never a prompt.
  const firstParty =
    !resolved &&
    body.firstParty === true &&
    !!outcome &&
    FIRST_PARTY_OUTCOMES.has(outcome) &&
    !!origin &&
    isOwnOrigin(origin, req)

  if ((!resolved && !firstParty) || !sessionId || !outcome || !origin) {
    return NextResponse.json({ ok: false }, { status: 202 })
  }

  const artifact = typeof body.artifact === 'string' && ARTIFACTS.has(body.artifact) ? body.artifact : undefined

  // Attended-vs-standing origin, stamped SERVER-side (lib/value-origin.ts).
  // Job-driven turns may carry the jobId so DCA-schedule runs (jobs whose
  // source is 'dca:<scheduleId>') tag as dca-run; the lookup is best-effort —
  // a missing/foreign job still tags the row job-step, never drops it.
  let originKind: OriginKind = resolved ? 'embed' : 'chat'
  if (artifact === 'job' || artifact === 'job-step') {
    originKind = 'job-step'
    const jobId = typeof body.jobId === 'string' && /^[a-z0-9]{20,32}$/i.test(body.jobId) ? body.jobId : null
    // ONE money writer for job steps (lib/job-step-money, agent-desk round-2 decision 1): the
    // runner books a signed step's row at completion, so the browser's own `signed` beacon for
    // that step is a duplicate — answered as today (echo), written never.
    if (jobId && artifact === 'job-step' && outcome === 'signed' && (await jobStepMoneyAlreadyBooked({ jobId, seq: body.seq, txUrl: str(body.txUrl, 300) ?? null }))) {
      return NextResponse.json({ ok: true, deduped: true, ...(internalRun ? { internal: true } : {}) })
    }
    if (jobId) {
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { source: true } }).catch(() => null)
      if (job?.source?.startsWith('dca:')) originKind = 'dca-run'
    }
  }

  const intentLinkSlug =
    typeof body.intentLinkSlug === 'string' && INTENT_SLUG_RE.test(body.intentLinkSlug)
      ? body.intentLinkSlug
      : undefined
  // PROVENANCE (lib/broker-origin): a turn through a desk-minted link inherits
  // the feed the intent said it was born from — copied SERVER-side from the
  // bound broker intent, so "born from Dune, signed" is a join on the intent
  // row, never a second client claim. Best-effort: a miss stamps nothing.
  const deskIntent = intentLinkSlug ? await deskIntentForLink(intentLinkSlug) : null
  const originFeed = deskIntent?.feed
  // The SIGNING wallet — address-shaped only, lowercased. Self-reported like
  // the rest of the beacon; it keys lifetime referral earnings, the same
  // trust level as the valueUsd/outcome it rides beside.
  const walletAddress =
    typeof body.walletAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(body.walletAddress)
      ? body.walletAddress.toLowerCase()
      : undefined
  // The fee tier the artifact carried (C2b: 20 organic / 50 link) — earnings
  // read this over the per-path default. Integer bps, venue-cap bounded.
  const feeBps =
    typeof body.feeBps === 'number' && Number.isInteger(body.feeBps) && body.feeBps >= 0 && body.feeBps <= 100
      ? body.feeBps
      : undefined

  // The traded symbols, side-tagged ("buy:ETH") — the one trade detail a
  // first-party row keeps (no prompt, no detail). Self-reported like valueUsd,
  // so every entry is re-allowlisted against the Markets index; job artifacts
  // are never tagged (their fills are read from job steps — no double marker).
  const symbols =
    (outcome === 'tx-built' || outcome === 'signed') && artifact !== 'job' && artifact !== 'job-step'
      ? sanitizeFillSymbols(body.symbols, isIndexSymbol)
      : []

  let row: { id: string } | null = null
  try {
    row = await prisma.embedTurn.create({
      select: { id: true },
      data: {
        embedKeyId: resolved?.id ?? '',
        ownerAddress: resolved?.ownerAddress ?? null,
        origin,
        sessionId,
        prompt: firstParty ? '' : (str(body.prompt, 280) ?? ''),
        outcome,
        artifact,
        chain: str(body.chain, 40),
        detail: firstParty ? undefined : str(body.detail, 220),
        txUrl: str(body.txUrl, 300),
        valueUsd: usd(body.valueUsd),
        // Which layer built the artifact — allowlisted (self-reported like
        // everything here); anything unrecognized is dropped, not stored.
        buildPath: isBuildPath(body.buildPath) ? body.buildPath : undefined,
        originKind,
        // /i/<slug> attribution — slug-shaped only; creator fee-split
        // earnings compute read-time from fee-bearing signed rows.
        intentLinkSlug,
        originFeed,
        walletAddress,
        feeBps,
        isInternal: internalRun,
        symbols,
        // Money follows the receipt (S-2): a signed row starts fail-closed
        // and is promoted below by the same verifier the funnel event gets.
        verification: outcome === 'signed' ? 'unverified' : undefined,
      },
    })
  } catch {
    // telemetry never breaks a host page
    return NextResponse.json({ ok: false }, { status: 202 })
  }

  // Receipt verification for the MONEY row (squad security S-2, 2026-09-08).
  // Inline and timeboxed like the funnel event's: a slow RPC leaves the row
  // `unverified` (counts nothing) for the lazy re-check rather than hanging
  // the beacon. The verdict rides the response so a drill can assert it.
  let verification: string | undefined
  if (outcome === 'signed') {
    verification = await Promise.race([
      verifyTurnNow(row.id, body.chainId),
      new Promise<'unverified'>((r) => setTimeout(() => r('unverified'), 4000)),
    ]).catch(() => 'unverified')
  }
  const counted = !!verification && (COUNTED_VERIFICATIONS as readonly string[]).includes(verification)

  // First-touch lifetime referral (HANDOFF-yeetcall-gtm C2): the first link
  // a wallet SIGNS through claims it for that link's creator, forever.
  // Write-once (createMany skipDuplicates — a second link never re-claims),
  // self-referrals excluded (a creator signing their own link earns nothing
  // extra), and always fail-soft: referral stamping never breaks telemetry.
  // Internal runs never claim referrals: referred_wallets is write-once and
  // lifetime — a drill signing through a link must not permanently attribute
  // a real wallet to a creator. And (S-2) only a COUNTED sign claims one —
  // a spoofed or unreadable receipt must not bind a wallet to a creator for
  // life on the beacon's word.
  if (outcome === 'signed' && counted && intentLinkSlug && walletAddress && !internalRun) {
    try {
      const link = await prisma.intentLink.findUnique({ where: { id: intentLinkSlug }, select: { creator: true } })
      if (link?.creator && link.creator !== walletAddress) {
        await prisma.referredWallet.createMany({
          data: [{ wallet: walletAddress, creator: link.creator, intentLinkSlug }],
          skipDuplicates: true,
        })
      }
    } catch {
      /* fail-soft */
    }
  }
  // The share that pays (squad five-million, PERPS 2026-11-03): a connect-only
  // signer who came in on `?via=` (a chart / live / deck share, or the creator
  // page's ViaSeed) never passed the SIWE door, so the `yf_via` cookie
  // ViaTracker set on landing is read HERE — the same evidence class as
  // wallet_arrivals.via (the SIWE door reads this very cookie into that row)
  // and nothing more: never a body field (a beacon's `via` is ignored). Same
  // fences as the link referral above — a COUNTED sign only, a link's creator
  // wins the turn, never internal, never self, write-once (lib/share-referral).
  if (outcome === 'signed' && counted && !intentLinkSlug && walletAddress && !internalRun && req.cookies.get('yf_via')?.value) {
    await Promise.race([claimReferralFromViaCookie({ wallet: walletAddress, via: req.cookies.get('yf_via')?.value, landing: req.cookies.get('yf_via_landing')?.value ?? null, internal: false }), new Promise((r) => setTimeout(r, 2000))]).catch(() => null)
  }
  // Every trade you sign refills your chat (pricing v2): a VERIFIED receipt
  // banks answers from the fee it paid — to the embed HOST for a keyed embed
  // turn (their visitors chat on the host's pool), else to the signer. The
  // grant re-derives the notional and the fee venue from the chain; the
  // beacon's own valueUsd only ever LOWERS it (lib/earned-answers). Never for
  // an internal run, never awaited past the response.
  let earned: number | undefined
  if (verification === 'verified' && walletAddress && !internalRun) {
    const txHash = extractTxHash(str(body.txUrl, 300))
    const chainId = chainIdOfTurn({ chain: str(body.chain, 40), txUrl: str(body.txUrl, 300) }, body.chainId)
    const claimedUsd = usd(body.valueUsd)
    if (txHash && chainId && claimedUsd) {
      earned = await Promise.race([
        grantEarnedAnswers({
          id: row.id,
          beneficiary: resolved?.ownerAddress ?? walletAddress,
          wallet: walletAddress,
          chainId,
          txHash,
          claimedUsd,
          linkTier: !!intentLinkSlug,
        }),
        new Promise<number>((r) => setTimeout(() => r(0), 4000)),
      ]).catch(() => 0)
    }
  }

  // A swap that paid its link creator INSIDE the transaction (lib/creator-split)
  // is booked as an already-paid claim, read from the receipt — or the claim
  // ledger would pay the same share again. Verified rows only.
  if (verification === 'verified' && walletAddress && !internalRun) {
    const txHash = extractTxHash(str(body.txUrl, 300))
    const chainId = chainIdOfTurn({ chain: str(body.chain, 40), txUrl: str(body.txUrl, 300) }, body.chainId)
    if (txHash && chainId) {
      await Promise.race([
        recordCreatorPaidOnchain({ intentLinkSlug: intentLinkSlug ?? null, wallet: walletAddress, chainId, txHash }),
        new Promise<number>((r) => setTimeout(() => r(0), 4000)),
      ]).catch(() => 0)
    }
  }

  // THE POLICY POOL (squad 2026-11-02): a desk intent opened for the pool
  // learns its signature and its receipt HERE, where every other receipt
  // does — `signed` on the beacon, `mined` once the receipt verified
  // on-chain. The same txHash the money row carries; no new infrastructure.
  if (outcome === 'signed' && deskIntent && planNamesPolicyPool(deskIntent.plan)) {
    const txHash = extractTxHash(str(body.txUrl, 300)) ?? undefined
    const chainId = chainIdOfTurn({ chain: str(body.chain, 40), txUrl: str(body.txUrl, 300) }, body.chainId) ?? policyPoolConfigChainId()
    if (chainId) {
      const base = {
        intentId: deskIntent.id,
        origin: policyPoolOriginFor(deskIntent.id, deskIntent.origin),
        ...(walletAddress ? { swapper: walletAddress } : {}),
        chainId,
        ...(txHash ? { txHash } : {}),
        ...(usd(body.valueUsd) ? { usd: usd(body.valueUsd) as number } : {}),
        meta: { turnId: row.id, internal: internalRun, verification: verification ?? null },
      }
      await recordPolicyPoolEvent({ kind: 'signed', ...base })
      if (verification === 'verified') await recordPolicyPoolEvent({ kind: 'mined', ...base })
    }
  }

  // FIVE-MILLION: a turn through a TENANT's desk-minted link books its `signed` +
  // `settled` rows on that tenant's blotter — only on a VERIFIED receipt (this
  // beacon is public; a forged one must write nothing to a firm's audit trail).
  // A receipt still unverified here is picked up by the statement's sweep once
  // the lazy re-check promotes it (lib/tenant/statement).
  if (outcome === 'signed' && verification === 'verified' && deskIntent?.tenantId) {
    await recordTenantTurn({
      tenantId: deskIntent.tenantId,
      deskKeyId: deskIntent.deskKeyId,
      intentId: deskIntent.id,
      turnId: row.id,
      wallet: walletAddress ?? null,
      valueUsd: usd(body.valueUsd) ?? null,
      buildPath: isBuildPath(body.buildPath) ? body.buildPath : null,
      stampedFeeBps: feeBps ?? null,
      chainId: chainIdOfTurn({ chain: str(body.chain, 40), txUrl: str(body.txUrl, 300) }, body.chainId),
      txHash: extractTxHash(str(body.txUrl, 300)),
      artifact: artifact ?? null,
      signers: await prisma.tenant.findUnique({ where: { id: deskIntent.tenantId }, select: { signers: true } }).then((t) => t?.signers ?? null).catch(() => null),
    })
  }

  // `internal` echoes the stamp so drills (and the harness) can assert their
  // rows can never read as growth.
  return NextResponse.json({ ok: true, ...(internalRun ? { internal: true } : {}), ...(verification ? { verification } : {}), ...(earned ? { earnedAnswers: earned } : {}) })
}

/** The desk intent bound to this sign link — its feed (lib/broker-origin: the
 *  "born from" half of the joint number), id, origin and plan — or null when
 *  the link was not desk-minted or the read failed. */
async function deskIntentForLink(slug: string): Promise<{ id: string; feed: OriginFeed | undefined; origin: ReturnType<typeof readOrigin>; plan: unknown; tenantId: string | null; deskKeyId: string | null } | null> {
  try {
    const intent = await prisma.brokerIntent.findFirst({ where: { linkSlug: slug }, select: { id: true, origin: true, plan: true, tenantId: true, deskKeyId: true } })
    if (!intent) return null
    const origin = readOrigin(intent.origin)
    return { id: intent.id, feed: origin?.feed, origin, plan: intent.plan, tenantId: intent.tenantId, deskKeyId: intent.deskKeyId }
  } catch {
    return null
  }
}

/** The configured policy pool's chain, or null — never throws (a half-configured env must not break a beacon). */
function policyPoolConfigChainId(): number | null {
  try {
    return policyPoolConfig()?.chainId ?? null
  } catch {
    return null
  }
}
