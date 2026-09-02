import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { mintSlug } from '@/lib/intent-links'
import { isInternalRun } from '@/lib/internal-run'
import { cleanCapUsd, parseMandate } from '@/lib/roster'
import { logRosterRefusal } from '@/lib/roster-observe'
import {
  assertRosterOpen,
  bumpAndCheckRosterPost,
  cleanMandateInput,
  clientIpFrom,
  ROSTER_DRAFT_TTL_MS,
  ROSTER_MAX_SLOTS_PER_WALLET,
  ROSTER_RATE_WALL,
} from '@/lib/roster-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// THE ROSTER (R1): a wallet's mandate slots. Policy fences come whole from
// lib/roster-policy.ts (security CONTRACTS v1) — never re-implemented here.
//
// GET ?wallet=0x… — public by address (the inbox pattern, rule 6): serves
// HIRED/BENCHED slots only — never 'pending' drafts (threat T1: a squatter's
// junk must not show on anyone's public roster) and never consent nonces.
// A SIWE session matching the wallet sees its own drafts + fired history.
// GET stays open with the kill switch off: a user can always SEE and fire.
//
// POST { wallet, mandate, capUsd? } — connect-to-act draft mint. The row is
// INERT ('pending'): publishes nowhere, addresses nothing, self-cleans after
// 24h unhired. Only a sentence that round-trips its executor's grammar is
// ever stored (parseMandate returns the CANONICAL recompose — threat T2);
// garbage refuses by name. Stamped is_internal via lib/internal-run.

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

const PUBLIC_SELECT = {
  id: true,
  walletAddress: true,
  mandateText: true,
  mandateKind: true,
  agentKeyHash: true,
  capUsd: true,
  status: true,
  isInternal: true,
  createdAt: true,
} as const

export async function GET(req: NextRequest) {
  const wallet = (req.nextUrl.searchParams.get('wallet') ?? '').trim()
  if (!WALLET_RE.test(wallet)) return NextResponse.json({ error: 'Bad wallet.' }, { status: 400 })
  const w = wallet.toLowerCase()
  const session = await getAuthAddress(req).catch(() => null)
  const ownerView = session?.toLowerCase() === w
  const slots = await prisma.rosterSlot
    .findMany({
      where: { walletAddress: w, ...(ownerView ? {} : { status: { in: ['hired', 'benched'] } }) },
      select: PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    .catch(() => [])
  return NextResponse.json({ slots, ownerView })
}

export async function POST(req: NextRequest) {
  try {
    assertRosterOpen('create')
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }

  let body: { wallet?: unknown; mandate?: unknown; capUsd?: unknown; preview?: unknown; internalRun?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  // Hygiene BEFORE any grammar runs (T2/T7): NFKC, control-strip, refuse —
  // never truncate — over-length input. Then the four-grammar ladder; only
  // its canonical recompose is ever stored.
  let cleaned: string
  try {
    cleaned = cleanMandateInput(body.mandate)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  const parsed = parseMandate(cleaned)

  // Preview mode: the composer's live validation. The server runs the ONE
  // parser (the grammar chain is server-only — the client never forks it);
  // nothing is written, so the rate fence's bump above is the only cost.
  // Previews never log a failure — a half-typed sentence is not a wall.
  if (body.preview === true) {
    if ('problem' in parsed) return NextResponse.json({ preview: { problem: parsed.problem } })
    return NextResponse.json({ preview: { kind: parsed.kind, mandateText: parsed.mandateText, summary: parsed.summary } })
  }
  if ('problem' in parsed) {
    // Observability (doors run): a REAL mint attempt that the grammar
    // refused is exactly the premortem's invisible mode — log it.
    logRosterRefusal(req.headers, {
      surface: 'mandate',
      ask: cleaned,
      wallet: typeof body.wallet === 'string' ? body.wallet : null,
      error: parsed.problem,
    })
    return NextResponse.json({ error: parsed.problem }, { status: 400 })
  }

  // The write fence sits AFTER the preview branch: previews write nothing
  // and parse ≤300 anchored-regex chars, so they don't spend the hourly
  // bucket a real mint needs (deviation from CONTRACTS v1 §3 noted for
  // security re-baseline in squad-overnight-2026-08-25/uiux.md).
  if (await bumpAndCheckRosterPost(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: ROSTER_RATE_WALL }, { status: 429 })
  }

  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''
  if (!WALLET_RE.test(wallet)) return NextResponse.json({ error: 'Bad wallet.' }, { status: 400 })
  const w = wallet.toLowerCase()

  const cap = cleanCapUsd(body.capUsd)
  if (typeof cap === 'object') return NextResponse.json({ error: cap.problem }, { status: 400 })

  const internalRun = isInternalRun(req.headers, body)

  // Opportunistic self-clean: unhired drafts die after the draft TTL (the
  // pending-delegation pattern) — a squatter's junk never accumulates.
  // LISTED slots are exempt: the list consent is the owner's signature, so
  // a listed slot is a proven job listing, not a squattable draft (T-D2).
  void prisma.rosterSlot
    .deleteMany({ where: { status: 'pending', listed: false, createdAt: { lt: new Date(Date.now() - ROSTER_DRAFT_TTL_MS) } } })
    .catch(() => {})

  // Standing squat fence (security finding R2-1): the quota counts ONLY the
  // states that required the wallet's own signature (hired/benched) — a
  // squatter's connect-to-act drafts must never block the true owner.
  const held = await prisma.rosterSlot.count({ where: { walletAddress: w, status: { in: ['hired', 'benched'] } } }).catch(() => 0)
  if (held >= ROSTER_MAX_SLOTS_PER_WALLET) {
    return NextResponse.json(
      { error: `This wallet already holds ${held} staffed roster slots (the cap is ${ROSTER_MAX_SLOTS_PER_WALLET}) — fire one first.` },
      { status: 409 },
    )
  }
  // Pending drafts are bounded by ROLLING-DELETE-OLDEST, never refusal
  // (R2-1): the true owner can always draft; a squatter only ever churns
  // their own junk out of the window.
  // LISTED slots never evict here either — otherwise a squatter flooding
  // drafts could churn the owner's SIGNED public listing out of the window.
  const pending = await prisma.rosterSlot
    .findMany({ where: { walletAddress: w, status: 'pending', listed: false }, select: { id: true }, orderBy: { createdAt: 'asc' } })
    .catch(() => [] as { id: string }[])
  if (pending.length >= ROSTER_MAX_SLOTS_PER_WALLET) {
    const evict = pending.slice(0, pending.length - ROSTER_MAX_SLOTS_PER_WALLET + 1).map((p) => p.id)
    await prisma.rosterSlot.deleteMany({ where: { id: { in: evict }, status: 'pending', listed: false } }).catch(() => {})
  }

  const slot = await prisma.rosterSlot.create({
    data: {
      id: mintSlug(10),
      walletAddress: w,
      mandateText: parsed.mandateText,
      mandateKind: parsed.kind,
      capUsd: cap,
      status: 'pending',
      isInternal: internalRun,
    },
    select: PUBLIC_SELECT,
  })

  return NextResponse.json({ slot, summary: parsed.summary, ...(internalRun ? { internal: true } : {}) })
}
