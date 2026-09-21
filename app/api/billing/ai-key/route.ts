import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import {
  byokEnabled,
  checkAnthropicKey,
  deleteInferenceKey,
  getInferenceKeyMeta,
  isByokSynthModel,
  looksLikeAnthropicKey,
  saveInferenceKey,
  updateInferenceKeyPrefs,
} from '@/lib/byok'
import { bumpAndCheckAiKeyWrite, clientIpFrom } from '@/lib/turn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Bring your own key (pricing v2). SIWE SESSION ONLY — never a Bearer `yf_`
// key: an API key minted for an agent must not be able to replace whose model
// account its owner's chat runs on. The key is proven with Anthropic's free
// count_tokens endpoint BEFORE it is stored, sealed at rest, and never
// returned again — every response carries `last4` and nothing else.
//
//   POST   { key, synthModel?, useForEmbeds? }  → check, seal, store
//   PATCH  { synthModel?, useForEmbeds? }        → preferences only
//   DELETE                                       → remove the key

const off = () =>
  NextResponse.json(
    { error: 'Bring-your-own-key isn’t switched on for this deployment yet (BYOK_KEY_SECRET is not set).' },
    { status: 503 },
  )

export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in with your wallet first.' }, { status: 401 })
  if (!byokEnabled()) return off()
  // Each save is an outbound call to Anthropic with a caller-supplied
  // credential — fence it so the route is never a key-testing oracle.
  if (await bumpAndCheckAiKeyWrite(clientIpFrom(req.headers), addr)) {
    return NextResponse.json({ error: 'That’s a lot of key changes in an hour — try again shortly.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (!looksLikeAnthropicKey(body.key)) {
    return NextResponse.json({ error: 'That doesn’t look like an Anthropic API key — they start with sk-ant-. (Never paste a wallet key here.)' }, { status: 400 })
  }
  if (body.synthModel !== undefined && !isByokSynthModel(body.synthModel)) {
    return NextResponse.json({ error: 'synthModel must be one of the listed models.' }, { status: 400 })
  }
  const key = body.key.trim()
  const checked = await checkAnthropicKey(key)
  if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 })
  try {
    await saveInferenceKey(addr, key, {
      ...(isByokSynthModel(body.synthModel) ? { synthModel: body.synthModel } : {}),
      ...(typeof body.useForEmbeds === 'boolean' ? { useForEmbeds: body.useForEmbeds } : {}),
    })
  } catch {
    return NextResponse.json({ error: 'The key checked out but could not be saved — try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, key: await getInferenceKeyMeta(addr) })
}

export async function PATCH(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in with your wallet first.' }, { status: 401 })
  if (!byokEnabled()) return off()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.synthModel !== undefined && !isByokSynthModel(body.synthModel)) {
    return NextResponse.json({ error: 'synthModel must be one of the listed models.' }, { status: 400 })
  }
  const found = await updateInferenceKeyPrefs(addr, {
    ...(isByokSynthModel(body.synthModel) ? { synthModel: body.synthModel } : {}),
    ...(typeof body.useForEmbeds === 'boolean' ? { useForEmbeds: body.useForEmbeds } : {}),
  }).catch(() => false)
  if (!found) return NextResponse.json({ error: 'No key is saved for this wallet.' }, { status: 404 })
  return NextResponse.json({ ok: true, key: await getInferenceKeyMeta(addr) })
}

export async function DELETE() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in with your wallet first.' }, { status: 401 })
  await deleteInferenceKey(addr).catch(() => {})
  return NextResponse.json({ ok: true, key: null })
}
