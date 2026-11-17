// THE CALLED-IT FUNNEL DRIVE (squad called-gtm, lane QA, 2026-11-16).
//
// The outreach loop as a signed-out stranger sees it, in headless Chrome over CDP
// (no Playwright on this Mac; the recipe is scripts/landing-shot.mjs). It walks:
//   the one-call page (/x/<h>/<SYM>?call=<id>) → its unfurl tags + image → the
//   primary press onto the live chart with the call's card open → close → the
//   trade chip (connect-only door, zero POST /api/chat) → a bear call → a miss →
//   an unknown and a garbage id → the account page → the symbol page's Community
//   board → the admin outreach desk as a stranger.
// At 390x844 (the outreach link opens in X's in-app browser on a phone) and 1440x900.
//
//   BASE=http://localhost:4610 node scripts/called-gtm-drive.mjs [--shots=/abs/dir] [--handle=dcinvestor] [--sym=ETH]
//
// One line per check; exit 1 when any check fails. Reads only: it never scans,
// never signs, never sends. Every request carries `x-yf-internal-run: 1`.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (k, d) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const BASE = process.env.BASE ?? 'http://localhost:4610'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const HANDLE = flag('handle', 'dcinvestor')
const SYM = flag('sym', 'ETH')
const SHOTS = flag('shots', '')
const PORT = Number(flag('port', 9616))
const ONLY = flag('only', '') // a comma list of sizes: 390,1440
const H_HDR = { 'x-yf-internal-run': '1' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  if (!ok) failed++
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
}

const get = (p, init = {}) => fetch(`${BASE}${p}`, { redirect: 'manual', ...init, headers: { ...H_HDR, ...(init.headers ?? {}) } })
const attr = (html, re) => (html.match(re) ?? [])[1] ?? null
const metaContent = (html, key) =>
  attr(html, new RegExp(`<meta[^>]+(?:property|name)="${key.replace(/[:]/g, '\\:')}"[^>]+content="([^"]*)"`)) ??
  attr(html, new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${key.replace(/[:]/g, '\\:')}"`))
const unesc = (s) => (s ?? '').replace(/&amp;/g, '&')

// ---- data the drive needs, read from the record, never typed -------------------
const board = await (await get(`/api/x/board?sym=${SYM}`)).json()
const entry = board.entries.find((e) => e.handle === HANDLE)
if (!entry?.best || !entry?.worst) {
  console.log(`❌ setup — no best/worst for @${HANDLE} on ${SYM} in /api/x/board`)
  process.exit(1)
}
const rec = (await (await get(`/api/x/record?handle=${HANDLE}&sym=${SYM}`)).json()).record
const T = rec.tally
const BEST = entry.best.postId
const WORST = entry.worst.postId
const bear = rec.calls.filter((c) => c.stance === 'bear' && c.origin === 'scan')
const BEAR = bear.find((c) => c.verdict === 'wrong') ?? bear[0]
const BEAR_OPEN = bear.find((c) => c.verdict === 'open')
const WORD = { right: 'Called it.', wrong: 'Missed.', flat: 'No real move.', open: 'Too early to say.' }
console.log(`setup: @${HANDLE}/${SYM} best=${BEST} worst=${WORST} bear=${BEAR?.postId}(${BEAR?.verdict}) bearOpen=${BEAR_OPEN?.postId ?? '-'} tally=${JSON.stringify(T)}`)

// ---- server-side checks (once) ---------------------------------------------------
{
  const r = await get(`/x/${HANDLE}/${SYM}?call=${BEST}`)
  const html = await r.text()
  check('call page answers 200', r.status === 200, String(r.status))
  const og = unesc(metaContent(html, 'og:image'))
  check('og:image is the call image', og.includes('/api/og/called?') && og.includes(`call=${BEST}`), og)
  const tw = unesc(metaContent(html, 'twitter:image'))
  check('twitter:image is the call image', tw.includes(`call=${BEST}`), tw)
  const canon = unesc(attr(html, /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/) ?? attr(html, /<link[^>]+href="([^"]*)"[^>]+rel="canonical"/))
  check('canonical is the record (no call)', !!canon && canon.endsWith(`/x/${HANDLE}/${SYM}`) && !canon.includes('call='), canon)
  const robots = metaContent(html, 'robots') ?? ''
  check('robots noindex on a call address', /noindex/.test(robots), robots)
  const ogPath = og.replace(/^https?:\/\/[^/]+/, '')
  const img = await get(ogPath)
  const buf = Buffer.from(await img.arrayBuffer())
  check('call image 200 image/png', img.status === 200 && (img.headers.get('content-type') ?? '').startsWith('image/png'), `${img.status} ${img.headers.get('content-type')} ${buf.length}B`)
  check('call image header x-pantessa-card: call', img.headers.get('x-pantessa-card') === 'call', String(img.headers.get('x-pantessa-card')))
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, `qa-og-best.png`), buf)
  // SSR: the lead's words are in the first HTML, not drawn later
  const plain = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
  check('SSR html carries the verdict word', plain.includes(WORD.right), '')
  check('SSR html carries the full tally', plain.includes(`${T.total} calls`) && plain.includes(`${T.right} called it`) && plain.includes(`${T.wrong} missed`), '')
  check('SSR html carries "Not verified"', rec.verified ? true : plain.includes('Not verified'), '')

  // the miss's image
  const w = await get(`/api/og/called?handle=${HANDLE}&sym=${SYM}&call=${WORST}`)
  const wbuf = Buffer.from(await w.arrayBuffer())
  check('miss image 200 png, header call', w.status === 200 && w.headers.get('x-pantessa-card') === 'call', `${w.status} ${w.headers.get('x-pantessa-card')}`)
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, `qa-og-worst.png`), wbuf)
  if (BEAR) {
    const b = await get(`/api/og/called?handle=${HANDLE}&sym=${SYM}&call=${BEAR.postId}`)
    const bbuf = Buffer.from(await b.arrayBuffer())
    check('bear image 200 png, header call', b.status === 200 && b.headers.get('x-pantessa-card') === 'call', `${b.status} ${b.headers.get('x-pantessa-card')}`)
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, `qa-og-bear.png`), bbuf)
  }

  // (g) an id the record does not hold, and garbage
  const u = await get(`/x/${HANDLE}/${SYM}?call=12345678901234567`)
  const uh = await u.text()
  check('unknown id → 200, no lead', u.status === 200 && !uh.includes('data-xcl="lead"'), String(u.status))
  const g = await get(`/x/${HANDLE}/${SYM}?call=${encodeURIComponent('<script>qa9x</script>')}`)
  const gh = await g.text()
  // Next's own RSC payload carries the search JSON-escaped (\u003c); only a raw, unescaped echo counts
  const rawEcho = gh.includes('<script>qa9x') || gh.replace(/<script[\s\S]*?<\/script>/g, '').includes('qa9x')
  check('garbage id → 200, no lead, nothing reflected', g.status === 200 && !gh.includes('data-xcl="lead"') && !rawEcho, `${g.status} rawEcho=${rawEcho}`)

  // (j) the desk as a stranger
  const a = await get('/api/admin/outreach')
  const at = await a.text()
  check('GET /api/admin/outreach as a stranger → 401, no data', a.status === 401 && !at.includes(HANDLE), `${a.status} ${at.slice(0, 80)}`)
}

// ---- the browser ------------------------------------------------------------------
const PROFILE = path.join(os.tmpdir(), `claude-called-gtm-drive-${PORT}`)
fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })

try {
  let v = null
  for (let i = 0; i < 60 && !v; i++) {
    try {
      v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    } catch {
      await sleep(200)
    }
  }
  if (!v) throw new Error('chrome did not start')
  const ws = new WebSocket(v.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  const listeners = new Set()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d)
      pending.delete(d.id)
    } else for (const l of listeners) l(d)
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((res) => {
      const i = ++id
      pending.set(i, res)
      ws.send(JSON.stringify({ id: i, method, params, sessionId }))
    })

  const sizes = [
    { w: 390, h: 844, theme: 'dark' },
    { w: 1440, h: 900, theme: 'dark' },
  ].filter((s) => !ONLY || ONLY.split(',').includes(String(s.w)))

  for (const size of sizes) {
    const tag = `${size.w}`
    // a fresh browser context = a stranger with no cookies, no storage
    const { browserContextId } = (await send('Target.createBrowserContext', { disposeOnDetach: true })).result
    const { targetId } = (await send('Target.createTarget', { url: 'about:blank', browserContextId })).result
    const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
    const S = (method, params = {}) => send(method, params, sessionId)
    const errors = []
    const chatPosts = []
    listeners.add((d) => {
      if (d.sessionId !== sessionId) return
      if (d.method === 'Runtime.exceptionThrown') errors.push(`exception: ${d.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? d.params.exceptionDetails?.text}`)
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(`console.error: ${(d.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`)
      if (d.method === 'Network.requestWillBeSent' && d.params.request.method === 'POST' && /\/api\/chat(\b|\/|\?|$)/.test(new URL(d.params.request.url).pathname)) chatPosts.push(d.params.request.url)
    })
    await S('Page.enable')
    await S('Runtime.enable')
    await S('Network.enable')
    await S('Network.setExtraHTTPHeaders', { headers: H_HDR })
    await S('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: size.w < 768 })
    if (size.w < 768) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await S('Emulation.setFocusEmulationEnabled', { enabled: true })
    const setTheme = (t) => S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: t }] })
    await setTheme(size.theme)

    const ev = async (expression) => {
      const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
      return r.result?.result?.value
    }
    const waitFor = async (expr, ms = 15000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        if (await ev(expr).catch(() => false)) return Date.now() - t0
        await sleep(200)
      }
      return -1
    }
    const open = async (p, settle = 2500) => {
      errors.length = 0
      await S('Page.navigate', { url: `${BASE}${p}` })
      await waitFor('document.readyState === "complete"', 30000)
      await sleep(settle)
    }
    const shot = async (name) => {
      if (!SHOTS) return
      await ev('window.scrollTo(0,0)')
      await sleep(300)
      const r = await S('Page.captureScreenshot', { format: 'png' })
      if (r.result?.data) fs.writeFileSync(path.join(SHOTS, `qa-${name}-${tag}-${size.theme}.png`), Buffer.from(r.result.data, 'base64'))
    }
    const click = async (sel) => {
      const box = await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      if (!box) return false
      await sleep(250)
      const b2 = await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.getClientRects().length); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      for (const type of ['mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x: b2.x, y: b2.y, button: 'left', clickCount: 1 })
      return true
    }
    const noErrors = (where) => check(`[${tag}] ${where}: no page error`, errors.length === 0, errors.slice(0, 3).join(' | '))
    const overflow = () => ev('document.documentElement.scrollWidth > window.innerWidth + 1')

    // (a) the one-call page, first viewport
    await open(`/x/${HANDLE}/${SYM}?call=${BEST}`)
    const a = await ev(`(() => {
      const H = window.innerHeight
      const lead = document.querySelector('[data-xcl="lead"]')
      const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } }
      const h1 = document.querySelector('h1.xcl-verdict')
      const post = lead?.querySelector('.xcl-post')
      const tally = lead?.querySelector('[data-record-headline]')
      const standing = lead?.querySelector('[data-standing]')
      const btn = lead?.querySelector('.xcl-btn')
      const small = lead ? [...lead.querySelectorAll('a,button,summary')].filter(e => e.getClientRects().length).map(e => ({ t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 40), h: Math.round(e.getBoundingClientRect().height) })).filter(x => x.h < 44) : []
      return { H, lead: !!lead, h1: h1?.textContent?.trim(), h1r: vis(h1), post: post?.textContent?.trim().slice(0, 60), postr: vis(post), tally: tally?.textContent?.replace(/\\s+/g, ' ').trim(), tallyr: vis(tally), standing: standing?.textContent?.trim(), standingr: vis(standing), btn: btn?.textContent?.trim(), btnr: vis(btn), small, h1count: document.querySelectorAll('h1').length }
    })()`)
    check(`[${tag}] (a) lead renders`, a.lead, '')
    check(`[${tag}] (a) verdict word "${WORD.right}" in first viewport`, (a.h1 ?? '').includes(WORD.right) && a.h1r && a.h1r.bottom <= a.H, `${a.h1} @${JSON.stringify(a.h1r)}`)
    check(`[${tag}] (a) one h1`, a.h1count === 1, String(a.h1count))
    check(`[${tag}] (a) post text in first viewport`, !!a.post && a.postr && a.postr.top < a.H, `${a.post} @${JSON.stringify(a.postr)}`)
    const tallyOk = (a.tally ?? '').includes(`${T.total} calls`) && a.tally.includes(`${T.right} called it`) && a.tally.includes(`${T.wrong} missed`)
    check(`[${tag}] (a) full tally present (${T.total}/${T.right}/${T.wrong})`, tallyOk, a.tally)
    check(`[${tag}] (a) full tally inside first viewport`, tallyOk && a.tallyr && a.tallyr.bottom <= a.H, JSON.stringify(a.tallyr))
    check(`[${tag}] (a) "Not verified" line present`, (a.standing ?? '').startsWith('Not verified'), a.standing)
    check(`[${tag}] (a) "Not verified" inside first viewport`, a.standingr && a.standingr.bottom <= a.H, JSON.stringify(a.standingr))
    check(`[${tag}] (a) primary button within first ${a.H}px`, a.btnr && a.btnr.bottom <= a.H, `${a.btn} @${JSON.stringify(a.btnr)}`)
    check(`[${tag}] (a) no horizontal overflow`, !(await overflow()), '')
    if (size.w < 768) check(`[${tag}] (a) no target under 44px in the lead`, a.small.length === 0, JSON.stringify(a.small))
    const chips = await ev(`[...document.querySelectorAll('[data-xcl="lead"] .xca__chip')].map(e => e.dataset.ask)`)
    check(`[${tag}] (a) bull lead offers the buy chip`, chips.some((c) => /^Buy \$25 of /.test(c)), JSON.stringify(chips))
    noErrors('(a) call page')
    await shot('a-call')
    if (size.w === 1440) {
      await setTheme('light')
      await sleep(600)
      if (SHOTS) {
        const r = await S('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(path.join(SHOTS, `qa-a-call-${tag}-light.png`), Buffer.from(r.result.data, 'base64'))
      }
      await setTheme(size.theme)
    }

    // (d) the trade chip as a stranger: the connect-only door, zero POST /api/chat
    {
      chatPosts.length = 0
      const before = await ev('location.href')
      const pressed = await click('[data-xcl="lead"] .xca__chip')
      await sleep(2500)
      const st = await ev(`(() => ({ href: location.href, door: /Sign in or create an account|Connect a wallet|Connect your wallet/i.test(document.body.innerText), dialog: !!document.querySelector('[role="dialog"]') }))()`)
      check(`[${tag}] (d) trade chip press opens the connect door`, pressed && (st.door || st.dialog), JSON.stringify(st))
      check(`[${tag}] (d) stays on the call page`, st.href === before, st.href)
      check(`[${tag}] (d) zero POST /api/chat`, chatPosts.length === 0, chatPosts.join(','))
      noErrors('(d) door')
      if (SHOTS) {
        const r = await S('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(path.join(SHOTS, `qa-d-door-${tag}-${size.theme}.png`), Buffer.from(r.result.data, 'base64'))
      }
    }

    // (c) the primary press → the live chart, card open on the call
    await open(`/x/${HANDLE}/${SYM}?call=${BEST}`)
    {
      const pressed = await click('[data-xcl="lead"] .xcl-btn')
      const landed = await waitFor(`location.pathname === '/t/${SYM}' && new URLSearchParams(location.search).get('x') === '${HANDLE}' && new URLSearchParams(location.search).get('call') === '${BEST}'`, 15000)
      check(`[${tag}] (c) press lands on /t/${SYM}?x=${HANDLE}&call=…`, pressed && landed >= 0, await ev('location.pathname + location.search'))
      const opened = await waitFor(`!!document.querySelector('[data-called-card="${BEST}"]')`, 15000)
      check(`[${tag}] (c) the call's card opens within 15s`, opened >= 0, `${opened}ms`)
      noErrors('(c) chart')
      await sleep(800)
      await shot('c-chart')
      const closed = await click(`[data-called-card="${BEST}"] .xcf__close`)
      await sleep(600)
      const q = await ev('location.search')
      check(`[${tag}] (c) close drops call from the address`, closed && !new URLSearchParams(q).has('call') && new URLSearchParams(q).get('x') === HANDLE, q)
      await sleep(3000)
      const still = await ev('!!document.querySelector("[data-called-card]")')
      check(`[${tag}] (c) card stays closed for 3s`, !still, '')
      noErrors('(c) after close')
    }

    // (e) a bear call
    for (const bc of [BEAR, BEAR_OPEN].filter(Boolean)) {
      await open(`/x/${HANDLE}/${SYM}?call=${bc.postId}`)
      const e = await ev(`(() => ({ h1: document.querySelector('h1.xcl-verdict')?.textContent?.trim(), kicker: document.querySelector('.xcl-kicker')?.textContent?.trim(), chips: [...document.querySelectorAll('[data-xcl="lead"] .xca__chip')].map(x => x.dataset.ask) }))()`)
      check(`[${tag}] (e) bear ${bc.verdict} → "${WORD[bc.verdict]}"`, (e.h1 ?? '').includes(WORD[bc.verdict]), e.h1)
      check(`[${tag}] (e) bear kicker says Bear`, /bear/i.test(e.kicker ?? ''), e.kicker)
      check(`[${tag}] (e) bear offers no Buy`, !e.chips.some((c) => /^Buy\b/.test(c)), JSON.stringify(e.chips))
      check(`[${tag}] (e) bear chips are Short/Sell only`, e.chips.every((c) => /^(Short|Sell)\b/.test(c)), JSON.stringify(e.chips))
      noErrors(`(e) bear ${bc.verdict}`)
      if (bc === BEAR) await shot('e-bear')
    }

    // (f) a miss
    await open(`/x/${HANDLE}/${SYM}?call=${WORST}`)
    {
      const f = await ev(`(() => { const lead = document.querySelector('[data-xcl="lead"]'); return { h1: document.querySelector('h1.xcl-verdict')?.textContent?.trim(), kicker: lead?.querySelector('.xcl-kicker')?.textContent, best: !!document.querySelector('[data-xcl="best"]'), leadNoTally: (lead?.innerText ?? '').replace(lead?.querySelector('[data-record]')?.innerText ?? '', '') } })()`)
      check(`[${tag}] (f) miss says "Missed."`, (f.h1 ?? '').includes('Missed.'), f.h1)
      check(`[${tag}] (f) the lead never says "Called it" outside the tally`, !/called it/i.test(f.leadNoTally), '')
      noErrors('(f) miss')
      await shot('f-miss')
    }

    // (g) unknown + garbage ids in the browser
    for (const [name, q] of [['unknown', '12345678901234567'], ['garbage', encodeURIComponent('<script>qa9x</script>')]]) {
      await open(`/x/${HANDLE}/${SYM}?call=${q}`)
      const g = await ev(`(() => ({ lead: !!document.querySelector('[data-xcl="lead"]'), h1: document.querySelector('h1')?.textContent?.trim().slice(0, 60), reflected: document.documentElement.outerHTML.includes('qa9x') && !location.href.includes('qa9x') }))()`)
      const reflectedInDom = await ev(`[...document.querySelectorAll('body *')].some(e => !['SCRIPT','STYLE','TEMPLATE','NOSCRIPT'].includes(e.tagName) && e.childElementCount === 0 && (e.textContent || '').includes('qa9x'))`)
      check(`[${tag}] (g) ${name} id → plain record page`, !g.lead && !!g.h1, g.h1)
      check(`[${tag}] (g) ${name} id: nothing reflected in the page`, !reflectedInDom, '')
      noErrors(`(g) ${name}`)
    }

    // (h) the account page
    await open(`/x/${HANDLE}`)
    {
      const h = await ev(`(() => ({ sum: document.querySelector('[data-xpf="sum"]')?.innerText?.replace(/\\s+/g, ' '), best: document.querySelectorAll('[data-xpf="best"] .xpf-call').length, misses: document.querySelectorAll('[data-xpf="misses"] .xpf-call').length, owner: !!document.querySelector('[data-xpf="owner"]'), firstCall: document.querySelector('.xpf-call')?.getAttribute('href') }))()`)
      check(`[${tag}] (h) summed line`, !!h.sum && h.sum.includes(String(T.total)) && h.sum.includes(String(T.right)) && h.sum.includes(String(T.wrong)), h.sum)
      check(`[${tag}] (h) Best calls group`, h.best > 0, String(h.best))
      check(`[${tag}] (h) Misses group`, h.misses > 0, String(h.misses))
      check(`[${tag}] (h) "Is this you?" block`, h.owner, '')
      check(`[${tag}] (h) no horizontal overflow`, !(await overflow()), '')
      noErrors('(h) account page')
      await shot('h-account')
      if (size.w === 1440 && SHOTS) {
        await setTheme('light')
        await sleep(600)
        const r = await S('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(path.join(SHOTS, `qa-h-account-${tag}-light.png`), Buffer.from(r.result.data, 'base64'))
        await setTheme(size.theme)
      }
      const pressed = await click('.xpf-call')
      const landed = await waitFor(`location.pathname === '/x/${HANDLE}/${SYM}' && new URLSearchParams(location.search).has('call')`, 15000)
      const href = await ev('location.pathname + location.search')
      const st = (await get(href)).status
      check(`[${tag}] (h) "See the call" opens a call address answering 200`, pressed && landed >= 0 && st === 200, `${href} ${st}`)
      check(`[${tag}] (h) it lands on that call's lead`, !!(await ev('!!document.querySelector(\'[data-xcl="lead"]\')')), '')
    }

    // (i) the Community board
    await open(`/t/${SYM}?tab=community`, 1500)
    {
      const n = board.entries.length
      const ready = await waitFor(`document.querySelector('.xbd[data-called-board]')?.dataset.calledBoard === '${n}'`, 20000)
      check(`[${tag}] (i) board shows ${n} cards`, ready >= 0, await ev(`document.querySelector('[data-called-board]')?.dataset.calledBoard ?? 'none'`))
      const cards = await ev(`[...document.querySelectorAll('.xbd-card')].map(c => ({ name: c.querySelector('.xbd-card__name')?.textContent?.trim(), tally: c.querySelector('.xbd-card__tallyline')?.textContent?.trim() ?? c.querySelector('.xbd-card__tally')?.innerText?.replace(/\\s+/g, ' '), rate: c.querySelector('.xbd-card__rate')?.textContent?.trim() }))`)
      for (const e of board.entries) {
        const want = e.headline.replace(/^@\S+ on \S+: /, '').replace(/\.$/, '')
        const norm = (t) => (t ?? '').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim()
        const c = cards.find((x) => x.tally && norm(x.tally) === norm(want))
        check(`[${tag}] (i) card for @${e.handle} carries its tally`, !!c, `${want} vs ${JSON.stringify(cards.map((x) => x.tally))}`)
        if (e.hitRate) check(`[${tag}] (i) card for @${e.handle} hit rate`, cards.some((x) => x.rate === e.hitRate), e.hitRate)
      }
      noErrors('(i) community')
      await shot('i-community')
      const pressed = await click('.xbd-card__press')
      const landed = await waitFor(`new URLSearchParams(location.search).get('x') === '${board.entries[0].handle}'`, 15000)
      check(`[${tag}] (i) card press plots the account`, pressed && landed >= 0, await ev('location.search'))
      const chartVis = await waitFor(`[...document.querySelectorAll('.sym__chart')].some(e => !e.classList.contains('is-parked') && e.getBoundingClientRect().height > 150)`, 10000)
      check(`[${tag}] (i) chart visible after the press`, chartVis >= 0, '')
      noErrors('(i) after press')
      await sleep(1500)
      await shot('i-after-press')

      await open(`/t/SOL?tab=community`, 1500)
      const quiet = await waitFor(`document.querySelector('[data-called-board]')?.dataset.calledBoard === '0'`, 15000)
      const ql = await ev(`document.querySelector('[data-called-board]')?.innerText?.replace(/\\s+/g, ' ')`)
      check(`[${tag}] (i) /t/SOL community: the one quiet line`, quiet >= 0 && document_count_ok(ql), ql)
      noErrors('(i) SOL community')
    }

    // (j) the outreach desk as a stranger
    await open('/dashboard/admin/outreach', 3000)
    {
      const j = await ev(`(() => ({ path: location.pathname, text: document.body.innerText.slice(0, 200).replace(/\\s+/g, ' '), leak: /Reply on X|Copy DM|Direct message|not contacted/.test(document.body.innerText) || location.pathname.startsWith('/dashboard/admin/outreach') && document.body.innerText.includes('${HANDLE}') }))()`)
      check(`[${tag}] (j) the desk shows a stranger no data`, !j.leak, `${j.path} :: ${j.text}`)
    }

    await send('Target.closeTarget', { targetId })
    await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
  }
} catch (err) {
  check('drive ran to the end', false, String(err?.stack ?? err).split('\n').slice(0, 3).join(' | '))
} finally {
  chrome.kill('SIGKILL')
  await new Promise((r) => chrome.once('exit', r)).catch(() => {})
  fs.rmSync(PROFILE, { recursive: true, force: true })
}

function document_count_ok(line) {
  return typeof line === 'string' && line.length > 0 && line.length < 200
}

console.log(`\n${results.length - failed} / ${results.length} green${failed ? `, ${failed} red` : ''}`)
process.exit(failed ? 1 : 0)
