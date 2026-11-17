// The job pre-flight, driven through the REAL server (squad lane1, lane
// preflight, 2026-11-17). Read-only wallets, nothing signed, nothing
// broadcast; every request carries `x-yf-internal-run: 1`, and any job a
// funded wallet gets is canceled at the end.
//
//   BASE=http://localhost:4802 npx tsx scripts/jobs-preflight-drive.ts
//
// For each wallet shape (empty · funded on another chain only · funded) it
// sends compound asks through POST /api/chat and POST /api/jobs (dry run and
// real) and prints: was a job row created, the reply's words, the chips.
// Exit 1 when a wallet that cannot fund the first step ends with a job row.

import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import prisma from '../lib/db'
import { signSession } from '../lib/auth'

const BASE = process.env.BASE ?? 'http://localhost:4802'
const H = { 'content-type': 'application/json', 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' }

const WALLETS = {
  // The address of a key nobody holds.
  // (checksummed: a mis-checksummed address reads as no wallet at the chat route)
  empty: '0x000000000000000000000000000000000000deA1',
  // $300+ of USDT on Arbitrum with gas there, nothing on Base (scripts/drive-onboarding).
  elsewhere: '0x37dad9aee064f976e2b24f8f802089557a6a0293',
  // Deep money on every chain (scripts/drive-onboarding richEverywhere).
  funded: '0x0000000000000000000000000000000000000001',
} as const

const ASKS = [
  '2x Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop',
  'Fund Robinhood Chain with $12 from Base including gas, then buy $10 of AAPL',
  'deposit 13 usdc to hyperliquid, then long $12 of HYPE on hyperliquid',
  'swap 1 USDC for ETH on base, then swap 3 USDC for ETH on base',
]

type Turn = { reply?: string; error?: string; jobId?: string; jobToken?: string; buildPath?: string; clarify?: { question: string; options: { label: string; resume: string; fund?: unknown }[] }; job?: { id: string; status: string; failReason?: string | null; steps: { seq: number; status: string; title: string; result?: { error?: string; withheld?: boolean } | null }[] }; preflight?: { reply: string; clarify?: Turn['clarify'] }; created?: boolean; firstSignPreview?: { refused?: string; artifact?: unknown } }

const jobsOf = (wallet: string) => prisma.job.count({ where: { wallet: wallet.toLowerCase() } })
const chipsOf = (c: Turn['clarify']) => (c?.options ?? []).map((o) => `[${o.label}${o.fund ? ' (card)' : ''}] → ${o.resume}`)

async function main() {
  let bad = 0
  const cleanup: { id: string; wallet: string }[] = []
  for (const [shape, wallet] of Object.entries(WALLETS)) {
    const cookie = `yf_session=${await signSession(wallet.toLowerCase())}`
    for (const ask of ASKS) {
      console.log(`\n══ ${shape} (${wallet.slice(0, 8)}…) · ${ask}`)
      // ── chat ──
      const before = await jobsOf(wallet)
      const t0 = Date.now()
      const chat = (await fetch(`${BASE}/api/chat`, { method: 'POST', headers: H, body: JSON.stringify({ message: ask, walletAddress: wallet, activeServers: [], history: [] }) }).then((r) => r.json())) as Turn
      const chatMs = Date.now() - t0
      const after = await jobsOf(wallet)
      console.log(`  chat  ${chatMs}ms · buildPath=${chat.buildPath} · job row created: ${after > before ? 'YES ' + chat.jobId : 'no'}`)
      console.log(`        reply: ${(chat.reply ?? '').slice(0, 520)}`)
      for (const c of chipsOf(chat.clarify)) console.log(`        chip:  ${c}`)
      if (chat.jobId) {
        cleanup.push({ id: chat.jobId, wallet })
        const row = await prisma.job.findUnique({ where: { id: chat.jobId }, include: { steps: { orderBy: { seq: 'asc' } } } })
        const s0 = row?.steps[0]
        console.log(`        job: status=${row?.status} · step 1 "${s0?.title}" = ${s0?.status}${(s0?.result as { withheld?: boolean } | null)?.withheld ? ' (withheld)' : ''}${(s0?.result as { error?: string } | null)?.error ? ' · ' + String((s0?.result as { error?: string }).error).slice(0, 200) : ''}`)
        if (row?.status === 'failed') {
          bad += 1
          console.log('        ❌ a created job ended failed')
        }
        if (shape !== 'funded' && s0?.status !== 'offered') {
          bad += 1
          console.log('        ❌ a wallet that cannot sign step 1 got a job row')
        }
      }
      // ── /api/jobs dry run ──
      const dry = (await fetch(`${BASE}/api/jobs`, { method: 'POST', headers: { ...H, cookie }, body: JSON.stringify({ ask, dryRun: true }) }).then((r) => r.json())) as Turn
      console.log(`  api dry: preflight=${dry.preflight ? 'SHORT' : 'clear'} · step 1 preview=${dry.firstSignPreview?.refused ? 'refused: ' + dry.firstSignPreview.refused.slice(0, 120) : dry.firstSignPreview?.artifact ? 'built' : 'none'}`)
      // ── /api/jobs real ──
      const b2 = await jobsOf(wallet)
      const res = await fetch(`${BASE}/api/jobs`, { method: 'POST', headers: { ...H, cookie }, body: JSON.stringify({ ask }) })
      const api = (await res.json()) as Turn
      const a2 = await jobsOf(wallet)
      console.log(`  api   HTTP ${res.status} · job row created: ${a2 > b2 ? 'YES ' + api.job?.id : 'no'}${api.created === false ? ' (created: false)' : ''}`)
      if (api.error) console.log(`        error: ${api.error.slice(0, 520)}`)
      for (const c of chipsOf(api.clarify)) console.log(`        chip:  ${c}`)
      if (api.job) {
        cleanup.push({ id: api.job.id, wallet })
        const s0 = api.job.steps[0]
        console.log(`        job: status=${api.job.status} · step 1 "${s0?.title}" = ${s0?.status}${s0?.result?.withheld ? ' (withheld)' : ''}${s0?.result?.error ? ' · ' + s0.result.error.slice(0, 200) : ''}`)
        if (api.job.status === 'failed') {
          bad += 1
          console.log('        ❌ a created job ended failed')
        }
        if (shape !== 'funded' && s0?.status !== 'offered') {
          bad += 1
          console.log('        ❌ a wallet that cannot sign step 1 got a job row')
        }
      }
    }
  }
  // Leave nothing behind: every job this drive created is canceled, then removed.
  for (const j of cleanup) {
    await prisma.job.updateMany({ where: { id: j.id, wallet: j.wallet.toLowerCase() }, data: { status: 'canceled' } })
  }
  console.log(`\n${cleanup.length} job(s) created by this drive were canceled. ${bad === 0 ? 'PASS' : `FAIL (${bad})`}: no short wallet ended with a job row, and no created job ended failed.`)
  await prisma.$disconnect()
  process.exit(bad ? 1 : 0)
}

void main()
