#!/usr/bin/env npx tsx
/**
 * The kickback-loop rehearsal (Q6, §2.3 of HANDOFF-gtm-bulletproof.md).
 *
 * 2,804 links / 0 claims: the creator-kickback loop — the whole YeetCall
 * thesis — has never executed end to end for a creator who isn't us. This
 * script rehearses the MACHINERY on a local build so the one real drill
 * (a human creator + a second human wallet, on prod, real money — the
 * runbook in KICKBACK-DRILL.md) can only fail on product, never plumbing:
 *
 *   mint (creator SIWE) → the /i door serves → a stranger signs through
 *   the link → first-touch referral claimed → a later unattributed trade
 *   accrues to the creator → the earnings panel's numbers all agree.
 *
 * LOCALHOST ONLY by design. The rehearsal rows are UNFLAGGED — referral
 * and earnings must fire, and an is_internal run deliberately skips both
 * (the Q3 rule) — and unflagged fixture rows must never touch prod.
 * Localhost origins keep them out of every public metric; throwaway
 * random wallets keep the write-once referred_wallets table inert (the
 * phantom-wallet lesson: random rows stay inert).
 *
 *   npm run drill:kickback                       (vs http://localhost:3000)
 *   BASE=http://localhost:3521 npm run drill:kickback
 *
 * Needs `next start` running at BASE (the test:api recipe, never dev).
 */
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const HOST = new URL(BASE).hostname
if (!/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(HOST)) {
  console.error(
    `✋ ${BASE} is not a localhost build. This rehearsal writes UNFLAGGED fixture rows\n` +
      '   (referral + earnings must fire), which must never land in prod data.\n' +
      '   The real prod drill is a human with a second wallet: see KICKBACK-DRILL.md.',
  )
  process.exit(1)
}
const DOMAIN = new URL(BASE).host

const getCookie = (res: Response, name: string): string | null => {
  const all = res.headers.getSetCookie?.() ?? []
  for (const c of all) if (c.startsWith(`${name}=`)) return c.split(';')[0]
  return null
}

async function signIn(account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`)
  const nonceCookie = getCookie(nonceRes, 'yf_siwe_nonce')
  const { nonce } = await nonceRes.json()
  const message = createSiweMessage({
    address: account.address,
    chainId: 8453,
    domain: DOMAIN,
    nonce,
    uri: BASE,
    version: '1',
  })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = getCookie(res, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${res.status})`)
  return session
}

type Earnings = {
  totalEarnedUsd: number
  referredWallets: number
  referredEarnedUsd: number
  referredSignedUsd: number
  claimableUsd: number
  weekly?: Array<{ weekStart: string; earnedUsd: number }>
}
type LinksRes = {
  links: Array<{ slug: string; signedUsd: number; earnedUsd: number; feeBearingUsd: number }>
  earnings: Earnings
}

const steps: Array<{ name: string; ok: boolean; note: string }> = []
const step = (name: string, ok: boolean, note = '') => {
  steps.push({ name, ok, note })
  console.log(` ${ok ? '✅' : '❌'} ${name}${note ? ` — ${note}` : ''}`)
  if (!ok) finish()
}
function finish(): never {
  const failed = steps.filter((s) => !s.ok)
  console.log(
    failed.length
      ? `\n✋ rehearsal FAILED at "${failed[0].name}" — fix the machinery before the real drill.`
      : '\n🏁 Machinery green. The real drill (KICKBACK-DRILL.md) can only fail on product now.',
  )
  process.exit(failed.length ? 1 : 0)
}

async function main() {
  console.log(`Kickback-loop rehearsal vs ${BASE}\n`)

  // The two humans of the real drill, as throwaways.
  const creator = privateKeyToAccount(generatePrivateKey())
  const stranger = privateKeyToAccount(generatePrivateKey())
  const session = await signIn(creator)
  step('creator signs in (SIWE)', true, creator.address)

  const mint = await fetch(`${BASE}/api/intent-links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: session },
    body: JSON.stringify({ ask: 'Swap $25 of ETH to USDC' }),
  })
  const minted = (await mint.json()) as { link?: { slug?: string }; slug?: string; error?: string }
  const slug = minted.link?.slug ?? minted.slug
  step('creator mints an intent link', mint.status === 200 && !!slug, slug ?? minted.error ?? `status ${mint.status}`)

  const door = await fetch(`${BASE}/i/${slug}`)
  step('the /i door serves the link', door.status === 200)

  // The stranger signs through the link, then trades again later without it.
  // Unflagged fixture beacons — the exact rows the real client writes.
  const sess = `fixture-drill-${Math.random().toString(36).slice(2, 10)}`
  const beacon = (over: Record<string, unknown>) =>
    fetch(`${BASE}/api/embed/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstParty: true,
        sessionId: sess,
        page: `${BASE}/i/${slug}`,
        outcome: 'signed',
        artifact: 'tx',
        buildPath: 'native-swap-uniswap',
        walletAddress: stranger.address.toLowerCase(),
        ...over,
      }),
    })
  const through = await beacon({ intentLinkSlug: slug, valueUsd: 100 })
  const throughBody = (await through.json()) as { ok?: boolean; internal?: boolean }
  step(
    'stranger signs THROUGH the link ($100, fee-bearing)',
    through.status === 200 && throughBody.ok === true && throughBody.internal === undefined,
    throughBody.internal ? 'row came back INTERNAL — it would mint nothing' : '',
  )
  const later = await beacon({ valueUsd: 200, page: `${BASE}/chat` })
  step('stranger trades again later, NO link attached ($200)', later.status === 200)

  const read = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: session } })
  const life = (await read.json()) as LinksRes
  const mine = life.links.find((l) => l.slug === slug)
  const e = life.earnings
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005

  step('link row shows the moved $ + the direct kickback', !!mine && mine.signedUsd >= 100 && near(mine.earnedUsd, 0.1), JSON.stringify({ signedUsd: mine?.signedUsd, earnedUsd: mine?.earnedUsd }))
  step('first-touch referral claimed the stranger (exactly one wallet)', e.referredWallets === 1, `referredWallets=${e.referredWallets}`)
  step('the later unattributed trade accrued to the creator', near(e.referredEarnedUsd, 0.2) && e.referredSignedUsd >= 200, JSON.stringify({ referredEarnedUsd: e.referredEarnedUsd, referredSignedUsd: e.referredSignedUsd }))
  step('lifetime total = direct + referred (what the claims rail pays)', near(e.totalEarnedUsd, 0.3) && near(e.claimableUsd, 0.3), JSON.stringify({ totalEarnedUsd: e.totalEarnedUsd, claimableUsd: e.claimableUsd }))
  step('the weekly out-earn axis carries this week', !!e.weekly?.[0] && e.weekly[0].earnedUsd >= 0.3 - 0.005, JSON.stringify(e.weekly?.[0] ?? null))

  // The dashboard earnings panel renders exactly this API response —
  // /api/intent-links IS the panel's single source (lib/intent-links-ui).
  const revoke = await fetch(`${BASE}/api/intent-links/${slug}`, { method: 'DELETE', headers: { cookie: session } })
  step('cleanup: link revoked', revoke.status === 200)
  console.log(
    '\n Residue (inert by design): 2 localhost-origin embed_turns rows +' +
      ' 1 referred_wallets row for a random throwaway wallet.',
  )
  finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
