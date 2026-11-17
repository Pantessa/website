// Pins for "a nonce conflict is a transaction in flight, not a retry"
// (lib/tx-inflight, components/SendTxButton).
//
// 2026-11-17, prod job cmwkvauga001mkbdvwjipojey: a $2 gas bridge from a
// Pantessa account went out on Ethereum nonce 0 while its card painted
// "Replacement transaction underpriced." beside a Retry that asked the
// wallet for the same bridge on the same nonce (three refusals in 108s).
// These pins hold:
//   - the node's nonce-conflict words recognised, and ordinary refusals not,
//   - the card's own transaction found by sender + destination + calldata,
//   - the three verdicts of one look (found / waiting / cleared),
//   - the component: one request at a time, a conflict follows instead of
//     offering Retry, and the remembered ask is kept while something is out.
//
// Pure (no server, no chain, no DB). Called from scripts/test-api.ts;
// runnable alone:  npx tsx scripts/tx-inflight-pins.ts
import { readFileSync } from 'node:fs'
import {
  INFLIGHT_COPY,
  INFLIGHT_MAX_BLOCKS_PER_LOOK,
  inflightScanBlocks,
  inflightVerdict,
  isNonceConflict,
  matchSentTx,
} from '../lib/tx-inflight'

type Check = (name: string, ok: boolean, extra?: string) => void

export function txInflightPins(check: Check): void {
  const conflicts = [
    'Replacement transaction underpriced.', // the 2026-11-17 words, verbatim
    'replacement transaction underpriced',
    'replacement fee too low',
    'nonce too low: next nonce 1, tx nonce 0',
    'Nonce too low',
    'already known',
    'Transaction with the same hash was already imported.',
    'AlreadyKnown: known transaction',
  ]
  const missed = conflicts.filter((w) => !isNonceConflict(w))
  check('tx inflight: every node spelling of "this wallet already has a transaction on that nonce" is a nonce conflict', missed.length === 0, missed.join(' | '))
  const ordinary = [
    'insufficient funds for gas * price + value',
    'User rejected the request.',
    'transaction underpriced', // a FIRST send under the pool floor: nothing is out, Retry is right
    'max fee per gas less than block base fee',
    'execution reverted: STF',
    'The request took too long to respond.',
    '',
  ]
  const wrong = ordinary.filter((w) => isNonceConflict(w))
  check('tx inflight: an ordinary refusal (no gas, a rejection, a revert, a first send under the pool floor, a timeout) is NOT a nonce conflict', wrong.length === 0 && !isNonceConflict(null) && !isNonceConflict(undefined), wrong.join(' | '))

  const ME = '0xdB53146089e6c00521944dFD8637Ae2c6b904D90'
  const LIFI = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
  const DATA = '0x1794958fAB'
  const block = [
    { from: '0x0000000000000000000000000000000000000001', to: LIFI, input: DATA.toLowerCase(), hash: '0xother' },
    { from: ME.toLowerCase(), to: LIFI.toLowerCase(), input: '0x1794958fac', hash: '0xrequoted' },
    { from: ME.toLowerCase(), to: null, input: DATA.toLowerCase(), hash: '0xdeploy' },
    { from: ME.toLowerCase(), to: LIFI.toLowerCase(), input: DATA.toLowerCase(), hash: '0xmine' },
  ]
  check('tx inflight: matchSentTx finds the card\'s own transaction by sender + destination + byte-identical calldata, case-insensitively',
    matchSentTx(block, { from: ME, to: LIFI, data: DATA })?.hash === '0xmine')
  check('tx inflight: another sender, a re-quoted calldata, or a contract creation is never mistaken for it; a hashless row is not a match',
    matchSentTx(block.slice(0, 3), { from: ME, to: LIFI, data: DATA }) === null &&
      matchSentTx([{ from: ME, to: LIFI, input: DATA, hash: null }], { from: ME, to: LIFI, data: DATA }) === null)
  check('tx inflight: a plain transfer (no calldata) matches "0x" and an absent input alike',
    matchSentTx([{ from: ME, to: LIFI, input: '0x', hash: '0xplain' }], { from: ME, to: LIFI })?.hash === '0xplain' &&
      matchSentTx([{ from: ME, to: LIFI, hash: '0xplain2' }], { from: ME, to: LIFI, data: '0x' })?.hash === '0xplain2')

  const few = inflightScanBlocks({ cursor: BigInt(100), latest: BigInt(103) })
  const many = inflightScanBlocks({ cursor: BigInt(0), latest: BigInt(1000) })
  check('tx inflight: one look reads the blocks after the cursor, newest first, never the cursor itself, capped',
    few.join(',') === '103,102,101' && many.length === INFLIGHT_MAX_BLOCKS_PER_LOOK && many[0] === BigInt(1000) &&
      inflightScanBlocks({ cursor: BigInt(5), latest: BigInt(5) }).length === 0)

  check('tx inflight: found wins; an unmoved mined count is waiting; a moved count with no match is cleared ONLY when every block was read; a failed read is waiting',
    inflightVerdict({ found: true, minedAtStart: 0, minedNow: 1, scannedAll: true }) === 'found' &&
      inflightVerdict({ found: false, minedAtStart: 0, minedNow: 0, scannedAll: true }) === 'waiting' &&
      inflightVerdict({ found: false, minedAtStart: 0, minedNow: 1, scannedAll: true }) === 'cleared' &&
      inflightVerdict({ found: false, minedAtStart: 0, minedNow: 1, scannedAll: false }) === 'waiting' &&
      inflightVerdict({ found: false, minedAtStart: null, minedNow: 1, scannedAll: true }) === 'waiting' &&
      inflightVerdict({ found: false, minedAtStart: 0, minedNow: null, scannedAll: true }) === 'waiting')

  check('tx inflight: NOTHING in flight (first look, every block read, no pending transaction, count unmoved) is `none`: the wallet\'s own stale nonce, the 16:05Z "Nonce too low"',
    inflightVerdict({ found: false, minedAtStart: 1, minedNow: 1, scannedAll: true, pendingNow: 1, firstLook: true }) === 'none')
  check('tx inflight: `none` is never said while something is pending, on a later look, on a capped look, or when the pending count could not be read',
    inflightVerdict({ found: false, minedAtStart: 0, minedNow: 0, scannedAll: true, pendingNow: 1, firstLook: true }) === 'waiting' &&
      inflightVerdict({ found: false, minedAtStart: 1, minedNow: 1, scannedAll: true, pendingNow: 1, firstLook: false }) === 'waiting' &&
      inflightVerdict({ found: false, minedAtStart: 1, minedNow: 1, scannedAll: false, pendingNow: 1, firstLook: true }) === 'waiting' &&
      inflightVerdict({ found: false, minedAtStart: 1, minedNow: 1, scannedAll: true, pendingNow: null, firstLook: true }) === 'waiting' &&
      inflightVerdict({ found: true, minedAtStart: 1, minedNow: 1, scannedAll: true, pendingNow: 1, firstLook: true }) === 'found')
  check('tx inflight: the waiting words say nothing new was signed and that the card continues on its own; no copy offers a retry; the stale-nonce words say nothing was sent',
    /Nothing new was signed/.test(INFLIGHT_COPY.waiting) && /continues on its own/.test(INFLIGHT_COPY.waiting) && /nothing was sent/.test(INFLIGHT_COPY.stale) &&
      !Object.values(INFLIGHT_COPY).some((w) => /retry/i.test(w)))

  // ── the component ──────────────────────────────────────────────────────
  const lib = readFileSync('lib/tx-inflight.ts', 'utf8')
  check('tx inflight: lib/tx-inflight is pure (no react, no wagmi, no window)', !/from 'react'|from 'wagmi'|window\.|document\./.test(lib))
  const btn = readFileSync('components/SendTxButton.tsx', 'utf8')
  check('tx inflight (button): ONE request per card at a time (a ref latch taken before the wallet is asked, released in finally)',
    /const sending = useRef\(false\)/.test(btn) && /if \(sending\.current\) return\s+sending\.current = true\s+try \{[\s\S]{0,400}await sendOnce\(true\)[\s\S]{0,60}\} finally \{\s+sending\.current = false/.test(btn))
  check('tx inflight (button): a nonce conflict follows the transaction already out (returns before the red Retry) and keeps the remembered ask',
    /const conflict = isNonceConflict\(msg\)/.test(btn) && /if \(outcomeKey && !conflict\) clearSignOutcome/.test(btn) &&
      /if \(conflict\) \{[\s\S]{0,300}return follow\(askedAtMs, /.test(btn))
  check('tx inflight (button): while following, the button is disabled and says so; the found transaction is recorded settled and completes the step',
    /status === 'signing' \|\| status === 'broadcast' \|\| status === 'following'/.test(btn) && /status === 'following'\s+\? INFLIGHT_COPY\.button/.test(btn) &&
      /state: 'settled', askedAt, settledAt: Date\.now\(\), hash: found/.test(btn) && /if \(receipt\.status === 'success'\) onConfirmed\?\.\(found\)/.test(btn))
  check('tx inflight (button): a Pantessa account\'s send carries the chain\'s own nonce (count including pending), read only for the embedded wallet',
    /explicitNonceTag = 'pending'/.test(lib) && /if \(embedded && publicClient\) \{\s+nonce = await publicClient\.getTransactionCount\(\{ address: address as `0x\$\{string\}`, blockTag: explicitNonceTag \}\)/.test(btn) &&
      /\.\.\.\(nonce != null \? \{ nonce \} : \{\}\)/.test(btn) && /const embedded = connector\?\.id === CDP_CONNECTOR_ID/.test(btn))
  check('tx inflight (button): a stale-nonce refusal re-sends ONCE in the same press (embedded), hands the step back (other wallets), and a second conflict waits, never a third send',
    /if \(\(await sendOnce\(true\)\) === 'resend'\) await sendOnce\(false\)/.test(btn) &&
      /return follow\(askedAtMs, !embedded \? 'hand-back' : mayResend \? 'resend' : 'wait'\)/.test(btn) && /verdict === 'none' && onNone !== 'wait'/.test(btn))
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /tx-inflight-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  txInflightPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
