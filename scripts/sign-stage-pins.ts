// Pins for "only the wallet may be blamed for a wallet rejection"
// (lib/wallet-refusal signStageError, lib/cow-refusal).
//
// 2026-11-11: a wallet SIGNED a $25 USDC → UNI CoW limit order on Base, CoW's
// order book refused the signed order, our relay answered 502 "CoW order
// book rejected the order: …", and the sign button's /rejected|denied/ test
// printed "Signature rejected in the wallet — check the wallet is on Base".
// CoW's reason was in no log and no row. These pins hold:
//   - the two stages apart (wallet vs server) on all five sign surfaces that
//     call a server after the signature,
//   - CoW's errorType kept, worded, logged and filed as `venue-refused`,
//   - the admin feed able to filter every kind the failures page labels.
//
// signStagePins is pure (no server, no chain, no DB). cowRefusalLivePins
// posts ONE order signed by a fresh, unfunded throwaway key through the
// relay: CoW stops it at its balance check (InsufficientBalance), so nothing
// can ever be placed, and the harness header keeps it off the failures log.
// Called from scripts/test-api.ts; runnable alone:
//   npx tsx scripts/sign-stage-pins.ts            (pure)
//   BASE=http://localhost:4490 npx tsx scripts/sign-stage-pins.ts   (+ live)
import { readFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { cowRefusalOf, cowRefusalWords, signOrderErrorText } from '../lib/cow-refusal'
import { isReportableWalletError, signStageError, VENUE_REFUSED_KIND } from '../lib/wallet-refusal'
import { COW_APP_DATA_HASH, COW_APP_DATA_JSON } from '../lib/cow'

type Check = (name: string, ok: boolean, extra?: string) => void

const rf = (p: string) => readFileSync(p, 'utf8')

/** Every errorType CoW's POST /api/v1/orders can answer
 *  (cowprotocol/services crates/orderbook/src/api/post_order.rs, 2026-11-11). */
const COW_ERROR_TYPES = [
  'AppDataHashMismatch', 'AppdataFromMismatch', 'DuplicatedOrder', 'ExcessiveValidTo', 'FastPathLimitTooTight', 'Forbidden',
  'IncompatibleSigningScheme', 'InsufficientAllowance', 'InsufficientBalance', 'InsufficientValidTo', 'InvalidAppData',
  'InvalidEip1271Signature', 'InvalidNativeSellToken', 'InvalidSignature', 'InvalidValidFrom', 'MetadataSerializationFailed',
  'MissingFrom', 'NonZeroFee', 'QuoteNotVerified', 'SameBuyAndSellToken', 'SellAmountOverflow', 'TooManyLimitOrders',
  'TooMuchGas', 'TransferSimulationFailed', 'UnsupportedBuyTokenDestination', 'UnsupportedSellTokenSource', 'UnsupportedToken',
  'WrongOwner', 'ZeroAmount',
]

const IN_THE_WALLET = /in the wallet/i

export function signStagePins(check: Check): void {
  // ── CoW's answer, read and worded ──────────────────────────────────────
  const bal = cowRefusalOf(400, { errorType: 'InsufficientBalance', description: 'order owner must have funds worth at least x in his account' })
  check('sign stage (cow): cowRefusalOf keeps CoW\'s errorType + description',
    bal.status === 400 && bal.errorType === 'InsufficientBalance' && /must have funds/.test(bal.description ?? ''))
  const junk = cowRefusalOf(502, '<html>Bad Gateway</html>')
  const odd = cowRefusalOf(400, { errorType: 'Weird Type; drop', description: 42 })
  check('sign stage (cow): a body that is not CoW\'s error shape reads as no errorType/description (never throws); a non-name errorType is dropped',
    junk.errorType === null && junk.description === null && odd.errorType === null && odd.description === null)
  const balWords = cowRefusalWords(bal)
  check('sign stage (cow): InsufficientBalance reads as the wallet not holding enough, says nothing was placed, and ends with CoW\'s own words',
    /^CoW's order book refused the signed order: the wallet doesn't hold enough/.test(balWords) && /Nothing was placed\./.test(balWords) &&
      balWords.endsWith('(InsufficientBalance: order owner must have funds worth at least x in his account)'), balWords)
  const unmapped = COW_ERROR_TYPES.filter((t) => !/refused the signed order: /.test(cowRefusalWords({ status: 400, errorType: t, description: 'd' })))
  check('sign stage (cow): every errorType CoW\'s order endpoint can answer has plain words', unmapped.length === 0, unmapped.join(', '))
  const unknown = cowRefusalWords({ status: 400, errorType: 'SomethingNew', description: 'new rule' })
  const bare = cowRefusalWords({ status: 503, errorType: null, description: null })
  check('sign stage (cow): an unknown errorType and an empty body still name what CoW said (or the HTTP status)',
    unknown === "CoW's order book refused the signed order. Nothing was placed. (SomethingNew: new rule)" &&
      bare === "CoW's order book refused the signed order. Nothing was placed. (HTTP 503)", `${unknown} | ${bare}`)
  check('sign stage (cow): no order-book sentence ever blames the wallet',
    [...COW_ERROR_TYPES, null].every((t) => !IN_THE_WALLET.test(cowRefusalWords({ status: 400, errorType: t, description: 'invalid signature' }))))

  // ── The stage rule: only the wallet's own throw reads as a rejection ───
  const live1111 = 'CoW order book rejected the order: invalid signature' // main's relay wording, 2026-11-11
  check('sign stage: the 2026-11-11 case — a server answer containing "rejected" is shown as the server wrote it, never as a wallet rejection',
    signOrderErrorText('server', live1111, 'Base') === live1111 &&
      signStageError('server', 'The venue rejected the approval.', 'Signature request declined.') === 'The venue rejected the approval.' &&
      signStageError('server', 'Access denied by policy', 'x') === 'Access denied by policy')
  check('sign stage: a human "no" from the wallet still reads as declined, with the order\'s OWN chain in the hint (never a hard-coded Base)',
    signOrderErrorText('wallet', 'User rejected the request.', 'Ethereum') === 'Signature rejected in the wallet. Nothing was placed. (If you didn’t cancel: check the wallet is on Ethereum.)' &&
      signStageError('wallet', 'User denied message signature.', 'D') === 'D' && signStageError('wallet', '', 'D') === 'D')
  const mm = 'Provided chainId "1" must match the active chainId "8453"'
  check('sign stage: a wallet error that is not a human "no" is shown in the wallet\'s words (the beacon files the same set)',
    signOrderErrorText('wallet', mm, 'Base') === `The wallet couldn't sign the order: ${mm}` && signStageError('wallet', mm, 'D') === mm && isReportableWalletError(mm))
  check('sign stage: an empty server answer never reads as a wallet rejection',
    !IN_THE_WALLET.test(signOrderErrorText('server', '', 'Base')) && !IN_THE_WALLET.test(signStageError('server', ' ', 'Rejected in the wallet')))

  // ── The five sign surfaces that call a server after the signature ──────
  const surfaces: Array<[string, RegExp]> = [
    ['components/SignOrderButton.tsx', /signOrderErrorText\(stage, words,/],
    ['components/ArmDcaButton.tsx', /signStageError\(stage, msg,/],
    ['components/ArmSpotGuardButton.tsx', /signStageError\(stage, msg,/],
    ['components/GuardianPanel.tsx', /signStageError\(stage, msg,/],
    ['components/SignNftListingButton.tsx', /signStageError\(phase === 'relay' \? 'server' : 'wallet', msg,/],
  ]
  const bad = surfaces.filter(([p, uses]) => {
    const src = rf(p)
    return /\/rejected\|denied\/i\.test/.test(src) || !uses.test(src)
  })
  check('sign stage: CoW order, DCA arm, spot-guard arm, Guardian approval and NFT listing never regex a server answer for "rejected|denied"; each words its error by stage',
    bad.length === 0, bad.map(([p]) => p).join(', '))
  const cowBtn = rf('components/SignOrderButton.tsx')
  const iSign = cowBtn.indexOf('signature = await signTypedDataAsync(')
  const iStage = cowBtn.indexOf("stage = 'server'")
  const iFetch = cowBtn.indexOf("fetch('/api/cow/submit'")
  check('sign stage: the CoW button flips to the server stage only AFTER the signature exists and BEFORE the relay call',
    iSign > 0 && iStage > iSign && iFetch > iStage && /let stage: SignStage = 'wallet'/.test(cowBtn) && !/check the wallet is on Base/.test(cowBtn))
  const dca = rf('components/ArmDcaButton.tsx')
  const guard = rf('components/GuardianPanel.tsx')
  check('sign stage: the arm buttons flip to the server stage right before their arm call; the Guardian approval is server → wallet → server',
    dca.indexOf("stage = 'server'") > dca.indexOf('await signTypedDataAsync(') && dca.indexOf("stage = 'server'") < dca.indexOf('/api/dca/') &&
      /let stage: SignStage = 'server'[\s\S]*?stage = 'wallet'\s*\n\s*const signature = await signTypedDataAsync\([\s\S]*?\n\s*stage = 'server'\s*\n\s*const activated/.test(guard))

  // ── The relay: keep it, log it, file it ────────────────────────────────
  const relay = rf('app/api/cow/submit/route.ts')
  check('sign stage (relay): a CoW refusal keeps CoW\'s errorType, answers stage order-book, and logs one line with errorType + description',
    /const refusal = cowRefusalOf\(res\.status, data\)/.test(relay) && /return refused\(refusal, cowRefusalWords\(refusal\)\)/.test(relay) &&
      /stage: 'order-book', venue: 'cow', errorType: refusal\.errorType/.test(relay) &&
      /console\.warn\(\s*'\[cow\/submit\] order book refused a signed order',[\s\S]{0,200}errorType: refusal\.errorType, description: refusal\.description/.test(relay) &&
      /console\.warn\('\[cow\/submit\] could not reach the order book'/.test(relay))
  check('sign stage (relay): the refusal files a server-written venue-refused row after the response (rate-capped, harness opt-out honored, internal runs stamped)',
    VENUE_REFUSED_KIND === 'venue-refused' && /kind: VENUE_REFUSED_KIND/.test(relay) && /after\(async \(\) => \{\s*if \(await bumpAndCheckBrokerCall\(ip\)\) return/.test(relay) &&
      /if \(req\.headers\.get\('x-yf-no-ask-log'\) !== '1'\)/.test(relay) && /isInternal: internal/.test(relay))

  // ── The admin feed can filter every kind the page labels ───────────────
  const page = rf('app/dashboard/failures/page.tsx')
  const labelBlock = page.slice(page.indexOf('const KIND_LABEL'), page.indexOf('}', page.indexOf('const KIND_LABEL')))
  const labeled = [...labelBlock.matchAll(/^\s*'?([a-z-]+)'?:\s*'/gm)].map((m) => m[1])
  const feed = rf('app/api/admin/ask-failures/route.ts')
  const allow = (/const KINDS = new Set\(\[([^\]]*)\]\)/.exec(feed)?.[1] ?? '').match(/'([a-z-]+)'/g)?.map((s) => s.slice(1, -1)) ?? []
  const missing = labeled.filter((k) => !allow.includes(k))
  check('sign stage (dashboard): the failures feed can filter on every kind the page labels (refunded/withheld/launch-dropped were silently nulled), venue-refused included',
    labeled.includes('venue-refused') && labeled.length >= 9 && missing.length === 0, `labeled=${labeled.join(',')} missing=${missing.join(',')}`)
}

/** Live: one order from a fresh, unfunded key through the relay. CoW stops
 *  it at the balance check — nothing can be placed — and the relay must
 *  hand back CoW's own errorType, worded, never as a wallet rejection. */
export async function cowRefusalLivePins(base: string, check: Check): Promise<void> {
  const acct = privateKeyToAccount(generatePrivateKey())
  const owner = acct.address.toLowerCase()
  const order = {
    sellToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC (Base)
    buyToken: '0xc3de830ea07524a0761646a6a4e4be0e114a3c83', // UNI (Base) — the 2026-11-11 pair
    receiver: owner,
    sellAmount: '25000000',
    buyAmount: '4224500000000000000',
    validTo: Math.floor(Date.now() / 1000) + 3600,
    appData: COW_APP_DATA_HASH,
    feeAmount: '0',
    kind: 'sell',
    partiallyFillable: true,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
  }
  const signature = await acct.signTypedData({
    domain: { name: 'Gnosis Protocol', version: 'v2', chainId: 8453, verifyingContract: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41' },
    types: {
      Order: [
        { name: 'sellToken', type: 'address' }, { name: 'buyToken', type: 'address' }, { name: 'receiver', type: 'address' },
        { name: 'sellAmount', type: 'uint256' }, { name: 'buyAmount', type: 'uint256' }, { name: 'validTo', type: 'uint32' },
        { name: 'appData', type: 'bytes32' }, { name: 'feeAmount', type: 'uint256' }, { name: 'kind', type: 'string' },
        { name: 'partiallyFillable', type: 'bool' }, { name: 'sellTokenBalance', type: 'string' }, { name: 'buyTokenBalance', type: 'string' },
      ],
    },
    primaryType: 'Order',
    message: { ...order, sellAmount: BigInt(order.sellAmount), buyAmount: BigInt(order.buyAmount), feeAmount: BigInt(0) } as never,
  })
  let status = 0
  let body: { error?: string; stage?: string; errorType?: string | null } = {}
  try {
    const res = await fetch(`${base}/api/cow/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ chainId: 8453, order, signature, from: owner, appDataJson: COW_APP_DATA_JSON, mode: 'limit' }),
    })
    status = res.status
    body = (await res.json().catch(() => ({}))) as typeof body
  } catch (e) {
    body = { error: e instanceof Error ? e.message : String(e) }
  }
  check('sign stage (live): an unfunded throwaway order through the relay comes back as CoW\'s InsufficientBalance (stage order-book), worded, never as a wallet rejection',
    status === 502 && body.stage === 'order-book' && body.errorType === 'InsufficientBalance' &&
      /^CoW's order book refused the signed order: the wallet doesn't hold enough/.test(body.error ?? '') &&
      !IN_THE_WALLET.test(signOrderErrorText('server', body.error ?? '', 'Base')),
    `${status} ${JSON.stringify(body).slice(0, 300)}`)
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /sign-stage-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  const check: Check = (name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? `\n     ${extra}` : ''}`)
  }
  signStagePins(check)
  const done = () => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  }
  if (process.env.BASE) void cowRefusalLivePins(process.env.BASE, check).then(done)
  else done()
}
