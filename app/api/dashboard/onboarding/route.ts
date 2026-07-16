import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Done-state signals for the dashboard "Get started" checklist — the pivot
 * flow (chat → guarded tx → fund-then-act job → embed), each read from what
 * the wallet has actually done rather than self-reported:
 *
 *  · chatted    — owns ≥1 chat (created on the first turn)
 *  · signedTx   — a durable signed-tx record on one of their messages
 *                 (meta.signed, written back after a wallet-signed artifact
 *                 confirms) OR a completed job that moved value — either way,
 *                 a guarded build made it through their wallet
 *  · fundedJob  — a completed job with a settlement-wait step: the runner
 *                 waited on a bridge/solver between their signatures, i.e. a
 *                 fund-then-act / cross-chain "lazy trade"
 *  · embedKey   — minted a publishable `yfe_` embed key
 */
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const [chat, embedKey, signedRows, jobRows] = await Promise.all([
    prisma.chat.findFirst({ where: { ownerAddress: addr }, select: { id: true } }),
    prisma.embedKey.findFirst({ where: { ownerAddress: addr, revoked: false }, select: { id: true } }),
    prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM messages m
        JOIN chats c ON c.id = m.chat_id
        WHERE c.owner_address = ${addr}
          AND jsonb_typeof(m.meta->'signed') = 'array'
          AND jsonb_array_length(m.meta->'signed') > 0
      ) OR EXISTS(
        SELECT 1 FROM jobs
        WHERE wallet = ${addr} AND status = 'done' AND COALESCE(value_usd, 0) > 0
      ) AS ok`,
    prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM jobs j
        WHERE j.wallet = ${addr} AND j.status = 'done'
          AND EXISTS(SELECT 1 FROM job_steps s WHERE s.job_id = j.id AND s.kind = 'wait')
      ) AS ok`,
  ])

  return NextResponse.json({
    chatted: !!chat,
    signedTx: signedRows[0]?.ok ?? false,
    fundedJob: jobRows[0]?.ok ?? false,
    embedKey: !!embedKey,
  })
}
