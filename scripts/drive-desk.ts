#!/usr/bin/env tsx
/**
 * Desk drive — the admin's view of an agent working, asserted in a real browser.
 *
 * THE INVARIANT (agent-desk squad, 2026-09-23, contract C5): every leg an agent
 * signs shows up on `/dashboard/admin/desk` and in the Growth page's Desk
 * section — and NOTHING a hostile agent wrote is rendered as a live link.
 *
 * The second half is the point. A leg's `result` is the agent's word
 * (lib/jobs-runner completeSignStep stores it verbatim), and the desk log
 * renders it in an ADMIN browser. So this drive asserts, on real pixels:
 *   1. the desk log and the Growth Desk section render for an admin wallet;
 *   2. a seeded intent appears as a row that expands to its timeline;
 *   3. CLAIMED and VERIFIED are separate — the page never presents an
 *      unverified agent claim as a settled fact;
 *   4. no anchor on the page carries a javascript:/data: href, and every
 *      explorer link's hash is 0x + 64 hex (QA finding F1);
 *   5. dark 1440 + light 375: 0 horizontal overflow, 0 page errors.
 *
 * Usage:
 *   BASE=http://localhost:3865 npx tsx scripts/drive-desk.ts
 *   BASE=… npx tsx scripts/drive-desk.ts --seed     # mint a DRY fixture intent first
 *
 * Read-only: the mock wallet signs the SIWE message and NOTHING else — no
 * transaction, no order, no consent. Every request wears the internal-run
 * header so a drive never books money moved.
 *
 * NOTE (round 1): assertions tagged WAITS-ON-UI report as ⏳ until the UI lane
 * lands `/dashboard/admin/desk`. They become hard failures the moment the page
 * exists (the drive decides by asking for the route, never by a flag).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const BASE = (process.env.BASE ?? 'http://localhost:3865').replace(/\/$/, '')
const WANT_SEED = process.argv.includes('--seed')

// The hooks the UI lane renders. Kept here as ONE list so a rename shows up as
// a drive failure, not a silent green. (Round 2: these are the UI lane's OWN
// names, read off the page it shipped — QA's Ask A7 proposed different ones and
// the page is the truth.)
const HOOKS = {
  deskPage: '[data-desk-page]',
  deskRows: '[data-desk-rows]',
  row: (intentId: string) => `[data-intent="${intentId}"]`,
  timeline: '[data-desk-timeline]',
  event: (kind: string) => `[data-event="${kind}"]`,
  /** The voice pill: whose word an event is. `agent` / `human` = a claim. */
  voice: (who: string) => `[data-who="${who}"]`,
  internal: '[data-internal="1"]',
  growthDesk: '[data-desk-section]',
  txClaim: '[data-tx]',
}

function envLocal(key: string): string | undefined {
  try {
    return readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
  } catch {
    return undefined
  }
}

async function signSiwe(raw: string): Promise<string> {
  const pk = envLocal('PRIVATE_KEY')
  if (!pk) throw new Error('no PRIVATE_KEY in .env.local')
  const { privateKeyToAccount } = await import('viem/accounts')
  const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  return account.signMessage({ message: raw.startsWith('0x') ? { raw: raw as `0x${string}` } : raw })
}

/** A real SIWE session for the admin wallet, minted through the app's own
 *  /api/auth door (no forged JWT). The mock wallet stays CONNECTED on the
 *  same address, so the orphan-session effect never fires and the cookie
 *  survives (memory: siwe-drive-orphan-session). The dashboard's gate bounces
 *  a connected-but-unsigned wallet HOME, so signing in through the UI would
 *  need a detour via a public page first — this is the deterministic door. */
async function mintSession(): Promise<{ name: string; value: string }> {
  const pk = envLocal('PRIVATE_KEY')
  if (!pk) throw new Error('no PRIVATE_KEY in .env.local')
  const { privateKeyToAccount } = await import('viem/accounts')
  const { createSiweMessage } = await import('viem/siwe')
  const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`)
  const nonceCookie = (nonceRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.match(/^yf_siwe_nonce=([^;]+)/)?.[1])
    .find(Boolean)
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({
    address: account.address,
    chainId: 8453,
    domain: new URL(BASE).host,
    nonce,
    uri: BASE,
    version: '1',
  })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: `yf_siwe_nonce=${nonceCookie}` } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const value = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.match(/^yf_session=([^;]+)/)?.[1])
    .find(Boolean)
  if (!value) throw new Error(`SIWE sign-in failed (${res.status}) — the drive cannot reach an admin page`)
  return { name: 'yf_session', value }
}

/** Fail LOUD when the burner is not an admin — a silent redirect to `/` reads
 *  as "the page is missing", and this drive would only ever prove the gate. */
async function adminAddress(): Promise<string> {
  const pk = envLocal('PRIVATE_KEY')
  if (!pk) throw new Error('no PRIVATE_KEY in .env.local')
  const admins = (envLocal('ADMIN_WALLETS') ?? '').toLowerCase()
  const { privateKeyToAccount } = await import('viem/accounts')
  const addr = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`).address
  if (!admins.includes(addr.toLowerCase())) {
    throw new Error(
      `the .env.local burner ${addr} is not in ADMIN_WALLETS — the desk log is admin-gated, so this drive would ` +
        'only ever prove the gate. Add it, or point PRIVATE_KEY at an admin key.',
    )
  }
  return addr
}

// ── the mock wallet ────────────────────────────────────────────────────────
// Watch-only except for SIWE: the sign-in door cannot be driven otherwise, and
// a SIWE signature moves no money (it IS the ownership proof). Every other
// signing method refuses, under every flag.
const MOCK_WALLET = `(() => {
  const ADDR = '__ADDR__'
  const provider = {
    isMetaMask: false,
    _chainId: '0x2105',
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [ADDR]
        case 'eth_chainId':
          return provider._chainId
        case 'wallet_switchEthereumChain':
          provider._chainId = params[0].chainId
          return null
        case 'wallet_addEthereumChain':
          return null
        case 'personal_sign': {
          const raw = String(params?.[0] ?? '')
          const text = raw.startsWith('0x')
            ? new TextDecoder().decode(Uint8Array.from(raw.slice(2).match(/../g).map((h) => parseInt(h, 16))))
            : raw
          if (/wants you to sign in/i.test(text)) return await window.__deskSignSiwe(raw)
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        }
        case 'eth_signTypedData_v4':
        case 'eth_sendTransaction':
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        default:
          return null
      }
    },
    on() {}, removeListener() {},
  }
  const info = { uuid: 'dddddddd-eeee-ffff-0000-111111111111', name: 'Desk Drive Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'io.pantessa.deskdrive' }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
  window.ethereum = provider
})()`

// ── Playwright's types, spelled out locally ────────────────────────────────
// `playwright-core` is NOT a dependency of this app (it resolves from the
// developer's own global install, the resolver-walks-up path). A real
// `typeof import(…)` here type-checks on this machine and breaks `next build`
// everywhere else — that is how it broke a Vercel deploy once.
type PwConsoleMessage = { type(): string; text(): string }
type PwLocator = {
  first(): PwLocator
  nth(i: number): PwLocator
  locator(selector: string): PwLocator
  count(): Promise<number>
  click(opts?: { timeout?: number }): Promise<void>
  waitFor(opts?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>
  innerText(): Promise<string>
}
type PwPage = {
  goto(url: string, opts?: { waitUntil?: 'commit' | 'domcontentloaded' | 'load' | 'networkidle' }): Promise<{ status(): number } | null>
  waitForTimeout(ms: number): Promise<void>
  locator(selector: string): PwLocator
  evaluate<T>(fn: () => T): Promise<T>
  url(): string
  on(event: 'console', cb: (m: PwConsoleMessage) => void): void
  on(event: 'pageerror', cb: (e: unknown) => void): void
}
type PwContext = {
  newPage(): Promise<PwPage>
  addCookies(cookies: Array<{ name: string; value: string; url: string }>): Promise<void>
  addInitScript(script: string): Promise<void>
  exposeFunction(name: string, fn: (raw: string) => unknown): Promise<void>
  close(): Promise<void>
}
type PwBrowser = {
  newContext(opts: {
    viewport: { width: number; height: number }
    deviceScaleFactor?: number
    colorScheme?: 'dark' | 'light'
    isMobile?: boolean
    hasTouch?: boolean
  }): Promise<PwContext>
  close(): Promise<void>
}
type PwChromium = { launch(opts: { executablePath?: string; headless?: boolean; args?: string[] }): Promise<PwBrowser> }

let pass = 0
let fail = 0
let waiting = 0
const add = (id: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✅' : '❌'} ${id}${detail ? ` — ${detail}` : ''}`)
}
const waits = (id: string, detail = '') => {
  waiting++
  console.log(`  ⏳ ${id} — WAITS-ON-UI${detail ? `: ${detail}` : ''}`)
}

/** Seed one DRY desk intent so the log has a row to render. Uses the desk's
 *  own MCP surface (the drill's path) — no DB writes from the drive. */
async function seedIntent(): Promise<string | null> {
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts')
  const { deskExecuteConsentMessage } = await import('../lib/broker-exec')
  const agent = privateKeyToAccount(generatePrivateKey())
  const ask = `swap 1 USDC for ETH on base, then send 0.5 USDC on base to ${agent.address}`

  let id = 0
  let session: string | null = null
  const rpc = async (method: string, params?: unknown): Promise<any> => {
    const res = await fetch(`${BASE}/api/broker/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-yf-internal-run': '1',
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    })
    session = res.headers.get('mcp-session-id') ?? session
    const raw = await res.text()
    const line = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).find((l) => l.includes(`"id":${id}`))
    return line ? JSON.parse(line).result : undefined
  }
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc('tools/call', { name, arguments: args })
    const text: string = r?.content?.find((c: any) => c.type === 'text')?.text ?? ''
    if (r?.isError) return { error: text }
    try {
      return { payload: JSON.parse(text) }
    } catch {
      return { error: text }
    }
  }

  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'desk-drive', version: '0' } })
  await rpc('notifications/initialized')
  const open = await call('broker_open', { ask, wallet: agent.address, agent: 'desk-drive', agent_key: 'qa-desk-drive-key' })
  const intentId = open.payload?.intentId as string | undefined
  if (!intentId) {
    console.log(`  ⚠️  seed: the desk refused to open — ${open.error ?? 'no intentId'}`)
    return null
  }
  // Execute compiles the job. A throwaway key holds nothing, so the first leg
  // refuses on real balances — which is exactly the row we want in the log:
  // an intent that opened, consented and compiled, and signed nothing.
  // Round 2 (DRIVE / QA F4): the consent names the instant it was signed and rides with the desk key that opened the intent.
  const issuedAt = new Date().toISOString()
  const sig = await agent.signMessage({ message: deskExecuteConsentMessage(intentId, agent.address, issuedAt) })
  const exec = await call('broker_execute', { intent_id: intentId, wallet_signature: sig, issued_at: issuedAt, agent_key: 'qa-desk-drive-key' })
  console.log(`  · seeded intent ${intentId}${exec.payload?.jobId ? ` → job ${exec.payload.jobId}` : ` (execute: ${String(exec.error).slice(0, 80)})`}`)
  return intentId
}

async function main() {
  const admin = await adminAddress()
  console.log(`\ndesk drive → ${BASE}  (admin ${admin})\n`)

  const seeded = WANT_SEED ? await seedIntent() : null
  const session = await mintSession()
  console.log(`  · signed in as ${admin} (real SIWE, through /api/auth)\n`)

  const require_ = createRequire('/Users/nategeier/anchor.js')
  const { chromium } = require_('playwright-core') as { chromium: PwChromium }
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--force-device-scale-factor=2'],
  })

  async function open(opts: { width: number; height: number; theme: 'dark' | 'light' }) {
    const ctx = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 2,
      colorScheme: opts.theme,
      isMobile: opts.width < 768,
      hasTouch: opts.width < 768,
    })
    await ctx.exposeFunction('__deskSignSiwe', (raw: string) => signSiwe(raw))
    await ctx.addInitScript(MOCK_WALLET.replace('__ADDR__', admin))
    // A remembered connector makes wagmi reconnect without a click, so the
    // wallet is CONNECTED from the first paint and the orphan-session effect
    // never fires (memory: siwe-drive-orphan-session).
    await ctx.addInitScript(`try { localStorage.setItem('wagmi.recentConnectorId', '"io.pantessa.deskdrive"') } catch {}`)
    // The desk log polls only while the tab is visible; headless reads hidden.
    await ctx.addInitScript(
      `try { Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }); Object.defineProperty(document, 'hidden', { get: () => false }) } catch {}`,
    )
    await ctx.addCookies([{ name: session.name, value: session.value, url: BASE }])
    const page = await ctx.newPage()
    const errs: string[] = []
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
    page.on('pageerror', (e) => errs.push(String(e)))
    return { ctx, page, errs }
  }

  /** Land on `path` already signed in, and say so if the app sent us home. */
  async function land(page: PwPage, path: string) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    if (!page.url().includes(path)) {
      // One retry: wagmi's reconnect can land a beat after the gate reads.
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
    }
  }

  /** The three things every page in this drive owes. */
  async function inspect(page: PwPage, id: string, errs: string[]) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    add(`${id}/overflow`, overflow <= 1, overflow > 1 ? `${overflow}px of horizontal scroll` : '0px')
    // Environment noise, not findings: CDP's embedded-wallet API allows
    // www.pantessa.com and not localhost, so every local page logs a CORS
    // refusal; guest polls answer 401 by design.
    const real = errs.filter(
      (e) =>
        !/favicon|ERR_|net::|Download the React|401|Failed to load resource/i.test(e) &&
        !/api\.cdp\.coinbase\.com|Access to XMLHttpRequest|has been blocked by CORS/i.test(e),
    )
    add(`${id}/console`, real.length === 0, real.slice(0, 2).join(' | ').slice(0, 200) || 'clean')
  }

  /** F1, on real pixels: nothing an agent wrote may become a live link. */
  async function assertNoHostileLinks(page: PwPage, id: string) {
    const bad = await page.evaluate(() => {
      const out: string[] = []
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const href = a.getAttribute('href') ?? ''
        if (/^\s*(javascript|data|vbscript):/i.test(href)) out.push(`scheme: ${href.slice(0, 60)}`)
        // An explorer link built from a leg result must carry a real hash.
        const m = href.match(/\/tx\/([^/?#]+)/)
        if (m && !/^0x[0-9a-fA-F]{64}$/.test(m[1])) out.push(`tx href: ${m[1].slice(0, 70)}`)
      }
      return out
    })
    add(`${id}/hostile-links`, bad.length === 0, bad.slice(0, 2).join(' | ') || 'no javascript:/data: hrefs, every /tx/ link is 0x+64hex')
  }

  // ── P1 — the desk log, dark 1440 ─────────────────────────────────────────
  {
    const { ctx, page, errs } = await open({ width: 1440, height: 900, theme: 'dark' })
    const res = await page.goto(`${BASE}/dashboard/admin/desk`, { waitUntil: 'domcontentloaded' })
    const status = res?.status() ?? 0
    if (status === 404) {
      waits('desk log: /dashboard/admin/desk renders', 'route is 404 — the UI lane has not landed it')
      await ctx.close()
    } else {
      await land(page, '/dashboard/admin/desk')
      add('desk log: an ADMIN wallet reaches /dashboard/admin/desk (not bounced home)', page.url().includes('/dashboard/admin/desk'), page.url())
      const hasPage = (await page.locator(HOOKS.deskPage).count()) > 0
      add('desk log: the page renders (not the not-authorized card, not the load error)', hasPage, hasPage ? HOOKS.deskPage : `${HOOKS.deskPage} missing`)
      const rows = page.locator(`${HOOKS.deskRows} > li`)
      const n = await rows.count()
      add('desk log: the log lists brokered intents', n > 0, `${n} rows`)
      if (seeded) {
        const seedRow = page.locator(HOOKS.row(seeded))
        const sawSeed = (await seedRow.count()) > 0
        add('desk log: the intent this drive just opened appears as its own row', sawSeed, sawSeed ? seeded : `${seeded} not among ${n} rows`)
        if (sawSeed) {
          add(
            'desk log: a harness intent is marked INTERNAL, so a drive can never dress itself up as an agent that showed up',
            (await page.locator(`${HOOKS.row(seeded)}${HOOKS.internal}`).count()) > 0,
            'data-internal=1',
          )
          await seedRow.first().click({ timeout: 4000 }).catch(() => {})
          await page.waitForTimeout(900)
          const timeline = page.locator(`${HOOKS.row(seeded)} ${HOOKS.timeline}`)
          const opened = await page.locator(`${HOOKS.row(seeded)} ${HOOKS.event('opened')}`).count()
          add(
            'desk log: the row expands to its timeline, starting at `opened`',
            (await timeline.count()) > 0 && opened > 0,
            `timeline=${await timeline.count()} opened=${opened}`,
          )
          // QA F1 / Ask A1: an agent's word must never be presented as settled
          // fact. The UI answers it with a VOICE pill per event — desk / runner
          // are ours, agent / human are claims, checked by the next wait leg.
          const voices = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[data-who]')).map((el) => el.getAttribute('data-who') ?? ''),
          )
          add(
            'desk log: every event says WHOSE word it is — the desk\'s and the runner\'s are ours, the agent\'s is a claim (QA F1: a hostile agent writes what this page renders)',
            voices.length > 0 && voices.some((v) => v === 'desk' || v === 'runner') && voices.some((v) => v === 'agent' || v === 'human'),
            `voices: ${[...new Set(voices)].join(', ') || 'none'}`,
          )
        }
      }
      // Every hash the page shows is a claim an agent POSTed. None of it may
      // become a live link, and none of it may be malformed.
      const claims = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-tx]')).map((el) => ({
          hash: el.getAttribute('data-tx') ?? '',
          href: el.getAttribute('href') ?? '',
        })),
      )
      add(
        'desk log: every rendered tx claim is a well-formed hash, and any link built from it is http(s)',
        claims.every((c) => /^0x[0-9a-fA-F]{64}$/.test(c.hash) && (!c.href || /^https?:\/\//.test(c.href))),
        `${claims.length} claim(s)${claims.length ? `, first ${claims[0].hash.slice(0, 12)}…` : ''}`,
      )
      await assertNoHostileLinks(page, 'desk log')
      await inspect(page, 'desk log 1440 dark', errs)
      await ctx.close()
    }
  }

  // ── P2 — the desk log, light 375 ─────────────────────────────────────────
  {
    const { ctx, page, errs } = await open({ width: 375, height: 812, theme: 'light' })
    const res = await page.goto(`${BASE}/dashboard/admin/desk`, { waitUntil: 'domcontentloaded' })
    if ((res?.status() ?? 0) === 404) {
      waits('desk log 375 light: renders', 'route is 404')
      await ctx.close()
    } else {
      await land(page, '/dashboard/admin/desk')
      await assertNoHostileLinks(page, 'desk log 375')
      await inspect(page, 'desk log 375 light', errs)
      await ctx.close()
    }
  }

  // ── P3 — Growth's Desk section, dark 1440 ────────────────────────────────
  {
    const { ctx, page, errs } = await open({ width: 1440, height: 900, theme: 'dark' })
    await land(page, '/dashboard/admin')
    add('growth: an ADMIN wallet reaches /dashboard/admin', page.url().includes('/dashboard/admin'), page.url())
    const desk = page.locator(HOOKS.growthDesk)
    const hasDesk = (await desk.count()) > 0
    if (hasDesk) {
      const text = await desk.first().innerText()
      add(
        'growth: the Desk section names the agent funnel (opened → executed → signed → settled)',
        /agent/i.test(text) && /(opened|executed|signed|settled)/i.test(text),
        text.replace(/\s+/g, ' ').slice(0, 140),
      )
      add('growth: the Desk section links to the full log', (await page.locator('a[href="/dashboard/admin/desk"]').count()) > 0)
    } else {
      add('growth: the Desk section renders', false, `${HOOKS.growthDesk} missing`)
    }
    await assertNoHostileLinks(page, 'growth')
    await inspect(page, 'growth 1440 dark', errs)
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed, ${waiting} waiting on the UI lane\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
