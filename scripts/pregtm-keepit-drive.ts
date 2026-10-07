/**
 * The keep-it drive (squad pre-gtm QA, 2026-10-06): proves FIRSTRUN's KeepItBar
 * renders in /chat after a SIGNED receipt, with NOTHING broadcast.
 *
 *   BASE=http://localhost:3994 PLAYWRIGHT_CORE=… npx tsx scripts/pregtm-keepit-drive.ts [--out dir]
 *
 * How it stays off-chain:
 *  - /api/chat is answered with a canned turn carrying a plain txRequest (a
 *    0-value call on Base) and guardrails.valueUsd = 1 — the shape the native
 *    swap layer returns, minus the venue.
 *  - The mock EIP-6963 wallet returns a fixed fake hash for eth_sendTransaction
 *    (it never signs or sends anything) and answers wallet-side reads locally.
 *  - Every JSON-RPC request the PAGE sends to a non-local host (wagmi's Base
 *    transport polling the receipt) is answered by a local fake: block numbers,
 *    and a status-0x1 receipt for the fake hash. No request reaches a chain.
 *
 * Asserts: [data-keep-it="chat"] appears with "$1.00 moved · signed by your
 * wallet", its receipt link names the fake hash, "Not now" removes it, a
 * reload keeps it gone (sessionStorage). At 375 the compact row sits in the
 * phone seat ([data-gate-banner="phone"]). /i is NOT driven here: an /i link
 * needs a DB row and this machine has no database.
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const require_ = createRequire(import.meta.url)
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = (process.env.BASE || 'http://localhost:3994').replace(/\/$/, '')
const OUT = (() => { const i = process.argv.indexOf('--out'); return i >= 0 ? process.argv[i + 1] : 'keepit-out' })()
const ADDR = '0x9a3a1e6f0c3b7d2e4f5a6b7c8d9e0f1a2b3c4d5e'
const FAKE_HASH = '0x' + 'ab'.repeat(32)
const ASK = 'Swap $1 of ETH to USDC'

const BLOCK = 30_000_000
function fakeRpc(method: string, params: any[]): any {
  switch (method) {
    case 'eth_chainId': return '0x2105'
    case 'net_version': return '8453'
    case 'eth_blockNumber': return '0x' + (BLOCK + 3).toString(16)
    case 'eth_getTransactionReceipt':
      return String(params?.[0]).toLowerCase() === FAKE_HASH ? {
        transactionHash: FAKE_HASH, transactionIndex: '0x0', blockHash: '0x' + 'cd'.repeat(32), blockNumber: '0x' + BLOCK.toString(16),
        from: ADDR, to: '0x4200000000000000000000000000000000000006', cumulativeGasUsed: '0x5208', gasUsed: '0x5208',
        effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2',
      } : null
    case 'eth_getTransactionByHash': return null
    case 'eth_getBlockByNumber': return { number: '0x' + (BLOCK + 3).toString(16), hash: '0x' + 'ee'.repeat(32), baseFeePerGas: '0x1', timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16), transactions: [], gasLimit: '0x1c9c380', gasUsed: '0x0' }
    case 'eth_getTransactionCount': return '0x0'
    case 'eth_estimateGas': return '0x5208'
    case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': return '0x1'
    case 'eth_getBalance': return '0x0'
    case 'eth_getCode': return '0x'
    case 'eth_call': return '0x'
    case 'eth_feeHistory': return { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'], gasUsedRatio: [0.5], reward: [['0x1']] }
    default: return null
  }
}

const wallet = `(() => {
  const ADDR = ${JSON.stringify(ADDR)}; const HASH = ${JSON.stringify(FAKE_HASH)}; let chain = '0x2105'; const L = {};
  window.__qaSent = 0;
  const provider = { isMetaMask: false,
    request: async ({ method, params }) => { try { const k = 'qa.walletlog'; sessionStorage.setItem(k, (sessionStorage.getItem(k) || '') + ' ' + method) } catch {} switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return [ADDR];
      case 'eth_chainId': return chain; case 'net_version': return '8453';
      case 'wallet_switchEthereumChain': chain = params?.[0]?.chainId ?? chain; (L.chainChanged||[]).forEach(f=>f(chain)); return null;
      case 'wallet_addEthereumChain': return null;
      case 'eth_sendTransaction': window.__qaSent++; return HASH; // a fixed fake hash: nothing is signed or broadcast
      case 'eth_estimateGas': return '0x5208'; case 'eth_getTransactionCount': return '0x0';
      case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': return '0x1';
      case 'eth_blockNumber': return '0x' + (${BLOCK} + 3).toString(16);
      case 'eth_getBlockByNumber': return { number: '0x' + (${BLOCK} + 3).toString(16), baseFeePerGas: '0x1', timestamp: '0x' + Math.floor(Date.now()/1000).toString(16), transactions: [] };
      case 'eth_getBalance': return '0x0'; case 'eth_call': return '0x';
      case 'personal_sign': case 'eth_signTypedData_v4': { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
      default: return null; } },
    on: (ev, fn) => { (L[ev] = L[ev] || []).push(fn); }, removeListener: (ev, fn) => { L[ev] = (L[ev]||[]).filter(f => f !== fn); } };
  const detail = Object.freeze({ info: Object.freeze({ uuid: '11111111-2222-3333-4444-555555555556', name: 'Mock Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', rdns: 'pro.nate.mock' }), provider });
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  window.addEventListener('eip6963:requestProvider', announce); announce(); window.ethereum = provider;
  try { localStorage.setItem('wagmi.recentConnectorId', JSON.stringify('pro.nate.mock')); localStorage.removeItem('wagmi.pro.nate.mock.disconnected'); } catch {}
})()`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function drive(browser: any, width: number): Promise<string[]> {
  const phone = width < 768
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 812 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, colorScheme: 'dark' })
  await ctx.addInitScript(wallet)
  const origin = new URL(BASE).origin
  let chats = 0, rpcOut = 0
  await ctx.route('**/*', async (r: any) => {
    const req = r.request(); const u = new URL(req.url())
    if (u.origin === origin) {
      if (req.method() === 'POST' && u.pathname === '/api/chat') {
        chats++
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          reply: 'Built: swap $1 of ETH to USDC on Base (QA canned turn).',
          txRequest: { to: '0x4200000000000000000000000000000000000006', data: '0x', value: '0', chainId: 8453, action: 'Swap $1 of ETH to USDC' },
          guardrails: { valueUsd: 1 }, buildPath: 'native-swap-uniswap',
        }) })
      }
      return r.continue({ headers: { ...req.headers(), 'x-yf-internal-run': '1' } })
    }
    const body = req.postData() || ''
    if (req.method() === 'POST' && body.includes('"jsonrpc"')) {
      rpcOut++
      let j: any; try { j = JSON.parse(body) } catch { return r.abort() }
      const one = (m: any) => ({ jsonrpc: '2.0', id: m.id, result: fakeRpc(m.method, m.params) })
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)) })
    }
    return r.continue()
  })
  const page = await ctx.newPage()
  page.on('console', (m: any) => { if (process.env.DEBUG) console.log('console', m.type(), m.text().slice(0, 200)) })
  page.on('framenavigated', (f: any) => { if (process.env.DEBUG && f === page.mainFrame()) console.log('NAV', f.url()) })
  page.on('request', (q: any) => { if (process.env.DEBUG && /api\/chat/.test(q.url())) console.log('req', q.method(), q.url()) })
  const res: string[] = []
  const ok = (c: boolean, m: string) => { res.push(`${c ? 'PASS' : 'FAIL'} @${width} ${m}`) }
  await page.goto(BASE + '/chat', { waitUntil: 'domcontentloaded' })
  await sleep(4000)
  const box = page.locator('textarea').first()
  await box.waitFor({ state: 'visible', timeout: 15000 })
  await box.fill(ASK)
  await box.press('Enter')
  const sign = page.getByRole('button', { name: /^Sign (&|and) send/i }).first()
  try { await sign.waitFor({ state: 'visible', timeout: 15000 }) } catch {}
  ok(chats > 0, `the ask sent one turn (stubbed): chats=${chats}`)
  ok(await sign.isVisible().catch(() => false), 'the canned turn renders a sign card')
  await sign.click().catch((e: any) => res.push('INFO click error ' + String(e?.message).slice(0, 120)))
  await sleep(3000)
  if (process.env.DEBUG) console.log('walletlog', await page.evaluate("sessionStorage.getItem('qa.walletlog')"))
  await page.screenshot({ path: join(OUT, `keepit-after-click-${width}.png`) }).catch(() => {})
  const bar = page.locator('[data-keep-it="chat"]')
  try { await bar.waitFor({ state: 'visible', timeout: 20000 }) } catch {}
  const sent = await page.evaluate('window.__qaSent')
  ok(sent === 1, `the wallet was asked once (fake hash, nothing broadcast): ${sent}`)
  const vis = await bar.isVisible().catch(() => false)
  ok(vis, 'the keep-it bar renders after the receipt')
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: join(OUT, `keepit-chat-${width}.png`) })
  if (vis) {
    const text = (await bar.innerText()).replace(/\s+/g, ' ')
    ok(/\$1\.00 moved/.test(text) && /signed by your wallet/i.test(text), `the bar names the dollars + the signature: "${text.slice(0, 140)}"`)
    const href = await bar.locator('a[href*="0xabab"]').first().getAttribute('href').catch(() => null)
    ok(!!href && href.includes(FAKE_HASH), `the receipt link names the tx: ${href}`)
    if (phone) ok(await page.locator('[data-gate-banner="phone"] [data-keep-it="chat"]').isVisible().catch(() => false), 'the 375 bar sits in the phone seat (compact row)')
    const notNow = bar.getByRole('button', { name: /not now/i })
    await notNow.click().catch(() => {})
    await sleep(600)
    ok(!(await bar.isVisible().catch(() => false)), '"Not now" removes it')
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(4000)
    ok(!(await page.locator('[data-keep-it="chat"]').isVisible().catch(() => false)), 'a reload keeps it gone (sessionStorage)')
  }
  ok(true, `info: fake JSON-RPC answers served to the page: ${rpcOut}`)
  await ctx.close()
  return res
}

async function main() {
  const pw = require_(process.env.PLAYWRIGHT_CORE || 'playwright-core')
  const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true })
  const all: string[] = []
  for (const w of (process.env.WIDTHS || "1440,375").split(",").map(Number)) all.push(...(await drive(browser, w)))
  await browser.close()
  for (const l of all) console.log(l)
  const fails = all.filter((l) => l.startsWith('FAIL')).length
  console.log(`keepit: ${all.length - fails} pass / ${fails} fail`)
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
