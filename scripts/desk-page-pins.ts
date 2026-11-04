// Pins for /desk, the pilot door, lib/legal and the tenant docs (squad
// five-million, DESKPAGE lane, 2026-11-03). Pure half: the page's sample
// objects agree with lib/tenant/spec (venues, ops, sides, chains, desk ids,
// the blotter kinds + a hash chain that really verifies, the pricing
// arithmetic), lib/legal keeps today's exact strings and honours the env,
// the lane's sources carry no forbidden phrase, the pilot parser + limiter.
// Live half (--live, BASE): the served /desk carries every vocabulary word
// and pricing number READ from the spec, no forbidden phrase beyond the
// site chrome, the OG card renders, the sitemap lists it, /docs/desk has
// the tenant section, the pilot route refuses a bad email and stores a good
// one (row deleted after), the honeypot stores nothing, the limiter answers
// 429, and — with --legal-server — a second `next start` with the LEGAL_*
// env set renders no "TO BE COMPLETED" anywhere.
// Called from scripts/test-api.ts (pure + live, no legal server), and alone:
//   npx tsx scripts/desk-page-pins.ts                              (pure)
//   BASE=http://localhost:4430 npx tsx scripts/desk-page-pins.ts --live [--legal-server]
import { readFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import {
  BLOTTER_GENESIS,
  BLOTTER_KINDS,
  DESIGN_PARTNER_FREE_DAYS,
  DESK_FEE_TIERS,
  DESK_ID_RE,
  DESK_PLATFORM_FEE_USD,
  TENANT_OPS,
  TENANT_SIDES,
  TENANT_VENUES,
  VENUE_CHAINS,
  tieredDeskFeeUsd,
} from '../lib/tenant/spec'
import { GOVERNING_LAW, LEGAL_DEFAULTS, LEGAL_ENTITY, LEGAL_ENTITY_SHORT, LEGAL_PLACEHOLDER, VENUE, legalFromEnv, legalIsComplete } from '../lib/legal'
import {
  BLOTTER_KIND_ROWS,
  PRICING_EXAMPLE_NOTIONAL_USD,
  SAMPLE_POLICY,
  monthlyDeskCostUsd,
  policyVocabulary,
  sampleBlotterCsv,
  sampleBlotterRows,
  samplePolicyJson,
  tierLines,
  usd0,
  usdShort,
  verifySampleChain,
} from '../components/desk-page/sample'
import { CUSTODY_OPTIONS } from '../components/desk-page/PilotForm'
import { CUSTODY_VALUES, PILOT_LIMIT_MAX, PILOT_LIMIT_WINDOW_MS, WindowLimiter, isTestAddress, parsePilotBody, pilotEmail, pilotSubject } from '../app/api/desk/pilot/pilot'

type Check = (name: string, ok: boolean, extra?: string) => void

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const HEX64 = /^[0-9a-f]{64}$/
const count = (hay: string, needle: string | RegExp): number => (typeof needle === 'string' ? hay.split(needle).length - 1 : (hay.match(needle) ?? []).length)
/** The served page, comments out and React's text escapes undone, for text pins. */
const flat = (html: string) =>
  html
    .replace(/<!--.*?-->/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** The lane's own sources: never these words (the honesty lines in the
 *  README + DUNE-MEETING "Say before they find it"). */
const FORBIDDEN_STRONG = ['in partnership with Dune', 'SOC 2 compliant', 'sanctions screening', 'isolated']
const LANE_SOURCES = ['app/desk/page.tsx', 'app/desk/opengraph-image.tsx', 'components/desk-page/sample.ts', 'components/desk-page/PilotForm.tsx', 'components/desk-page/desk.css', 'app/api/desk/pilot/route.ts', 'app/api/desk/pilot/pilot.ts', 'app/docs/desk/page.tsx']
const BARE_HANDLE = /@pantessa\b(?!\.com)/

export function deskPagePins(check: Check): void {
  // ── The sample policy IS the spec's shape ────────────────────────────────
  const venueOk = SAMPLE_POLICY.venues.every((r) => (TENANT_VENUES as readonly string[]).includes(r.venue))
  const opsOk = SAMPLE_POLICY.venues.every((r) => (r.ops ?? []).every((o) => (TENANT_OPS as readonly string[]).includes(o)))
  const sidesOk = SAMPLE_POLICY.venues.every((r) => (r.sides ?? []).every((s) => (TENANT_SIDES as readonly string[]).includes(s)))
  const chainsOk = SAMPLE_POLICY.venues.every((r) => (r.chains ?? []).every((c) => (VENUE_CHAINS[r.venue] ?? []).includes(c)))
  const tokensOk = SAMPLE_POLICY.venues.every((r) => (r.tokens ?? []).every((t) => t === t.toUpperCase()))
  const desksOk = SAMPLE_POLICY.desks.length === 1 && SAMPLE_POLICY.desks.every((d) => DESK_ID_RE.test(d.id) && (d.approvals?.approvers ?? 0) >= 2 && (d.hours?.days ?? []).every((n) => n >= 0 && n <= 6))
  check(
    'desk page: the sample policy is the spec\'s shape — version 1, default deny, every venue/op/side a spec word, every chain one the venue runs on, tokens UPPER, one desk with ≥2 approvers and legal hours',
    SAMPLE_POLICY.version === 1 && SAMPLE_POLICY.default === 'deny' && venueOk && opsOk && sidesOk && chainsOk && tokensOk && desksOk && !!SAMPLE_POLICY.hooks?.preTrade && SAMPLE_POLICY.signing?.lane === 'walletconnect',
    `venue=${venueOk} ops=${opsOk} sides=${sidesOk} chains=${chainsOk} tokens=${tokensOk} desks=${desksOk}`,
  )
  check(
    'desk page: the sample names CoW + Uniswap v3 on Ethereum and Base and Aave v4 supply/withdraw (the plan\'s pilot shape), $5M an order, 2 approvers over $1M',
    SAMPLE_POLICY.venues.map((v) => v.venue).join() === 'cow,uniswap-v3,aave-v4' &&
      SAMPLE_POLICY.venues.every((v) => (v.chains ?? []).join() === '1,8453' && v.maxOrderUsd === 5_000_000) &&
      (SAMPLE_POLICY.venues[2].ops ?? []).join() === 'supply,withdraw' &&
      SAMPLE_POLICY.desks[0].approvals?.overUsd === 1_000_000 && SAMPLE_POLICY.desks[0].approvals?.approvers === 2,
  )
  const vocab = policyVocabulary()
  const byKey = Object.fromEntries(vocab.map((r) => [r.k, r.items]))
  check(
    'desk page: the vocabulary rows ARE the spec constants (venues, ops, sides by identity) and the chain row names every chain any venue runs on',
    byKey.venues === TENANT_VENUES && byKey.ops === TENANT_OPS && byKey.sides === TENANT_SIDES && new Set(Object.values(VENUE_CHAINS).flatMap((c) => c ?? [])).size === byKey.chains.length && byKey.chains.every((c) => /^[A-Za-z ]+ · \d+$/.test(c)),
    `chains: ${byKey.chains.join(' | ')}`,
  )

  // ── The blotter sample: the kinds, and a chain that verifies ───────────
  check('desk page: the kinds table lists every BLOTTER_KIND in the spec\'s order, each with words', BLOTTER_KIND_ROWS.map((r) => r.kind).join() === BLOTTER_KINDS.join() && BLOTTER_KIND_ROWS.every((r) => r.words.length > 10))
  const rows = sampleBlotterRows()
  const v = verifySampleChain(rows)
  const tampered = rows.map((r) => (r.seq === 4 ? { ...r, payload: { ...r.payload, lane: 'safe' } } : r))
  const removed = rows.filter((r) => r.seq !== 3)
  check(
    'desk page: the six-row sample export chains from BLOTTER_GENESIS with the spec\'s blotterHash — verify answers ok, every hash is sha256 hex, seq 1..6, intent → policy_verdict → build → offered → signed → settled',
    v.ok && v.rows === 6 && rows[0].prevHash === BLOTTER_GENESIS && rows.every((r, i) => HEX64.test(r.hash) && r.seq === i + 1 && (i === 0 || r.prevHash === rows[i - 1].hash)) &&
      rows.map((r) => r.kind).join() === 'intent,policy_verdict,build,offered,signed,settled' && rows[5].verification === 'verified' && rows[5].txHash === `0x${'0'.repeat(64)}`,
    JSON.stringify(v),
  )
  const tv = verifySampleChain(tampered)
  const rv = verifySampleChain(removed)
  check('desk page: one changed byte in row 4 breaks verify AT row 4; a removed row 3 breaks it at the next row (the auditor\'s replay is real)', !tv.ok && tv.brokenAt === 4 && !rv.ok && rv.brokenAt === 4, `${JSON.stringify(tv)} ${JSON.stringify(rv)}`)
  const csv = sampleBlotterCsv().split('\n')
  check('desk page: the CSV sample has the header + six rows with prev_hash and hash as the last two columns', csv.length === 7 && csv[0].endsWith('prev_hash,hash') && csv.slice(1).every((l) => l.split(',').length === 12))

  // ── Pricing, from the spec ───────────────────────────────────────────────
  const total = monthlyDeskCostUsd(PRICING_EXAMPLE_NOTIONAL_USD)
  check(
    'desk page: the pricing example is DESK_PLATFORM_FEE_USD + tieredDeskFeeUsd over the plan\'s $25M month (= $21,500 while the spec says $4K + 10/5/2 bps), and the tier lines name every DESK_FEE_TIER',
    PRICING_EXAMPLE_NOTIONAL_USD === 25_000_000 && total === DESK_PLATFORM_FEE_USD + tieredDeskFeeUsd(25_000_000) && total === 21_500 && tierLines().length === DESK_FEE_TIERS.length && DESK_FEE_TIERS.every((t, i) => tierLines()[i].startsWith(`${t.bps} bps`)),
    `${usd0(total)} · ${tierLines().join(' / ')}`,
  )

  // ── lib/legal: today's exact strings, and the env override ───────────────
  const unset = legalFromEnv({})
  check(
    'legal: with nothing set lib/legal answers EXACTLY the strings the pages shipped with (Yeetful, Inc. · PANTESSA INC. · the two TO BE COMPLETED placeholders)',
    unset.entity === 'Yeetful, Inc.' && unset.entityShort === 'PANTESSA INC.' && unset.governingLaw === '[governing jurisdiction — TO BE COMPLETED]' && unset.venue === '[venue — TO BE COMPLETED]' && !legalIsComplete(unset) && JSON.stringify(unset) === JSON.stringify(LEGAL_DEFAULTS),
  )
  const set = legalFromEnv({ LEGAL_ENTITY: ' Pantessa, Inc. ', LEGAL_ENTITY_SHORT: 'PANTESSA INC.', LEGAL_GOVERNING_LAW: 'the State of Delaware', LEGAL_VENUE: 'Wilmington, Delaware' })
  const blank = legalFromEnv({ LEGAL_GOVERNING_LAW: '   ', LEGAL_VENUE: '' })
  check(
    'legal: LEGAL_ENTITY / LEGAL_ENTITY_SHORT / LEGAL_GOVERNING_LAW / LEGAL_VENUE override (trimmed), the Terms count as complete once both placeholders are gone, and a blank value keeps the default',
    set.entity === 'Pantessa, Inc.' && set.governingLaw === 'the State of Delaware' && set.venue === 'Wilmington, Delaware' && legalIsComplete(set) && blank.governingLaw === LEGAL_DEFAULTS.governingLaw && blank.venue === LEGAL_DEFAULTS.venue,
  )
  const envNow = legalFromEnv(process.env)
  check('legal: the exported constants are legalFromEnv(process.env)', LEGAL_ENTITY === envNow.entity && LEGAL_ENTITY_SHORT === envNow.entityShort && GOVERNING_LAW === envNow.governingLaw && VENUE === envNow.venue)
  const terms = read('app/docs/terms/page.tsx')
  const privacy = read('app/docs/privacy/page.tsx')
  const footer = read('components/Footer.tsx')
  check(
    'legal: the Terms, the Privacy policy and the footer READ lib/legal and carry no literal entity or placeholder of their own (the footer renders LEGAL_ENTITY_SHORT)',
    /from '@\/lib\/legal'/.test(terms) && /from '@\/lib\/legal'/.test(privacy) && /from '@\/lib\/legal'/.test(footer) &&
      ![terms, privacy, footer].some((s) => s.includes(LEGAL_PLACEHOLDER) || s.includes("'Yeetful, Inc.'") || s.includes('PANTESSA INC.')) &&
      /\{GOVERNING_LAW\}/.test(terms) && /\{VENUE\}/.test(terms) && /\{LEGAL_ENTITY\}/.test(terms) && /\{LEGAL_ENTITY\}/.test(privacy) && /© 2026 \{LEGAL_ENTITY_SHORT\}/.test(footer),
  )
  check('legal: .env.example documents the four names', ['LEGAL_ENTITY=', 'LEGAL_ENTITY_SHORT=', 'LEGAL_GOVERNING_LAW=', 'LEGAL_VENUE='].every((n) => read('.env.example').includes(n)))

  // ── Forbidden phrases in the lane's own sources ──────────────────────────
  const hits: string[] = []
  for (const p of LANE_SOURCES) {
    const s = read(p)
    for (const f of FORBIDDEN_STRONG) if (s.toLowerCase().includes(f.toLowerCase())) hits.push(`${p}: "${f}"`)
    if (BARE_HANDLE.test(s)) hits.push(`${p}: bare @pantessa`)
    if (!p.startsWith('app/docs/') && /yeetful/i.test(s)) hits.push(`${p}: Yeetful`)
  }
  check('desk page: no lane source says "in partnership with Dune", "SOC 2 compliant", "sanctions screening", "isolated", "Yeetful" (outside the docs\' wire hosts) or a bare "@pantessa"', hits.length === 0, hits.join('; '))
  const page = read('app/desk/page.tsx')
  check(
    'desk page: the page reads its numbers from the spec and the sample module (no typed $4,000 / 21,500 / 90 days), says "built on Dune\'s real-time feeds", links /docs/venues + /policy-pool + /live + /pricing, and the Safe lane reads "in drill"',
    !/4,000|21,500|90 days/.test(page.replace(/\{[^}]*\}/g, '')) && /Built on Dune’s real-time feeds/.test(page) && ['/docs/venues', '/policy-pool', '/live', '/pricing', '/docs/trust'].every((h) => page.includes(`href="${h}"`)) && /status: 'in drill'/.test(page),
  )

  // ── The pilot parser, the test-address rule, the mail, the limiter ───────
  const good = parsePilotBody({ name: ' Jordan Lee ', firm: 'Example\u0007 Capital', email: 'JORDAN@Example-Capital.com', custody: 'Fireblocks', venues: 'CoW on Base', trades: 'majors\r\nto $5M', website: '' })
  check(
    'pilot: a good body parses — trimmed, control characters out, email lowercased, custody normalised to the form\'s value, CRLF folded',
    good.ok && !good.honeypot && good.value.name === 'Jordan Lee' && good.value.firm === 'Example Capital' && good.value.email === 'jordan@example-capital.com' && good.value.custody === 'fireblocks' && good.value.trades === 'majors\nto $5M',
    JSON.stringify(good),
  )
  const other = parsePilotBody({ name: 'A', firm: 'B', email: 'a@b.co', custody: 'Ledger Vault' })
  check('pilot: an unlisted custody becomes "other"; a missing one is refused; the form\'s options are exactly the route\'s values', other.ok && other.value.custody === 'other' && !parsePilotBody({ name: 'A', firm: 'B', email: 'a@b.co' }).ok && CUSTODY_OPTIONS.map((o) => o.v).join() === CUSTODY_VALUES.join())
  const bad = [parsePilotBody(null), parsePilotBody('x'), parsePilotBody({ name: 'A', firm: 'B', email: 'nope', custody: 'safe' }), parsePilotBody({ name: 'A', firm: 'B', email: `${'a'.repeat(250)}@b.co`, custody: 'safe' }), parsePilotBody({ firm: 'B', email: 'a@b.co', custody: 'safe' }), parsePilotBody({ name: 'A', email: 'a@b.co', custody: 'safe' })]
  check('pilot: no body, a string, a bad email, a 254+ email, no name and no firm are each refused with a sentence', bad.every((b) => !b.ok && b.error.length > 8), bad.map((b) => (b.ok ? 'ok' : b.error)).join(' | '))
  const hp = parsePilotBody({ name: 'A', firm: 'B', email: 'a@b.co', custody: 'safe', website: 'http://spam' })
  check('pilot: a filled honeypot parses OK with honeypot:true (the route answers 200 and stores nothing)', hp.ok && hp.honeypot)
  check('pilot: a reserved test address never mails the desk (example.com, .test, .invalid, localhost); a real one does', ['a@example.com', 'a@example.org', 'a@b.example', 'a@x.test', 'a@y.invalid', 'a@localhost'].every(isTestAddress) && !isTestAddress('a@example-capital.com') && !isTestAddress('a@pantessa.com'))
  const m = pilotEmail({ name: 'J<b>', firm: 'Ex & Co', email: 'j@ex.co', custody: 'safe', venues: '', trades: 'x' }, '2026-11-03T00:00:00.000Z')
  check('pilot: the mail\'s subject is "Desk pilot request — <firm>", the text carries every field, the HTML escapes the requester\'s text', m.subject === pilotSubject('Ex & Co') && m.subject === 'Desk pilot request — Ex & Co' && /Name: J<b>/.test(m.text) && /Custody: safe/.test(m.text) && m.html.includes('J&lt;b&gt;') && m.html.includes('Ex &amp; Co') && !m.html.includes('<b>'))
  const lim = new WindowLimiter(PILOT_LIMIT_MAX, PILOT_LIMIT_WINDOW_MS)
  const t0 = 1_000_000
  const first = Array.from({ length: PILOT_LIMIT_MAX }, (_, i) => lim.hit('k', t0 + i).ok)
  const over = lim.hit('k', t0 + PILOT_LIMIT_MAX)
  const later = lim.hit('k', t0 + PILOT_LIMIT_WINDOW_MS + 1)
  check(`pilot: the limiter admits ${PILOT_LIMIT_MAX} in a window, refuses the next, another key is untouched, and the window resets after ${PILOT_LIMIT_WINDOW_MS / 60000} minutes`, first.every(Boolean) && !over.ok && over.remaining === 0 && lim.hit('other', t0).ok && later.ok && later.remaining === PILOT_LIMIT_MAX - 1)
}

// ── Live ────────────────────────────────────────────────────────────────────

async function waitReady(base: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/health`).catch(() => fetch(base))
      if (r.ok || r.status === 404) return true
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

export async function deskPageLivePins(check: Check, base: string, opts: { legalServer?: boolean } = {}): Promise<void> {
  const res = await fetch(`${base}/desk`)
  const html = flat(await res.text())
  const pricingHtml = flat(await (await fetch(`${base}/pricing`)).text())
  check('desk page (served): GET /desk is 200 and carries the line, the eight sections in order, and the canonical', res.status === 200 && /The DeFi execution desk that lives/.test(html) && ['id="line"', 'id="policy"', 'id="blotter"', 'id="signing"', 'id="guard"', 'id="signal"', 'id="pricing"', 'id="honest"', 'id="pilot"'].every((id, i, a) => html.includes(id) && (i === 0 || html.indexOf(id) > html.indexOf(a[i - 1]))) && html.includes('rel="canonical" href="https://www.pantessa.com/desk"'))

  const missingVocab = [
    ...TENANT_VENUES.filter((v) => !html.includes(`data-vocab-item="venues">${v}<`)),
    ...TENANT_OPS.filter((v) => !html.includes(`data-vocab-item="ops">${v}<`)),
    ...TENANT_SIDES.filter((v) => !html.includes(`data-vocab-item="sides">${v}<`)),
    ...policyVocabulary().find((r) => r.k === 'chains')!.items.filter((v) => !html.includes(`data-vocab-item="chains">${v}<`)),
  ]
  check('desk page (served): the vocabulary rows carry EVERY spec venue, op, side and chain (read from lib/tenant/spec, compared to the HTML)', missingVocab.length === 0, `missing: ${missingVocab.join(', ')}`)
  const sampleJson = samplePolicyJson()
  check(
    'desk page (served): the policy sample is printed verbatim (the spec-typed object; scalar arrays on one line, and it parses back to the SAME object) under the "your compliance writes the values" badge',
    html.includes(sampleJson) && html.indexOf('your compliance writes the values') < html.indexOf(sampleJson) && JSON.stringify(JSON.parse(sampleJson)) === JSON.stringify(SAMPLE_POLICY) && sampleJson.includes('"chains": [1, 8453]'),
  )

  const tiers = tierLines()
  const tierWords = DESK_FEE_TIERS.map((t) => `${t.bps} bps`)
  const tierCaps = DESK_FEE_TIERS.filter((t) => Number.isFinite(t.uptoUsd)).map((t) => usdShort(t.uptoUsd))
  const example = usd0(monthlyDeskCostUsd(PRICING_EXAMPLE_NOTIONAL_USD))
  check(
    `desk page (served): pricing from the spec — ${usd0(DESK_PLATFORM_FEE_USD)} platform fee, ${tierWords.join(' / ')} to ${tierCaps.join(' / ')}, the $25M example ${example}, ${DESIGN_PARTNER_FREE_DAYS} days free`,
    html.includes(usd0(DESK_PLATFORM_FEE_USD)) && tierWords.every((w) => html.includes(w)) && tierCaps.every((c) => html.includes(c)) && html.includes(example) && html.includes(`${DESIGN_PARTNER_FREE_DAYS} days free`) && tiers.length === DESK_FEE_TIERS.length,
  )
  check('desk page (served): the blotter kinds table lists every spec kind and the sample export\'s chain verifies at render (data-verify="ok", twelve hash cells)', BLOTTER_KINDS.every((k) => html.includes(`>${k}</td>`)) && html.includes('data-verify="ok"') && count(html, 'class="dk__hash" title="') === 12)
  check('desk page (served): the four signing lanes with their earned words — Wallet live, WalletConnect "signs in the cockpit", viem "proven · driveJob", Safe "in drill"', ['data-lane="Wallet"', 'data-lane="WalletConnect custody"', 'data-lane="Headless (viem)"', 'data-lane="Safe"'].every((l) => html.includes(l)) && /signs in the cockpit/.test(html) && /proven · driveJob/.test(html) && /in drill/.test(html))

  // Honesty: the strong phrases never; "Yeetful" and a bare "@pantessa" no
  // more often than the site chrome already says them (the footer's
  // "Formerly Yeetful" rides every page, and the RSC payload repeats it).
  const strong = FORBIDDEN_STRONG.filter((f) => html.toLowerCase().includes(f.toLowerCase()))
  const yeetDesk = count(html, /yeetful/gi)
  const yeetPricing = count(pricingHtml, /yeetful/gi)
  const bareDesk = count(html, /@pantessa\b(?!\.com)/g)
  const barePricing = count(pricingHtml, /@pantessa\b(?!\.com)/g)
  check('desk page (served): no "in partnership with Dune" / "SOC 2 compliant" / "sanctions screening" / "isolated"; "Yeetful" and a bare "@pantessa" appear no more than on /pricing (the chrome)', strong.length === 0 && yeetDesk <= yeetPricing && bareDesk <= barePricing, `strong=${strong.join(',')} yeetful ${yeetDesk} vs ${yeetPricing} · bare ${bareDesk} vs ${barePricing}`)
  check('desk page (served): "Honest about today" names the one database fenced by tenant id, no SOC 2 yet, the pre-trade hook as the screen, crypto venues only', /One database, fenced by tenant id/.test(html) && /No SOC 2 yet/.test(html) && /pre-trade hook is your screen/.test(html) && /Crypto venues only/.test(html))

  const og = await fetch(`${base}/desk/opengraph-image`)
  const ogBytes = og.ok ? (await og.arrayBuffer()).byteLength : 0
  check('desk page (served): the OG card renders as a PNG over 20KB and the page\'s og:image names it', og.status === 200 && /image\/png/.test(og.headers.get('content-type') ?? '') && ogBytes > 20_000 && /property="og:image" content="[^"]*\/desk\/opengraph-image/.test(html), `${og.status} ${ogBytes}b`)
  const smap = await (await fetch(`${base}/sitemap.xml`)).text()
  check('desk page (served): the sitemap lists /desk', smap.includes('https://www.pantessa.com/desk</loc>'))
  const docs = flat(await (await fetch(`${base}/docs/desk`)).text())
  check('docs/desk (served): the "Run a governed desk" section — tenant, policy + maker-checker, dk_ key, Bearer call, the gate:"policy" refusal, approvals, blotter/verify/statement, pricing links', /id="governed-desk"/.test(docs) && /Authorization: Bearer dk_/.test(docs) && /"gate": "policy"/.test(docs) && /CHAIN_DENIED/.test(docs) && /blotter\/verify/.test(docs) && /statement\?ym=YYYY-MM/.test(docs) && docs.includes('href="/desk#pricing"') && docs.includes('href="/pricing#desk"') && /data-governed-desk-status="(shipping|shipped)"/.test(docs))
  const footer = html.slice(html.indexOf('<footer'))
  check('desk page (served): the footer carries the /desk link and the LEGAL_ENTITY_SHORT copyright', footer.includes('href="/desk"') && footer.includes(`© 2026 ${LEGAL_ENTITY_SHORT}`))

  // ── The pilot door ──────────────────────────────────────────────────────
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/desk/pilot`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const notJson = await post('not json')
  const badEmail = await post({ name: 'Pins', firm: 'Pins Capital', email: 'nope', custody: 'safe' })
  const badJ = (await badEmail.json()) as { error?: string }
  check('pilot (route): a non-JSON body and a bad email are 400 with a sentence', notJson.status === 400 && badEmail.status === 400 && /email/i.test(badJ.error ?? ''), `${notJson.status} ${badEmail.status} ${badJ.error}`)
  const stamp = Date.now()
  const email = `desk-pins-${stamp}@example.com`
  const goodRes = await post({ name: 'Pins Runner', firm: `Pins Capital ${stamp}`, email, custody: 'fireblocks', venues: 'CoW + Uniswap v3 on Base', trades: 'majors to $5M', website: '' })
  const goodJ = (await goodRes.json()) as { ok?: boolean }
  check('pilot (route): a good request answers 200 { ok: true } (the page then says "We answer within a day")', goodRes.status === 200 && goodJ.ok === true, `${goodRes.status} ${JSON.stringify(goodJ)}`)
  const hpEmail = `desk-pins-hp-${stamp}@example.com`
  const hpRes = await post({ name: 'Bot', firm: 'Bot Capital', email: hpEmail, custody: 'safe', website: 'http://spam.example' })
  const hpJ = (await hpRes.json()) as { ok?: boolean }
  check('pilot (route): a filled honeypot answers the same 200 { ok: true }', hpRes.status === 200 && hpJ.ok === true)
  if (process.env.DATABASE_URL) {
    const { default: prisma } = await import('../lib/db')
    try {
      const row = await prisma.deskPilotRequest.findFirst({ where: { email } })
      const hpRow = await prisma.deskPilotRequest.findFirst({ where: { email: hpEmail } })
      check(
        'pilot (DB): the good request is ONE desk_pilot_requests row — email, name, firm, custody, venues, notes, source "desk", no raw IP; the honeypot stored nothing',
        !!row && row.name === 'Pins Runner' && row.firm === `Pins Capital ${stamp}` && row.custody === 'fireblocks' && row.venues === 'CoW + Uniswap v3 on Base' && row.notes === 'majors to $5M' && row.source === 'desk' && (row.ipHash === null || /^[0-9a-f]{16}$/.test(row.ipHash)) && hpRow === null,
        row ? `ipHash=${row.ipHash}` : 'no row',
      )
      await prisma.deskPilotRequest.deleteMany({ where: { email: { in: [email, hpEmail] } } })
      const gone = await prisma.deskPilotRequest.findFirst({ where: { email } })
      check('pilot (DB): the pins row is deleted after the check', gone === null)
    } finally {
      await prisma.$disconnect().catch(() => {})
    }
  } else console.log('  ⚪ pilot (DB): no DATABASE_URL on this process — the stored row is not read back')
  // The limiter, from a fake platform IP so loopback (and other sessions) are untouched.
  const fakeIp = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
  const statuses: number[] = []
  for (let i = 0; i <= PILOT_LIMIT_MAX; i++) statuses.push((await post({ name: 'Bot', firm: 'Bot', email: 'bot@example.com', custody: 'safe', website: 'x' }, { 'x-forwarded-for': fakeIp })).status)
  check(`pilot (route): ${PILOT_LIMIT_MAX} requests from one platform IP in an hour pass and the next is 429 with retry-after (honeypot bodies, nothing stored)`, statuses.slice(0, PILOT_LIMIT_MAX).every((s) => s === 200) && statuses[PILOT_LIMIT_MAX] === 429, statuses.join(','))

  // ── The legal env, on a second server ───────────────────────────────────
  check('legal (served): with no LEGAL_* set this server\'s Terms still carry the placeholders (the defaults are the shipped strings)', process.env.LEGAL_GOVERNING_LAW ? true : (await (await fetch(`${base}/docs/terms`)).text()).includes(LEGAL_PLACEHOLDER))
  if (opts.legalServer) {
    const port = Number(new URL(base).port || 3000) + 1
    const env = { ...process.env, LEGAL_ENTITY: 'Pantessa, Inc. (pins)', LEGAL_ENTITY_SHORT: 'PANTESSA PINS INC.', LEGAL_GOVERNING_LAW: 'the State of Delaware (pins)', LEGAL_VENUE: 'the courts of Wilmington, Delaware (pins)', PORT: String(port) }
    let child: ChildProcess | null = null
    try {
      child = spawn(join(process.cwd(), 'node_modules', '.bin', 'next'), ['start', '-p', String(port)], { env, stdio: 'ignore' })
      const legalBase = `http://localhost:${port}`
      const ready = await waitReady(legalBase, 60_000)
      const pages = ready ? await Promise.all(['/docs/terms', '/docs/privacy', '/desk', '/pricing'].map(async (p) => [p, flat(await (await fetch(`${legalBase}${p}`)).text())] as const)) : []
      const leaks = pages.filter(([, h]) => h.includes(LEGAL_PLACEHOLDER)).map(([p]) => p)
      const terms = pages.find(([p]) => p === '/docs/terms')?.[1] ?? ''
      const privacy = pages.find(([p]) => p === '/docs/privacy')?.[1] ?? ''
      // The two legal pages are request-time (force-dynamic), so they read the
      // env the server was started with; /desk and /pricing are prerendered,
      // so their footer still carries the BUILD's short entity — the documented
      // "set LEGAL_* on Vercel, then redeploy" rule, pinned here on purpose.
      const statics = pages.filter(([p]) => p === '/desk' || p === '/pricing')
      check(
        `legal (served, LEGAL_* set on a second next start :${port}): no page carries "${LEGAL_PLACEHOLDER}"; the Terms name the law + venue + entity, the Privacy policy the entity, both footers the short entity; the prerendered pages keep the build's short entity`,
        ready && leaks.length === 0 && terms.includes('the State of Delaware (pins)') && terms.includes('the courts of Wilmington, Delaware (pins)') && terms.includes('Pantessa, Inc. (pins)') && privacy.includes('Pantessa, Inc. (pins)') &&
          terms.includes('© 2026 PANTESSA PINS INC.') && privacy.includes('© 2026 PANTESSA PINS INC.') && statics.length === 2 && statics.every(([, h]) => h.includes(`© 2026 ${LEGAL_ENTITY_SHORT}`)),
        ready ? `leaks: ${leaks.join(',') || 'none'} · terms law=${terms.includes('the State of Delaware (pins)')} entity=${terms.includes('Pantessa, Inc. (pins)')} short=${terms.includes('PANTESSA PINS INC.')}` : 'the second server never answered',
      )
    } finally {
      child?.kill('SIGTERM')
    }
  } else console.log('  ⚪ legal (served): --legal-server not passed — the env override is pinned purely + by source')
}

if (process.argv[1]?.endsWith('desk-page-pins.ts')) {
  let pass = 0
  let fail = 0
  const check: Check = (name, ok, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    ok ? pass++ : fail++
  }
  ;(async () => {
    deskPagePins(check)
    if (process.argv.includes('--live')) {
      const base = process.env.BASE ?? 'http://localhost:3000'
      if (!process.env.DATABASE_URL) {
        const m = (() => {
          try {
            return readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
          } catch {
            return null
          }
        })()
        if (m) process.env.DATABASE_URL = m[1].trim().replace(/^"|"$/g, '')
      }
      await deskPageLivePins(check, base, { legalServer: process.argv.includes('--legal-server') })
    }
    console.log(`\n${pass} passed, ${fail} failed\n`)
    process.exit(fail ? 1 : 0)
  })().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
