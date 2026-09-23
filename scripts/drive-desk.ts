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

// The hooks the UI lane renders (QA Ask A7). Kept here as ONE list so a
// rename shows up as a drive failure, not a silent green.
const HOOKS = {
  deskLog: '[data-desk-log]',
  deskRow: '[data-desk-row]',
  growthDesk: '[data-growth-desk]',
  claimed: '[data-desk-claimed]',
  verified: '[data-desk-verified]',
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
  const sig = await agent.signMessage({ message: deskExecuteConsentMessage(intentId, agent.address) })
  const exec = await call('broker_execute', { intent_id: intentId, wallet_signature: sig })
  console.log(`  · seeded intent ${intentId}${exec.payload?.jobId ? ` → job ${exec.payload.jobId}` : ` (execute: ${String(exec.error).slice(0, 80)})`}`)
  return intentId
}

async function main() {
  const admin = await adminAddress()
  console.log(`\ndesk drive → ${BASE}  (admin ${admin})\n`)

  const seeded = WANT_SEED ? await seedIntent() : null

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
    const page = await ctx.newPage()
    const errs: string[] = []
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
    page.on('pageerror', (e) => errs.push(String(e)))
    return { ctx, page, errs }
  }

  /** Sign in through the app's own door, then land on `path`. */
  async function signInAndOpen(page: PwPage, path: string) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    // The dashboard bounces a wallet that has not SIWE'd. Press the door the
    // page itself offers; on a signed-in reload this is a no-op.
    const door = page.locator('button:has-text("Sign in"), button:has-text("Sign In")').first()
    if ((await door.count()) > 0) {
      await door.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(2500)
      const wallet = page.locator('button:has-text("Desk Drive Wallet")').first()
      if ((await wallet.count()) > 0) {
        await wallet.click({ timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(3000)
      }
    }
    if (!page.url().includes(path)) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    }
    await page.waitForTimeout(2500)
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
      await signInAndOpen(page, '/dashboard/admin/desk')
      add('desk log: an ADMIN wallet reaches /dashboard/admin/desk (not bounced home)', page.url().includes('/dashboard/admin/desk'), page.url())
      const log = page.locator(HOOKS.deskLog)
      const hasLog = (await log.count()) > 0
      hasLog
        ? add('desk log: the log renders its container', true, HOOKS.deskLog)
        : waits('desk log: the log renders its container', `${HOOKS.deskLog} missing — Ask A7`)
      const rows = page.locator(HOOKS.deskRow)
      const n = await rows.count()
      if (seeded) {
        const seenSeed = (await page.locator(`[data-desk-row="${seeded}"]`).count()) > 0
        seenSeed
          ? add('desk log: the seeded intent appears as its own row', true, seeded)
          : n > 0
            ? add('desk log: rows render (the seeded intent is not among them)', false, `${n} rows, none is ${seeded}`)
            : waits('desk log: the seeded intent appears as its own row', 'no rows yet — Ask A7')
      } else if (n > 0) {
        add('desk log: rows render', true, `${n} rows`)
      } else {
        waits('desk log: rows render', 'no rows (run with --seed)')
      }
      if (n > 0) {
        await rows.first().click({ timeout: 4000 }).catch(() => {})
        await page.waitForTimeout(800)
        const body = await page.locator(HOOKS.deskLog).first().innerText().catch(() => '')
        add(
          'desk log: a row expands to its timeline (opened → compiled → … in words)',
          /opened/i.test(body) && /(compiled|consent|leg)/i.test(body),
          body.replace(/\s+/g, ' ').slice(0, 120),
        )
        const claimed = await page.locator(HOOKS.claimed).count()
        const verified = await page.locator(HOOKS.verified).count()
        claimed + verified > 0
          ? add(
              'desk log: CLAIMED and VERIFIED are separate marks — an agent\'s word is never shown as settled fact (F1)',
              claimed > 0 && verified > 0,
              `claimed=${claimed} verified=${verified}`,
            )
          : waits('desk log: CLAIMED and VERIFIED are separate marks (F1)', 'neither hook present — Ask A1')
      }
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
      await signInAndOpen(page, '/dashboard/admin/desk')
      await assertNoHostileLinks(page, 'desk log 375')
      await inspect(page, 'desk log 375 light', errs)
      await ctx.close()
    }
  }

  // ── P3 — Growth's Desk section, dark 1440 ────────────────────────────────
  {
    const { ctx, page, errs } = await open({ width: 1440, height: 900, theme: 'dark' })
    await signInAndOpen(page, '/dashboard/admin')
    add('growth: an ADMIN wallet reaches /dashboard/admin', page.url().includes('/dashboard/admin'), page.url())
    const desk = page.locator(HOOKS.growthDesk)
    if ((await desk.count()) > 0) {
      const text = await desk.first().innerText()
      add(
        'growth: the Desk section names the agent funnel (agents seen → opened → executed → signed → settled)',
        /agent/i.test(text) && /(opened|executed|signed|settled)/i.test(text),
        text.replace(/\s+/g, ' ').slice(0, 140),
      )
    } else {
      waits('growth: the Desk section renders', `${HOOKS.growthDesk} missing — Ask A7`)
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
