import { NextRequest, NextResponse } from 'next/server'
import { getBearerKey } from '@/lib/api-key'
import { orgScopeKey } from '@/lib/org'
import { agentSpentTodayUsd } from '@/lib/grant-store'
import { streamAutoRouter, sanitizeHistory } from '@/app/api/chat/route'

// x402 signing + paid fetch (inside the engine) need the Node runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Engine-as-a-service (B9a). The same routing engine the chat uses, exposed to
 * API-key holders (agents) — so an embedding agent gets the chat's NL→MCP
 * usefulness. Bearer-only; house-paid (burner); streams the SAME SSE wire
 * contract as the chat's Auto-Router (status/analyze/candidate/select/pay/
 * receipt/note/reply/error/done).
 *
 * Controls are real: the call is gated by the key's kill switch + its owner/org
 * spend grant (host allowlist + per-day cap, enforced inside the engine) + a
 * best-effort per-key daily-budget pre-gate. NO custody — the SDK thin client +
 * in-path settlement are B9b (pending the settlement-mechanism decision).
 */
export async function POST(req: NextRequest) {
  const key = await getBearerKey(req)
  if (!key) return NextResponse.json({ error: 'Bearer yf_… key required.' }, { status: 401 })
  if (key.paused) {
    return NextResponse.json({ error: 'This agent is paused.', halted: 'AGENT_PAUSED' }, { status: 403 })
  }

  let body: { message?: unknown; history?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  // Per-key daily-budget pre-gate (best-effort: against the key's attributed
  // ledger; attributing the routed spend back to the key is a follow-up). The
  // grant's allowlist + per-day cap are the hard gate, enforced in the engine.
  if (key.perDayUsd != null) {
    const spent = await agentSpentTodayUsd(key.id)
    if (spent >= key.perDayUsd) {
      return NextResponse.json({ error: 'Agent daily budget reached.', overBudget: true }, { status: 402 })
    }
  }

  // Spend scope = the org's (org key) or the key owner's. Burner mode (no wallet
  // signing over an API). Returns the streamed Response.
  const owner = key.orgId ? orgScopeKey(key.orgId) : key.ownerAddress
  return streamAutoRouter(message, sanitizeHistory(body.history), undefined, owner)
}
