// scripts/receipt-binding-pins.ts — pins for RECEIPT BINDING (2026-11-04,
// squad five-million QA F1): a link / first-party receipt verifies only when
// the chain's transaction is the one Pantessa built for that wallet, mined
// after it was built, once. Runs inside test:api (the tail calls
// receiptBindingPins(check) + receiptBindingLivePins(check, BASE)) and alone:
// `npm run pins:receipt-binding` (add `--live` with BASE to drive the
// recording site with the burner).
//
// The attack it closes: POST /api/chat records expectations for ANY body-
// claimed wallet (builds are connect-to-act); the old verdict matched a
// receipt on {to, selector} with no time window, so a forged beacon naming
// ANY historical USDC approve the victim ever sent on Base read `verified`,
// claimed the victim for a stranger's link for life (referred_wallets) and
// counted the beacon's own dollars as money moved.
//
// What they hold:
//   · calldataHashOf: keccak256 of the exact calldata; a native send hashes
//     the empty byte string (what the chain reports as `input: 0x`); case
//     does not matter; junk hashes as empty.
//   · builtTxsOf: the lone txRequest or EVERY step of a txChain, normalized
//     (lowercased, Base when a step names no chain, a step with no `to`
//     skipped).
//   · expectationOf: the row carries {to, selector} as before PLUS the hash,
//     the build moment and the head the server saw on that chain (null when
//     the head was not read).
//   · minedAfterBuild: height is the fence when the build saw the head
//     (strict — the head it saw was already sealed), else block time against
//     recordedAt within the clock slack; a bound row with neither fails
//     closed; a fence that needs an unread block time says so.
//   · judgeReceipt: the ladder — reuse / no signer / another sender /
//     reverted refuse; the exact calldata mined after its build VERIFIES and
//     names its build; mined before its build or spent by another tx is a
//     replay (mismatch, terminal); a legacy {to, selector} row ATTESTS and
//     never verifies; matching nobody's build stays unverified.
//   · Source fences: the chat route captures the build moment + the heads
//     BEFORE it responds and records every wallet-bound build; the refresh
//     route records the REFRESHED step the card signs, on the step's own
//     chain; the spend is ONE conditional write; both verify paths read the
//     bound columns and spend on verified; the prisma model, the DDL and the
//     npm script carry the feature.
//   · Live (BASE + the burner): a real build from POST /api/chat lands in
//     intent_link_expectations with the hash of the calldata it answered,
//     recorded before the response, with the head of the chain it built on,
//     unspent.

import { readFileSync } from 'node:fs'
import { keccak256 } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  builtTxsOf,
  calldataHashOf,
  CHAT_EXPECTATION_SLUG,
  decideReceiptVerdict,
  expectationOf,
  judgeReceipt,
  minedAfterBuild,
  RECEIPT_CLOCK_SLACK_MS,
  type ExpectationFact,
  type ReceiptFacts,
} from '../lib/link-receipt-verify'

type Check = (name: string, ok: boolean, extra?: string) => void

const W = '0x1111111111111111111111111111111111111111'
const TO = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const APPROVE = '0x095ea7b3000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb00000000000000000000000000000000000000000000000000000000004c4b40'
const EMPTY_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
const H = (c: string) => `0x${c.repeat(64)}`

export function receiptBindingPins(check: Check): void {
  // ── the hash ──
  check('receipt binding: calldataHashOf is keccak256 of the exact calldata — a native send ("", undefined, "0x") hashes the empty byte string, case does not matter, junk hashes as empty',
    calldataHashOf('0x') === EMPTY_HASH && calldataHashOf('') === EMPTY_HASH && calldataHashOf(undefined) === EMPTY_HASH && calldataHashOf(null) === EMPTY_HASH && calldataHashOf('zz') === EMPTY_HASH &&
      calldataHashOf(APPROVE) === keccak256(APPROVE as `0x${string}`).toLowerCase() && calldataHashOf(APPROVE.toUpperCase().replace('0X', '0x')) === calldataHashOf(APPROVE) && calldataHashOf(APPROVE) !== calldataHashOf(APPROVE.slice(0, -2) + '41'))

  // ── the artifact's transactions ──
  const chainArtifact = { txChain: { steps: [{ tx: { to: TO.toUpperCase().replace('0X', '0x'), data: APPROVE, chainId: 1 } }, { tx: { to: TO, data: '0x3593564c00', chainId: 1 } }, { tx: { data: '0x00' } }, { tx: { to: TO } }] } }
  const built = builtTxsOf(chainArtifact)
  check('receipt binding: builtTxsOf takes every step of a txChain (one expectation per step — the approve and the swap are both signed), lowercased, skipping a step with no `to`; a lone txRequest is one; a step with no chain is Base, no data is 0x; nothing from nothing',
    built.length === 3 && built[0].to === TO && built[0].data === APPROVE && built[0].chainId === 1 && built[1].data === '0x3593564c00' && built[2].to === TO && built[2].data === '0x' && built[2].chainId === 8453 &&
      builtTxsOf({ txRequest: { to: TO, data: '0xAB', chainId: 8453 } }).length === 1 && builtTxsOf({ txRequest: { to: TO, data: '0xAB', chainId: 8453 } })[0].data === '0xab' &&
      builtTxsOf({}).length === 0 && builtTxsOf(null).length === 0 && builtTxsOf({ reply: 'words' }).length === 0, JSON.stringify(built))
  const at = new Date('2026-11-04T10:00:00Z')
  const row = expectationOf('abcd1234', W.toUpperCase().replace('0X', '0x'), built[0], { recordedAt: at, heads: { 1: 23_456_789, 8453: null } })
  const rowNoHead = expectationOf(CHAT_EXPECTATION_SLUG, W, built[2], { recordedAt: at })
  check('receipt binding: expectationOf keeps {to, selector, chainId} and adds the calldata hash, the build moment and the head the server saw on THAT chain (null when unread); a native send has no selector and the empty hash; the wallet is lowercased',
    row.slug === 'abcd1234' && row.wallet === W && row.chainId === 1 && row.toAddr === TO && row.selector === '0x095ea7b3' && row.calldataHash === calldataHashOf(APPROVE) && row.recordedAt === at && row.recordedBlock === 23_456_789 &&
      rowNoHead.slug === '' && rowNoHead.selector === null && rowNoHead.calldataHash === EMPTY_HASH && rowNoHead.recordedBlock === null && expectationOf('x', W, built[1], { recordedAt: at, heads: { 1: Number.NaN } }).recordedBlock === null, JSON.stringify(row))

  // ── the fence ──
  const byHeight: ExpectationFact = { toAddr: TO, selector: null, calldataHash: EMPTY_HASH, recordedAt: at, recordedBlock: 100 }
  const byTime: ExpectationFact = { toAddr: TO, selector: null, calldataHash: EMPTY_HASH, recordedAt: at, recordedBlock: null }
  check('receipt binding: minedAfterBuild fences by HEIGHT when the build saw the head — strictly after (101 > 100 passes; the head’s own block and anything under it fail) — with no clock in it',
    minedAfterBuild(101, null, byHeight) === 'after' && minedAfterBuild(100, null, byHeight) === 'before' && minedAfterBuild(99, at.getTime() + 1e6, byHeight) === 'before' && minedAfterBuild(1_000_000, 0, byHeight) === 'after')
  check(`receipt binding: with no head on record the fence is block TIME against the build moment within the ${RECEIPT_CLOCK_SLACK_MS / 1000}s clock slack (a Base head trails the wall clock by up to a block); an unread block time says so; a bound row with neither fails closed`,
    minedAfterBuild(101, at.getTime(), byTime) === 'after' && minedAfterBuild(101, at.getTime() - RECEIPT_CLOCK_SLACK_MS, byTime) === 'after' && minedAfterBuild(101, at.getTime() - RECEIPT_CLOCK_SLACK_MS - 1, byTime) === 'before' &&
      minedAfterBuild(101, at.getTime() + 3600_000, byTime) === 'after' && minedAfterBuild(101, null, byTime) === 'unread' && minedAfterBuild(101, undefined, byTime) === 'unread' &&
      minedAfterBuild(101, at.getTime(), { ...byTime, recordedAt: null }) === 'before' && minedAfterBuild(null, at.getTime(), byHeight) === 'after' && RECEIPT_CLOCK_SLACK_MS === 90_000)

  // ── the ladder ──
  const tx = { from: W, to: TO.toUpperCase().replace('0X', '0x'), input: APPROVE, blockNumber: 500 }
  const legacy: ExpectationFact = { toAddr: TO, selector: '0x095ea7b3' }
  const boundRow: ExpectationFact = { id: 'b1', toAddr: TO, selector: '0x095ea7b3', calldataHash: calldataHashOf(APPROVE), recordedAt: at, recordedBlock: 499 }
  const facts = (over: Partial<ReceiptFacts>): ReceiptFacts => ({ wallet: W, tx, receiptStatus: 'success', txHash: H('ab'), expectations: [boundRow], hashReused: false, ...over })
  const honest = judgeReceipt(facts({}))
  check('receipt binding (ladder): the exact calldata, from the wallet, successful, mined after its build → VERIFIED, naming the build it rests on; decideReceiptVerdict is that verdict',
    honest.verdict === 'verified' && honest.hit?.id === 'b1' && /mined after its build/.test(honest.reason) && decideReceiptVerdict(facts({})) === 'verified', JSON.stringify(honest))
  const forged = judgeReceipt(facts({ expectations: [{ ...boundRow, recordedBlock: 500 }] }))
  const forgedTime = judgeReceipt(facts({ expectations: [{ ...boundRow, recordedBlock: null, recordedAt: new Date(at.getTime() + 3600_000) }], blockTimeMs: at.getTime() }))
  check('receipt binding (ladder, F1): the same calldata recorded with the head AT the tx’s block (a plant after the victim’s tx) is a MISMATCH naming the replay; so is a plant with no head whose build moment is an hour after the block',
    forged.verdict === 'mismatch' && /mined before its build/.test(forged.reason) && forgedTime.verdict === 'mismatch' && /mined before its build/.test(forgedTime.reason), JSON.stringify({ forged, forgedTime }))
  const unread = judgeReceipt(facts({ expectations: [{ ...boundRow, recordedBlock: null }] }))
  const readLater = judgeReceipt(facts({ expectations: [{ ...boundRow, recordedBlock: null }], blockTimeMs: at.getTime() + 5000 }))
  check('receipt binding (ladder): a bound match with no head on record and no block time read yet is UNVERIFIED ("block time unread" — the shell reads the block and asks again); with the time read it verifies',
    unread.verdict === 'unverified' && unread.reason === 'block time unread' && readLater.verdict === 'verified', JSON.stringify({ unread, readLater }))
  const spentElsewhere = judgeReceipt(facts({ expectations: [{ ...boundRow, usedTxHash: H('cd') }] }))
  const spentHere = judgeReceipt(facts({ expectations: [{ ...boundRow, usedTxHash: H('AB') }] }))
  check('receipt binding (ladder): a build already spent by ANOTHER transaction is a MISMATCH (one build, one receipt — identical calldata sent twice verifies once); spent by THIS hash still verifies (the funnel event and the money row of one signature share a hash)',
    spentElsewhere.verdict === 'mismatch' && /spent by another/.test(spentElsewhere.reason) && spentHere.verdict === 'verified', JSON.stringify({ spentElsewhere, spentHere }))
  const attested = judgeReceipt(facts({ expectations: [legacy] }))
  const attestedNative = judgeReceipt(facts({ tx: { ...tx, input: '0x' }, expectations: [{ toAddr: TO, selector: null }] }))
  const attestedNoSel = judgeReceipt(facts({ expectations: [{ toAddr: TO, selector: null }] }))
  check('receipt binding (ladder): a LEGACY {to, selector} row (no hash) ATTESTS a matching receipt — a native send against a selector-less row, and a selector-less row against any input, alike — and never verifies',
    attested.verdict === 'attested' && attestedNative.verdict === 'attested' && attestedNoSel.verdict === 'attested' && !/verified/.test(attested.verdict), JSON.stringify({ attested, attestedNative }))
  const nobody = judgeReceipt(facts({ tx: { ...tx, input: APPROVE.slice(0, -2) + '41' } }))
  const wrongTo = judgeReceipt(facts({ tx: { ...tx, to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } }))
  const legacyWrongSel = judgeReceipt(facts({ tx: { ...tx, input: '0x99999999' }, expectations: [legacy] }))
  check('receipt binding (ladder): a tx that matches nobody’s build — a different amount in the same approve, another target, a legacy row with another selector — is UNVERIFIED (counts nothing; never a terminal verdict on a tx nobody built)',
    nobody.verdict === 'unverified' && nobody.reason === "matches nobody's build" && wrongTo.verdict === 'unverified' && legacyWrongSel.verdict === 'unverified', JSON.stringify({ nobody, wrongTo, legacyWrongSel }))
  check('receipt binding (ladder): the refusals come first and are unchanged — hash reused, no signer, another wallet’s tx (even with no receipt), reverted → MISMATCH; chain dark or no build on record → UNVERIFIED',
    judgeReceipt(facts({ hashReused: true })).verdict === 'mismatch' && judgeReceipt(facts({ wallet: null })).verdict === 'mismatch' &&
      judgeReceipt(facts({ tx: { ...tx, from: '0x2222222222222222222222222222222222222222' }, receiptStatus: null })).verdict === 'mismatch' && judgeReceipt(facts({ receiptStatus: 'reverted' })).verdict === 'mismatch' &&
      judgeReceipt(facts({ tx: null, receiptStatus: null })).verdict === 'unverified' && judgeReceipt(facts({ receiptStatus: null })).verdict === 'unverified' && judgeReceipt(facts({ expectations: [] })).verdict === 'unverified')
  const mixedVerified = judgeReceipt(facts({ expectations: [legacy, boundRow] }))
  const mixedReplay = judgeReceipt(facts({ expectations: [legacy, { ...boundRow, recordedBlock: 500 }] }))
  const mixedTwo = judgeReceipt(facts({ expectations: [{ ...boundRow, id: 'old', recordedBlock: 500 }, { ...boundRow, id: 'new', recordedBlock: 498 }] }))
  check('receipt binding (ladder): a bound verdict outranks a legacy row for the same target — verified when the bound row fits, a REPLAY when it does not (never attested on the side); two builds of the same calldata verify on the one recorded before the tx',
    mixedVerified.verdict === 'verified' && mixedVerified.hit?.id === 'b1' && mixedReplay.verdict === 'mismatch' && mixedTwo.verdict === 'verified' && mixedTwo.hit?.id === 'new', JSON.stringify({ mixedVerified, mixedReplay, mixedTwo }))

  // ── source fences ──
  const chat = readFileSync('app/api/chat/route.ts', 'utf8')
  const capture = chat.indexOf('const recordedAt = new Date()')
  check('receipt binding (source): the chat route captures the build moment and observes the heads of every chain the artifact touches BEFORE it responds, and records every wallet-bound build with them after the response',
    capture > 0 && chat.includes('const heads = await observeChainHeads(builtTxsOf(artifactData).map((t) => t.chainId))') && chat.includes('after(() => recordTurnExpectations(reqBody, artifactData, { recordedAt, heads }))') &&
      chat.indexOf('after(() => recordTurnExpectations') > capture && chat.includes("import { builtTxsOf, observeChainHeads, recordTurnExpectations } from '@/lib/link-receipt-verify'"))
  const refresh = readFileSync('app/api/tx/refresh/route.ts', 'utf8')
  check('receipt binding (source): the refresh route records the REFRESHED step the card signs — every offer goes through offerStep (five sites, no bare `NextResponse.json({ tx:`), on the step’s own chain with the branch’s chain as the fallback, under the link the build was born on',
    (refresh.match(/return offerStep\(/g) ?? []).length === 5 && !refresh.includes('NextResponse.json({ tx:') && refresh.includes('chainId: payload.tx.chainId ?? chainId') &&
      refresh.includes('after(() => recordBuiltExpectations({ slug: linkSlug ?? CHAT_EXPECTATION_SLUG, wallet: from.toLowerCase(), txs, recordedAt, heads }))') && refresh.includes("import { NextRequest, NextResponse, after } from 'next/server'"))
  const lib = readFileSync('lib/link-receipt-verify.ts', 'utf8')
  check('receipt binding (source): both verify paths read the bound columns, judge with the chain’s time only when a bound match needs it, and SPEND on verified through one conditional write (null or this hash)',
    (lib.match(/select: EXPECTATION_SELECT/g) ?? []).length === 2 && (lib.match(/await judgeWithChainTime\(/g) ?? []).length === 2 && (lib.match(/await spendIfVerified\(judged, /g) ?? []).length === 2 &&
      lib.includes('updateMany({ where: { id: j.hit.id, OR: [{ usedTxHash: null }, { usedTxHash: hash }] }, data: { usedTxHash: hash } })') && lib.includes("return spent.count === 1 ? 'verified' : 'unverified'") &&
      lib.includes("if (first.verdict !== 'unverified' || first.reason !== 'block time unread' || facts.tx?.blockNumber == null) return first"))
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const ddl = readFileSync('prisma/ddl/2026-11-04-receipt-binding.sql', 'utf8')
  const pkg = readFileSync('package.json', 'utf8')
  check('receipt binding (source): the prisma model and the additive DDL carry calldata_hash · recorded_at · recorded_block · used_tx_hash (every ADD COLUMN IF NOT EXISTS), and the npm script exists',
    /calldataHash\s+String\?\s+@map\("calldata_hash"\)/.test(schema) && /recordedAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("recorded_at"\)/.test(schema) && /recordedBlock\s+Int\?\s+@map\("recorded_block"\)/.test(schema) && /usedTxHash\s+String\?\s+@map\("used_tx_hash"\)/.test(schema) &&
      ['calldata_hash text', 'recorded_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP', 'recorded_block integer', 'used_tx_hash text'].every((c) => ddl.includes(`ALTER TABLE intent_link_expectations ADD COLUMN IF NOT EXISTS ${c};`)) &&
      pkg.includes('"pins:receipt-binding": "tsx scripts/receipt-binding-pins.ts"'))
}

/** The recording site, driven: a real build from POST /api/chat for the
 *  burner lands in intent_link_expectations bound to the calldata it
 *  answered. Needs DATABASE_URL (env or .env.local) and PRIVATE_KEY; skips by
 *  name without them. No money moves — the build is never signed. */
export async function receiptBindingLivePins(check: Check, base: string): Promise<void> {
  const env = (() => {
    try {
      return readFileSync('.env.local', 'utf8')
    } catch {
      return ''
    }
  })()
  const read = (k: string) => process.env[k] ?? env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? null
  const dbUrl = read('DATABASE_URL')
  const pk = read('PRIVATE_KEY')
  if (!dbUrl || !pk) {
    check(`receipt binding live: skipped — no ${!dbUrl ? 'DATABASE_URL' : 'PRIVATE_KEY'} for the recording drive`, true)
    return
  }
  const sender = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  const wallet = sender.address.toLowerCase()
  const recipient = privateKeyToAccount(generatePrivateKey()).address
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  const since = new Date(Date.now() - 2000)
  try {
    const turn = (await (
      await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1', 'x-yf-internal-run': '1' },
        body: JSON.stringify({ message: `send 1 USDC to ${recipient} on base`, walletAddress: sender.address, activeServers: [], history: [] }),
      })
    ).json()) as { reply?: string; txRequest?: { to?: string; data?: string; chainId?: number }; buildPath?: string }
    const responded = new Date()
    if (!turn.txRequest?.to) {
      check(`receipt binding live: skipped — the send did not build (${turn.buildPath ?? 'no path'}: ${String(turn.reply ?? '').slice(0, 120)})`, true)
      return
    }
    const want = calldataHashOf(turn.txRequest.data)
    // The write rides `after()` — give it a moment.
    let row: { toAddr: string; selector: string | null; calldataHash: string | null; recordedAt: Date; recordedBlock: number | null; usedTxHash: string | null; chainId: number } | null = null
    for (let i = 0; i < 12 && !row; i++) {
      row = await db.intentLinkExpectation.findFirst({ where: { slug: CHAT_EXPECTATION_SLUG, wallet, calldataHash: want, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, select: { toAddr: true, selector: true, calldataHash: true, recordedAt: true, recordedBlock: true, usedTxHash: true, chainId: true } }).catch(() => null)
      if (!row) await new Promise((r) => setTimeout(r, 500))
    }
    check(
      'receipt binding live: a real build (the burner’s "send 1 USDC") is recorded under the chat slug with the keccak256 of the EXACT calldata it answered, its target and selector, the build moment before the response, the head of the chain it built on, unspent',
      !!row && row.toAddr === turn.txRequest.to.toLowerCase() && row.selector === String(turn.txRequest.data ?? '').slice(0, 10).toLowerCase() && row.chainId === (turn.txRequest.chainId ?? 8453) &&
        row.recordedAt.getTime() >= since.getTime() && row.recordedAt.getTime() <= responded.getTime() && (row.recordedBlock == null || row.recordedBlock > 1_000_000) && row.usedTxHash === null,
      JSON.stringify({ row, to: turn.txRequest.to, chainId: turn.txRequest.chainId, path: turn.buildPath }),
    )
    check('receipt binding live: the head was read on the chain of the build (Base ≥ 30M; null only when the RPC did not answer in time)', !!row && (row.recordedBlock == null || row.recordedBlock > 30_000_000), JSON.stringify({ head: row?.recordedBlock ?? null }))
    await db.intentLinkExpectation.deleteMany({ where: { slug: CHAT_EXPECTATION_SLUG, wallet, calldataHash: want, createdAt: { gte: since } } }).catch(() => {})
  } finally {
    await db.$disconnect().catch(() => {})
  }
}

if (process.argv[1]?.endsWith('receipt-binding-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  }
  receiptBindingPins(check)
  const done = process.argv.includes('--live') ? receiptBindingLivePins(check, process.env.BASE ?? 'http://localhost:3000') : Promise.resolve()
  done.then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall receipt binding pins green')
    process.exit(failed ? 1 : 0)
  })
}
