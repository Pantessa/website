// Pins for the desk plans (PLANS lane, squad five-million, 2026-11-03).
//
// PURE (plansPins): the entitlements table (lib/tenant/entitlements) cell by
// cell, unknown plans fall to free, the helpers (planAllows · capAllows ·
// cheapestPlanAllowing · cheapestPlanForCap · entitlementsJson), lib/plans'
// Agent + Desk on sale with 0 credits and NO hard-coded Stripe product id
// (env only), Enterprise valid but hand-sold, Growth/Scale still retired, the
// answers grid untouched (Free, Plus), DESK_PLAN_FEATURES written from the
// entitlements, and the source rules (client-safe imports, nothing retyped on
// /pricing, the checkout's one-plan rule, PlanPanel never printing "0 house
// answers").
//
// LIVE (plansLivePins): the served /pricing carries the four desk tiers with
// the spec's numbers and the Plus section as before; checkout refuses
// growth/scale/enterprise/free by name and opens a TEST-mode Stripe session
// for agent/desk (or answers the 503 shape when Stripe is not configured —
// never with a live key: a sk_live_ key skips every session-creating call);
// a Stripe-SIGNED webhook (generated locally from STRIPE_WEBHOOK_SECRET)
// activates `agent` for a throwaway wallet, /api/billing/plan then shows the
// Agent entitlements, a second checkout answers 409, and a signed
// `customer.subscription.deleted` puts the wallet back on free.
//
// Called from scripts/test-api.ts (the `plans` block at the end), and alone:
//   npx tsx scripts/plans-pins.ts                         (pure)
//   BASE=http://localhost:4420 npx tsx scripts/plans-pins.ts --live
import { readFileSync } from 'node:fs'
import Stripe from 'stripe'
import { createSiweMessage } from 'viem/siwe'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import {
  ANSWER_PACK,
  DESK_PLANS,
  DESK_PLAN_FEATURES,
  LISTED_PLANS,
  PAID_PLANS,
  PLANS,
  PLAN_BY_ID,
  countWords,
  deskFeatureLines,
  deskPlanSummary,
  isCheckoutPlan,
  isPlanId,
  planChargeUsd,
  planCreditsFor,
  planFamily,
  stripeProductFor,
} from '../lib/plans'
import {
  DESK_PLAN_ORDER,
  ENTITLEMENT_CAPS,
  ENTITLEMENT_FLAGS,
  capAllows,
  cheapestPlanAllowing,
  cheapestPlanForCap,
  entitlementsFor,
  entitlementsJson,
  isDeskPlanId,
  planAllows,
} from '../lib/tenant/entitlements'
import { DESIGN_PARTNER_FREE_DAYS, DESK_FEE_TIERS, DESK_PLAN_IDS, DESK_PLATFORM_FEE_USD, tieredDeskFeeUsd, type TenantEntitlements } from '../lib/tenant/spec'

type Check = (name: string, ok: boolean, extra?: string) => void

const INF = Number.POSITIVE_INFINITY
/** The contract, cell by cell (README "THE CONTRACT → Plans"). */
const EXPECTED: Record<string, TenantEntitlements> = {
  free: { tenants: 1, keysPerTenant: 1, mainnet: false, blotterExport: false, approvals: false, hooks: false, statement: false },
  agent: { tenants: 1, keysPerTenant: 3, mainnet: true, blotterExport: true, approvals: false, hooks: false, statement: false },
  desk: { tenants: 5, keysPerTenant: 50, mainnet: true, blotterExport: true, approvals: true, hooks: true, statement: true },
  enterprise: { tenants: INF, keysPerTenant: INF, mainnet: true, blotterExport: true, approvals: true, hooks: true, statement: true },
}
const same = (a: TenantEntitlements, b: TenantEntitlements) =>
  (Object.keys(b) as (keyof TenantEntitlements)[]).every((k) => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length

const src = (p: string) => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}
/** Strip // and /* *\/ comments so a pin on code never matches prose. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

export function plansPins(check: Check): void {
  // ── entitlements ─────────────────────────────────────────────────────────
  check(
    'plans: entitlementsFor matches the contract cell by cell — free {1,1,sandbox} · agent {1,3,mainnet,export} · desk {5,50,mainnet,export,approvals,hooks,statement} · enterprise {∞,∞,all}',
    Object.entries(EXPECTED).every(([id, e]) => same(entitlementsFor(id), e)),
    JSON.stringify(Object.fromEntries(Object.keys(EXPECTED).map((id) => [id, entitlementsFor(id)]))),
  )
  check(
    'plans: an unknown plan is the free tier — plus, growth, scale, "", "DESK", "toString", "__proto__" all read free (Plus buys answers, not the desk)',
    ['plus', 'growth', 'scale', '', 'DESK', ' desk', 'toString', '__proto__', 'constructor', 'nope'].every((p) => same(entitlementsFor(p), EXPECTED.free)),
  )
  {
    const a = entitlementsFor('desk')
    a.tenants = 999
    a.approvals = false
    check('plans: entitlementsFor returns a fresh object — a caller editing it never edits the table', entitlementsFor('desk').tenants === 5 && entitlementsFor('desk').approvals === true)
  }
  check(
    'plans: DESK_PLAN_ORDER is spec DESK_PLAN_IDS in the same order (cheapest first); isDeskPlanId accepts exactly those',
    DESK_PLAN_ORDER.join() === DESK_PLAN_IDS.join() && DESK_PLAN_IDS.every((p) => isDeskPlanId(p)) && !isDeskPlanId('plus') && !isDeskPlanId('toString') && !isDeskPlanId(null),
  )
  check(
    'plans: planAllows reads the flag — mainnet free✗ agent✓; blotterExport free✗ agent✓; approvals/hooks/statement agent✗ desk✓; enterprise everything',
    !planAllows('free', 'mainnet') && planAllows('agent', 'mainnet') && !planAllows('free', 'blotterExport') && planAllows('agent', 'blotterExport') &&
      (['approvals', 'hooks', 'statement'] as const).every((f) => !planAllows('agent', f) && planAllows('desk', f)) &&
      ENTITLEMENT_FLAGS.every((f) => planAllows('enterprise', f)) && ENTITLEMENT_FLAGS.length === 5 && ENTITLEMENT_CAPS.join() === 'tenants,keysPerTenant',
  )
  check(
    'plans: capAllows admits up to the cap and refuses one past it — free 0 tenants ✓ 1 ✗; agent keys 2 ✓ 3 ✗; desk keys 49 ✓ 50 ✗; enterprise 1e9 ✓; garbage counts read as 0',
    capAllows('free', 'tenants', 0) && !capAllows('free', 'tenants', 1) && capAllows('agent', 'keysPerTenant', 2) && !capAllows('agent', 'keysPerTenant', 3) &&
      capAllows('desk', 'keysPerTenant', 49) && !capAllows('desk', 'keysPerTenant', 50) && capAllows('desk', 'tenants', 4) && !capAllows('desk', 'tenants', 5) &&
      capAllows('enterprise', 'tenants', 1e9) && capAllows('free', 'keysPerTenant', Number.NaN) && capAllows('free', 'keysPerTenant', -3),
  )
  check(
    'plans: the cheapest plan that unlocks a feature names the way forward — mainnet/export → agent; approvals/hooks/statement → desk; a 4th key → desk; a 6th tenant → enterprise',
    cheapestPlanAllowing('mainnet') === 'agent' && cheapestPlanAllowing('blotterExport') === 'agent' && cheapestPlanAllowing('approvals') === 'desk' &&
      cheapestPlanAllowing('hooks') === 'desk' && cheapestPlanAllowing('statement') === 'desk' &&
      cheapestPlanForCap('keysPerTenant', 4) === 'desk' && cheapestPlanForCap('keysPerTenant', 3) === 'agent' && cheapestPlanForCap('tenants', 6) === 'enterprise' && cheapestPlanForCap('tenants', 1) === 'free',
  )
  {
    const j = JSON.parse(JSON.stringify(entitlementsJson(entitlementsFor('enterprise'))))
    const d = JSON.parse(JSON.stringify(entitlementsJson(entitlementsFor('desk'))))
    check(
      'plans: entitlementsJson spells an unlimited cap null on purpose (JSON has no Infinity) and keeps finite caps and every flag',
      j.tenants === null && j.keysPerTenant === null && j.statement === true && d.tenants === 5 && d.keysPerTenant === 50 && d.approvals === true,
    )
  }

  // ── lib/plans ────────────────────────────────────────────────────────────
  const agent = PLAN_BY_ID.agent
  const desk = PLAN_BY_ID.desk
  const ent = PLAN_BY_ID.enterprise
  check(
    'plans: Agent $49/mo · $490/yr and Desk $499/mo · $4,990/yr are ON SALE (not legacy, not hand-sold), family desk, credits 0 (they price the desk, not answers)',
    agent.priceUsd === 49 && agent.yearlyUsd === 490 && desk.priceUsd === 499 && desk.yearlyUsd === 4990 &&
      [agent, desk].every((p) => !p.legacy && !p.handSold && p.credits === 0 && planFamily(p) === 'desk' && planCreditsFor(p, new Date(0)) === 0) &&
      planChargeUsd(agent, 'month') === 49 && planChargeUsd(agent, 'year') === 490 && planChargeUsd(desk, 'year') === 4990,
  )
  check(
    'plans: Enterprise is a valid plan id (a subscription row may carry it) but hand-sold — never in PAID_PLANS, DESK_PLANS or the answers grid, credits 0',
    isPlanId('enterprise') && ent.handSold === true && ent.credits === 0 && planFamily(ent) === 'desk' &&
      !PAID_PLANS.includes(ent) && !DESK_PLANS.includes(ent) && !LISTED_PLANS.includes(ent),
  )
  const savedEnv = { agent: process.env.STRIPE_PRODUCT_AGENT, desk: process.env.STRIPE_PRODUCT_DESK }
  delete process.env.STRIPE_PRODUCT_AGENT
  delete process.env.STRIPE_PRODUCT_DESK
  const unset = [stripeProductFor(agent), stripeProductFor(desk), stripeProductFor(ent)]
  process.env.STRIPE_PRODUCT_AGENT = 'prod_pins_agent'
  process.env.STRIPE_PRODUCT_DESK = 'prod_pins_desk'
  const set = [stripeProductFor(agent), stripeProductFor(desk)]
  if (savedEnv.agent === undefined) delete process.env.STRIPE_PRODUCT_AGENT
  else process.env.STRIPE_PRODUCT_AGENT = savedEnv.agent
  if (savedEnv.desk === undefined) delete process.env.STRIPE_PRODUCT_DESK
  else process.env.STRIPE_PRODUCT_DESK = savedEnv.desk
  const plansSrc = code(src('lib/plans.ts'))
  check(
    'plans: NO hard-coded Stripe product id on the desk plans — stripeProductId absent, env unset → undefined (Stripe makes the product inline), STRIPE_PRODUCT_AGENT / _DESK win when set; the only prod_ literals left are the two retired plans',
    [agent, desk, ent].every((p) => p.stripeProductId === undefined) && unset.every((v) => v === undefined) &&
      set[0] === 'prod_pins_agent' && set[1] === 'prod_pins_desk' && (plansSrc.match(/prod_[A-Za-z0-9]+/g) ?? []).length === 2,
    `prod_ literals: ${(plansSrc.match(/prod_[A-Za-z0-9]+/g) ?? []).join(',')}`,
  )
  check(
    'plans: on sale = PAID_PLANS plus,agent,desk; the desk list = agent,desk; the answers grid (LISTED_PLANS, what PricingPlans maps) is still free,plus; Growth + Scale still retired but valid',
    PAID_PLANS.map((p) => p.id).join() === 'plus,agent,desk' && DESK_PLANS.map((p) => p.id).join() === 'agent,desk' &&
      LISTED_PLANS.map((p) => p.id).join() === 'free,plus' && PLAN_BY_ID.growth.legacy === true && PLAN_BY_ID.scale.legacy === true &&
      isPlanId('growth') && isPlanId('scale') && PLAN_BY_ID.plus.priceUsd === 9 && PLAN_BY_ID.plus.credits === 600 && ANSWER_PACK.priceUsd === 10,
  )
  check(
    'plans: isCheckoutPlan sells plus/agent/desk only — free, growth, scale, enterprise, a typo and prototype keys refused; isPlanId knows all seven ids and no prototype key',
    ['plus', 'agent', 'desk'].every((p) => isCheckoutPlan(p)) && ['free', 'growth', 'scale', 'enterprise', 'Agent', '', 'toString', '__proto__', null, 7].every((p) => !isCheckoutPlan(p)) &&
      PLANS.length === 7 && PLANS.every((p) => isPlanId(p.id)) && !isPlanId('toString') && !isPlanId('__proto__') && !isPlanId('hasOwnProperty'),
  )

  // ── DESK_PLAN_FEATURES ───────────────────────────────────────────────────
  const tiers = DESK_PLAN_FEATURES
  const t = (id: string) => tiers.find((x) => x.id === id)!
  const texts = (id: string) => t(id).features.map((f) => f.text)
  check(
    'plans: DESK_PLAN_FEATURES lists the four tiers cheapest first (Sandbox · Agent · Desk · Enterprise); only Agent + Desk carry a Plan to check out',
    tiers.map((x) => x.id).join() === 'free,agent,desk,enterprise' && t('free').name === 'Sandbox' && t('agent').plan === agent && t('desk').plan === desk &&
      t('free').plan === null && t('enterprise').plan === null,
  )
  check(
    'plans: every tier\'s lines are WRITTEN FROM the entitlements — sandbox names Base Sepolia + HL testnet; Agent "One tenant on mainnet" + "Three desk keys"; Desk "Five tenants on mainnet" + "50 desk keys per tenant"; Enterprise "Unlimited"',
    texts('free')[0] === `${countWords(1, 'tenant', 'tenants')}, sandbox only: Base Sepolia and Hyperliquid testnet` && texts('free')[1] === 'One desk key' &&
      texts('agent')[0] === 'One tenant on mainnet' && texts('agent')[1] === 'Three desk keys' &&
      texts('desk')[0] === 'Five tenants on mainnet' && texts('desk')[1] === '50 desk keys per tenant' &&
      texts('enterprise')[0] === 'Unlimited tenants on mainnet' && texts('enterprise')[1] === 'Unlimited desk keys',
    JSON.stringify(tiers.map((x) => texts(x.id).slice(0, 2))),
  )
  check(
    'plans: a line appears only where its entitlement is on — CSV export from Agent, maker-checker + the statement from Desk, and nothing the sandbox does not have',
    DESK_PLAN_IDS.every((id) => {
      const e = entitlementsFor(id)
      const has = (re: RegExp) => texts(id).some((x) => re.test(x))
      return has(/as CSV/) === e.blotterExport && has(/Maker-checker/) === e.approvals && has(/monthly statement/) === e.statement && has(/hooks/) === e.hooks
    }),
  )
  check(
    'plans: each tier\'s card lines = what it ADDS over the tier below ("Everything in Agent, plus:") — Agent adds mainnet + three keys + CSV; Desk adds five tenants + 50 keys + maker-checker + the statement + hooks; Enterprise adds the unlimited caps; nothing a tier includes is lost (adds ∪ the tier below = its features)',
    t('free').inherits === null && t('free').adds.length === t('free').features.length && t('agent').inherits === 'Sandbox' && t('desk').inherits === 'Agent' && t('enterprise').inherits === 'Desk' &&
      t('agent').adds.map((f) => f.text).join('|') === 'One tenant on mainnet|Three desk keys|Export the blotter as CSV' &&
      t('enterprise').adds.map((f) => f.text).join('|') === 'Unlimited tenants on mainnet|Unlimited desk keys' &&
      t('desk').adds.some((f) => /Maker-checker/.test(f.text)) && t('desk').adds.some((f) => f.soon) &&
      tiers.every((x, i) => i === 0 || x.features.every((f) => x.adds.some((a) => a.text === f.text) || tiers[i - 1].features.some((b) => b.text === f.text))),
    JSON.stringify(tiers.map((x) => x.adds.map((f) => f.text))),
  )
  check(
    'plans: hooks (wave 2, not built) are marked soon wherever a plan includes them — a page must say "coming", the Plan highlights say "(coming)"',
    DESK_PLAN_IDS.every((id) => t(id).features.filter((f) => /hooks/.test(f.text)).every((f) => f.soon === true)) &&
      desk.highlights.some((h) => /hooks \(coming\)$/.test(h)) && !agent.highlights.some((h) => /hooks/.test(h)),
  )
  check(
    'plans: the desk plans\' Plan.highlights are the same lines /pricing prints; the inline Stripe description names the desk and never "house answers"',
    agent.highlights.join('|') === deskFeatureLines('agent').map((f) => f.text).join('|') && deskPlanSummary('agent').includes('Three desk keys') &&
      !/answers/i.test(deskPlanSummary('agent')) && !/answers/i.test(deskPlanSummary('desk')) && !/hooks/.test(deskPlanSummary('desk')),
  )

  // ── source rules ─────────────────────────────────────────────────────────
  const entSrc = code(src('lib/tenant/entitlements.ts'))
  // `[^'"]*` stops at the first module string, so one import never spans into the next.
  const runtimeSpecImport = /import\s+(?!type\b)[^'"]*from\s+['"](?:@\/lib\/tenant\/spec|\.\/spec|(?:\.\.\/)+lib\/tenant\/spec)['"]/
  check(
    'plans: lib/plans.ts + lib/tenant/entitlements.ts import only TYPES from lib/tenant/spec (it imports node:crypto; client components import lib/plans)',
    !runtimeSpecImport.test(plansSrc) && !runtimeSpecImport.test(entSrc) && /import type \{[^}]*\} from '@\/lib\/tenant\/spec'/.test(entSrc) && !/node:/.test(plansSrc + entSrc),
  )
  const co = code(src('app/api/billing/checkout/route.ts'))
  check(
    'plans: checkout sells through isCheckoutPlan, names every plan on sale from PAID_PLANS in its refusal, describes a desk plan by deskPlanSummary (not "house answers"), carries plan + family in metadata, lands a desk buyer on /dashboard/plan?desk=<id>',
    co.includes('isCheckoutPlan(planId)') && co.includes("PAID_PLANS.map((p) => p.id).join(', ')") && co.includes('deskPlanSummary(') &&
      co.includes('family: planFamily(plan)') && co.includes('/dashboard/plan?desk=${plan.id}') && !co.includes("plan on sale (plus)"),
  )
  check(
    'plans: ONE WALLET, ONE PLAN — checkout reads getEffectivePlan and answers 409 { current, manage } before any Stripe session when the wallet already holds a paid plan',
    /getEffectivePlan\(owner\)/.test(co) && /current\.id !== 'free'/.test(co) && /status: 409/.test(co) && co.indexOf('status: 409') < co.indexOf('checkout.sessions.create'),
  )
  const wh = code(src('app/api/billing/webhook/route.ts'))
  check(
    'plans: the webhook activates ANY plan id lib/plans knows (isPlanId, no plan literal) — Agent and Desk need no webhook change',
    (wh.match(/isPlanId\(plan\)/g) ?? []).length >= 2 && !/'plus'|'agent'|'desk'/.test(wh),
  )
  const page = code(src('app/pricing/page.tsx'))
  const island = code(src('app/pricing/DeskPlans.tsx'))
  check(
    '/pricing: the desk section reads DESK_PLAN_FEATURES + the spec constants (platform fee, bps tiers, design-partner days, tieredDeskFeeUsd) — no desk price is retyped in the page or its island',
    page.includes('DESK_PLAN_FEATURES.map(') && page.includes('DESK_PLATFORM_FEE_USD') && page.includes('DESK_FEE_TIERS.map(') &&
      page.includes('DESIGN_PARTNER_FREE_DAYS') && page.includes('tieredDeskFeeUsd(') && page.includes('<PricingPlans />') &&
      !/\b(49|490|499|4990|4,990|4000|4,000|21,500|90)\b/.test(page.replace(/EXAMPLE_NOTIONAL = 25_000_000/, '')) && !/\b(49|490|499|4990|4000)\b/.test(island),
  )
  check(
    '/pricing: the desk checkout uses the same door as Plus — POST /api/billing/checkout, 401 → connectAndSignIn back to ?checkout=<plan>, CreateAccountButton when CDP is on; it resumes only agent/desk so PricingPlans never double-fires',
    island.includes("fetch('/api/billing/checkout'") && island.includes('connectAndSignIn(resumeHref(plan, iv))') && island.includes('<CreateAccountButton') &&
      island.includes("wanted !== 'agent' && wanted !== 'desk'") && island.includes('redirectTo={resumeHref(plan, interval)}'),
  )
  const panel = code(src('components/PlanPanel.tsx'))
  check(
    '/dashboard/plan: a 0-credit plan never prints "0 house answers" — the allowance line, the meter and the "left this month" tile need hasAllowance; a desk plan says what it buys and shows THE DESK card linking /desk',
    panel.includes('const hasAllowance = u.allowance > 0') && /isPaid && hasAllowance\s*\?/.test(panel) && panel.includes('{hasAllowance && (') &&
      panel.includes('Pays for the desk') && panel.includes('<DeskCard') && panel.includes('href="/desk"') && !/isPaid\s*\?\s*`\$\{u\.allowance/.test(panel),
  )
  // Pricing constants the page prints, recomputed here from the spec.
  check(
    'plans: the spec numbers the page prints — $4,000 platform fee, 10/5/2 bps tiers at $10M/$100M, 90 design-partner days, $25M → $17,500 of execution',
    DESK_PLATFORM_FEE_USD === 4000 && DESK_FEE_TIERS.map((x) => x.bps).join() === '10,5,2' && DESIGN_PARTNER_FREE_DAYS === 90 && tieredDeskFeeUsd(25_000_000) === 17_500,
  )
}

// ── LIVE ───────────────────────────────────────────────────────────────────

function envLocal(name: string): string | null {
  if (process.env[name]) return process.env[name] as string
  const m = src('.env.local').match(new RegExp(`^${name}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : null
}
function cookieOf(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}
async function siwe(base: string, account: PrivateKeyAccount): Promise<string | null> {
  const nonceRes = await fetch(`${base}/api/auth/nonce`)
  const nonceCookie = cookieOf(nonceRes, 'yf_siwe_nonce')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(base).host, nonce, uri: base, version: '1' })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  return cookieOf(res, 'yf_session')
}
const flat = (html: string) => html.replace(/<!--.*?-->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
const usd = (n: number) => `$${n.toLocaleString('en-US')}`
const usdShort = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toLocaleString('en-US')}M` : usd(n))

/** `signIn` lets the harness pass its own (it records the wallet for the
 *  end-of-suite sweeps); alone, the pins mint throwaway wallets themselves. */
export async function plansLivePins(check: Check, base: string, signIn?: (a: PrivateKeyAccount) => Promise<string | null>): Promise<void> {
  const login = signIn ?? ((a: PrivateKeyAccount) => siwe(base, a))
  const H = { 'x-yf-internal-run': '1' }

  // /pricing: four tiers with the spec's numbers; the Plus grid as before.
  const pr = await fetch(`${base}/pricing`, { headers: H })
  const html = flat(await pr.text())
  const want = [
    'id="desk"',
    ...DESK_PLAN_IDS.map((id) => `data-desk-tier="${id}"`),
    ...DESK_PLAN_FEATURES.map((t) => `>${t.name}</h3>`),
    usd(PLAN_BY_ID.agent.priceUsd),
    usd(PLAN_BY_ID.desk.priceUsd),
    usd(DESK_PLATFORM_FEE_USD),
    ...DESK_FEE_TIERS.map((t, i) => (Number.isFinite(t.uptoUsd) ? `${t.bps} bps to ${usdShort(t.uptoUsd)}` : `${t.bps} bps above ${usdShort(DESK_FEE_TIERS[i - 1].uptoUsd)}`)),
    `free for the first ${DESIGN_PARTNER_FREE_DAYS} days`,
    usd(DESK_PLATFORM_FEE_USD + tieredDeskFeeUsd(25_000_000)),
    'Get Agent',
    'Get Desk',
    'Request a pilot',
    'href="/desk"',
    ...DESK_PLAN_FEATURES.flatMap((t) => t.adds.map((f) => f.text)),
    ...DESK_PLAN_FEATURES.filter((t) => t.inherits).map((t) => `Everything in ${t.inherits}, plus:`),
  ]
  const missing = want.filter((w) => !html.includes(w))
  check(
    'plans live: /pricing serves "The desk" — four tiers (Sandbox · Agent · Desk · Enterprise) with every line and number read from lib/plans + lib/tenant/spec, Get Agent / Get Desk / Request a pilot, a link to /desk',
    pr.status === 200 && missing.length === 0,
    `${pr.status} missing: ${missing.join(' | ')}`,
  )
  check(
    'plans live: the Plus / pack / BYOK section is still there as it was — Get Plus, the pack, Bring your own API key, and no desk plan inside the answers grid',
    html.includes('Get Plus') && html.includes(`Buy for $${ANSWER_PACK.priceUsd}`) && html.includes('Bring your own API key') &&
      html.indexOf('pricing__grid--two') > -1 && html.indexOf('pricing__grid--two') < html.indexOf('id="desk"') &&
      !html.slice(html.indexOf('pricing__grid--two'), html.indexOf('Three more ways')).includes('Get Agent'),
  )
  check('plans live: no "TO BE COMPLETED", no "in partnership with Dune", no SOC 2 claim on /pricing', !/TO BE COMPLETED|in partnership with Dune|SOC ?2/i.test(html))

  // Checkout: auth first, then the plan id.
  const noAuth = await fetch(`${base}/api/billing/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body: JSON.stringify({ plan: 'agent' }) })
  check('plans live: checkout for agent without a SIWE session → 401 (the door signs in first)', noAuth.status === 401, String(noAuth.status))

  const buyer = privateKeyToAccount(generatePrivateKey())
  const session = await login(buyer)
  if (!session) {
    check('plans live: a throwaway wallet signs in for the checkout pins', false, 'SIWE failed')
    return
  }
  const CJ = { 'content-type': 'application/json', cookie: session, ...H }
  const post = async (body: unknown) => {
    const r = await fetch(`${base}/api/billing/checkout`, { method: 'POST', headers: CJ, body: JSON.stringify(body) })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as { url?: string; error?: string; detail?: string; current?: string; manage?: string } }
  }
  const secret = envLocal('STRIPE_SECRET_KEY')
  const stripeOn = !!secret
  const live = !!secret && secret.startsWith('sk_live_')
  const refused = await Promise.all(['growth', 'scale', 'enterprise', 'free', 'nope'].map((plan) => post({ plan })))
  check(
    `plans live: checkout refuses growth · scale · enterprise · free · a typo — ${stripeOn ? '400 naming every plan on sale (plus, agent, desk)' : '503 (Stripe not configured here, the route answers before the plan id)'}`,
    refused.every((r) => (stripeOn ? r.status === 400 && (r.body.error ?? '').includes('(plus, agent, desk)') : r.status === 503)),
    refused.map((r) => `${r.status} ${r.body.error ?? ''}`.slice(0, 90)).join(' · '),
  )
  if (!stripeOn) {
    const r = await post({ plan: 'agent' })
    check(
      'plans live: with no STRIPE_SECRET_KEY, checkout for agent answers the 503 shape — a buyer sentence that names no env var + a detail for the network tab',
      r.status === 503 && !!r.body.error && !/STRIPE/.test(r.body.error ?? '') && /STRIPE_SECRET_KEY/.test(r.body.detail ?? ''),
      `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`,
    )
    console.log('  ⚪ plans live: STRIPE_SECRET_KEY is not set — the session + webhook pins are skipped (the 503 shape was asserted instead)')
    return
  }
  if (live) {
    console.log('  ⚪ plans live: STRIPE_SECRET_KEY is a LIVE key — no checkout session is created and no webhook is replayed (test mode only)')
    return
  }
  const [a, d] = await Promise.all([post({ plan: 'agent' }), post({ plan: 'desk', interval: 'year' })])
  check(
    'plans live: checkout for agent (month) and desk (year) opens a TEST-mode Stripe Checkout session (checkout.stripe.com url; nothing is charged until someone pays it)',
    a.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(a.body.url ?? '') && d.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(d.body.url ?? ''),
    `${a.status} ${(a.body.url ?? a.body.error ?? '').slice(0, 60)} · ${d.status} ${(d.body.url ?? d.body.error ?? '').slice(0, 60)}`,
  )

  // The plan API for a fresh wallet: the free desk tier.
  const planRead = async (cookie: string) => {
    const r = await fetch(`${base}/api/billing/plan`, { headers: { cookie, ...H } })
    return (await r.json().catch(() => ({}))) as {
      usage?: { plan?: string; allowance?: number }
      plans?: { id: string }[]
      deskPlans?: { id: string; credits: number }[]
      desk?: { family?: string; plan?: string; entitlements?: Record<string, unknown>; features?: { text: string }[] }
    }
  }
  const fresh = await planRead(session)
  check(
    'plans live: /api/billing/plan for a fresh wallet — answers grid free,plus (unchanged), deskPlans agent,desk at 0 credits, desk block = the free tier (1 tenant, 1 key, sandbox)',
    fresh.plans?.map((p) => p.id).join() === 'free,plus' && fresh.deskPlans?.map((p) => p.id).join() === 'agent,desk' && fresh.deskPlans?.every((p) => p.credits === 0) === true &&
      fresh.desk?.family === 'answers' && fresh.desk?.plan === 'free' && fresh.desk?.entitlements?.tenants === 1 && fresh.desk?.entitlements?.keysPerTenant === 1 && fresh.desk?.entitlements?.mainnet === false,
    JSON.stringify(fresh.desk ?? {}).slice(0, 200),
  )

  // The webhook, signed locally with the deployment's webhook secret.
  const whSecret = envLocal('STRIPE_WEBHOOK_SECRET')
  if (!whSecret) {
    console.log('  ⚪ plans live: no STRIPE_WEBHOOK_SECRET — the signed-webhook activation pins are skipped')
    return
  }
  const signer = new Stripe('sk_test_plans_pins_local_signing_only')
  const tag = buyer.address.slice(2, 12).toLowerCase()
  const subId = `sub_plans_pins_${tag}`
  const cusId = `cus_plans_pins_${tag}`
  const owner = buyer.address.toLowerCase()
  const send = async (type: string, object: Record<string, unknown>) => {
    const payload = JSON.stringify({ id: `evt_plans_pins_${tag}_${type.replace(/\W/g, '_')}`, object: 'event', type, data: { object } })
    const header = signer.webhooks.generateTestHeaderString({ payload, secret: whSecret })
    const r = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': header, 'content-type': 'application/json' }, body: payload })
    return r.status
  }
  const done = await send('checkout.session.completed', {
    id: `cs_plans_pins_${tag}`,
    object: 'checkout.session',
    mode: 'subscription',
    customer: cusId,
    subscription: subId,
    client_reference_id: owner,
    payment_status: 'paid',
    metadata: { ownerAddress: owner, plan: 'agent', family: 'desk' },
  })
  const after = await planRead(session)
  check(
    'plans live: a Stripe-signed checkout.session.completed for plan agent activates it — the effective plan is Agent, 0 answers a month, the desk block carries Agent\'s entitlements (1 tenant, 3 keys, mainnet, CSV export, no approvals)',
    done === 200 && after.usage?.plan === 'agent' && after.usage?.allowance === 0 && after.desk?.family === 'desk' && after.desk?.plan === 'agent' &&
      after.desk?.entitlements?.tenants === 1 && after.desk?.entitlements?.keysPerTenant === 3 && after.desk?.entitlements?.mainnet === true &&
      after.desk?.entitlements?.blotterExport === true && after.desk?.entitlements?.approvals === false,
    `${done} ${JSON.stringify({ usage: after.usage?.plan, desk: after.desk }).slice(0, 220)}`,
  )
  const second = await post({ plan: 'desk' })
  const again = await post({ plan: 'agent' })
  check(
    'plans live: ONE WALLET, ONE PLAN — that wallet\'s checkout for desk answers 409 naming Agent and the plan page; for agent again, 409 "already on Agent"; no second subscription is opened',
    second.status === 409 && second.body.current === 'agent' && second.body.manage === '/dashboard/plan' && /already pays for Agent/.test(second.body.error ?? '') &&
      again.status === 409 && /already on Agent/.test(again.body.error ?? '') && !second.body.url && !again.body.url,
    `${second.status} ${second.body.error ?? ''} · ${again.status} ${again.body.error ?? ''}`,
  )
  const deleted = await send('customer.subscription.deleted', {
    id: subId,
    object: 'subscription',
    customer: cusId,
    status: 'canceled',
    metadata: { ownerAddress: owner, plan: 'agent' },
    items: { object: 'list', data: [] },
  })
  const back = await planRead(session)
  check(
    'plans live: a signed customer.subscription.deleted puts the wallet back on free — the desk block is the sandbox tier again',
    deleted === 200 && back.usage?.plan === 'free' && back.desk?.plan === 'free' && back.desk?.entitlements?.mainnet === false,
    `${deleted} ${back.usage?.plan}`,
  )
}

if (process.argv[1]?.endsWith('plans-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  }
  plansPins(check)
  const base = process.env.BASE
  const runLive = process.argv.includes('--live') || !!base
  const done = runLive ? plansLivePins(check, base ?? 'http://localhost:4420') : Promise.resolve()
  done
    .catch((e) => {
      failed++
      console.log(`❌ plans live: threw — ${e instanceof Error ? e.message : String(e)}`)
    })
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall plans pins green${runLive ? ' (pure + live)' : ' (pure; pass --live or BASE= for the served half)'}`)
      process.exit(failed ? 1 : 0)
    })
}
