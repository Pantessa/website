// Pins for squad called-gtm, lane OUTREACH (2026-11-16). The lane owns this file:
// pure checks in calledGtmOutreachPins, checks against a running server in
// calledGtmOutreachPinsServed. Already wired into test-api and package.json by
// the contract commit, so no lane edits the harness.
//   npx tsx scripts/called-gtm-outreach-pins.ts            (npm run pins:called-gtm-outreach)
//   BASE=http://localhost:PORT npx tsx scripts/called-gtm-outreach-pins.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUTREACH_TAG, noKitReason, outreachKit, xWeight, type OutreachKit } from '../lib/called-it/outreach'
import { callHref, type BoardCall, type BoardEntry } from '../lib/called-it/gtm'
import { parseBatchArgs, parseBatchCsv, scansThatFit } from './called-batch-scan'

type Check = (name: string, ok: boolean, extra?: string) => void

const ORIGIN = 'https://www.pantessa.com'
const LONG_HANDLE = 'abcdefghijklmno' // 15, X's maximum

function call(over: Partial<BoardCall> = {}): BoardCall {
  return {
    postId: '1877000000000000001',
    url: 'https://x.com/someone/status/1877000000000000001',
    text: 'BTC to 150k this cycle, I am loading every dip and not selling a single sat until then. This is the most obvious trade of the decade.',
    quote: 'BTC to 150k this cycle',
    postedAt: Date.UTC(2026, 0, 10),
    stance: 'bull',
    verdict: 'right',
    verdictWords: 'called it',
    move: '+23.4% in 30 days, +14.2% since',
    priceAt: 90386,
    likes: 1200,
    ...over,
  }
}

function entry(over: Partial<BoardEntry> = {}): BoardEntry {
  return {
    handle: 'cz_binance',
    symbol: 'BTC',
    name: 'CZ',
    avatarUrl: null,
    followers: 10_000_000,
    verified: false,
    scannedAt: Date.UTC(2026, 10, 12),
    tally: { total: 8, right: 1, wrong: 4, flat: 2, open: 1 } as BoardEntry['tally'],
    headline: '@cz_binance on BTC: 8 calls, 1 called it, 4 missed, 2 no real move, 1 too early to say.',
    coverage: null,
    hitRate: '1 of 5 judged calls',
    line: '',
    dots: [],
    best: call(),
    worst: null,
    ...over,
  }
}

const texts = (k: OutreachKit) => [k.reply, k.dm, k.post]

export function calledGtmOutreachPins(check: Check): void {
  // ── the kit ──
  const base = outreachKit(entry(), ORIGIN)
  check('outreach: an entry with a hit gets a kit', base !== null)
  if (!base) return
  check('outreach: the link is the call address on the public origin, tagged', base.link.startsWith(`${ORIGIN}${callHref('cz_binance', 'BTC', '1877000000000000001')}&`) && base.link.includes('utm_medium=outreach'), base.link)
  check('outreach: the tag names no person (only utm_source/medium/campaign)', Object.keys(OUTREACH_TAG).every((k) => /^utm_(source|medium|campaign)$/.test(k)) && !/cz_binance/.test(Object.values(OUTREACH_TAG).join('')))
  check('outreach: the image is /api/og/called with handle, sym and call', base.imagePath === '/api/og/called?handle=cz_binance&sym=BTC&call=1877000000000000001', base.imagePath)
  check('outreach: the reply intent answers the original post', base.replyIntent.startsWith('https://x.com/intent/post?') && new URL(base.replyIntent).searchParams.get('in_reply_to') === '1877000000000000001' && new URL(base.replyIntent).searchParams.get('text') === base.reply.text)
  check('outreach: the post intent carries the post text', new URL(base.postIntent).searchParams.get('text') === base.post.text && !new URL(base.postIntent).searchParams.has('in_reply_to'))
  for (const t of texts(base)) {
    check(`outreach (${t.kind}): carries the link`, t.text.includes(base.link))
    check(`outreach (${t.kind}): says "hits and misses"`, t.text.includes('hits and misses'))
    check(`outreach (${t.kind}): the verdict and the day are the entry's`, t.text.includes('called it') && t.text.includes('10 Jan 2026'), t.text)
    check(`outreach (${t.kind}): within X's 280`, t.weight <= 280 && t.weight === xWeight(t.text), `${t.weight}`)
    check(`outreach (${t.kind}): never "verified" for an unverified entry`, !/verif/i.test(t.text), t.text)
  }
  check('outreach: the reply carries the record\'s tally and the move', base.reply.text.includes('8 calls, 1 called it, 4 missed') && base.reply.text.includes('+23.4% in 30 days'), base.reply.text)
  check('outreach: the post never opens with an @mention', !base.post.text.startsWith('@'))

  // Long handle, long move, long non-ASCII quote: still within 280, still the full record.
  const long = outreachKit(
    entry({
      handle: LONG_HANDLE,
      symbol: 'XYZ:NVDA',
      headline: `@${LONG_HANDLE} on XYZ:NVDA: 12345 calls, 6789 called it, 4321 missed, 1111 no real move, 124 too early to say.`,
      best: call({ move: '-50.0% before its $5,000,000,000 market cap target, +1234.5% since', quote: '比特币 将会 涨到 十五万 🚀🚀🚀 '.repeat(8), text: '比特币 将会 涨到 十五万 🚀🚀🚀 '.repeat(20) }),
    }),
    ORIGIN,
  )
  check('outreach (long): a kit', long !== null)
  if (long) for (const t of texts(long)) {
    check(`outreach (long ${t.kind}): within X's 280`, t.weight <= 280, `${t.weight}: ${t.text}`)
    check(`outreach (long ${t.kind}): link + "hits and misses"`, t.text.includes(long.link) && t.text.includes('hits and misses'))
  }
  check('outreach: xWeight counts a link as 23 and non-ASCII as 2', xWeight('ab https://www.pantessa.com/x/a/BTC?call=1') === 26 && xWeight('é🚀') === 4)

  // Verified: the word may appear, and only then.
  const v = outreachKit(entry({ verified: true }), ORIGIN)
  check('outreach: a verified entry may say verified (the DM does)', !!v && /verified/i.test(v.dm.text), v?.dm.text)

  // No hit: no kit, and a reason in words.
  const none = entry({ best: null, tally: { total: 5, right: 0, wrong: 3, flat: 1, open: 1 } as BoardEntry['tally'] })
  check('outreach: no hit, no kit', outreachKit(none, ORIGIN) === null)
  check('outreach: no hit, a reason in words', typeof noKitReason(none) === 'string' && /called it/.test(noKitReason(none)!))
  check('outreach: a kit has no reason', noKitReason(entry()) === null)

  // ── the batch script ──
  const dry = parseBatchArgs(['list.csv'])
  check('batch: a dry run is the default', !('error' in dry) && dry.apply === false)
  check('batch: --apply without --max-usd is refused', 'error' in parseBatchArgs(['list.csv', '--apply']))
  check('batch: --apply with --max-usd=0 is refused', 'error' in parseBatchArgs(['list.csv', '--apply', '--max-usd=0']))
  const ok = parseBatchArgs(['list.csv', '--apply', '--max-usd=3'])
  check('batch: --apply --max-usd=3 parses', !('error' in ok) && ok.apply && ok.maxUsd === 3)
  check('batch: never more scans than the cap pays for at their worst', scansThatFit(10, 0.76, 3) === 3 && scansThatFit(2, 0.76, 3) === 2 && scansThatFit(5, 0.76, 0.5) === 0)
  const csv = parseBatchCsv('handle,symbol,why\n@CZ_Binance,btc,x\ncz_binance,BTC\nthis_handle_is_too_long,ETH\n# note\nfoo,\n')
  check('batch: the CSV is cleaned, de-duplicated and bad rows named', csv.pairs.length === 1 && csv.pairs[0].handle === 'cz_binance' && csv.pairs[0].symbol === 'BTC' && csv.bad.length === 2, JSON.stringify(csv))
  try {
    const src = readFileSync(join(__dirname, 'called-batch-scan.ts'), 'utf8')
    check('batch: runs through the scan route\'s own runScan, as a public run', /import\('\.\.\/lib\/called-it\/scan'\)/.test(src) && /internal: false/.test(src))
    check('batch: the production-host fence', /--host-ok=/.test(src) && /ep-tiny-butterfly/.test(src))
  } catch (e) {
    check('batch: source readable', false, String(e))
  }
}

export async function calledGtmOutreachPinsServed(check: Check, base: string): Promise<void> {
  try {
    const api = await fetch(`${base}/api/admin/outreach`, { cache: 'no-store' })
    const body = await api.text()
    check('outreach (served): the API refuses a visitor', api.status === 401 || api.status === 403, `${api.status}`)
    check('outreach (served): the refusal carries no board data', !/"rows"|"kit"|cz_binance/.test(body), body.slice(0, 120))
    const forged = await fetch(`${base}/api/admin/outreach`, { headers: { cookie: 'yf_session=forged.token.value' }, cache: 'no-store' })
    check('outreach (served): a forged session is refused', forged.status === 401 || forged.status === 403, `${forged.status}`)
    const page = await fetch(`${base}/dashboard/admin/outreach`, { cache: 'no-store', redirect: 'manual' })
    const html = page.status === 200 ? await page.text() : ''
    check('outreach (served): the page holds no board data for a visitor', page.status !== 500 && !/utm_medium=outreach|intent\/post\?in_reply_to/.test(html), `${page.status}`)
  } catch (e) {
    check('outreach (served): server reachable', false, String(e))
  }
}

if (process.argv[1]?.endsWith('called-gtm-outreach-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledGtmOutreachPins(check)
    if (process.env.BASE) await calledGtmOutreachPinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-gtm outreach pins failed` : `\nall ${n} called-gtm outreach pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
