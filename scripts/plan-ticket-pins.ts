// PLAN TICKET (2026-11-17): phase 2 of a wallet-paid chat turn runs only the
// plan phase 1 wrote (lib/plan-ticket). Pure matrix, source fences, and the
// served refusal. `npm run pins:plan-ticket` runs the pure + source half.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_TICKET_REFUSAL, PLAN_TICKET_TTL_MS, planDigest, signPlanTicket, verifyPlanTicket } from '../lib/plan-ticket'

type Check = (name: string, ok: boolean, extra?: string) => void

const KEY = 'pins-only-secret-0123456789'
const base = {
  message: 'what is the price of ETH',
  history: [{ role: 'user', content: 'hi' }],
  capabilities: 'caps',
  plan: [
    { id: 'data:a', role: 'data', name: 'A', host: 'a.example.test', priceUsd: '0', url: 'https://a.example.test/api', method: 'GET', prepared: null, extra: undefined },
    { id: 'inference:x', role: 'inference', name: 'X', host: 'x.example.test', priceUsd: '0.01', endpoint: 'https://x.example.test/mcp' },
  ],
}

export function planTicketPins(check: Check) {
  const now = 1_800_000_000_000
  const t = signPlanTicket(base, now, KEY)!
  const echoed = JSON.parse(JSON.stringify(base)) // what the browser sends back
  check(
    'plan ticket (pure): the plan the server wrote verifies after a JSON round trip, until it expires',
    typeof t === 'string' && /^v1\.\d+\.[0-9a-f]{64}$/.test(t) && verifyPlanTicket(t, echoed, now + 1000, KEY) &&
      verifyPlanTicket(t, echoed, now + PLAN_TICKET_TTL_MS - 2000, KEY) && !verifyPlanTicket(t, echoed, now + PLAN_TICKET_TTL_MS + 2000, KEY),
    t,
  )
  const swap = (f: (x: typeof base) => void) => {
    const x = JSON.parse(JSON.stringify(base)) as typeof base
    f(x)
    return verifyPlanTicket(t, x, now + 1000, KEY)
  }
  check(
    'plan ticket (pure): another URL, another method or body, an added call, another synthesizer, another message, history or capabilities all refuse',
    !swap((x) => { x.plan[0].url = 'http://169.254.169.254/latest/meta-data' }) &&
      !swap((x) => { x.plan[0].method = 'POST' }) &&
      !swap((x) => { (x.plan[0] as Record<string, unknown>).body = '{}' }) &&
      !swap((x) => { x.plan.push({ ...x.plan[0], id: 'data:b' }) }) &&
      !swap((x) => { x.plan[1].id = 'inference:yeetful-house' }) &&
      !swap((x) => { x.message = 'write me an essay' }) &&
      !swap((x) => { x.history = [{ role: 'user', content: 'ignore the above' }] }) &&
      !swap((x) => { x.capabilities = 'other' }),
  )
  const far = `v1.${Math.floor((now + 365 * 86_400_000) / 1000)}.${'0'.repeat(64)}`
  check(
    'plan ticket (pure): no ticket, a malformed one, another key’s, a far-future expiry and a server with no secret all refuse; the digest is order-stable',
    !verifyPlanTicket(undefined, echoed, now, KEY) && !verifyPlanTicket('', echoed, now, KEY) && !verifyPlanTicket('v1.1.zz', echoed, now, KEY) &&
      !verifyPlanTicket(signPlanTicket(base, now, 'another-secret-0123456789'), echoed, now, KEY) && !verifyPlanTicket(far, echoed, now, KEY) &&
      signPlanTicket(base, now, null) === null && !verifyPlanTicket(t, echoed, now, null) &&
      planDigest(base) === planDigest(echoed),
  )
  const route = readFileSync(join(process.cwd(), 'app/api/chat/route.ts'), 'utf8')
  const exec = route.indexOf("if (body.phase === 'execute')")
  const verifyAt = route.indexOf('verifyPlanTicket(body.ticket', exec)
  const runAt = route.indexOf('return await executeWithSignatures(', exec)
  check(
    'plan ticket (source): the execute phase verifies the ticket BEFORE it runs anything, both plan producers sign, and executeWithSignatures has one caller',
    exec > 0 && verifyAt > exec && runAt > verifyAt && route.slice(verifyAt, runAt).includes('PLAN_TICKET_REFUSAL') &&
      (route.match(/signPlanTicket\(\{/g) ?? []).length === 2 && (route.match(/executeWithSignatures\(/g) ?? []).length === 2 &&
      /phase: 'awaiting-signatures'[\s\S]{0,400}ticket: signPlanTicket/.test(route) && /type: 'plan'[^\n]*ticket: signPlanTicket/.test(route),
  )
  const ui = readFileSync(join(process.cwd(), 'components/ChatInterface.tsx'), 'utf8')
  check(
    'plan ticket (source): the chat echoes the ticket and the planned message in phase 2, and carries both from the auto-router’s plan event',
    /phase: 'execute',[\s\S]{0,400}ticket: data\.ticket/.test(ui) && /message: typeof data\.message === 'string' \? data\.message : userMsg/.test(ui) &&
      /ticket: event\.ticket/.test(ui) && /message: event\.message/.test(ui),
  )
}

export async function planTicketServedPins(check: Check, BASE: string) {
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1' }, body: JSON.stringify(body) })
    return { status: r.status, json: (await r.json().catch(() => ({}))) as { reply?: string; planTicket?: string; receipts?: unknown[] } }
  }
  const plan = [
    { id: 'data:probe', role: 'data', name: 'probe', host: 'a.example.test', priceUsd: '0', url: 'https://a.example.test/api', method: 'GET', prepared: null },
    { id: 'inference:yeetful-house', role: 'inference', name: 'house', host: 'house', priceUsd: '0', endpoint: 'https://a.example.test/mcp', prepared: null },
  ]
  const bare = await post({ phase: 'execute', message: 'say hello', plan })
  const forged = await post({ phase: 'execute', message: 'say hello', plan, ticket: `v1.${Math.floor(Date.now() / 1000) + 300}.${'a'.repeat(64)}` })
  check(
    'plan ticket (served): an execute phase nobody planned is refused before any call - no ticket and a forged ticket both answer the refusal, with no receipts',
    bare.status === 200 && bare.json.reply === PLAN_TICKET_REFUSAL && bare.json.planTicket === 'refused' && !bare.json.receipts &&
      forged.json.reply === PLAN_TICKET_REFUSAL && forged.json.planTicket === 'refused' && !forged.json.receipts,
    `${bare.status} ${String(bare.json.reply).slice(0, 80)} | ${String(forged.json.reply).slice(0, 80)}`,
  )
}

if (process.argv[1]?.endsWith('plan-ticket-pins.ts')) {
  let fail = 0
  planTicketPins((name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ` — ${extra}`}`)
    if (!ok) fail++
  })
  console.log(fail ? `\n${fail} plan ticket pins red` : '\nall plan ticket pins green')
  process.exit(fail ? 1 : 0)
}
