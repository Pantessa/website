// npm run drive:prints — the print alerts end to end against a running
// server (BASE, default http://localhost:3000) on the TEST DB, with the
// .env.local burner (PRIVATE_KEY) and CRON_SECRET from the same file:
//
//   1. SIWE as the burner.
//   2. Arm "big print ≥ $10K on any market" over hypercore (every request
//      carries x-yf-internal-run: 1, so the row is is_internal and never
//      counts anywhere).
//   3. Run the cron against the LIVE feed: a cold pass opens at the tip and
//      seeds the cursor (it reads only its settle window — a quiet pass).
//   4. Wait a minute, then run the cron ONCE more: the pass resumes strictly
//      after the stored cursor and consumes the whole minute it missed
//      (what it consumed: cursor in/out, frames, fills, how far behind,
//      the outcome) and what fired. A quiet minute is reported as such,
//      never faked.
//   5. Read the bell's own path (/api/alerts/notifications) for the firing:
//      a past-tense sentence with measured numbers, the venue, the chip only
//      when the venue gate passed it.
//   6. The deterministic half: a fixture fill through the same cron proves
//      the path when the minute was quiet.
//   7. Clean up: the rule deleted, the notifications dismissed.
// Nothing here signs or sends a trade.
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const env = (() => {
  try {
    return readFileSync('.env.local', 'utf8')
  } catch {
    return ''
  }
})()
const envGet = (k: string) => process.env[k] ?? env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? null
const PRIVATE_KEY = envGet('PRIVATE_KEY')
const CRON_SECRET = envGet('CRON_SECRET')
if (!PRIVATE_KEY || !CRON_SECRET) {
  console.error('drive:prints needs PRIVATE_KEY and CRON_SECRET (env or .env.local)')
  process.exit(2)
}

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}
const INTERNAL = { 'x-yf-internal-run': '1' }
const J = { 'content-type': 'application/json', ...INTERNAL }

function getCookie(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
  console.log(`drive:prints → ${BASE} as ${account.address.slice(0, 6)}…${account.address.slice(-4)}`)
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`, { headers: INTERNAL })
  const nonceCookie = getCookie(nonceRes, 'yf_siwe_nonce')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
  const signature = await account.signMessage({ message })
  const verify = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { ...J, ...(nonceCookie ? { cookie: nonceCookie } : {}) }, body: JSON.stringify({ message, signature }) })
  const session = getCookie(verify, 'yf_session')
  check('1. SIWE as the burner', !!session, `${verify.status}`)
  if (!session) process.exit(1)
  const H = { ...J, cookie: session }
  const cronH = { ...J, authorization: `Bearer ${CRON_SECRET}` }

  // Residue from an earlier run: start from none.
  const before = (await (await fetch(`${BASE}/api/print-alerts`, { headers: H })).json()) as { alerts: { id: string }[] }
  for (const a of before.alerts) await fetch(`${BASE}/api/print-alerts?id=${a.id}`, { method: 'DELETE', headers: H })

  const armRes = await fetch(`${BASE}/api/print-alerts`, { method: 'POST', headers: H, body: JSON.stringify({ rule: 'big-print', market: null, venues: ['hypercore'], bigPrintUsd: 10000 }) })
  const armed = ((await armRes.json()) as { alert: { id: string; status: string; thresholds: { bigPrintUsd: number } } }).alert
  check('2. armed "big print ≥ $10K on any market" over hypercore', armRes.status === 201 && armed?.status === 'active' && armed.thresholds.bigPrintUsd === 10000, `${armRes.status} ${armed?.id}`)

  type Sweep = {
    elapsedMs: number
    evaluated: number
    venues: { venue: string; cursorIn: string | null; cursorOut: string | null; resumed: boolean; outcome: string; frames: number; fills: number; firstLagMs: number | null; lastLagMs: number | null; tipAt: string | null; gap?: { note: string }; retried?: string }[]
    fired: { alertId: string; market: string; title: string; actionAsk: string | null; price: number }[]
    more: number
    cooled: number
    error?: string
  }
  const venueLine = (v: Sweep['venues'][number] | undefined) =>
    v ? `${v.resumed ? `resumed ${v.cursorIn}` : 'cold open at the tip'} → ${v.cursorOut} · ${v.frames} frames · ${v.fills} fills · first ${v.firstLagMs != null ? (v.firstLagMs / 1000).toFixed(1) : '?'}s behind, last ${v.lastLagMs != null ? (v.lastLagMs / 1000).toFixed(1) : '?'}s · ${v.outcome}${v.gap ? ` · GAP: ${v.gap.note}` : ''}${v.retried ? ` · retried: ${v.retried}` : ''}` : 'no hypercore pass'
  const t0 = Date.now()
  const cold = (await (await fetch(`${BASE}/api/cron/prints?budgetMs=30000`, { method: 'POST', headers: cronH })).json()) as Sweep
  const hc0 = cold.venues?.find((v) => v.venue === 'hypercore')
  console.log(`     cold pass: ${Date.now() - t0}ms wall · ${venueLine(hc0)}`)
  check('3. the cold pass opened the LIVE hypercore feed (from the stored cursor when one existed) and seeded a cursor', !!hc0 && hc0.frames > 0 && !!hc0.cursorOut && ['tip', 'budget', 'idle', 'closed'].includes(hc0.outcome), hc0 ? venueLine(hc0) : JSON.stringify(cold))
  const WAIT_MS = Number(process.env.DRIVE_WAIT_MS) || 60_000
  console.log(`     waiting ${Math.round(WAIT_MS / 1000)}s so the next pass has a whole minute to replay…`)
  await new Promise((r) => setTimeout(r, WAIT_MS))
  const t1 = Date.now()
  const live = (await (await fetch(`${BASE}/api/cron/prints?budgetMs=30000`, { method: 'POST', headers: cronH })).json()) as Sweep
  const hc = live.venues?.find((v) => v.venue === 'hypercore')
  console.log(`     resumed pass: ${Date.now() - t1}ms wall · ${venueLine(hc)}`)
  check('4. the resumed pass started STRICTLY after the cold pass\'s cursor and replayed the minute it missed to the tip (contiguous passes; the first frame ~a minute behind, the last at the tip)', !!hc && hc.resumed && hc.cursorIn === hc0?.cursorOut && !!hc.cursorOut && BigInt(hc.cursorOut) > BigInt(hc.cursorIn ?? '0') && hc.firstLagMs != null && hc.firstLagMs > WAIT_MS * 0.8 && hc.lastLagMs != null && hc.lastLagMs < 10_000 && ['tip', 'idle'].includes(hc.outcome), hc ? venueLine(hc) : JSON.stringify(live))
  const mine = (live.fired ?? []).filter((f) => f.alertId === armed.id)
  console.log(`     fired on the live minute: ${mine.length}${live.more ? ` (+${live.more} counted in the newest body)` : ''}${live.cooled ? ` · ${live.cooled} cooled` : ''}`)
  for (const f of mine) console.log(`       · ${f.title} — ${f.actionAsk ?? 'no chip (venue gate)'} @ ${f.price}`)
  const notes = (await (await fetch(`${BASE}/api/alerts/notifications`, { headers: H })).json()) as { notifications: { alertId: string; symbol: string; title: string; body: string; actionAsk: string | null; price: number }[] }
  const liveNotes = notes.notifications.filter((n) => n.alertId === armed.id)
  if (mine.length) {
    const n = liveNotes.find((x) => x.title === mine[0].title) ?? liveNotes[0]
    check('5. every live firing is on the bell (/api/alerts/notifications): past tense, measured dollars and price, the venue named, through Dune\'s feed; the chip only through the venue gate', !!n && /^\$[\d.]+[KM]? (bought|sold) on [A-Za-z0-9:]+ in one fill at [\d.]+\. Hyperliquid, through Dune's feed\./.test(n.body) && n.title === `Big print on ${mine[0].market}` && (n.actionAsk === null || /^(Long|Short|Buy) \$25 of /.test(n.actionAsk)) && mine.every((f) => liveNotes.some((x) => x.title === f.title && x.price === f.price)), n ? `${n.title} · ${n.body} · chip: ${n.actionAsk ?? 'none'}` : 'no row')
    console.log(`     bell: ${JSON.stringify(liveNotes.map((n) => ({ title: n.title, body: n.body, actionAsk: n.actionAsk, price: n.price })))}`)
  } else {
    check('5. no $10K print landed in the minute the pass replayed — reported as a quiet minute, nothing faked (the fixture half below proves the path)', liveNotes.length === 0, `${liveNotes.length} rows`)
  }

  // The deterministic half runs on its OWN rule (market HYPE), whose
  // cooldown state is empty — the any-market rule above may have cooled
  // HYPE in the live minute.
  const armB = ((await (await fetch(`${BASE}/api/print-alerts`, { method: 'POST', headers: H, body: JSON.stringify({ rule: 'big-print', market: 'HYPE', venues: ['hypercore'], bigPrintUsd: 10000 }) })).json()) as { alert: { id: string } }).alert
  const stamp = Date.now()
  const fixture = { fills: [{ id: `drive:${stamp}`, market: 'HYPE', side: 'buy', size: 500, price: 42.1, at: stamp - 2_000, taker: '0xdrive' }] }
  const fx = (await (await fetch(`${BASE}/api/cron/prints`, { method: 'POST', headers: cronH, body: JSON.stringify({ fixture }) })).json()) as Sweep & { fixture: number }
  const fxMine = (fx.fired ?? []).find((f) => f.alertId === armB.id)
  const notes2 = (await (await fetch(`${BASE}/api/alerts/notifications`, { headers: H })).json()) as typeof notes
  const fxNote = notes2.notifications.find((n) => n.alertId === armB.id && /\$21\.05K bought on HYPE/.test(n.body))
  check('6. the deterministic half — a $21.05K fixture print (internal run, internal rule on HYPE) fires through the same path, opens no feed, and lands on the bell with the HYPE long chip (or none, by the venue gate)', fx.fixture === 1 && (fx.venues ?? []).length === 0 && !!fxMine && !!fxNote && fxNote.title === 'Big print on HYPE' && fxNote.price === 42.1 && (fxNote.actionAsk === 'Long $25 of HYPE on Hyperliquid' || fxNote.actionAsk === null), fxNote ? `${fxNote.body} · chip: ${fxNote.actionAsk ?? 'none'}` : JSON.stringify(fx))

  await fetch(`${BASE}/api/print-alerts?id=${armed.id}`, { method: 'DELETE', headers: H })
  await fetch(`${BASE}/api/print-alerts?id=${armB.id}`, { method: 'DELETE', headers: H })
  await fetch(`${BASE}/api/alerts/notifications`, { method: 'PATCH', headers: H, body: JSON.stringify({ all: true }) })
  const left = (await (await fetch(`${BASE}/api/print-alerts`, { headers: H })).json()) as { alerts: unknown[] }
  const unseen = (await (await fetch(`${BASE}/api/alerts/notifications`, { headers: H })).json()) as { notifications: unknown[] }
  check('7. cleanup — the rule deleted, the notifications dismissed', left.alerts.length === 0 && unseen.notifications.length === 0)
  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
