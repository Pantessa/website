// scripts/broker-exec-drill.ts — the x402-payer drill: an agent that SIGNS.
//
// Plays an external agent holding its own key (the same kind that signs
// x402 payments): opens an ask at the desk, picks a funding option when the
// desk offers one, personal_signs the execute consent, calls broker_execute,
// then drives the job leg by leg off the job API — polling until the runner
// builds the current leg, printing the guarded artifact's SHAPE (never the
// bytes), signing locally, and (only with LIVE=1) broadcasting + posting
// completion so the runner's wait leg can verify arrival and release the
// next leg.
//
// The three signable shapes the runner emits, driven here exactly as the
// `pantessa` SDK's driveJob does (agent-desk squad C1/C2, DRIVE.md):
//   txRequest    one EVM tx → sign + broadcast → complete { txHash, chainId }
//   txChain      N EVM txs; a step the recipe marks is re-quoted first
//                (POST /api/tx/refresh) → complete with the LAST hash
//   orderRequest a Hyperliquid step: `batch` = [leverage?, order] signed in
//                ONE pass and submitted in order via POST /api/hl/submit
//                (mode direct); a failed member stops the batch and the
//                runner re-offers from it → complete { batch: [...] }
//
// DRY by default: with a fresh throwaway key the first build refuses on
// real balances — which IS the demo of the guard posture. LIVE=1 with a
// funded AGENT_KEY runs the real sequenced flow and moves REAL money.
//
//   BASE=http://localhost:3861 npx tsx scripts/broker-exec-drill.ts \
//     ["2x long $12 of HYPE on hyperliquid"]
//   AGENT_KEY=0x… LIVE=1 …            # the real thing — owner's call
//   OPTION=fund-1                     # pick a desk option before executing
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, http, type Hex } from 'viem'
import { deskExecuteConsentMessage } from '../lib/broker-exec'
import { chainById } from '../lib/chains'
import { receiptClientFor } from '../lib/link-receipt-verify'
import { hlBatchStaleAfterMs, type HlBatchMember, type HlBatchMemberResult } from '../lib/hl-batch'

const BASE = (process.env.BASE ?? 'http://localhost:3000').replace(/\/$/, '')
const LIVE = process.env.LIVE === '1'
const KEY = (process.env.AGENT_KEY ?? generatePrivateKey()) as `0x${string}`
const account = privateKeyToAccount(KEY)
const ASK =
  process.argv[2] ??
  `swap 1 USDC for ETH on base, then send 0.5 USDC on base to ${account.address}`
const OPTION = process.env.OPTION ?? ''
const MAX_TICKS = Number(process.env.MAX_TICKS ?? '120')
const INTERNAL_HEADERS = { 'x-yf-internal-run': '1' }

function say(who: 'desk' | 'agent' | 'jobapi' | 'chain' | 'venue', text: string) {
  const tag =
    who === 'desk' ? '\x1b[32m[desk  ]\x1b[0m'
    : who === 'jobapi' ? '\x1b[33m[jobapi]\x1b[0m'
    : who === 'chain' ? '\x1b[35m[chain ]\x1b[0m'
    : who === 'venue' ? '\x1b[34m[venue ]\x1b[0m'
    : '\x1b[36m[agent ]\x1b[0m'
  console.log(`${tag} ${text}`)
}

function parsePayload(res: unknown): Record<string, unknown> {
  const r = res as { content?: { type: string; text?: string }[]; isError?: boolean }
  const text = r.content?.find((c) => c.type === 'text')?.text ?? ''
  if (r.isError) throw new Error(`desk refused: ${text}`)
  if (/0x[0-9a-fA-F]{64,}/.test(text)) throw new Error('LEAK: MCP surface returned raw hex material.')
  return JSON.parse(text)
}

/** Describe an artifact without printing its bytes. */
function shapeOf(artifact: unknown): string {
  if (!artifact || typeof artifact !== 'object') return 'none yet'
  const a = artifact as Record<string, unknown>
  const keys = Object.keys(a)
  const chain = (a.chainId ?? (a.txRequest as { chainId?: unknown } | undefined)?.chainId ?? (a.txChain as { steps?: { tx?: { chainId?: unknown } }[] } | undefined)?.steps?.[0]?.tx?.chainId ?? (a.orderRequest ? 1337 : '?')) as string | number
  const batch = (a.orderRequest as { batch?: unknown[] } | undefined)?.batch
  return `{${keys.slice(0, 6).join(', ')}} on chain ${chain}${Array.isArray(batch) ? ` · batch of ${batch.length} [${batch.map((m) => (m as { kind: string }).kind).join(' → ')}]` : ''}`
  // deliberately no values — the drill treats bytes as radioactive
}

type EvmTx = { to: string; data?: string; value?: string; chainId: number }
type LegResult = Record<string, unknown>

async function broadcast(tx: EvmTx, label: string): Promise<Hex> {
  const chain = chainById(tx.chainId)
  if (!chain) throw new Error(`no registry chain ${tx.chainId}`)
  const wallet = createWalletClient({ account, chain: chain.viem, transport: http() })
  const hash = await wallet.sendTransaction({
    to: tx.to as `0x${string}`,
    data: (tx.data ?? '0x') as Hex,
    value: BigInt(tx.value ?? '0'),
  })
  say('chain', `${label}: broadcast ${hash} on ${chain.name}`)
  const receipts = receiptClientFor(tx.chainId)
  if (!receipts) throw new Error(`no receipt client for chain ${tx.chainId}`)
  const receipt = await receipts.waitForTransactionReceipt({ hash, timeout: 180_000 })
  say('chain', `${label}: ${receipt.status} in block ${receipt.blockNumber} (gas ${receipt.gasUsed})`)
  if (receipt.status !== 'success') throw new Error(`${label} reverted on-chain (${hash})`)
  return hash
}

/** txChain: re-quote the recipe's step right before signing it, then send each tx in order. */
async function driveTxChain(chain: { steps: { tx: EvmTx; label?: string; validUntil?: number | null }[]; refresh?: { kind: string; stepIndex: number; params: Record<string, unknown> } }): Promise<LegResult> {
  let last: Hex | null = null
  let chainId = 0
  for (let i = 0; i < chain.steps.length; i++) {
    let tx = chain.steps[i].tx
    const label = chain.steps[i].label ?? `tx ${i + 1}/${chain.steps.length}`
    if (chain.refresh && chain.refresh.stepIndex === i) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}/api/tx/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...INTERNAL_HEADERS },
          body: JSON.stringify({ kind: chain.refresh.kind, ...chain.refresh.params, from: account.address }),
        })
        const fresh = (await res.json()) as { tx?: EvmTx; pending?: boolean; blocked?: boolean; reasons?: string; error?: string; note?: string }
        if (fresh.tx) { tx = fresh.tx; say('agent', `${label}: re-quoted through /api/tx/refresh (${chain.refresh.kind})`); break }
        if (fresh.pending && attempt < 8) { say('agent', `${label}: refresh pending — ${fresh.note ?? ''}; waiting`); await sleep(5000); continue }
        throw new Error(`${label}: refresh ${fresh.blocked ? 'blocked' : 'failed'}: ${fresh.reasons ?? fresh.error ?? fresh.note ?? 'no tx'}`)
      }
    }
    last = await broadcast(tx, label)
    chainId = tx.chainId
  }
  if (!last) throw new Error('empty txChain')
  return { txHash: last, chainId }
}

/** orderRequest.batch: sign every member in one pass, submit in order, stop at the first failure. */
async function driveHlBatch(orderRequest: { batch?: HlBatchMember[]; hl?: { isTestnet?: boolean; feeApproval?: unknown } }): Promise<LegResult | null> {
  const batch = orderRequest.batch
  if (!Array.isArray(batch) || batch.length === 0) {
    say('agent', orderRequest.hl?.feeApproval ? 'this order needs a one-time builder-fee approval first (hl.feeApproval) — the v1 drill does not sign that; stopping.' : 'no batch on this order request — stopping.')
    return null
  }
  const left = hlBatchStaleAfterMs(batch)
  if (left <= 0) {
    say('agent', `batch nonce is stale (${-left}ms past the window) — asking the runner for a fresh build`)
    return { stale: true }
  }
  say('agent', `signing ${batch.length} member(s) in one pass: ${batch.map((m) => m.kind).join(' → ')} (${Math.round(left / 1000)}s left in the nonce window)`)
  const signatures: Hex[] = []
  for (const m of batch) {
    const td = m.typedData as { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }
    signatures.push(await account.signTypedData(td as unknown as Parameters<typeof account.signTypedData>[0]))
  }
  const results: HlBatchMemberResult[] = []
  for (let i = 0; i < batch.length; i++) {
    const m = batch[i]
    const res = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...INTERNAL_HEADERS },
      body: JSON.stringify({ mode: 'direct', action: m.action, nonce: m.nonce, signature: signatures[i], from: account.address, isTestnet: orderRequest.hl?.isTestnet === true, expected: m.expected }),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      say('venue', `member ${i + 1} (${m.kind}) REFUSED: ${String(body.error ?? res.status)}`)
      results.push({ ok: false, error: String(body.error ?? `HTTP ${res.status}`) })
      break
    }
    say('venue', `member ${i + 1} (${m.kind}) ok: ${JSON.stringify(body).slice(0, 200)}`)
    results.push({ ok: true, orderResponse: body })
  }
  return { batch: results }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  say('agent', `I am ${account.address} (${LIVE ? 'LIVE — will broadcast' : 'DRY — will not broadcast'})`)
  say('agent', `ask: "${ASK}"`)

  const client = new Client({ name: 'payer-agent', version: '0.2.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/broker/mcp`), { requestInit: { headers: INTERNAL_HEADERS } }))

  let open = parsePayload(
    await client.callTool({
      name: 'broker_open',
      // agent_key binds the desk identity (M1); the wallet is PROVEN below by
      // signing the desk's consent text with this same key.
      arguments: { ask: ASK, wallet: account.address, agent: 'payer-agent', agent_key: 'payer-agent-drill-key' },
    }),
  )
  const intentId = open.intentId as string
  const plan = open.plan as { say: string; options: { id: string; label: string; resume: string; kind: string }[] }
  say('desk', plan.say)
  for (const o of plan.options) say('desk', `  option ${o.id} [${o.kind}]: ${o.label} → "${o.resume}"`)
  if (OPTION) {
    open = parsePayload(await client.callTool({ name: 'broker_choose', arguments: { intent_id: intentId, option_id: OPTION } }))
    say('agent', `chose ${OPTION} → working ask "${(open.plan as { ask: string }).ask}"`)
  }

  const walletSignature = await account.signMessage({ message: deskExecuteConsentMessage(intentId, account.address) })
  const exec = parsePayload(
    await client.callTool({ name: 'broker_execute', arguments: { intent_id: intentId, wallet_signature: walletSignature } }),
  )
  const steps = exec.steps as { seq: number; kind: string; note: string }[]
  say('desk', exec.say as string)
  for (const s of steps) say('desk', `  leg ${s.seq}: [${s.kind}] ${s.note}`)
  const drive = exec.drive as { poll: string; complete: string }
  const pollUrl = drive.poll.replace(/^https?:\/\/[^/]+/, BASE)
  const completeUrl = drive.complete.replace(/^https?:\/\/[^/]+/, BASE)
  const retryUrl = completeUrl.replace(/\/complete\?/, '/retry?')

  const complete = async (seq: number, result: LegResult) => {
    const res = await fetch(completeUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...INTERNAL_HEADERS }, body: JSON.stringify({ seq, result }) })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    say('jobapi', `complete leg ${seq} → ${res.status} ${body.ok ? 'ok' : body.error ?? ''}`)
    if (!res.ok) throw new Error(`complete refused: ${body.error ?? res.status}`)
  }

  // Drive loop: poll until the current leg is offered, handle it, repeat.
  let lastSeen = ''
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    const { job } = (await (await fetch(pollUrl, { headers: INTERNAL_HEADERS })).json()) as {
      job: {
        status: string
        currentStep: number
        steps: { seq: number; kind: string; status: string; title: string; artifact?: Record<string, unknown>; result?: Record<string, unknown> }[]
        failReason?: string
      }
    }
    const cur = job.steps?.find((s) => s.seq === job.currentStep)
    const line = `job ${job.status} · leg ${job.currentStep}: ${cur ? `[${cur.kind}] ${cur.title} (${cur.status})` : '—'}`
    if (line !== lastSeen) { say('jobapi', line); lastSeen = line }

    if (job.status === 'done') { say('agent', 'all legs settled. 🤝'); break }
    if (job.status === 'failed') { say('jobapi', `failed closed: ${job.failReason ?? 'see step'}`); break }
    if (job.status === 'canceled') { say('jobapi', 'canceled'); break }

    if (cur?.kind === 'sign' && cur.status === 'offered' && cur.artifact) {
      say('jobapi', `guarded artifact ready: ${shapeOf(cur.artifact)}`)
      if (!LIVE) {
        say('agent', 'DRY — I would sign and broadcast this leg with my own key, then POST completion. Stopping here.')
        break
      }
      const a = cur.artifact
      let result: LegResult | null = null
      if (a.orderRequest && typeof a.orderRequest === 'object') {
        result = await driveHlBatch(a.orderRequest as Parameters<typeof driveHlBatch>[0])
        if (!result) break
        if (result.stale) {
          const r = await fetch(retryUrl, { method: 'POST', headers: INTERNAL_HEADERS })
          say('jobapi', `refresh (retry route) → ${r.status}`)
          await sleep(3000)
          continue
        }
      } else if (a.txChain && typeof a.txChain === 'object') {
        result = await driveTxChain(a.txChain as Parameters<typeof driveTxChain>[0])
      } else if (a.txRequest && typeof a.txRequest === 'object') {
        const tx = a.txRequest as EvmTx
        result = { txHash: await broadcast(tx, cur.title), chainId: tx.chainId }
      } else {
        say('agent', `unknown artifact shape {${Object.keys(a).join(', ')}} — stopping before anything is signed.`)
        break
      }
      await complete(cur.seq, result)
      await sleep(1500)
      continue
    }
    if (cur?.kind === 'sign' && cur.status === 'pending' && cur.result?.error) {
      say('jobapi', `leg ${cur.seq} withheld: ${String(cur.result.error).slice(0, 200)}`)
    }
    if (cur?.kind === 'wait') say('agent', 'runner is verifying on-chain arrival before releasing the next leg…')
    await sleep(5000)
  }

  const status = parsePayload(await client.callTool({ name: 'broker_status', arguments: { intent_id: intentId } }))
  say('desk', `status: ${status.state} — ${status.say}`)

  if (process.env.KEEP === '1' || (LIVE && status.state !== 'closed')) {
    say('agent', `job stays live (intent ${intentId}) — a LIVE run never cancels what it signed.`)
  } else {
    const closed = parsePayload(await client.callTool({ name: 'broker_close', arguments: { intent_id: intentId } }))
    say('agent', `cleaned up: ${closed.say}`)
  }
  await client.close()
}

main().catch((e) => {
  console.error(`❌ exec drill failed: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
