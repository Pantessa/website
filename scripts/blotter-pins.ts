// Pins for the tenant blotter + the monthly statement (BLOTTER lane, five-million,
// 2026-11-03): lib/tenant/blotter.ts · lib/tenant/statement.ts · the runner's
// tenant rows (lib/job-step-money.ts, lib/jobs-runner.ts) · the sign-site row
// (app/api/embed/telemetry) · the routes under app/api/tenants/[id]/{blotter,statement}.
//
//   blotterPurePins(check)   no DB, no server — scripts/test-api.ts runs these
//   blotterDbPins(check)     the TEST DB: 20-way concurrent seq, the once-key,
//                            tamper → verify breaks, spentTodayUsd, the runner's
//                            rows (a real Base tx for `verified`), the statement
//                            cut + idempotence + a draft invoice (a fake Stripe;
//                            and Stripe TEST mode when the key is sk_test_)
//   blotterHttpPins(check)   BASE=http://localhost:44xx — the routes, read back
//                            with burner SIWE sessions (owner / admin / stranger)
//
//   npm run pins:blotter                         pure + DB (reads .env.local)
//   BASE=http://localhost:4410 npm run pins:blotter   + the HTTP pass
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  BLOTTER_GENESIS,
  BLOTTER_KINDS,
  DESK_PLATFORM_FEE_USD,
  TENANT_VENUES,
  blotterHash,
  canonicalJson,
  tieredDeskFeeUsd,
  type BlotterEvent,
} from '../lib/tenant/spec'
import {
  BLOTTER_CSV_COLUMNS,
  blotterCsv,
  csvCell,
  ledgerColumns,
  legFeeBps,
  legFeeUsd,
  normalizePayload,
  parseBlotterQuery,
  replayChain,
  sealRow,
  tenantAdminsOf,
  tenantVenueOfBuildPath,
  utcDayStart,
  type StoredBlotterRow,
} from '../lib/tenant/blotter'
import { draftStatementInvoice, lastClosedMonth, monthRange, statementLegs, statementMath, type StatementLeg, type StripeLike } from '../lib/tenant/statement'

type Check = (name: string, ok: boolean, extra?: string) => void

// ── fixtures ────────────────────────────────────────────────────────────────

const T0 = Date.UTC(2026, 10, 3, 9, 0, 0, 0)
function toStored(s: ReturnType<typeof sealRow>): StoredBlotterRow {
  return { seq: s.seq, prevHash: s.prevHash, hash: s.hash, kind: s.kind, createdAt: s.createdAt, payload: s.payload, ...s.columns }
}
function fixtureChain(): StoredBlotterRow[] {
  const events: BlotterEvent[] = [
    { tenantId: 'tn_fixture', kind: 'intent', intentId: 'int1', deskId: 'macro', keyId: 'dk1', payload: { ask: 'Buy $25 of ETH on Base', usd: 25 } },
    { tenantId: 'tn_fixture', kind: 'policy_verdict', intentId: 'int1', deskId: 'macro', payload: { allowed: true, rule: { venue: 'uniswap-v3', chains: [8453] } } },
    { tenantId: 'tn_fixture', kind: 'build', intentId: 'int1', jobId: 'job1', venue: 'uniswap-v3', chainId: 8453, valueUsd: 25, payload: { routeChosen: 'native-swap-uniswap', quotesConsidered: null } },
    { tenantId: 'tn_fixture', kind: 'signed', intentId: 'int1', jobId: 'job1', deskId: 'macro', venue: 'uniswap-v3', chainId: 8453, valueUsd: 25, feeUsd: 0.05, feeBps: 20, txHash: `0x${'ab'.repeat(32)}`, payload: { source: 'job-step', seq: 0 } },
    { tenantId: 'tn_fixture', kind: 'settled', intentId: 'int1', jobId: 'job1', chainId: 8453, txHash: `0x${'ab'.repeat(32)}`, verification: 'verified', payload: { source: 'job-step', signedSeq: 4, note: 'a "quoted", comma, and\nnew line' } },
  ]
  const out: StoredBlotterRow[] = []
  let prev: { seq: number; hash: string } | null = null
  events.forEach((e, i) => {
    const s = sealRow(prev, e, new Date(T0 + i * 1000), i === 3 ? 'job:job1:0:signed' : undefined)
    out.push(toStored(s))
    prev = { seq: s.seq, hash: s.hash }
  })
  return out
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** A small RFC 4180 reader — the auditor's side of the export. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else cell += c
  }
  return rows
}

const leg = (valueUsd: number | null, feeUsd: number | null, settled: StatementLeg['settled'], signedSeq = 1): StatementLeg => ({ signedSeq, valueUsd, feeUsd, settled })

// ── pure ────────────────────────────────────────────────────────────────────

export function blotterPurePins(check: Check): void {
  // The hash: the spec's encoding, byte for byte.
  const chain = fixtureChain()
  const r1 = chain[0]
  const manual = createHash('sha256').update(`${BLOTTER_GENESIS}\n1\nintent\n${new Date(T0).toISOString()}\n${canonicalJson(r1.payload)}`).digest('hex')
  check(
    'blotter: row 1 chains from BLOTTER_GENESIS and its hash is sha256(prevHash\\nseq\\nkind\\ncreatedAtIso\\ncanonicalJson(payload)) — the spec encoding, recomputed by hand',
    r1.seq === 1 && r1.prevHash === BLOTTER_GENESIS && r1.hash === manual && r1.hash === blotterHash({ prevHash: BLOTTER_GENESIS, seq: 1, kind: 'intent', createdAtIso: new Date(T0).toISOString(), payload: r1.payload }),
  )
  check(
    'blotter: each row names the previous row\'s hash; seq runs 1..n',
    chain.every((r, i) => r.seq === i + 1 && r.prevHash === (i === 0 ? BLOTTER_GENESIS : chain[i - 1].hash)),
  )
  const sig = chain[3]
  const led = (sig.payload as { ledger?: Record<string, unknown> }).ledger ?? {}
  check(
    'blotter: the typed columns ride INSIDE the hashed payload under `ledger` (value, fee, bps, tx, venue, chain, desk) and the once-key under `once` — a column edit breaks the chain',
    led.valueUsd === 25 && led.feeUsd === 0.05 && led.feeBps === 20 && led.txHash === sig.txHash && led.venue === 'uniswap-v3' && led.chainId === 8453 && led.deskId === 'macro' && !('verification' in led) && (sig.payload as { once?: unknown }).once === 'job:job1:0:signed',
  )
  const ok = replayChain(chain)
  check('blotter replay: the fixture chain verifies — ok, 5 rows, head = the last row', ok.ok && ok.rows === 5 && ok.head?.seq === 5 && ok.head.hash === chain[4].hash, JSON.stringify(ok))
  const rt = replayChain(clone(chain))
  check('blotter replay: a JSON round trip (dates as ISO strings, as the export and the DB hand them back) still verifies', rt.ok && rt.rows === 5)

  const tampered = clone(chain)
  ;(tampered[2].payload as Record<string, unknown>).routeChosen = 'native-swap-cow'
  const tv = replayChain(tampered)
  check('blotter replay: a tampered payload breaks verify at its seq', !tv.ok && tv.brokenAt === 3 && /hash/.test(tv.reason ?? '') && tv.head?.seq === 2, JSON.stringify(tv))
  const colT = clone(chain)
  colT[3].valueUsd = 2500
  const cv = replayChain(colT)
  check('blotter replay: a tampered COLUMN (value_usd 25 → 2500) breaks verify at its seq even though the hash still recomputes', !cv.ok && cv.brokenAt === 4 && /valueUsd/.test(cv.reason ?? ''), JSON.stringify(cv))
  const relinked = clone(chain)
  ;(relinked[2].payload as Record<string, unknown>).routeChosen = 'native-swap-cow'
  relinked[2].hash = blotterHash({ prevHash: relinked[2].prevHash, seq: 3, kind: relinked[2].kind, createdAtIso: new Date(relinked[2].createdAt).toISOString(), payload: relinked[2].payload })
  const rv = replayChain(relinked)
  check('blotter replay: an edit whose hash is RE-COMPUTED still breaks at the NEXT row (its prev_hash names the original)', !rv.ok && rv.brokenAt === 4 && /prev_hash/.test(rv.reason ?? ''), JSON.stringify(rv))
  const gap = clone(chain).filter((r) => r.seq !== 2)
  const gv = replayChain(gap)
  check('blotter replay: a deleted row is a gap at its seq', !gv.ok && gv.brokenAt === 2 && /missing/.test(gv.reason ?? ''), JSON.stringify(gv))
  const timeT = clone(chain)
  timeT[1].createdAt = new Date(T0 + 999_999).toISOString()
  check('blotter replay: a moved created_at breaks verify (the time is hashed)', replayChain(timeT).brokenAt === 2)
  const kindT = clone(chain)
  kindT[0].kind = 'approval'
  check('blotter replay: a changed kind breaks verify', replayChain(kindT).brokenAt === 1)
  const tail = replayChain(chain.slice(3), { seq: 3, hash: chain[2].hash })
  check('blotter replay: replays incrementally from a known head (the verify route pages a thousand at a time)', tail.ok && tail.rows === 2 && tail.head?.seq === 5)
  check('blotter replay: an empty chain verifies with no head', (() => {
    const e = replayChain([])
    return e.ok && e.rows === 0 && e.head === null
  })())

  // Normalisation: what jsonb hands back is what was hashed.
  const n = normalizePayload({ at: new Date(T0), big: BigInt(7), nan: Number.NaN, gone: undefined, nul: 'a\u0000b', ledger: { valueUsd: 1e9 }, once: 'theirs', arr: [1, undefined] })
  check(
    'blotter normalize: Date → ISO, bigint → string, NaN → null, undefined dropped, NUL stripped (jsonb refuses it), arrays keep their slots',
    n.at === new Date(T0).toISOString() && n.big === '7' && n.nan === null && !('gone' in n) && n.nul === 'ab' && Array.isArray(n.arr) && (n.arr as unknown[])[1] === null,
  )
  const s1 = sealRow(null, { tenantId: 't', kind: 'intent', valueUsd: 5, payload: { ledger: { valueUsd: 1e9 }, once: 'theirs' } }, new Date(T0), 'ours')
  check(
    'blotter seal: a caller cannot forge the reserved keys — its `ledger` / `once` are kept as callerLedger / callerOnce, ours carry the real columns',
    (s1.payload.ledger as Record<string, unknown>).valueUsd === 5 && s1.payload.once === 'ours' && (s1.payload.callerLedger as Record<string, unknown>).valueUsd === 1e9 && s1.payload.callerOnce === 'theirs',
  )
  check('blotter seal: a non-object payload is wrapped, never dropped', (sealRow(null, { tenantId: 't', kind: 'intent', payload: 'x' as unknown as Record<string, unknown> }, new Date(T0)).payload as { value?: unknown }).value === 'x')
  const cols = ledgerColumns({ chainId: 1.5, feeBps: 20_000, verification: 'probably' as never, valueUsd: Number.POSITIVE_INFINITY, txHash: ' 0xabc ', venue: 'x'.repeat(300) })
  check(
    'blotter columns: clamped to what the table holds — a fractional chain, bps over 10,000, an unknown verification and ±Inf are null; strings trimmed and capped at 200',
    cols.chainId === null && cols.feeBps === null && cols.verification === null && cols.valueUsd === null && cols.txHash === '0xabc' && cols.venue?.length === 200,
  )
  check('blotter kinds: every spec kind is accepted by the writer (sealRow keeps the kind verbatim)', BLOTTER_KINDS.every((k) => sealRow(null, { tenantId: 't', kind: k, payload: {} }, new Date(T0)).kind === k))

  // The export.
  const csv = blotterCsv(chain)
  const parsed = parseCsv(csv)
  check(
    'blotter csv: header = seq…payload (17 columns), CRLF lines, a trailing CRLF, one line per row',
    csv.split('\r\n')[0] === BLOTTER_CSV_COLUMNS.join(',') && BLOTTER_CSV_COLUMNS.length === 17 && csv.endsWith('\r\n') && parsed.length === chain.length + 1 && parsed.every((r) => r.length === 17),
    `${parsed.length} lines`,
  )
  const back: StoredBlotterRow[] = parsed.slice(1).map((c) => ({
    seq: Number(c[0]),
    createdAt: c[1],
    kind: c[2],
    intentId: c[3] || null,
    jobId: c[4] || null,
    deskId: c[5] || null,
    keyId: c[6] || null,
    venue: c[7] || null,
    chainId: c[8] ? Number(c[8]) : null,
    valueUsd: c[9] ? Number(c[9]) : null,
    feeUsd: c[10] ? Number(c[10]) : null,
    feeBps: c[11] ? Number(c[11]) : null,
    txHash: c[12] || null,
    verification: c[13] || null,
    prevHash: c[14],
    hash: c[15],
    payload: JSON.parse(c[16]),
  }))
  check('blotter csv: the auditor\'s path — parse the CSV, replay the chain from its cells alone, it verifies (quotes, commas and a new line in a payload survive)', replayChain(back).ok, JSON.stringify(replayChain(back)))
  check(
    'blotter csv: cells — quotes doubled and wrapped, a formula-leading text cell gets an apostrophe, numbers and `{`-payloads untouched, null is empty',
    csvCell('a,"b"') === '"a,""b"""' && csvCell('=SUM(A1)') === "'=SUM(A1)" && csvCell('-5') === "'-5" && csvCell(-5) === '-5' && csvCell('{"a":1}') === '"{""a"":1}"' && csvCell(null) === '' && csvCell(Number.NaN) === '',
  )

  // The query.
  const q = (s: string) => parseBlotterQuery(new URLSearchParams(s))
  const q1 = q('from=2026-11-01&to=2026-11-30&kind=signed,settled&limit=50')
  check(
    'blotter query: a date-only `to` covers that whole UTC day; kinds and limit read',
    q1.ok && q1.query.from?.toISOString() === '2026-11-01T00:00:00.000Z' && q1.query.to?.toISOString() === '2026-12-01T00:00:00.000Z' && q1.query.kinds?.join() === 'signed,settled' && q1.query.limit === 50 && q1.query.format === 'json',
  )
  check(
    'blotter query: refusals in words — an unknown kind, a bad format, limit 0 / 1001 (json) / 10001 (csv), from ≥ to, a date with no zone',
    !q('kind=signed,nope').ok && !q('format=xml').ok && !q('limit=0').ok && !q('limit=1001').ok && q('format=csv&limit=10000').ok && !q('format=csv&limit=10001').ok && !q('from=2026-11-02&to=2026-11-01').ok && !q('from=2026-11-01T00:00:00').ok && !q('after=-1').ok,
  )

  // The vocabulary bridges.
  const paths = ['native-swap-uniswap', 'native-swap-uniswap-v4', 'native-swap-cow', 'native-swap-lifi', 'native-cross-chain', 'native-hl-exec', 'native-aave-supply', 'native-lido', 'native-transfer', 'native-morpho-lend', 'native-nft-buy']
  check(
    'blotter venue: build paths map onto the policy\'s own venue ids (uniswap-v3 / -v4 / cow / lifi / near-intents / hyperliquid / aave-v4 / lido / transfer / morpho / opensea); every answer is a TENANT_VENUES id; planner → null',
    tenantVenueOfBuildPath('native-swap-uniswap') === 'uniswap-v3' && tenantVenueOfBuildPath('native-swap-uniswap-v4') === 'uniswap-v4' && tenantVenueOfBuildPath('native-hl-exec') === 'hyperliquid' && tenantVenueOfBuildPath('native-cross-chain') === 'near-intents' && paths.every((p) => (TENANT_VENUES as readonly string[]).includes(tenantVenueOfBuildPath(p) ?? '')) && tenantVenueOfBuildPath('planner') === null,
  )
  check(
    'blotter fee: the leg\'s net bps is the calldata fee — fee-free paths 0, a stamped link tier wins on Uniswap, cross-chain keeps its path rate; $25 × 20 bps = $0.05',
    legFeeBps('native-transfer', 20) === 0 && legFeeBps('native-lido', null) === 0 && legFeeBps('native-swap-uniswap', 50) === 50 && legFeeBps('native-swap-uniswap', null) === 20 && legFeeBps('native-cross-chain', 20) === legFeeBps('native-cross-chain', null) && legFeeUsd(25, 20) === 0.05 && legFeeUsd(null, 20) === null,
  )
  check('blotter day: spentTodayUsd sums from 00:00 UTC', utcDayStart(new Date(Date.UTC(2026, 10, 3, 23, 59))).toISOString() === '2026-11-03T00:00:00.000Z')
  check(
    'blotter admins: owner ∪ admins, lowercased, deduped, non-strings ignored',
    tenantAdminsOf({ ownerAddress: '0xABC', admins: ['0xdef', '0xabc', 7, null] }).join() === '0xabc,0xdef',
  )

  // The statement math.
  const created = new Date(Date.UTC(2026, 0, 10)) // free window ends 2026-04-10
  const m = (ym: string, legs: StatementLeg[], feeBps: number | null = null, c = created) => statementMath({ ym, tenantCreatedAt: c, feeBps, legs })
  const t5 = m('2026-06', [leg(5_000_000, 0, 'verified')])
  const t50 = m('2026-06', [leg(50_000_000, 0, 'verified')])
  const t150 = m('2026-06', [leg(150_000_000, 0, 'verified')])
  check(
    'statement tiers: $5M → $5,000 (10 bps) · $50M → $30,000 (10 bps to $10M + 5 bps) · $150M → $65,000 (+ 2 bps above $100M) — marginal, and the tier lines add up',
    t5.execution.feeUsd === 5000 && t50.execution.feeUsd === 30_000 && t150.execution.feeUsd === 65_000 && tieredDeskFeeUsd(150_000_000) === 65_000 && t150.execution.tiers?.reduce((a, t) => a + t.feeUsd, 0) === 65_000 && t150.execution.tiers?.[2].spanUsd === 50_000_000 && t50.execution.mode === 'tiered',
    `${t5.execution.feeUsd} ${t50.execution.feeUsd} ${t150.execution.feeUsd}`,
  )
  const t25 = m('2026-06', [leg(25_000_000, 0, 'verified')])
  check('statement plan check: a $25M month outside the free window = $4,000 + $17,500 = $21,500 (GTM-PLAN-5M §4)', t25.amountDueUsd === 21_500 && t25.platform.dueUsd === DESK_PLATFORM_FEE_USD, String(t25.amountDueUsd))
  const jan = m('2026-01', [])
  const mar = m('2026-03', [])
  const apr = m('2026-04', [])
  const may = m('2026-05', [])
  const dec = m('2025-12', [])
  check(
    'statement free window: created 2026-01-10 → Jan–Mar platform waived in full; April charged for 21 of 30 days ($2,800, waived to the 10th); May in full; a month before the tenant existed is $0',
    jan.platform.dueUsd === 0 && mar.platform.dueUsd === 0 && apr.platform.dueUsd === 2800 && apr.platform.waivedUsd === 1200 && may.platform.dueUsd === 4000 && dec.platform.dueUsd === 0 && /did not exist/.test(dec.platform.note) && /Waived/.test(jan.platform.note),
    `apr=${apr.platform.dueUsd} note=${apr.platform.note}`,
  )
  const flat = m('2026-06', [leg(5_000_000, 0, 'verified')], 3)
  check('statement flat bps: tenant.feeBps = 3 on $5M → $1,500 flat, no tiers', flat.execution.mode === 'flat' && flat.execution.bps === 3 && flat.execution.feeUsd === 1500 && flat.execution.tiers === null)
  const credited = m('2026-06', [leg(10_000_000, 20_000, 'verified', 1)])
  check('statement credit: $10M at 10 bps = $10,000 minus $20,000 already collected in calldata → execution due $0, credit applied $10,000, $10,000 unused (not refunded in wave 1)', credited.executionDueUsd === 0 && credited.creditAppliedUsd === 10_000 && credited.creditUnusedUsd === 10_000 && credited.amountDueUsd === 4000)
  const part = m('2026-06', [leg(2_000_000, 400, 'verified', 1)])
  check('statement credit: $2M → $2,000 fee − $400 calldata = $1,600 execution due; amount due = platform + that', part.executionDueUsd === 1600 && part.amountDueUsd === 5600)
  const mix = m('2026-06', [leg(100, 0.2, 'verified', 1), leg(50, 0.1, 'attested', 2), leg(30, 0.06, null, 3), leg(1000, 2, 'mismatch', 4), leg(null, null, 'verified', 5), leg(7, 0.01, 'unverified', 6)])
  check(
    'statement basis: verified + attested (off-chain legs) + signed-only count; a refuted (mismatch) leg never counts nor credits; an unpriced leg adds $0 and is named; an `unverified` settlement reads as signed-only',
    mix.notionalUsd === 187 && mix.legs.verified.usd === 100 && mix.legs.attested.usd === 50 && mix.legs.signedOnly.usd === 37 && mix.legs.signedOnly.count === 2 && mix.legs.mismatch.usd === 1000 && mix.legs.unpriced === 1 && mix.calldataCreditUsd === 0.37 && mix.basis === 'verified+attested+signed' && /refuted/.test(mix.basisNote) && /signed with no settlement/.test(mix.basisNote),
    `${mix.notionalUsd} ${mix.calldataCreditUsd} ${mix.basis}`,
  )
  check('statement basis: an all-verified month says so', m('2026-06', [leg(10, 0, 'verified')]).basis === 'verified' && m('2026-06', []).basis === 'none')
  check(
    'statement lines: three lines (platform · execution · credit) and they add up to the amount due',
    [t25, part, credited, mix].every((s) => s.lines.length === 3 && s.lines.map((l) => l.id).join() === 'platform,execution,credit' && Math.abs(s.lines.reduce((a, l) => a + l.amountUsd, 0) - s.amountDueUsd) < 0.005),
  )

  // Pairing legs with their settlements.
  const sRow = (seq: number, kind: string, extra: Partial<StoredBlotterRow> & { payload?: unknown }): StoredBlotterRow => ({ seq, prevHash: '', hash: '', kind, createdAt: new Date(T0), payload: {}, ...extra })
  const legs = statementLegs(
    [
      sRow(1, 'signed', { valueUsd: 25, feeUsd: 0.05, payload: { once: 'job:a:0:signed' } }),
      sRow(2, 'signed', { valueUsd: 40, feeUsd: 0.08, payload: { once: 'turn:x:signed' } }),
      sRow(3, 'signed', { valueUsd: 10, feeUsd: 0.02, payload: { once: 'job:b:0:signed' } }),
    ],
    [
      sRow(4, 'settled', { verification: 'unverified', payload: { signedSeq: 1 } }),
      sRow(5, 'settled', { verification: 'verified', payload: { signedSeq: 1 } }),
      sRow(6, 'settled', { verification: 'mismatch', payload: { once: 'turn:x:settled' } }),
      sRow(7, 'settled', { verification: 'verified', payload: { source: 'wait', settles: [3] } }),
    ],
  )
  check(
    'statement legs: a leg pairs with its LATEST settlement by signedSeq, else by the once-key twin; a wait-step settlement never stands in for a leg\'s receipt',
    legs.length === 3 && legs[0].settled === 'verified' && legs[1].settled === 'mismatch' && legs[2].settled === null,
    JSON.stringify(legs),
  )
  check('statement month: YYYY-MM ranges and the last closed month', monthRange('2026-02')?.to.toISOString() === '2026-03-01T00:00:00.000Z' && monthRange('2026-13') === null && lastClosedMonth(new Date(Date.UTC(2026, 0, 5))) === '2025-12')

  // Wiring (source pins).
  const src = (p: string) => readFileSync(p, 'utf8')
  const blotterSrc = src('lib/tenant/blotter.ts')
  const runnerSrc = src('lib/jobs-runner.ts')
  const moneySrc = src('lib/job-step-money.ts')
  const telemetrySrc = src('app/api/embed/telemetry/route.ts')
  const stmtSrc = src('lib/tenant/statement.ts')
  const routes = ['app/api/tenants/[id]/blotter/route.ts', 'app/api/tenants/[id]/blotter/verify/route.ts', 'app/api/tenants/[id]/statement/route.ts'].map(src)
  check(
    'blotter wiring: one per-tenant advisory lock around read-last → seal → insert, created_at generated in code and stored as hashed, retries on the unique violation, and recordBlotter swallows every error',
    /pg_advisory_xact_lock\(hashtextextended\(\$\{`blotter:\$\{tenantId\}`\}, 0\)\)/.test(blotterSrc) && /createdAt: sealed\.createdAt/.test(blotterSrc) && /code === 'P2002'/.test(blotterSrc) && /export async function recordBlotter\(e: BlotterEvent\): Promise<void> \{\n  try \{/.test(blotterSrc),
  )
  check(
    'blotter wiring: the runner books a tenant job\'s build (offered + refused), its signed leg (after the money row) and its wait settlements — each behind `tenantId`; the cron tick re-checks pending legs for its own env',
    /if \(fresh\.tenantId\) await recordTenantBuild\(fresh, step, built\)/.test(runnerSrc) && /if \(fresh\.tenantId\) await recordTenantBuild\(fresh, step, null, \(e as Error\)\.message\)/.test(runnerSrc) && /if \(fresh\.tenantId\) await recordTenantWaitSettled\(fresh, step, settled\.result\)/.test(runnerSrc) && /const money = await recordJobStepMoney\(\{[\s\S]{0,400}if \(job\.tenantId\) \{\s*await recordTenantLeg\(/.test(runnerSrc) && /settleTenantJobLegs\(null, 5, jobsEnv\(\)\)/.test(runnerSrc),
  )
  check(
    'blotter wiring: a `settled` row is the CHAIN\'s word for an EVM leg (sender + status — the money row\'s own read), `attested` only for an off-chain order leg; quotes are never invented',
    /claim === 'ok' \? 'verified' : claim === 'refuted' \? 'mismatch'/.test(moneySrc) && /if \(offChain\) \{\s*verification = 'attested'/.test(moneySrc) && /quotesConsidered: null/.test(moneySrc),
  )
  check(
    'blotter wiring: the public telemetry beacon writes a tenant row ONLY on a verified receipt, the tenant read from the server\'s own broker intent (never the beacon)',
    /if \(outcome === 'signed' && verification === 'verified' && deskIntent\?\.tenantId\) \{\s*await recordTenantTurn\(/.test(telemetrySrc) && /select: \{ id: true, origin: true, plan: true, tenantId: true, deskKeyId: true \}/.test(telemetrySrc) && !/body\.tenantId/.test(telemetrySrc),
  )
  check(
    'blotter wiring: every route reads the SIWE session, answers 404 to a non-admin, gates CSV on blotterExport and the cut on statement through entitlementsFor(the owner\'s EFFECTIVE plan); nothing is cached',
    routes.every((r) => /getSessionAddress\(\)/.test(r) && /tenantForAdmin\(id, addr\)/.test(r) && /status: 404/.test(r)) &&
      /entitlementsFor\(plan\.id\)\.blotterExport/.test(routes[0]) && /entitlementsFor\(plan\.id\)\.statement/.test(routes[2]) && /getEffectivePlan\(tenant\.ownerAddress\)/.test(routes[0]) &&
      ![blotterSrc, stmtSrc, ...routes].some((s) => /unstable_cache|revalidate\s*=/.test(s)),
  )
  check(
    'statement wiring: the Stripe invoice is a DRAFT — auto_advance false, never finalized, never sent, never paid',
    /auto_advance: false/.test(stmtSrc) && !/finalizeInvoice|sendInvoice|\.pay\(|\.finalize\(/.test(stmtSrc),
  )
}

// ── DB ──────────────────────────────────────────────────────────────────────

function fakeStripe() {
  const calls: { kind: 'invoice' | 'item'; params: Record<string, unknown>; key?: string }[] = []
  const stripe: StripeLike = {
    invoices: { create: async (params, opts) => (calls.push({ kind: 'invoice', params, key: opts?.idempotencyKey }), { id: 'in_fake_1', status: 'draft' }) },
    invoiceItems: { create: async (params, opts) => (calls.push({ kind: 'item', params, key: opts?.idempotencyKey }), { id: `ii_fake_${calls.length}` }) },
  }
  return { stripe, calls }
}

export async function blotterDbPins(check: Check): Promise<void> {
  const { default: prisma } = await import('../lib/db')
  const B = await import('../lib/tenant/blotter')
  const S = await import('../lib/tenant/statement')
  const M = await import('../lib/job-step-money')
  const tag = `bp${Date.now().toString(36)}`
  const owner = `0x${createHash('sha256').update(tag).digest('hex').slice(0, 40)}`
  const tenants: string[] = []
  const mk = async (suffix: string, createdAt?: Date) => {
    const t = await prisma.tenant.create({ data: { slug: `${tag}-${suffix}`.slice(0, 32), name: `blotter pins ${suffix}`, ownerAddress: owner, isInternal: true, ...(createdAt ? { createdAt } : {}) } })
    tenants.push(t.id)
    return t
  }
  try {
    // 20-way concurrent writers.
    const a = await mk('conc')
    await Promise.all(Array.from({ length: 20 }, (_, i) => B.recordBlotter({ tenantId: a.id, kind: i % 2 ? 'intent' : 'policy_verdict', deskId: 'macro', payload: { i } })))
    const rows = await prisma.blotterRow.findMany({ where: { tenantId: a.id }, orderBy: { seq: 'asc' }, select: { seq: true, payload: true } })
    const seqs = rows.map((r) => r.seq)
    const is = new Set(rows.map((r) => (r.payload as { i?: number }).i))
    const v20 = await B.verifyChain(a.id)
    check('blotter db: 20 concurrent recordBlotter calls on one tenant land as seq 1..20 — no gap, no repeat, every write kept — and the chain verifies', seqs.length === 20 && seqs.every((s, i) => s === i + 1) && is.size === 20 && v20.ok && v20.rows === 20, `seqs=${seqs.join(',')} verify=${JSON.stringify(v20)}`)

    // The once-key, concurrently too.
    const once = await Promise.all(Array.from({ length: 5 }, () => B.recordBlotterOnce('pin:once', { tenantId: a.id, kind: 'build', payload: { x: 1 } })))
    const onceRows = await prisma.blotterRow.count({ where: { tenantId: a.id, kind: 'build' } })
    check('blotter db: five racing recordBlotterOnce calls with one key write ONE row; the others answer written:false with its seq', onceRows === 1 && once.filter((w) => w?.written).length === 1 && new Set(once.map((w) => w?.seq)).size === 1, JSON.stringify(once))

    // A bad event is dropped, never thrown.
    let threw = false
    try {
      await B.recordBlotter({ tenantId: '', kind: 'intent', payload: {} })
      await B.recordBlotter({ tenantId: a.id, kind: 'nope' as never, payload: {} })
    } catch {
      threw = true
    }
    check('blotter db: recordBlotter never throws — no tenant id and an unknown kind are logged and dropped', !threw && (await prisma.blotterRow.count({ where: { tenantId: a.id } })) === 21)

    // Tamper → verify names the seq; restore → ok.
    const victim = await prisma.blotterRow.findFirst({ where: { tenantId: a.id, seq: 7 } })
    await prisma.$executeRaw`UPDATE blotter_rows SET payload = jsonb_set(payload, '{i}', '999') WHERE id = ${victim!.id}`
    const broken = await B.verifyChain(a.id)
    await prisma.$executeRaw`UPDATE blotter_rows SET payload = ${JSON.stringify(victim!.payload)}::jsonb WHERE id = ${victim!.id}`
    await prisma.$executeRaw`UPDATE blotter_rows SET value_usd = 1 WHERE tenant_id = ${a.id} AND seq = 9`
    const colBroken = await B.verifyChain(a.id)
    await prisma.$executeRaw`UPDATE blotter_rows SET value_usd = NULL WHERE tenant_id = ${a.id} AND seq = 9`
    const healed = await B.verifyChain(a.id)
    check(
      'blotter db: a payload edited in the table breaks verify at that seq; a column edited in the table (value_usd) breaks it too; put back, the chain verifies again',
      !broken.ok && broken.brokenAt === 7 && !colBroken.ok && colBroken.brokenAt === 9 && healed.ok && healed.rows === 21,
      `${JSON.stringify(broken)} ${JSON.stringify(colBroken)} ${JSON.stringify(healed)}`,
    )

    // spentTodayUsd.
    const d = await mk('spent')
    await B.recordBlotter({ tenantId: d.id, kind: 'signed', deskId: 'macro', valueUsd: 25, payload: {} })
    await B.recordBlotter({ tenantId: d.id, kind: 'signed', deskId: 'macro', valueUsd: 40.5, payload: {} })
    await B.recordBlotter({ tenantId: d.id, kind: 'signed', deskId: 'other', valueUsd: 1000, payload: {} })
    await B.recordBlotter({ tenantId: d.id, kind: 'intent', deskId: 'macro', valueUsd: 999, payload: {} })
    const spent = await B.spentTodayUsd(d.id, 'macro')
    check('blotter db: spentTodayUsd sums today\'s `signed` rows for THAT desk only ($25 + $40.50), never intents or another desk', spent === 65.5, String(spent))

    // The runner's rows.
    const r = await mk('runner')
    const job = { id: `${tag}job`, wallet: owner, tenantId: r.id, deskKeyId: null }
    await M.recordTenantBuild(job, { seq: 0, builder: 'native-swap', title: 'Swap 25 USDC for ETH' }, { artifact: { txChain: { steps: [{ tx: { chainId: 8453 } }], refresh: { kind: 'uniswap', params: { feeBps: '20' } } }, summary: 'Swap 25 USDC → ETH' }, guardReport: { checks: [{ id: 'price', ok: true, level: 'block', note: 'x' }] }, valueUsd: 25, buildPath: 'native-swap-uniswap' })
    await M.recordTenantBuild(job, { seq: 1, builder: 'native-swap', title: 'Swap again' }, null, 'No Uniswap v3 or v4 pool on Base can fill this.')
    // An EVM leg whose hash the chain has never heard of: signed, no settlement yet.
    await M.recordTenantLeg({ jobId: job.id, seq: 0, wallet: owner, builder: 'native-swap', artifact: { txChain: { steps: [{ tx: { chainId: 8453 } }] }, buildPath: 'native-swap-uniswap' }, valueUsd: 25, result: { txHash: `0x${'0'.repeat(63)}1` }, tenantId: r.id, deskKeyId: null }, null)
    // An off-chain order leg: attested at once.
    await M.recordTenantLeg({ jobId: job.id, seq: 2, wallet: owner, builder: 'native-hl-exec', artifact: { orderRequest: { action: {} }, buildPath: 'native-hl-exec' }, valueUsd: 50, result: { orderResponse: { uid: 'hl-123' } }, tenantId: r.id, deskKeyId: null }, null)
    // Twice → once.
    await M.recordTenantLeg({ jobId: job.id, seq: 2, wallet: owner, builder: 'native-hl-exec', artifact: { orderRequest: { action: {} }, buildPath: 'native-hl-exec' }, valueUsd: 50, result: {}, tenantId: r.id, deskKeyId: null }, null)
    await M.recordTenantWaitSettled(job, { seq: 3, waitPredicate: { kind: 'oneclick', fromStep: 2 } }, { status: 'SUCCESS' })
    const rr = await prisma.blotterRow.findMany({ where: { tenantId: r.id }, orderBy: { seq: 'asc' } })
    const kinds = rr.map((x) => `${x.kind}${x.verification ? `:${x.verification}` : ''}`).join(',')
    const buildOk = rr.find((x) => x.kind === 'build' && (x.payload as { ok?: boolean }).ok)
    const buildNo = rr.find((x) => x.kind === 'build' && (x.payload as { ok?: boolean }).ok === false)
    const evm = rr.find((x) => x.kind === 'signed' && (x.payload as { seq?: number }).seq === 0)
    check(
      'blotter db (runner): build (offered + refused) · signed (EVM, unreadable hash → no settlement yet) · signed + settled:attested (off-chain HL order, booked once) · settled:attested (the 1Click wait)',
      kinds === 'build,build,signed,signed,settled:attested,settled:attested' && buildOk?.venue === 'uniswap-v3' && buildOk?.chainId === 8453 && (buildOk?.payload as { quotesConsidered?: unknown }).quotesConsidered === null && /No Uniswap/.test(String((buildNo?.payload as { refusal?: unknown }).refusal)) && evm?.feeBps === 20 && evm?.feeUsd === 0.05 && evm?.venue === 'uniswap-v3',
      kinds,
    )
    const pending = await M.settleTenantJobLegs(r.id, 5)
    check('blotter db (runner): the lazy re-check leaves a leg the chain still does not know unsettled (never mints a verdict)', pending === 0 && (await prisma.blotterRow.count({ where: { tenantId: r.id, kind: 'settled' } })) === 2)

    // A real Base transaction: its sender → verified; anyone else → mismatch.
    const { receiptClientFor } = await import('../lib/link-receipt-verify')
    const client = receiptClientFor(8453)
    let real: { hash: string; from: string } | null = null
    try {
      const head = await client!.getBlockNumber()
      const block = await client!.getBlock({ blockNumber: head - BigInt(5) })
      for (const h of block.transactions.slice(0, 12)) {
        const [tx, rc] = await Promise.all([client!.getTransaction({ hash: h }), client!.getTransactionReceipt({ hash: h })])
        if (rc.status === 'success') {
          real = { hash: h, from: tx.from.toLowerCase() }
          break
        }
      }
    } catch (e) {
      console.log(`  ⚪ blotter db (runner, live): Base RPC did not answer (${(e as Error).message.split('\n')[0]}) — the verified / mismatch legs are skipped`)
    }
    if (real) {
      const v = await mk('live')
      const art = { txChain: { steps: [{ tx: { chainId: 8453 } }] }, buildPath: 'native-swap-uniswap' }
      await M.recordTenantLeg({ jobId: `${tag}live`, seq: 0, wallet: real.from, builder: 'native-swap', artifact: art, valueUsd: 10, result: { txHash: real.hash }, tenantId: v.id, deskKeyId: null }, null)
      await M.recordTenantLeg({ jobId: `${tag}live`, seq: 1, wallet: owner, builder: 'native-swap', artifact: art, valueUsd: 10, result: { txHash: real.hash }, tenantId: v.id, deskKeyId: null }, null)
      const vr = await prisma.blotterRow.findMany({ where: { tenantId: v.id, kind: 'settled' }, orderBy: { seq: 'asc' } })
      check(
        'blotter db (runner, live): a real Base tx reported by its own sender settles `verified`; the same hash claimed by another wallet settles `mismatch` — the chain decides, not the claim',
        vr.map((x) => x.verification).join() === 'verified,mismatch' && (vr[0].payload as { signedSeq?: number }).signedSeq === 1,
        `${real.hash} ${vr.map((x) => x.verification).join()}`,
      )
    }

    // The sign-site row (the telemetry route calls this on a verified receipt).
    const tt = await mk('turn')
    await prisma.tenant.update({ where: { id: tt.id }, data: { signers: ['0x00000000000000000000000000000000000000aa'] } })
    const turnArgs = { tenantId: tt.id, deskKeyId: null, intentId: 'int-x', turnId: `${tag}turn`, wallet: '0x00000000000000000000000000000000000000bb', valueUsd: 30, buildPath: 'native-swap-uniswap', stampedFeeBps: 50, chainId: 8453, txHash: `0x${'cd'.repeat(32)}`, artifact: 'tx-chain', signers: ['0x00000000000000000000000000000000000000aa'] }
    await B.recordTenantTurn(turnArgs)
    await B.recordTenantTurn(turnArgs)
    const tr = await prisma.blotterRow.findMany({ where: { tenantId: tt.id }, orderBy: { seq: 'asc' } })
    check(
      'blotter db (sign site): a verified link turn writes signed (link tier 50 bps → $0.15) + settled:verified once, and flags a signer the tenant does not list',
      tr.map((x) => `${x.kind}${x.verification ? `:${x.verification}` : ''}`).join() === 'signed,settled:verified' && tr[0].feeBps === 50 && tr[0].feeUsd === 0.15 && (tr[0].payload as { signerListed?: unknown }).signerListed === false && tr[0].intentId === 'int-x',
    )

    // The statement: cut once, idempotent, a draft invoice with three lines.
    const st = await mk('stmt', new Date(Date.UTC(2026, 0, 10)))
    const sig = async (valueUsd: number, feeUsd: number, n: number) => (await B.recordBlotterOnce(`job:${tag}s:${n}:signed`, { tenantId: st.id, kind: 'signed', jobId: `${tag}s`, valueUsd, feeUsd, feeBps: 20, payload: { source: 'job-step', seq: n } }))!.seq
    const s1 = await sig(30, 0.06, 1)
    const s2 = await sig(40, 0.08, 2)
    await sig(10, 0.02, 3)
    const s4 = await sig(100, 0.2, 4)
    await B.recordBlotterOnce(`job:${tag}s:1:settled`, { tenantId: st.id, kind: 'settled', verification: 'verified', payload: { source: 'job-step', signedSeq: s1 } })
    await B.recordBlotterOnce(`job:${tag}s:2:settled`, { tenantId: st.id, kind: 'settled', verification: 'attested', payload: { source: 'job-step', signedSeq: s2 } })
    await B.recordBlotterOnce(`job:${tag}s:4:settled`, { tenantId: st.id, kind: 'settled', verification: 'mismatch', payload: { source: 'job-step', signedSeq: s4 } })
    const now = new Date()
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const after = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 2))
    const live = await S.monthlyStatement(st.id, ym, { stripe: null, sweep: false })
    check('statement db: the OPEN month answers live numbers and cuts nothing', !!live && !live.closed && !live.final && live.seq === null && (await prisma.blotterRow.count({ where: { tenantId: st.id, kind: 'statement' } })) === 0)
    const sub = await prisma.subscription.create({ data: { ownerAddress: owner, plan: 'free', status: 'active', stripeCustomerId: `cus_${tag}` } })
    try {
      const fake = fakeStripe()
      const cut = await S.monthlyStatement(st.id, ym, { now: after, stripe: fake.stripe, sweep: false })
      const again = await S.monthlyStatement(st.id, ym, { now: after, stripe: fake.stripe, sweep: false })
      const items = fake.calls.filter((c) => c.kind === 'item')
      const inv = fake.calls.find((c) => c.kind === 'invoice')
      check(
        'statement db: a closed month cuts — notional $80 (verified $30 + attested $40 + signed-only $10; the $100 mismatch excluded), platform $4,000, execution $0.08 fully credited by $0.16 in calldata, $4,000 due',
        !!cut && cut.final && !cut.existing && cut.notionalUsd === 80 && cut.calldataCreditUsd === 0.16 && cut.platform.dueUsd === 4000 && cut.execution.feeUsd === 0.08 && cut.creditAppliedUsd === 0.08 && cut.executionDueUsd === 0 && cut.amountDueUsd === 4000 && cut.legs.mismatch.usd === 100,
        JSON.stringify({ n: cut?.notionalUsd, due: cut?.amountDueUsd, exec: cut?.execution.feeUsd, credit: cut?.calldataCreditUsd }),
      )
      check(
        'statement db: re-running returns the cut row\'s numbers (same seq, same hash, existing) and drafts nothing more; exactly ONE statement row',
        !!again && again.existing && again.seq === cut?.seq && again.hash === cut?.hash && again.amountDueUsd === cut?.amountDueUsd && fake.calls.length === 4 && (await prisma.blotterRow.count({ where: { tenantId: st.id, kind: 'statement' } })) === 1,
      )
      check(
        'statement db: the draft invoice — the owner\'s Stripe customer, auto_advance false, send_invoice, items-only; three items (platform · execution · credit) in cents summing to the amount due; idempotency keys per tenant-month',
        inv?.params.customer === `cus_${tag}` && inv?.params.auto_advance === false && inv?.params.collection_method === 'send_invoice' && inv?.params.pending_invoice_items_behavior === 'exclude' && items.length === 3 && items.reduce((a, c) => a + Number(c.params.amount), 0) === 400_000 && items.every((c) => c.params.invoice === 'in_fake_1' && c.params.currency === 'usd') && String(inv?.key).startsWith(`pantessa-statement:${st.id}:${ym}`) && cut?.invoice?.id === 'in_fake_1',
        JSON.stringify(items.map((c) => c.params.amount)),
      )
      const vst = await B.verifyChain(st.id)
      check('statement db: the statement row is a link in the chain — verify still passes', vst.ok)

      // Stripe TEST mode, the real API shape (a draft with three lines, then deleted).
      const key = process.env.STRIPE_SECRET_KEY ?? ''
      if (key.startsWith('sk_test_')) {
        const { default: Stripe } = await import('stripe')
        const real = new Stripe(key)
        const cust = await real.customers.create({ email: `blotter-pins+${tag}@example.com`, description: 'blotter pins fixture (deleted after the run)', metadata: { fixture: tag } })
        try {
          // February: inside the free window, so the platform line is a $0 line — the real API must take it.
          const n = S.statementMath({ ym: '2026-02', tenantCreatedAt: new Date(Date.UTC(2026, 0, 10)), feeBps: null, legs: [leg(2_000_000, 400, 'verified')] })
          const drafted = await S.draftStatementInvoice(real as unknown as StripeLike, cust.id, { id: st.id, slug: st.slug }, n)
          const fetched = await real.invoices.retrieve(drafted.id)
          const lines = await real.invoices.listLineItems(drafted.id, { limit: 10 })
          check(
            'statement stripe (TEST mode): the real API drafts it — status draft, auto_advance false, three lines ($0 waived platform · $2,000 execution · −$400 calldata credit) summing to the $1,600 due',
            fetched.status === 'draft' && fetched.auto_advance === false && lines.data.length === 3 && lines.data.map((l) => l.amount).sort((x, y) => x - y).join() === '-40000,0,200000' && lines.data.reduce((a, l) => a + l.amount, 0) === Math.round(n.amountDueUsd * 100) && n.amountDueUsd === 1600,
            `status=${fetched.status} lines=${lines.data.map((l) => l.amount).join(',')} due=${n.amountDueUsd}`,
          )
          await real.invoices.del(drafted.id).catch(() => {})
        } catch (e) {
          check('statement stripe (TEST mode): the real API drafts it', false, (e as Error).message)
        } finally {
          await real.customers.del(cust.id).catch(() => {})
        }
      } else console.log('  ⚪ statement stripe: no sk_test_ key here — the real-API draft is skipped (the fake client covers the shape)')
    } finally {
      await prisma.subscription.delete({ where: { id: sub.id } }).catch(() => {})
    }
  } finally {
    // The fixtures are ours and on the TEST DB: remove them.
    await prisma.blotterRow.deleteMany({ where: { tenantId: { in: tenants } } }).catch(() => {})
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } }).catch(() => {})
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

export async function blotterHttpPins(check: Check, base: string): Promise<void> {
  const { default: prisma } = await import('../lib/db')
  const B = await import('../lib/tenant/blotter')
  const { entitlementsFor } = await import('../lib/tenant/entitlements')
  const { getEffectivePlan } = await import('../lib/billing')
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts')
  const { createSiweMessage } = await import('viem/siwe')
  const domain = new URL(base).host
  const cookieOf = (res: Response, name: string) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const m = c.match(new RegExp(`^${name}=([^;]+)`))
      if (m) return `${name}=${m[1]}`
    }
    return null
  }
  const signIn = async (acct: ReturnType<typeof privateKeyToAccount>) => {
    const nonceRes = await fetch(`${base}/api/auth/nonce`, { headers: { 'x-yf-internal-run': '1' } })
    const nonceCookie = cookieOf(nonceRes, 'yf_siwe_nonce')
    const { nonce } = (await nonceRes.json()) as { nonce: string }
    const message = createSiweMessage({ address: acct.address, chainId: 8453, domain, nonce, uri: base, version: '1' })
    const signature = await acct.signMessage({ message })
    const res = await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1', ...(nonceCookie ? { cookie: nonceCookie } : {}) }, body: JSON.stringify({ message, signature }) })
    const s = cookieOf(res, 'yf_session')
    if (!s) throw new Error(`SIWE sign-in failed (${res.status})`)
    return s
  }
  const ownerAcct = privateKeyToAccount(generatePrivateKey())
  const adminAcct = privateKeyToAccount(generatePrivateKey())
  const strangerAcct = privateKeyToAccount(generatePrivateKey())
  const [ownerS, adminS, strangerS] = await Promise.all([signIn(ownerAcct), signIn(adminAcct), signIn(strangerAcct)])
  const tag = `bh${Date.now().toString(36)}`
  const t = await prisma.tenant.create({ data: { slug: tag, name: 'blotter http pins', ownerAddress: ownerAcct.address.toLowerCase(), admins: [adminAcct.address.toLowerCase()], isInternal: true } })
  const get = (path: string, cookie?: string) => fetch(`${base}${path}`, { headers: { 'x-yf-internal-run': '1', ...(cookie ? { cookie } : {}) } })
  try {
    for (let i = 0; i < 4; i++) await B.recordBlotter({ tenantId: t.id, kind: 'intent', deskId: 'macro', intentId: `int${i}`, payload: { ask: `Buy $${i + 1} of ETH on Base`, i } })
    await B.recordBlotter({ tenantId: t.id, kind: 'signed', deskId: 'macro', valueUsd: 25, feeUsd: 0.05, feeBps: 20, chainId: 8453, payload: { note: 'a, "comma"' } })
    const p = `/api/tenants/${t.id}/blotter`
    const owner = await get(p, ownerS)
    const oj = (await owner.json()) as { rows?: { seq: number; kind: string }[]; head?: { seq: number }; next?: number | null; tenant?: { slug?: string } }
    check('blotter http: the owner reads the chain — 5 rows in seq order, the head, no next page', owner.status === 200 && oj.rows?.length === 5 && oj.rows.every((r, i) => r.seq === i + 1) && oj.head?.seq === 5 && oj.next === null && oj.tenant?.slug === tag && owner.headers.get('cache-control') === 'no-store', `${owner.status} ${JSON.stringify(oj).slice(0, 200)}`)
    const admin = await get(p, adminS)
    const stranger = await get(p, strangerS)
    const anon = await get(p)
    const nope = await get(`/api/tenants/cl_nonexistent_tenant/blotter`, ownerS)
    check('blotter http: an admin reads it; a signed-in stranger and an unknown id get 404 (an id never confirms itself); no session 401', admin.status === 200 && stranger.status === 404 && nope.status === 404 && anon.status === 401, `${admin.status} ${stranger.status} ${nope.status} ${anon.status}`)
    const page1 = (await (await get(`${p}?limit=2`, ownerS)).json()) as { rows: { seq: number }[]; next: number | null }
    const page2 = (await (await get(`${p}?limit=2&after=${page1.next}`, ownerS)).json()) as { rows: { seq: number }[] }
    const signedOnly = (await (await get(`${p}?kind=signed`, ownerS)).json()) as { rows: { kind: string; valueUsd: number }[] }
    const bad = await get(`${p}?kind=bogus`, ownerS)
    check('blotter http: pages by `after` (1,2 → 3,4), filters by kind, refuses an unknown kind with 400 in words', page1.rows.map((r) => r.seq).join() === '1,2' && page1.next === 2 && page2.rows.map((r) => r.seq).join() === '3,4' && signedOnly.rows.length === 1 && signedOnly.rows[0].valueUsd === 25 && bad.status === 400 && /unknown kind/.test(((await bad.json()) as { error?: string }).error ?? ''))

    const verify = (await (await get(`${p}/verify`, ownerS)).json()) as { ok: boolean; rows: number; head?: { seq: number }; brokenAt?: number }
    const victim = await prisma.blotterRow.findFirst({ where: { tenantId: t.id, seq: 3 } })
    await prisma.$executeRaw`UPDATE blotter_rows SET payload = jsonb_set(payload, '{ask}', '"Buy $9,999 of ETH on Base"') WHERE id = ${victim!.id}`
    const broken = (await (await get(`${p}/verify`, ownerS)).json()) as { ok: boolean; brokenAt?: number; reason?: string }
    await prisma.$executeRaw`UPDATE blotter_rows SET payload = ${JSON.stringify(victim!.payload)}::jsonb WHERE id = ${victim!.id}`
    const healed = (await (await get(`${p}/verify`, ownerS)).json()) as { ok: boolean }
    const vStranger = await get(`${p}/verify`, strangerS)
    check('blotter http: /verify replays 5 rows ok; a payload edited in the table → ok:false brokenAt 3; restored → ok; a stranger gets 404', verify.ok && verify.rows === 5 && verify.head?.seq === 5 && !broken.ok && broken.brokenAt === 3 && healed.ok && vStranger.status === 404, `${JSON.stringify(verify)} ${JSON.stringify(broken)}`)

    const { plan } = await getEffectivePlan(ownerAcct.address)
    const canExport = entitlementsFor(plan.id).blotterExport
    const csv = await get(`${p}?format=csv`, ownerS)
    if (canExport) {
      const text = await csv.text()
      check('blotter http: CSV (the plan exports) — text/csv attachment, the header, 5 lines', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') ?? '') && /attachment/.test(csv.headers.get('content-disposition') ?? '') && text.split('\r\n')[0] === BLOTTER_CSV_COLUMNS.join(',') && text.trim().split('\r\n').length === 6)
    } else {
      const cj = (await csv.json()) as { entitlement?: string; plan?: string; error?: string }
      check(`blotter http: CSV refused by NAME for a plan without blotterExport (${plan.id}) — 403 { entitlement: 'blotterExport' }; the JSON read stays open`, csv.status === 403 && cj.entitlement === 'blotterExport' && cj.plan === plan.id && /blotterExport/.test(cj.error ?? ''))
    }

    const sp = `/api/tenants/${t.id}/statement`
    const stmt = await get(`${sp}?ym=${lastClosedMonth()}`, ownerS)
    const sj = (await stmt.json()) as { preview?: boolean; entitlement?: string; statement?: { notionalUsd?: number; final?: boolean; lines?: unknown[]; platform?: { dueUsd?: number } } }
    const entStatement = entitlementsFor(plan.id).statement
    check(
      `blotter http: /statement answers the numbers (three lines); ${entStatement ? 'the plan has `statement`' : `without the statement entitlement (${plan.id}) it is preview:true and nothing is cut`}`,
      stmt.status === 200 && sj.statement?.lines?.length === 3 && sj.statement.platform?.dueUsd === 0 && (entStatement ? sj.preview === false : sj.preview === true && sj.entitlement === 'statement' && sj.statement.final === false),
      `${stmt.status} ${JSON.stringify(sj).slice(0, 240)}`,
    )
    const badYm = await get(`${sp}?ym=2026-13`, ownerS)
    const sStranger = await get(sp, strangerS)
    check('blotter http: /statement refuses a bad month (400) and a stranger (404)', badYm.status === 400 && sStranger.status === 404)
    check('blotter http: nothing was cut for a fresh tenant (the free window covers its first month; preview writes no row)', (await prisma.blotterRow.count({ where: { tenantId: t.id, kind: 'statement' } })) === (entStatement ? 1 : 0))
  } finally {
    await prisma.blotterRow.deleteMany({ where: { tenantId: t.id } }).catch(() => {})
    await prisma.tenant.delete({ where: { id: t.id } }).catch(() => {})
  }
}

// ── standalone ──────────────────────────────────────────────────────────────

function loadEnvLocal(): void {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
    }
  } catch {
    /* no .env.local — the DB pins skip */
  }
}

if (process.argv[1]?.endsWith('blotter-pins.ts')) {
  let pass = 0
  let fail = 0
  const check: Check = (name, ok, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
    ok ? pass++ : fail++
  }
  ;(async () => {
    console.log('— blotter (pure)')
    blotterPurePins(check)
    loadEnvLocal()
    const url = process.env.DATABASE_URL ?? ''
    const host = url.match(/@([^/?]+)/)?.[1] ?? ''
    if (!url) console.log('  ⚪ blotter db: no DATABASE_URL — the DB + HTTP pins are skipped')
    else if (/ep-wild-credit/.test(host)) console.log(`  ⚪ blotter db: ${host} is PRODUCTION — refusing to write fixtures there`)
    else {
      console.log(`— blotter (db: ${host})`)
      await blotterDbPins(check)
      if (process.env.BASE) {
        if (!/^http:\/\/localhost:441\d$/.test(process.env.BASE)) console.log(`  ⚪ blotter http: BASE must be http://localhost:4410–4419 (got ${process.env.BASE})`)
        else {
          console.log(`— blotter (http: ${process.env.BASE})`)
          await blotterHttpPins(check, process.env.BASE)
        }
      } else console.log('  ⚪ blotter http: no BASE — the route pass is skipped (BASE=http://localhost:4410 npm run pins:blotter)')
    }
    console.log(`\n${pass} passed, ${fail} failed`)
    const { default: prisma } = await import('../lib/db').catch(() => ({ default: null as null | { $disconnect(): Promise<void> } }))
    await prisma?.$disconnect().catch(() => {})
    process.exit(fail ? 1 : 0)
  })().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
