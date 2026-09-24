// Drive: the Growth page's people table, in a real browser.
//
// The harness pins the rules (lib/admin-growth's merge, the live payload, the
// page source). This proves the screen: that the wallet lane actually shows
// up, that the all/email/wallet filter moves the rows AND the stage tiles,
// and that a person who traded still shows the path they were trying — the
// case the TEST DB has no row for, so it's injected into the payload.
//
//   npm run build && npx next start -p 3852
//   BASE=http://localhost:3852 npm run drive:growth-people
//
// Needs PRIVATE_KEY in .env.local (an admin wallet) — it signs a real SIWE.
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// playwright-core resolves from ~/node_modules (the resolver walks up from the
// worktree) and is CommonJS, so it is required, not imported: a bare `import`
// type-checks on a dev Mac and breaks the Vercel build, which has no such
// package to walk up to.
const req = createRequire(join(process.cwd(), 'anchor.js'))
/* eslint-disable @typescript-eslint/no-explicit-any */
const { chromium }: any = req('playwright-core')

const BASE = process.env.BASE ?? 'http://localhost:3852'
const SHOTS = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), 'growth-people-'))
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

function envVal(k: string): string {
  const m = readFileSync('.env.local', 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm'))
  return (m?.[1] ?? '').trim().replace(/^"|"$/g, '')
}

async function siweCookie() {
  const pk = envVal('PRIVATE_KEY')
  const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`)
  const nonceCookie = (nonceRes.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_siwe_nonce=([^;]+)/)?.[0]).find(Boolean)
  const { nonce } = await nonceRes.json()
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = (res.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_session=([^;]+)/)?.[1]).find(Boolean)
  if (!session) throw new Error(`SIWE failed (${res.status})`)
  return { session, address: account.address }
}

const mockWallet = (address: string) => `
  const ADDR = '${address}'
  const provider = {
    request: async ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ADDR]
      if (method === 'eth_chainId') return '0x2105'
      if (method === 'wallet_switchEthereumChain') return null
      throw new Error('unsupported: ' + method)
    },
    on: () => {}, removeListener: () => {},
  }
  const detail = Object.freeze({ info: { uuid: 'mock-0001-0000-0000-000000000001', name: 'Mock Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'dev.mock.wallet' }, provider })
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
  try { localStorage.setItem('wagmi.recentConnectorId', '"dev.mock.wallet"') } catch {}
`

async function main() {
  const { session, address } = await siweCookie()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })

  for (const mode of ['dark', 'light'] as const) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      colorScheme: mode,
    })
    await ctx.addCookies([{ name: 'yf_session', value: session, domain: 'localhost', path: '/' }])
    await ctx.addInitScript(mockWallet(address))
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e: { message: string }) => errors.push(e.message))

    await page.goto(`${BASE}/dashboard/admin`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Everyone who showed up', { timeout: 45_000 })
    await page.waitForTimeout(1200)

    const peopleTable = page.locator('table').filter({ has: page.locator('thead th', { hasText: 'Who' }) }).first()
    const heading = page.getByText(/^Everyone who showed up/).first()
    const chips = page.getByRole('button', { name: /^(All|With email|Wallet only) \d+$/ })
    const chipTexts = await chips.allInnerTexts()
    if (mode === 'dark') {
      check('filter: three chips with counts', chipTexts.length === 3, chipTexts.join(' | '))
      const nums = chipTexts.map((t: string) => Number(t.match(/(\d+)\s*$/)?.[1] ?? -1))
      check('filter: All = With email + Wallet only', nums[0] === nums[1] + nums[2], chipTexts.join(' | '))
      check('filter: there ARE wallet-only people (the whole point)', nums[2] > 0, `wallet-only=${nums[2]}`)

      const rowsOf = async () => {
        const rows = peopleTable.locator('tbody tr')
        const n = await rows.count()
        const out: { who: string; path: string | null }[] = []
        for (let i = 0; i < n; i++) {
          const who = (await rows.nth(i).locator('td').first().innerText()).trim()
          out.push({ who, path: /last (ask|wall):/.test(who) ? who : null })
        }
        return out
      }
      const all = await rowsOf()
      check('table: every person is a row', all.length === nums[0], `${all.length} rows vs chip ${nums[0]}`)
      const traded = peopleTable.locator('tbody tr').filter({ hasText: 'TRADED' })
      const tradedN = await traded.count()
      if (tradedN > 0) {
        const tradedWho = (await traded.first().locator('td').first().innerText()).trim()
        check('path: a TRADED person shows their path too (the old gate is gone)', /last (ask|wall):/.test(tradedWho), tradedWho.replace(/\n/g, ' ⏎ ').slice(0, 120))
      } else {
        check('path: no traded row on this DB to check (skipped)', true)
      }
      check('path: at least one row says what it was reaching for', all.some((r) => r.path), String(all.filter((r) => r.path).length))

      // Wallet only
      await page.getByRole('button', { name: /^Wallet only \d+$/ }).click()
      await page.waitForTimeout(300)
      const walletRows = await rowsOf()
      check('filter → Wallet only: every row is wallet-only, and the count matches the chip',
        walletRows.length === nums[2] && walletRows.every((r) => /^no email/m.test(r.who)),
        `${walletRows.length} rows; first: ${walletRows[0]?.who.replace(/\n/g, ' ⏎ ').slice(0, 80)}`)
      const copyDisabled = await page.getByRole('button', { name: /Copy emails/ }).isDisabled()
      check('filter → Wallet only: Copy emails is dead, because there are none', copyDisabled)
      await heading.scrollIntoViewIfNeeded()
      await page.waitForTimeout(250)
      await page.screenshot({ path: `${SHOTS}/people-wallet-only-dark.png` })

      // With email
      await page.getByRole('button', { name: /^With email \d+$/ }).click()
      await page.waitForTimeout(300)
      const emailRows = await rowsOf()
      check('filter → With email: every row carries an email, and the count matches the chip',
        emailRows.length === nums[1] && emailRows.every((r) => !/^no email/m.test(r.who)),
        `${emailRows.length} rows`)
      check('filter → With email: Copy emails comes back', !(await page.getByRole('button', { name: /Copy emails/ }).isDisabled()))

      // Stage tiles follow the filter
      const tilePct = async () => (await page.locator('text=/Signed up, never asked/').first().locator('..').innerText()).trim()
      const emailTiles = await tilePct()
      await page.getByRole('button', { name: /^All \d+$/ }).click()
      await page.waitForTimeout(300)
      const allTiles = await tilePct()
      check('stage tiles recount for the filter', emailTiles !== allTiles, `${emailTiles.replace(/\n/g, ' ')} → ${allTiles.replace(/\n/g, ' ')}`)
    } else {
      await page.getByRole('button', { name: /^All \d+$/ }).click()
      await page.waitForTimeout(300)
    }

    await heading.scrollIntoViewIfNeeded()
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${SHOTS}/people-all-${mode}.png` })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`${mode}: no horizontal page scroll`, overflow <= 0, `${overflow}px`)
    check(`${mode}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // A TRADED person: the TEST DB has none, and the whole point of the change
  // is that someone who got all the way through still shows what they were
  // reaching for. Inject one into the payload and read the DOM back.
  {
    const c = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'dark' })
    await c.addCookies([{ name: 'yf_session', value: session, domain: 'localhost', path: '/' }])
    await c.addInitScript(mockWallet(address))
    await c.route('**/api/admin/growth*', async (route: any) => {
      const res = await route.fetch()
      const body = await res.json()
      body.accounts.rows.unshift({
        key: 'drive-traded', email: 'traded@example.com', name: null, method: 'google',
        wallet: '0x000000000000000000000000000000000000dead', wallets: ['0x000000000000000000000000000000000000dead'],
        test: false, createdAt: new Date(Date.now() - 6e8).toISOString(),
        lastSignInAt: new Date(Date.now() - 3e6).toISOString(), lastSeenAt: new Date(Date.now() - 3e6).toISOString(),
        lastTurnAt: null, turns: 4, built: 2, signed: 2, usd: 41.5, chats: 2, links: 0, watching: 3,
        lastAsk: 'Buy $25 of AAPL', lastAskAt: new Date(Date.now() - 3e6).toISOString(), lastAskWalled: false,
        stage: 'traded',
      })
      await route.fulfill({ response: res, body: JSON.stringify(body) })
    })
    const p2 = await c.newPage()
    await p2.goto(`${BASE}/dashboard/admin`, { waitUntil: 'domcontentloaded' })
    await p2.waitForSelector('text=Everyone who showed up', { timeout: 45_000 })
    await p2.waitForTimeout(900)
    const table = p2.locator('table').filter({ has: p2.locator('thead th', { hasText: 'Who' }) }).first()
    const row = table.locator('tbody tr').filter({ hasText: 'traded@example.com' }).first()
    const who = (await row.locator('td').first().innerText()).trim()
    check('path: a TRADED person shows the path they tried, labelled as an ask, not a wall',
      /last ask: “Buy \$25 of AAPL”/.test(who) && !/last wall/.test(who) && /TRADED/i.test(await row.innerText()),
      who.replace(/\n/g, ' ⏎ ').slice(0, 140))
    await p2.getByText(/^Everyone who showed up/).first().scrollIntoViewIfNeeded()
    await p2.waitForTimeout(250)
    await p2.screenshot({ path: `${SHOTS}/people-traded-path.png` })
    await c.close()
  }

  // Phone
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2, colorScheme: 'dark' })
  await ctx.addCookies([{ name: 'yf_session', value: session, domain: 'localhost', path: '/' }])
  await ctx.addInitScript(mockWallet(address))
  const page = await ctx.newPage()
  await page.goto(`${BASE}/dashboard/admin`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Everyone who showed up', { timeout: 45_000 })
  await page.waitForTimeout(1000)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('375: no horizontal page scroll (the table scrolls inside its own box)', overflow <= 1, `${overflow}px`)
  await page.screenshot({ path: `${SHOTS}/people-375.png`, fullPage: false })
  await ctx.close()

  await browser.close()
  console.log(`\nshots: ${SHOTS}`)
  console.log(`${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
