// scripts/console-pins.ts — the CONSOLE lane's pins (squad five-million,
// 2026-11-03): /dashboard/desk and /dashboard/desk/[id], the desk console.
//
// PURE half (consolePurePins):
//   · the vocabulary the server hands the console IS lib/tenant/spec's
//     (venues, ops, sides, lanes, blotter kinds, chains, the sample policy);
//   · the browser's policy shape check agrees with lib/tenant/policy
//     validatePolicyDoc — same ok, same field — over a corpus of documents;
//   · the approvals queue read off the blotter, the maker-checker seat, the
//     plan line, the desk/rule words, the blotter query, the explorer link;
//   · source pins: the pages are server files that hand down the vocabulary,
//     no client file imports a runtime value from spec/policy (node:crypto),
//     the console calls the contract's routes, no Tailwind opacity on a CSS
//     variable, no html/body overflow, 44px controls, the secret never
//     reaches storage, the dashboard rail carries the Desk seat.
//
// LIVE half (consoleLivePins, `--live <base>`): the served HTML of both pages
// for a signed-in owner, then a DRIVE through the real routes the console
// calls: a fresh owner creates `console-drive-<random>` (the burner already
// runs its free plan's one tenant, so the burner is the SECOND ADMIN here),
// a second create is refused naming `tenants`, the README sample policy is
// proposed and self-activated (free plan: no maker-checker), a key is minted
// (the secret once; a second refused naming keysPerTenant), the blotter reads
// policy_* + key_minted rows, verify ok, CSV refused naming blotterExport,
// the statement is a preview, key + tenant pause/resume, the owner adds the
// burner as an admin, the burner reads the tenant and is refused editing
// admins; a custody signer is registered by proof of control (challenge →
// its own personal_sign → POST …/signers) and removed; with DATABASE_URL (the
// TEST DB) an active 'agent' subscription for the owner is the fixture (the
// sandbox follows the owner's plan, QA F5) so the console leaves the sandbox,
// exports the CSV, and "Buy $400 of ETH on Base" waits for one approval that
// the console's queue finds and the burner approves; the row is restored. Cleanup: the burner leaves the
// admins, the key is revoked, the tenant paused, sandbox back on, and
// is_internal confirmed true (the route has no delete; the rows stay,
// fenced as internal).
//
//   npm run pins:console                                         (pure)
//   DATABASE_URL=… npx tsx scripts/console-pins.ts --live http://localhost:4461
//   … --live <base> --keep <state.json>     (no cleanup; writes the cookies + tenant id for a visual pass)
//   … --cleanup <state.json>                (clean a kept run)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { SAMPLE_POLICY, validatePolicyDoc } from '../lib/tenant/policy'
import { BLOTTER_KINDS, canonicalJson, DESK_ID_RE, DESK_KEY_RE, SIGNING_LANES, TENANT_OPS, TENANT_SIDES, TENANT_SLUG_RE, TENANT_VENUES, VENUE_CHAINS } from '../lib/tenant/spec'
import { checkPolicyDoc, checkPolicyText, orderPolicyDoc, policyDocJson, policyJson } from '../components/desk/policy-check'
import { approvalQueue, blotterQuery, currentYm, daysWords, deskLines, explorerTx, fileNameOf, planLine, proposalSeat, ruleLines, ymClosed } from '../components/desk/derive'
import { deskVocab } from '../components/desk/vocab.server'
import type { BlotterRowJson } from '../components/desk/types'

type Check = (name: string, ok: boolean, extra?: string) => void
const read = (p: string) => readFileSync(p, 'utf8')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/* ── pure ─────────────────────────────────────────────────────────────── */

/** Documents the browser check and the server validator must judge alike. */
function corpus(): { name: string; doc: unknown }[] {
  const S = SAMPLE_POLICY
  const venue0 = S.venues[0]
  const desk0 = S.desks[0]
  const withRule = (r: Record<string, unknown>) => ({ ...S, venues: [{ ...venue0, ...r }] })
  const withDesk = (d: Record<string, unknown>) => ({ ...S, desks: [{ ...desk0, ...d }] })
  return [
    { name: 'the sample', doc: S },
    {
      name: 'a rich document (hours, approvals, tokens, sides, leverage, signing)',
      doc: {
        version: 1,
        default: 'deny',
        venues: [
          { venue: 'uniswap-v3', chains: [8453, 1], ops: ['swap'], tokens: ['USDC', 'eth', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'], sides: ['buy', 'sell'], maxOrderUsd: 500, maxPriceImpactBps: 50 },
          { venue: 'hyperliquid', ops: ['perp-open', 'perp-close'], tokens: ['HYPE'], sides: ['long'], maxLeverage: 3 },
          { venue: 'lido' },
        ],
        desks: [
          { id: 'macro', perOrderUsd: 400, perDayUsd: 1000, approvals: { overUsd: 250, approvers: 2 }, hours: { tz: 'America/New_York', from: '09:30', to: '16:00', days: [1, 2, 3, 4, 5] } },
          { id: 'n', hours: { tz: 'UTC', from: '22:00', to: '06:00', days: [1] } },
        ],
        signing: { lane: 'safe', wallets: ['0x0000000000000000000000000000000000000001'] },
        hooks: { preTrade: 'https://compliance.example.com/pre' },
      },
    },
    { name: 'no venues at all (allowed: default-deny refuses everything)', doc: { ...S, venues: [] } },
    { name: 'not an object', doc: [S] },
    { name: 'null', doc: null },
    { name: 'version 2', doc: { ...S, version: 2 } },
    { name: 'default allow', doc: { ...S, default: 'allow' } },
    { name: 'an unknown top-level field', doc: { ...S, owner: 'x' } },
    { name: 'an unknown venue', doc: withRule({ venue: 'binance' }) },
    { name: 'a chain outside the venue', doc: withRule({ chains: [10] }) },
    { name: 'a string chain', doc: withRule({ chains: ['8453'] }) },
    { name: 'an empty chain list', doc: withRule({ chains: [] }) },
    { name: 'chains on an off-chain venue', doc: { ...S, venues: [{ venue: 'hyperliquid', chains: [1] }] } },
    { name: 'an unknown op', doc: withRule({ ops: ['swap', 'margin'] }) },
    { name: 'a bad token', doc: withRule({ tokens: ['US DC'] }) },
    { name: 'an unknown side', doc: withRule({ sides: ['up'] }) },
    { name: 'a zero maxOrderUsd', doc: withRule({ maxOrderUsd: 0 }) },
    { name: 'impact over 10000 bps', doc: withRule({ maxPriceImpactBps: 20000 }) },
    { name: 'leverage 200', doc: withRule({ maxLeverage: 200 }) },
    { name: 'an unknown rule field', doc: withRule({ note: 'x' }) },
    { name: 'no desks', doc: { ...S, desks: [] } },
    { name: 'a bad desk id', doc: withDesk({ id: 'Macro Desk' }) },
    { name: 'a duplicate desk id', doc: { ...S, desks: [desk0, desk0] } },
    { name: 'approvers 0', doc: withDesk({ approvals: { overUsd: 250, approvers: 0 } }) },
    { name: 'approvals extra field', doc: withDesk({ approvals: { overUsd: 250, approvers: 1, quorum: 2 } }) },
    { name: 'a bad time zone', doc: withDesk({ hours: { tz: 'Mars/Olympus', from: '09:00', to: '17:00', days: [1] } }) },
    { name: 'a bad HH:MM', doc: withDesk({ hours: { tz: 'UTC', from: '9:00', to: '17:00', days: [1] } }) },
    { name: 'a day twice', doc: withDesk({ hours: { tz: 'UTC', from: '09:00', to: '17:00', days: [1, 1] } }) },
    { name: 'day 7', doc: withDesk({ hours: { tz: 'UTC', from: '09:00', to: '17:00', days: [7] } }) },
    { name: 'a non-https hook', doc: { ...S, hooks: { preTrade: 'http://x.example' } } },
    { name: 'an unknown hook', doc: { ...S, hooks: { midTrade: 'https://x.example' } } },
    { name: 'an unknown signing lane', doc: { ...S, signing: { lane: 'fireblocks', wallets: [] } } },
    { name: 'a bad signing wallet', doc: { ...S, signing: { lane: 'wallet', wallets: ['0x12'] } } },
  ]
}

export function consolePurePins(check: Check): void {
  const v = deskVocab()

  // The vocabulary is the contract's, never retyped.
  check('console vocab: venues · ops · sides · lanes · blotter kinds are lib/tenant/spec\'s, in order', same(v.venues, TENANT_VENUES) && same(v.ops, TENANT_OPS) && same(v.sides, TENANT_SIDES) && same(v.lanes, SIGNING_LANES) && same(v.kinds, BLOTTER_KINDS))
  check('console vocab: every venue\'s chains are VENUE_CHAINS, and every chain id a venue names has a name', TENANT_VENUES.every((x) => same(v.venueChains[x], VENUE_CHAINS[x] ? [...(VENUE_CHAINS[x] as readonly number[])] : null)) && TENANT_VENUES.flatMap((x) => [...(VENUE_CHAINS[x] ?? [])]).every((id) => !!v.chainNames[String(id)] && !/^chain /.test(v.chainNames[String(id)])))
  check('console vocab: the sample the editor opens with is lib/tenant/policy SAMPLE_POLICY (the README demo)', same(v.sample, SAMPLE_POLICY) && v.sample.desks[0].id === 'macro' && v.sample.desks[0].approvals?.overUsd === 250)
  check('console vocab: the slug and desk-id rules are spec\'s regexes; every blotter kind has words', v.slugRe === TENANT_SLUG_RE.source && v.deskIdRe === DESK_ID_RE.source && BLOTTER_KINDS.every((k) => typeof v.kindWords[k] === 'string' && v.kindWords[k].length > 8))
  check('console vocab: Base and Base Sepolia link to their explorers; a sandbox tenant\'s chains are the testnets', v.explorers['8453']?.startsWith('https://basescan.org/tx/') && v.explorers['84532']?.startsWith('https://sepolia.basescan.org/tx/') && v.testnets.includes(84532) && !v.testnets.includes(8453))

  // The browser's shape check names what the server names.
  const docs = corpus()
  const disagree = docs.filter(({ doc }) => {
    const c = checkPolicyDoc(doc, v)
    const s = validatePolicyDoc(doc)
    return c.ok !== s.ok || (!c.ok && !s.ok && c.field !== s.field)
  })
  check(`console policy check: agrees with validatePolicyDoc on all ${docs.length} documents (same ok, same field)`, disagree.length === 0, disagree.map((d) => `${d.name}: browser ${JSON.stringify(checkPolicyDoc(d.doc, v))} · server ${JSON.stringify(validatePolicyDoc(d.doc))}`).join(' | ').slice(0, 600))
  check('console policy check: the corpus covers good and bad documents (≥ 2 ok, ≥ 25 refused)', docs.filter((d) => validatePolicyDoc(d.doc).ok).length >= 2 && docs.filter((d) => !validatePolicyDoc(d.doc).ok).length >= 25)
  const bad = checkPolicyDoc(corpus().find((d) => d.name === 'a chain outside the venue')!.doc, v)
  check('console policy check: a chain outside the venue names venues[0].chains[0] and the chains it runs on', !bad.ok && bad.field === 'venues[0].chains[0]' && /cow does not run on chain 10 — it runs on 1, 8453, 42161/.test(bad.error))
  const notJson = checkPolicyText('{ "version": 1, ', v)
  check('console policy check: text that is not JSON names `document` with the parser\'s words', !notJson.ok && notJson.field === 'document' && /not JSON/.test(notJson.error))
  const round = checkPolicyText(policyJson(SAMPLE_POLICY), v)
  check('console policy check: the editor\'s formatting (scalar arrays on one line) round-trips to the same document', round.ok && same(round.doc, SAMPLE_POLICY) && /"chains": \[8453\]/.test(policyJson(SAMPLE_POLICY)))
  const sorted = JSON.parse(canonicalJson(corpus()[1].doc))
  check('console policy: a document read back from jsonb (keys sorted) prints in the spec\'s order — version, default, venues, desks; venue first in a rule; id first in a desk', Object.keys(sorted)[0] === 'default' && same(Object.keys(orderPolicyDoc(sorted) as object), ['version', 'default', 'venues', 'desks', 'hooks', 'signing']) && policyDocJson(sorted) === policyDocJson(corpus()[1].doc) && /^\{\n  "version": 1,\n  "default": "deny",\n  "venues": \[\n    \{\n      "venue": "uniswap-v3"/.test(policyDocJson(sorted)) && canonicalJson(JSON.parse(policyDocJson(sorted))) === canonicalJson(sorted))

  // The approvals queue, read off the blotter.
  const A = '0x' + 'a'.repeat(40)
  const B = '0x' + 'b'.repeat(40)
  let seq = 0
  const row = (kind: string, intentId: string | null, payload: Record<string, unknown>, extra: Partial<BlotterRowJson> = {}): BlotterRowJson => ({
    seq: ++seq, createdAt: new Date(Date.UTC(2026, 10, 3, 12, 0, seq)).toISOString(), kind, intentId, jobId: null, deskId: 'macro', keyId: 'k1', venue: 'uniswap-v3', chainId: 8453,
    valueUsd: 400, feeUsd: null, feeBps: null, txHash: null, verification: null, prevHash: '0', hash: String(seq), payload, ...extra,
  })
  const rows: BlotterRowJson[] = [
    row('intent', 'i-two', { ask: 'Buy $400 of ETH on Base', usd: 400 }),
    row('policy_verdict', 'i-two', { stage: 'open', allowed: true, needsApproval: true, approvers: 2 }),
    row('approval', 'i-two', { approver: A, have: 1, needed: 2, satisfied: false }),
    row('intent', 'i-one', { ask: 'Buy $300 of ETH on Base' }, { valueUsd: 300 }),
    row('policy_verdict', 'i-one', { stage: 'open', allowed: true, needsApproval: true, approvers: 1 }, { valueUsd: 300 }),
    row('approval', 'i-one', { approver: B, have: 1, needed: 1, satisfied: true }, { valueUsd: 300 }),
    row('intent', 'i-gone', { ask: 'Buy $350 of ETH on Base' }),
    row('policy_verdict', 'i-gone', { stage: 'open', allowed: true, needsApproval: true, approvers: 1 }),
    row('policy_verdict', 'i-gone', { stage: 'handoff', allowed: false, reason: 'VENUE_DENIED', detail: 'x' }),
    row('intent', 'i-small', { ask: 'Buy $25 of ETH on Base' }, { valueUsd: 25 }),
    row('policy_verdict', 'i-small', { stage: 'open', allowed: true, needsApproval: false }, { valueUsd: 25 }),
    row('key_minted', null, { keyId: 'k1' }),
  ]
  const q = approvalQueue(rows, A)
  const two = q.find((x) => x.intentId === 'i-two')
  check('console approvals: an over-threshold intent with 1 of 2 approvals is AWAITING, the ask from its intent row, mine for the admin who approved', !!two && two.state === 'awaiting' && two.have === 1 && two.needed === 2 && two.mine === true && two.ask === 'Buy $400 of ETH on Base' && two.usd === 400)
  check('console approvals: an intent whose approvals reached the threshold reads APPROVED; one a later verdict refused reads REFUSED with the reason', q.find((x) => x.intentId === 'i-one')?.state === 'approved' && q.find((x) => x.intentId === 'i-gone')?.state === 'refused' && q.find((x) => x.intentId === 'i-gone')?.reason === 'VENUE_DENIED')
  check('console approvals: an under-threshold intent and a non-intent row never enter the queue; awaiting sorts first', !q.some((x) => x.intentId === 'i-small') && q.length === 3 && q[0].state === 'awaiting')
  check('console approvals: for another admin the same intent is not "mine" (the Approve button shows)', approvalQueue(rows, B).find((x) => x.intentId === 'i-two')?.mine === false)

  // The maker-checker seat (the API still decides).
  check('console policy: under maker-checker the proposer sees "awaiting a second admin"; another admin, or the proposer without maker-checker, sees Approve', proposalSeat({ proposedBy: A }, A.toUpperCase().replace('0X', '0x'), true) === 'awaiting-second-admin' && proposalSeat({ proposedBy: A }, B, true) === 'approve' && proposalSeat({ proposedBy: A }, A, false) === 'approve')

  // The plan line + the words.
  const free = planLine('free', { tenants: 1, keysPerTenant: 1, mainnet: false, blotterExport: false, approvals: false, hooks: false, statement: false }, { tenants: 1 })
  const ent = planLine('enterprise', { tenants: null, keysPerTenant: null, mainnet: true, blotterExport: true, approvals: true, hooks: true, statement: true }, { tenants: 7, keys: 3 })
  check('console plan line: free = tenants 1 of 1 · 1 key per tenant · sandbox only · no maker-checker · no CSV export · statement preview', same(free, ['Free plan', 'tenants 1 of 1', '1 key per tenant', 'sandbox only', 'no maker-checker', 'no CSV export', 'statement preview']), free.join(' · '))
  check('console plan line: an unlimited cap (null, entitlementsJson) reads "unlimited"', ent.includes('tenants 7 · unlimited') && ent.includes('live keys 3 · unlimited') && ent.includes('maker-checker on') && ent.includes('monthly statement'), ent.join(' · '))
  check('console words: Mon–Fri; the sample desk reads "over $250 → 1 distinct admin" and its $5,000 day cap', daysWords([5, 1, 2, 3, 4]) === 'Mon–Fri' && daysWords([1, 3]) === 'Mon, Wed' && deskLines(SAMPLE_POLICY.desks[0]).some((l) => l.v === 'over $250 → 1 distinct admin') && deskLines(SAMPLE_POLICY.desks[0]).some((l) => l.v.startsWith('$5,000')))
  check('console words: a rule with no chains lists every chain the venue runs on; an off-chain venue says so', ruleLines({ venue: 'cow' }, v)[0].v === 'Ethereum, Base, Arbitrum (every chain it runs on)' && ruleLines({ venue: 'hyperliquid' }, v)[0].v === 'off-chain' && ruleLines(SAMPLE_POLICY.venues[0], v)[0].v === 'Base')
  check('console blotter: the query carries only what is set; csv is explicit; the route\'s file name wins', blotterQuery({}) === '' && blotterQuery({ kind: 'signed,settled', from: '2026-11-01', after: 200, limit: 200 }) === '?kind=signed%2Csettled&from=2026-11-01&after=200&limit=200' && blotterQuery({ format: 'csv' }) === '?format=csv' && fileNameOf('attachment; filename="blotter-acme.csv"', 'x.csv') === 'blotter-acme.csv' && fileNameOf(null, 'x.csv') === 'x.csv')
  check('console blotter: a tx links to its chain\'s explorer only when it is a 32-byte hash on a known chain', explorerTx(8453, '0x' + '1'.repeat(64), v) === `https://basescan.org/tx/0x${'1'.repeat(64)}` && explorerTx(null, '0x' + '1'.repeat(64), v) === null && explorerTx(8453, 'hl-oid-123', v) === null)
  check('console statement: a past month is closed, the current one is not', ymClosed('2026-10', new Date('2026-11-03T00:00:00Z')) && !ymClosed('2026-11', new Date('2026-11-03T00:00:00Z')) && currentYm(new Date('2026-11-03T00:00:00Z')) === '2026-11')

  // Source pins.
  const pageList = read('app/dashboard/desk/page.tsx')
  const pageOne = read('app/dashboard/desk/[id]/page.tsx')
  check('console pages (source): both are SERVER files that read the vocabulary (deskVocab) and are noindex', [pageList, pageOne].every((s) => !/^'use client'/m.test(s) && s.includes('deskVocab()') && /robots: \{ index: false, follow: false \}/.test(s)) && pageList.includes('<DeskList vocab=') && pageOne.includes('<TenantConsole tenantId={id} vocab='))
  const files = ['DeskList', 'TenantConsole', 'PolicySection', 'KeysSection', 'BlotterSection', 'StatementSection', 'SettingsSection', 'ui', 'api', 'derive', 'policy-check', 'types'].map((f) => {
    const p = existsSync(`components/desk/${f}.tsx`) ? `components/desk/${f}.tsx` : `components/desk/${f}.ts`
    return { f, src: read(p) }
  })
  const runtimeSpec = files.filter(({ src }) => /^import (?!type )[^\n]*from '@\/lib\/tenant\/(spec|policy|store|gate|blotter|statement)'/m.test(src) || /from '\.\/vocab\.server'/.test(src))
  check('console (source): no browser file imports a runtime value from lib/tenant/spec · policy · store · blotter (node:crypto / the DB) or vocab.server', runtimeSpec.length === 0, runtimeSpec.map((x) => x.f).join(', '))
  const all = files.map((x) => x.src).join('\n')
  check('console (source): it calls the contract\'s routes — tenants, policy propose/approve/reject, keys, intent approve, blotter, verify, statement', ["'/api/tenants'", '/api/tenants/${tenantId}/policy/${p.version}/${verb}', '/api/tenants/${t.id}/keys', '/api/tenants/${tenantId}/intents/${q.intentId}/approve', '/api/tenants/${t.id}/blotter', '${base}/verify', '/statement?ym=', "call('PATCH', `/api/tenants/${t.id}`"].every((s) => all.includes(s)))
  check('console (source): no Tailwind opacity modifier on a CSS variable (never generated)', !/\[(?:color:)?var\(--[^\]]*\]\/\d/.test(all))
  check('console (source): never the raw RainbowKit modal; the secret never reaches storage or a URL', !/openConnectModal/.test(all) && !/localStorage|sessionStorage/.test(files.find((x) => x.f === 'KeysSection')!.src) && /Shown once/.test(files.find((x) => x.f === 'KeysSection')!.src))
  const css = read('components/desk/desk-console.css').replace(/\/\*[\s\S]*?\*\//g, '')
  check('console (css): never touches html/body (overflow, sticky); every button, field and tab is ≥ 44px', !/(^|[\s,}])(html|body)\b[^{]*\{/m.test(css) && /\.dcx-btn \{[^}]*min-height: 44px/.test(css) && /\.dcx-btn--small \{[^}]*min-height: 44px/.test(css) && /\.dcx-input, \.dcx-select, \.dcx-textarea \{[^}]*min-height: 44px/.test(css) && /\.dcx-tab \{[^}]*min-height: 44px/.test(css))
  check('console (source): an API refusal prints verbatim (the one refusalText door), with the plan it names', /export function refusalText/.test(all) && /upgradeWord\(answer\.json\?\.upgrade\)/.test(all))
  const settings = files.find((x) => x.f === 'SettingsSection')!.src
  check('console settings (source): "Add a signer" is proof of control — challenge (GET …/signers/challenge?address=) → the wallet signs it → POST …/signers { address, signature, chainId? }; PATCH only removes', settings.includes('/signers/challenge?address=${encodeURIComponent(a0)}') && settings.includes("call('POST', `/api/tenants/${tenantId}/signers`, { address: challenge.address, signature: signature.trim()") && /The signer[’']s wallet signs this message \(a Safe signs it as a message in its UI\)/.test(settings) && /Copy the message/.test(settings) && /onSave=\{\(next, ok\) => patch\('signers', \{ signers: next \}/.test(settings) && /adder=\{owner \? <SignerProof/.test(settings))
  const rail = read('components/DashboardSidebar.tsx')
  check('console (source): the dashboard rail carries one Desk seat at /dashboard/desk', /href: '\/dashboard\/desk', label: 'Desk'/.test(rail) && (rail.match(/'\/dashboard\/desk'/g) ?? []).length === 1)
}

/** The rail lights Desk on the console, and Desk log stays Desk log (admin). */
export async function consoleRailPins(check: Check): Promise<void> {
  const SB = await import('../components/DashboardSidebar')
  const admin = '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'
  check('console rail: /dashboard/desk and a tenant page light the Desk seat; /dashboard/admin/desk still lights Desk log', SB.activeSectionHref('/dashboard/desk', null) === '/dashboard/desk' && SB.activeSectionHref('/dashboard/desk/abc123', null) === '/dashboard/desk' && SB.currentSectionLabel('/dashboard/desk/abc123', null) === 'Desk' && SB.activeSectionHref('/dashboard/admin/desk', admin) === '/dashboard/admin/desk')
}

/* ── live ─────────────────────────────────────────────────────────────── */

function getCookie(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

async function siwe(base: string, account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await fetch(`${base}/api/auth/nonce`, { headers: { 'x-yf-internal-run': '1' } })
  const nonceCookie = getCookie(nonceRes, 'yf_siwe_nonce')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(base).host, nonce, uri: base, version: '1' })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = getCookie(res, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${res.status})`)
  return session
}

/** A desk-key MCP client (Streamable HTTP; SSE frames). */
function deskClient(base: string, bearer: string) {
  let id = 0
  let session: string | null = null
  const rpc = async (method: string, params?: unknown) => {
    const res = await fetch(`${base}/api/broker/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-yf-internal-run': '1',
        'x-yf-no-ask-log': '1',
        authorization: `Bearer ${bearer}`,
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    })
    session = res.headers.get('mcp-session-id') ?? session
    const raw = await res.text()
    const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).find((l) => l.includes(`"id":${id}`))
    return data ? JSON.parse(data).result : (() => { try { return JSON.parse(raw).result } catch { return undefined } })()
  }
  let ready: Promise<unknown> | null = null
  const init = () => (ready ??= rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'console-pins', version: '0' } }).then(() => rpc('notifications/initialized')))
  return async (name: string, args: Record<string, unknown> = {}) => {
    await init()
    const result = await rpc('tools/call', { name, arguments: args })
    const text: string = result?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
    let payload: any = text
    try { payload = JSON.parse(text) } catch { /* prose */ }
    return { isError: !!result?.isError, payload }
  }
}

function burnerAccount(): PrivateKeyAccount | null {
  try {
    const pk = read('.env.local').match(/^PRIVATE_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '')
    if (!pk) return null
    return privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  } catch {
    return null
  }
}

export interface ConsoleLiveOpts {
  /** The harness's own SIWE helper (test-api passes its signIn). */
  signIn?: (a: PrivateKeyAccount) => Promise<string>
  log?: (line: string) => void
  /** Skip the cleanup and write { base, tenantId, owner, burner cookies } here. */
  keep?: string
}

interface KeptState {
  base: string
  tenantId: string
  slug: string
  ownerCookie: string
  burnerCookie: string
  burnerAddress: string
  keyIds: string[]
}

export async function consoleLivePins(check: Check, base: string, opts: ConsoleLiveOpts = {}): Promise<void> {
  const log = opts.log ?? ((l: string) => console.log(l))
  const signIn = opts.signIn ?? ((a: PrivateKeyAccount) => siwe(base, a))
  const J = { 'content-type': 'application/json', 'x-yf-internal-run': '1' }
  const owner = privateKeyToAccount(generatePrivateKey())
  const burnerAcct = burnerAccount()
  const second = burnerAcct ?? privateKeyToAccount(generatePrivateKey())
  const ownerCookie = await signIn(owner)
  const burnerCookie = await signIn(second)
  const api = async (method: string, path: string, body?: unknown, cookie = ownerCookie) => {
    const res = await fetch(`${base}${path}`, { method, headers: { ...J, cookie }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* csv or html */ }
    return { status: res.status, json, text, headers: res.headers }
  }
  const page = async (path: string, cookie: string | null) => {
    const res = await fetch(`${base}${path}`, { headers: { 'x-yf-internal-run': '1', ...(cookie ? { cookie } : {}) } })
    return { status: res.status, html: await res.text() }
  }
  log(`  · owner ${owner.address.toLowerCase()} (fresh) · second admin ${second.address.toLowerCase()}${burnerAcct ? ' (the burner)' : ' (fresh — no PRIVATE_KEY)'}`)
  const vocab = deskVocab()

  // ── 0. the served pages ───────────────────────────────────────────────
  const listHtml = await page('/dashboard/desk', ownerCookie)
  check('console served: /dashboard/desk for a signed-in owner → 200, titled, the console + the contract\'s vocabulary in the payload', listHtml.status === 200 && /<title>Desk console · Pantessa<\/title>/.test(listHtml.html) && listHtml.html.includes('Desk console') && listHtml.html.includes('DeskList') === false && listHtml.html.includes('policy-pool') && listHtml.html.includes('perp-close') && /<meta name="robots" content="noindex, nofollow"/.test(listHtml.html), `status ${listHtml.status}`)
  const anonHtml = await page('/dashboard/desk', null)
  check('console served: signed out, the same shell (the layout sends the visitor home client-side) — no tenant data in it', anonHtml.status === 200 && !/console-drive-/.test(anonHtml.html))

  // ── 1. create (the Create form's two answers) ─────────────────────────
  const list0 = await api('GET', '/api/tenants')
  check('console drive: a fresh owner lists no tenants; the plan line reads free (1 tenant, 1 key, sandbox) and canCreate', list0.status === 200 && Array.isArray(list0.json?.tenants) && list0.json.tenants.length === 0 && list0.json?.plan === 'free' && list0.json?.entitlements?.tenants === 1 && list0.json?.entitlements?.keysPerTenant === 1 && list0.json?.canCreate === true, JSON.stringify(list0.json).slice(0, 200))
  const slug = `console-drive-${Math.random().toString(36).slice(2, 10)}`
  const created = await api('POST', '/api/tenants', { slug, name: 'Console drive (console pins)' })
  const tenantId: string | undefined = created.json?.tenant?.id
  check('console drive: Create → 201, the tenant starts in the sandbox, active', created.status === 201 && !!tenantId && created.json?.tenant?.slug === slug && created.json?.tenant?.sandbox === true && created.json?.tenant?.status === 'active', JSON.stringify(created.json).slice(0, 200))
  if (!tenantId) return
  const T = `/api/tenants/${tenantId}`
  const capped = await api('POST', '/api/tenants', { slug: `${slug}-2`, name: 'Second' })
  check('console drive: a second Create → 403; the form prints the route\'s sentence naming `tenants` and the plan that includes 2', capped.status === 403 && capped.json?.entitlement === 'tenants' && /includes 1 tenant/.test(capped.json?.error ?? '') && capped.json?.upgrade === 'desk', JSON.stringify(capped.json).slice(0, 220))
  const badSlug = await api('POST', '/api/tenants', { slug: 'Bad Slug!', name: 'x' })
  check('console drive: a bad slug → 400 naming the field (the form\'s own check uses the same regex)', badSlug.status === 400 && badSlug.json?.field === 'slug' && !new RegExp(vocab.slugRe).test('bad slug!') && new RegExp(vocab.slugRe).test(slug))
  const oneHtml = await page(`/dashboard/desk/${tenantId}`, ownerCookie)
  check('console served: /dashboard/desk/[id] for its owner → 200, titled, the tenant id handed to the console', oneHtml.status === 200 && /<title>Tenant · Desk console · Pantessa<\/title>/.test(oneHtml.html) && oneHtml.html.includes(tenantId), `status ${oneHtml.status}`)

  // ── 2. policy: propose (the editor's check first), self-activate ──────
  const d0 = await api('GET', T)
  check('console drive: the tenant page reads no active policy, no keys, you = owner', d0.status === 200 && d0.json?.policy === null && d0.json?.keys?.length === 0 && d0.json?.you?.owner === true && d0.json?.entitlements?.approvals === false)
  const wrong = { ...SAMPLE_POLICY, venues: [{ venue: 'cow', chains: [10] }] }
  const wrongBrowser = checkPolicyDoc(wrong, vocab)
  const wrongServer = await api('POST', `${T}/policy`, { document: wrong })
  check('console drive: a chain outside the venue — the browser check and the route both name venues[0].chains[0]', !wrongBrowser.ok && wrongBrowser.field === 'venues[0].chains[0]' && wrongServer.status === 400 && wrongServer.json?.field === 'venues[0].chains[0]', JSON.stringify(wrongServer.json).slice(0, 200))
  const editorText = policyJson(vocab.sample)
  const pre = checkPolicyText(editorText, vocab)
  const proposed = await api('POST', `${T}/policy`, { document: pre.ok ? pre.doc : null, note: 'console pins: the README sample' })
  const version: number = proposed.json?.version
  check('console drive: the editor\'s prefilled sample passes the browser check and is proposed as v1 (state proposed, the route\'s next step)', pre.ok && proposed.status === 201 && version === 1 && proposed.json?.state === 'proposed' && /approve/i.test(proposed.json?.next ?? ''), JSON.stringify(proposed.json).slice(0, 200))
  const pol = await api('GET', `${T}/policy`)
  const pending = (pol.json?.policies ?? []).filter((p: { state: string }) => p.state === 'proposed')
  check('console drive: the pending list carries the proposal with its document (jsonb sorted its keys; the console prints them in the spec\'s order); on a plan without maker-checker the proposer\'s seat is Approve', pending.length === 1 && canonicalJson(pending[0].document) === canonicalJson(SAMPLE_POLICY) && Object.keys(pending[0].document)[0] !== 'version' && policyDocJson(pending[0].document) === policyDocJson(SAMPLE_POLICY) && proposalSeat(pending[0], owner.address, d0.json.entitlements.approvals) === 'approve', Object.keys(pending[0]?.document ?? {}).join(','))
  const activated = await api('POST', `${T}/policy/${version}/approve`)
  check('console drive: Approve and activate → 200 active (self-activated: free plan)', activated.status === 200 && activated.json?.state === 'active', JSON.stringify(activated.json).slice(0, 160))

  // ── 3. keys ────────────────────────────────────────────────────────────
  const d1 = await api('GET', T)
  const desks = (d1.json?.policy?.document?.desks ?? []).map((x: { id: string }) => x.id)
  check('console drive: the key form\'s desk picker reads the ACTIVE policy (v1 desks: macro)', d1.json?.policy?.version === 1 && same(desks, ['macro']))
  const minted = await api('POST', `${T}/keys`, { deskId: desks[0], label: 'console pins' })
  const secret: string = minted.json?.secret ?? ''
  const keyId: string = minted.json?.id ?? ''
  check('console drive: Mint → 201, the dk_ secret once (the copy box), prefix = its first 11 characters', minted.status === 201 && DESK_KEY_RE.test(secret) && minted.json?.prefix === secret.slice(0, 11) && /Shown once/i.test(minted.json?.note ?? ''), JSON.stringify({ ...minted.json, secret: secret ? '<dk_…>' : null }).slice(0, 200))
  const overKey = await api('POST', `${T}/keys`, { deskId: 'macro' })
  check('console drive: a second key → 403 naming keysPerTenant (the form prints it)', overKey.status === 403 && overKey.json?.entitlement === 'keysPerTenant' && typeof overKey.json?.error === 'string')
  const after = await api('GET', T)
  check('console drive: the key list never carries the secret or a hash', after.status === 200 && !after.text.includes(secret) && after.json?.keys?.length === 1 && after.json.keys[0].paused === false)

  // ── 4. the blotter ────────────────────────────────────────────────────
  const bl = await api('GET', `${T}/blotter${blotterQuery({ limit: 200 })}`)
  const kinds: string[] = (bl.json?.rows ?? []).map((r: { kind: string }) => r.kind)
  check('console drive: the blotter reads policy_proposed, policy_activated and key_minted rows, ascending seq from 1', bl.status === 200 && ['policy_proposed', 'policy_activated', 'key_minted'].every((k) => kinds.includes(k)) && bl.json?.rows?.[0]?.seq === 1 && bl.json?.head?.seq === bl.json.rows.length, kinds.join(','))
  const onlyKeys = await api('GET', `${T}/blotter${blotterQuery({ kind: 'key_minted' })}`)
  check('console drive: the kind filter narrows to that kind', onlyKeys.status === 200 && onlyKeys.json?.rows?.length >= 1 && onlyKeys.json.rows.every((r: { kind: string }) => r.kind === 'key_minted'))
  const today = new Date().toISOString().slice(0, 10)
  const dated = await api('GET', `${T}/blotter${blotterQuery({ from: today, to: today })}`)
  check('console drive: from/to (a date-only `to` covers the day) keeps today\'s rows', dated.status === 200 && dated.json?.rows?.length === bl.json?.rows?.length)
  const ver = await api('GET', `${T}/blotter/verify`)
  check('console drive: Verify the chain → ok, every row replayed', ver.status === 200 && ver.json?.ok === true && ver.json?.rows === bl.json?.head?.seq, JSON.stringify(ver.json).slice(0, 160))
  const csv = await api('GET', `${T}/blotter${blotterQuery({ format: 'csv' })}`)
  check('console drive: CSV on the free plan → 403 naming blotterExport (the console names the plan that has it)', csv.status === 403 && csv.json?.entitlement === 'blotterExport', JSON.stringify(csv.json).slice(0, 160))

  // ── 5. the statement ──────────────────────────────────────────────────
  const st = await api('GET', `${T}/statement?ym=${currentYm()}`)
  check('console drive: the statement for this month → preview (no statement entitlement), the three lines, an amount due', st.status === 200 && st.json?.preview === true && st.json?.entitlement === 'statement' && st.json?.statement?.lines?.length === 3 && typeof st.json?.statement?.amountDueUsd === 'number' && typeof st.json?.note === 'string', JSON.stringify(st.json).slice(0, 220))
  const badYm = await api('GET', `${T}/statement?ym=2026-13`)
  check('console drive: a month the picker could never send (2026-13) → 400', badYm.status === 400)

  // ── 6. pause / resume: key, then tenant; settings ─────────────────────
  const kp = await api('PATCH', `${T}/keys/${keyId}`, { paused: true })
  const kr = await api('PATCH', `${T}/keys/${keyId}`, { paused: false })
  const tp = await api('PATCH', T, { status: 'paused' })
  const tr = await api('PATCH', T, { status: 'active' })
  const nm = await api('PATCH', T, { name: 'Console drive (renamed)' })
  check('console drive: Pause/Resume a key, Pause/Resume the tenant, Save name → 200 each', kp.status === 200 && kp.json?.paused === true && kr.json?.paused === false && tp.json?.tenant?.status === 'paused' && tr.json?.tenant?.status === 'active' && nm.json?.tenant?.name === 'Console drive (renamed)')
  const sb = await api('PATCH', T, { sandbox: false })
  check('console drive: Leave the sandbox on the free plan → 403 naming mainnet (printed verbatim)', sb.status === 403 && sb.json?.entitlement === 'mainnet' && /sandbox/.test(sb.json?.error ?? ''))
  const ad = await api('PATCH', T, { admins: [second.address.toLowerCase()] })
  check('console drive: the owner adds a second admin (Settings · Admins)', ad.status === 200 && (ad.json?.tenant?.admins ?? []).includes(second.address.toLowerCase()))
  const bl2 = await api('GET', `${T}/blotter${blotterQuery({ kind: 'key_paused,key_resumed,tenant_paused,tenant_resumed,tenant_updated' })}`)
  const k2: string[] = (bl2.json?.rows ?? []).map((r: { kind: string }) => r.kind)
  check('console drive: every one of those is a blotter row (key_paused, key_resumed, tenant_paused, tenant_resumed, tenant_updated)', ['key_paused', 'key_resumed', 'tenant_paused', 'tenant_resumed', 'tenant_updated'].every((k) => k2.includes(k)), k2.join(','))

  // ── 7. the second admin ───────────────────────────────────────────────
  const bList = await api('GET', '/api/tenants', undefined, burnerCookie)
  const bSees = (bList.json?.tenants ?? []).some((x: { id: string }) => x.id === tenantId)
  const bOne = await api('GET', T, undefined, burnerCookie)
  check('console drive: the second admin lists the tenant and reads it as an admin (not owner)', bList.status === 200 && bSees && bOne.status === 200 && bOne.json?.you?.owner === false)
  const bHtml = await page(`/dashboard/desk/${tenantId}`, burnerCookie)
  check('console served: /dashboard/desk/[id] for the second admin → 200', bHtml.status === 200 && bHtml.html.includes(tenantId))
  const bAdmins = await api('PATCH', T, { admins: [] }, burnerCookie)
  check('console drive: an admin who is not the owner editing admins → 403, the route\'s sentence (the console says so up front)', bAdmins.status === 403 && /Only the tenant owner edits admins/.test(bAdmins.json?.error ?? ''))
  const stranger = await signIn(privateKeyToAccount(generatePrivateKey()))
  const sOne = await api('GET', T, undefined, stranger)
  check('console drive: a signed-in stranger reading the tenant → 404 (the console prints "no tenant here that this wallet administers")', sOne.status === 404)

  // ── 7b. a signer by proof of control (TENANT's QA change, 2026-11-03) ──
  const custody = privateKeyToAccount(generatePrivateKey())
  const ch = await api('GET', `${T}/signers/challenge?address=${custody.address.toLowerCase()}`)
  const challengeText: string | undefined = ch.json?.challenge ?? ch.json?.message ?? ch.json?.text
  if (ch.status === 404 && ch.json === null) {
    log('  ⚪ console signer proof (live): PENDING — GET …/signers/challenge is not on this server yet (TENANT is building it); the console is built to its shape')
  } else {
    check('console signer proof (live): GET …/signers/challenge?address= → a short ASCII message to sign', ch.status === 200 && typeof challengeText === 'string' && /^[\x20-\x7e\n]+$/.test(challengeText) && challengeText.toLowerCase().includes(custody.address.toLowerCase().slice(2, 10)), JSON.stringify(ch.json).slice(0, 200))
    if (challengeText) {
      const signature = await custody.signMessage({ message: challengeText })
      const forged = await api('POST', `${T}/signers`, { address: custody.address, signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message: challengeText }) })
      check('console signer proof (live): a signature from another wallet → refused (4xx, the route\'s words)', forged.status >= 400 && forged.status < 500 && typeof forged.json?.error === 'string', JSON.stringify(forged.json).slice(0, 160))
      const ch2 = await api('GET', `${T}/signers/challenge?address=${custody.address.toLowerCase()}`)
      const text2: string = ch2.json?.challenge ?? ch2.json?.message ?? ch2.json?.text ?? challengeText
      const reg = await api('POST', `${T}/signers`, { address: custody.address, signature: text2 === challengeText ? signature : await custody.signMessage({ message: text2 }) })
      const t2 = await api('GET', T)
      check('console signer proof (live): the wallet\'s own personal_sign → registered (the Settings list shows it)', reg.status >= 200 && reg.status < 300 && (t2.json?.tenant?.signers ?? []).includes(custody.address.toLowerCase()), JSON.stringify(reg.json).slice(0, 160))
      const rm = await api('PATCH', T, { signers: [] })
      check('console signer proof (live): Remove (PATCH signers) still removes', rm.status === 200 && (rm.json?.tenant?.signers ?? []).length === 0, JSON.stringify(rm.json).slice(0, 160))
    }
  }

  // ── 8. approvals: an intent over the threshold, found by the queue ────
  let prisma: (typeof import('../lib/db'))['default'] | null = null
  let intentId: string | null = null
  let restoreSub: () => Promise<void> = async () => {}
  if (process.env.DATABASE_URL) {
    prisma = (await import('../lib/db')).default
    const host = (() => { try { return new URL(process.env.DATABASE_URL!).host } catch { return '?' } })()
    // QA F5 (TENANT round 3): the sandbox follows the OWNER's effective plan at
    // every resolve, so a flipped column no longer leaves it. FIXTURE (the one
    // scripts/tenant-pins.ts uses): an active 'agent' subscription row for the
    // drive's owner on the TEST DB — the Agent plan includes mainnet — then the
    // console's own "Leave the sandbox" PATCH; the row is deleted (or the prior
    // one restored) at the end of this section, whatever happens.
    const ownerLower = owner.address.toLowerCase()
    const priorSub = await prisma.subscription.findUnique({ where: { ownerAddress: ownerLower } })
    await prisma.subscription.upsert({ where: { ownerAddress: ownerLower }, create: { ownerAddress: ownerLower, plan: 'agent', status: 'active' }, update: { plan: 'agent', status: 'active' } })
    log(`  · FIXTURE: an active 'agent' subscription for ${ownerLower} on the TEST DB (${host}) — the Agent plan includes mainnet; restored at the end`)
    restoreSub = async () => {
      if (priorSub) await prisma!.subscription.update({ where: { ownerAddress: ownerLower }, data: { plan: priorSub.plan, status: priorSub.status } }).catch(() => {})
      else await prisma!.subscription.delete({ where: { ownerAddress: ownerLower } }).catch(() => {})
    }
    try {
    const offSandbox = await api('PATCH', T, { sandbox: false })
    check('console drive (Agent plan): Leave the sandbox → 200, the plan line reads mainnet + CSV export', offSandbox.status === 200 && offSandbox.json?.tenant?.sandbox === false && (await api('GET', T)).json?.entitlements?.blotterExport === true, JSON.stringify(offSandbox.json).slice(0, 160))
    const csvOk = await api('GET', `${T}/blotter${blotterQuery({ format: 'csv' })}`)
    check('console drive (Agent plan): Export CSV → 200 text/csv with the route\'s file name, prev_hash + hash columns', csvOk.status === 200 && /text\/csv/.test(csvOk.headers.get('content-type') ?? '') && fileNameOf(csvOk.headers.get('content-disposition'), 'x.csv') === `blotter-${slug}.csv` && /prev_hash/.test(csvOk.text.split('\n')[0] ?? '') && /\bhash\b/.test(csvOk.text.split('\n')[0] ?? ''), (csvOk.text.split('\n')[0] ?? '').slice(0, 160))
    const desk = deskClient(base, secret)
    const big = await desk('broker_open', { ask: 'Buy $400 of ETH on Base', agent: 'console-pins' })
    intentId = big.payload?.intentId ?? null
    check('console approvals (live): "Buy $400 of ETH on Base" through the desk key → awaiting 1 approval', !big.isError && big.payload?.state === 'awaiting_approval' && !!intentId, JSON.stringify(big.payload).slice(0, 240))
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
    const qRows = await api('GET', `${T}/blotter${blotterQuery({ kind: 'intent,policy_verdict,approval', from, limit: 1000 })}`, undefined, burnerCookie)
    const queue = approvalQueue(qRows.json?.rows ?? [], second.address)
    const item = queue.find((x) => x.intentId === intentId)
    check('console approvals (live): the console\'s queue (read off the blotter) finds it AWAITING, 0 of 1, with the ask and $400', !!item && item.state === 'awaiting' && item.have === 0 && item.needed === 1 && item.ask === 'Buy $400 of ETH on Base' && item.usd === 400 && item.mine === false, JSON.stringify(item).slice(0, 240))
    const ap = await api('POST', `${T}/intents/${intentId}/approve`, undefined, burnerCookie)
    check('console approvals (live): the second admin presses Approve → satisfied, the intent back to open, the route\'s next sentence', ap.status === 200 && ap.json?.satisfied === true && ap.json?.state === 'open' && typeof ap.json?.next === 'string', JSON.stringify(ap.json).slice(0, 200))
    const again = await api('POST', `${T}/intents/${intentId}/approve`, undefined, burnerCookie)
    check('console approvals (live): pressing again → 409 (DISTINCT admins) — the console shows "you approved it" instead of the button', again.status === 409 && approvalQueue((await api('GET', `${T}/blotter${blotterQuery({ kind: 'intent,policy_verdict,approval', from, limit: 1000 })}`, undefined, burnerCookie)).json?.rows ?? [], second.address).find((x) => x.intentId === intentId)?.state === 'approved')
    await desk('broker_close', { intent_id: intentId }).catch(() => null)
    } finally {
      await restoreSub()
    }
  } else {
    log('  ⚪ console approvals (live): no DATABASE_URL in the environment — the plan fixture, the over-threshold intent and the approval are skipped')
  }
  const ver2 = await api('GET', `${T}/blotter/verify`)
  check('console drive: after the whole drive the chain still verifies', ver2.status === 200 && ver2.json?.ok === true && ver2.json?.rows >= 10, JSON.stringify(ver2.json).slice(0, 160))

  const state: KeptState = { base, tenantId, slug, ownerCookie, burnerCookie, burnerAddress: second.address.toLowerCase(), keyIds: [keyId] }
  if (opts.keep) {
    writeFileSync(opts.keep, JSON.stringify(state, null, 2))
    log(`  · KEPT for a visual pass: ${opts.keep} (run --cleanup ${opts.keep} after)`)
    return
  }
  await consoleCleanup(state, check, log)
}

/** Leave nothing live: the second admin leaves the admins, every key is
 *  revoked, the tenant is paused and back in the sandbox, and (with the TEST
 *  DB) its is_internal flag is confirmed — there is no tenant delete route. */
export async function consoleCleanup(s: KeptState, check: Check, log: (l: string) => void = console.log): Promise<void> {
  const J = { 'content-type': 'application/json', 'x-yf-internal-run': '1', cookie: s.ownerCookie }
  const T = `${s.base}/api/tenants/${s.tenantId}`
  const one = await fetch(T, { headers: J }).then((r) => r.json()).catch(() => null)
  const keys: { id: string; revoked: boolean }[] = one?.keys ?? []
  for (const k of keys) if (!k.revoked) await fetch(`${T}/keys/${k.id}`, { method: 'DELETE', headers: J })
  const admins = await fetch(T, { method: 'PATCH', headers: J, body: JSON.stringify({ admins: [] }) })
  const paused = await fetch(T, { method: 'PATCH', headers: J, body: JSON.stringify({ status: 'paused' }) })
  let internal: boolean | null = null
  if (process.env.DATABASE_URL) {
    const prisma = (await import('../lib/db')).default
    const row = await prisma.tenant.update({ where: { id: s.tenantId }, data: { isInternal: true, sandbox: true }, select: { isInternal: true } }).catch(() => null)
    internal = row?.isInternal ?? null
  }
  const after = await fetch(T, { headers: J }).then((r) => r.json()).catch(() => null)
  check('console cleanup: the fixture tenant is paused, every key revoked, the second admin gone' + (internal === null ? '' : ', is_internal true + sandbox back on (TEST DB)'), admins.ok && paused.ok && after?.tenant?.status === 'paused' && (after?.keys ?? []).every((k: { revoked: boolean }) => k.revoked) && (after?.tenant?.admins ?? []).length === 1 && internal !== false)
  log(`  · residue: tenant ${s.slug} (${s.tenantId}) stays on the DB — paused, keys revoked, is_internal${internal === null ? ' set at create (x-yf-internal-run)' : ' confirmed'}; its blotter rows stay (the chain is append-only)`)
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

const isMain = (() => { try { return process.argv[1] && /console-pins\.ts$/.test(process.argv[1]) } catch { return false } })()
if (isMain) {
  let pass = 0
  let fail = 0
  const check: Check = (name, ok, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${name}${extra && (!ok || process.argv.includes('--verbose')) ? ` — ${extra}` : ''}`)
    ok ? pass++ : fail++
  }
  const arg = (flag: string) => {
    const i = process.argv.indexOf(flag)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  ;(async () => {
    const cleanup = arg('--cleanup')
    if (cleanup) {
      console.log('— console (cleanup)')
      await consoleCleanup(JSON.parse(read(cleanup)) as KeptState, check)
    } else {
      console.log('— console (pure)')
      consolePurePins(check)
      await consoleRailPins(check)
      const base = arg('--live') ?? process.env.BASE
      if (base) {
        console.log(`— console (live @ ${base})`)
        await consoleLivePins(check, base, { keep: arg('--keep') }).catch((e: unknown) => check('console live: the drive ran to the end', false, e instanceof Error ? e.stack ?? e.message : String(e)))
      }
    }
    console.log(`\n${pass} passed, ${fail} failed\n`)
    process.exit(fail ? 1 : 0)
  })().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
