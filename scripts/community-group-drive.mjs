// THE ROOM, DRIVEN (squad community, lane GROUP, 2026-11-09): the join and
// invite flow in a real browser, against a real room on the TEST DB.
// Headless Chrome over CDP on Node's own WebSocket (no Playwright on this Mac).
//
//   an owner starts a room and three members join through invite links (API)
//   1. a STRANGER opens the owner's invite link in a clean profile: the page
//      says who invited them, the address bar goes back to the bare room and
//      the code moves into the tab's storage
//   2. Join opens the chooser and HOLDS the join (nothing is signed)
//   3. an identity lands (a session + its wallet, then a reload: the Google
//      lane's shape) and the held join runs by itself; the invite panel shows
//      the new member's OWN link
//   4. the inviter reads "You brought N" and where that puts them; the owner
//      sees Owner, the checklist and the linked-chats panels
//   5. leaving is behind the Joined menu
//   6. /g/new: a name suggests its address, a stranger gets the door (not a
//      wall), the draft survives a reload; an owner creates a room from the
//      form and lands on it
//   7. /g: the directory (empty state, and a fixture list for the look)
//   8. phones: 375px, no sideways scroll, on every page above
//
// Shots land in SHOTS (default: the squad blackboard's shots folder).
// Usage: BASE=http://localhost:4503 node scripts/community-group-drive.mjs
// Rows: slugs t-group-*, x-yf-internal-run: 1, deleted at the end
// (needs DATABASE_URL in the environment for the delete).
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT ?? 9453)
const BASE = process.env.BASE ?? 'http://localhost:4503'
const SHOTS = process.env.SHOTS ?? '/Users/nate/pantessa/squad-community-2026-11-09/shots'
const PROFILE = `/tmp/claude-community-group-drive-${PORT}`
const HDR = { 'x-yf-internal-run': '1' }

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} group drive: ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = () => Math.random().toString(36).slice(2, 8)

// ── sessions, the harness's way ────────────────────────────────────────────
function cookie(res, name) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return m[1]
  }
  return null
}
async function signIn(account) {
  const n = await fetch(`${BASE}/api/auth/nonce`, { headers: HDR })
  const nonceCookie = cookie(n, 'yf_siwe_nonce')
  const { nonce } = await n.json()
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
  const signature = await account.signMessage({ message })
  const v = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', ...HDR, ...(nonceCookie ? { cookie: `yf_siwe_nonce=${nonceCookie}` } : {}) }, body: JSON.stringify({ message, signature }) })
  const session = cookie(v, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${v.status})`)
  return session
}
const api = async (pathname, { session, method = 'GET', body } = {}) => {
  const r = await fetch(`${BASE}${pathname}`, { method, headers: { ...HDR, ...(body ? { 'content-type': 'application/json' } : {}), ...(session ? { cookie: `yf_session=${session}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => null) }
}
// A watch-only wallet on the session's address: wagmi reconnects to it, so
// the session is a connected one, not an orphan the page would end.
const mockWallet = (addr) => `(() => { const ADDR='${addr}'; const provider={request:async({method})=>{ if(method==='eth_accounts'||method==='eth_requestAccounts')return[ADDR]; if(method==='eth_chainId')return'0x2105'; if(method==='wallet_switchEthereumChain')return null; throw new Error('unsupported: '+method)}, on:()=>{}, removeListener:()=>{} };
  const detail=Object.freeze({info:{uuid:'mock-0001-0000-0000-000000000001',name:'Mock Wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'dev.mock.wallet'},provider});
  const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail})); window.addEventListener('eip6963:requestProvider',announce); announce();
  try{localStorage.setItem('wagmi.recentConnectorId','"dev.mock.wallet"')}catch{} })()`

// ── the room ───────────────────────────────────────────────────────────────
const slug = `t-group-drive-${rand()}`
const NAME = 'ETH Swing Traders'
const owner = privateKeyToAccount(generatePrivateKey())
const guest = privateKeyToAccount(generatePrivateKey())
const fillers = [1, 2, 3].map(() => privateKeyToAccount(generatePrivateKey()))
const ownerSession = await signIn(owner)
const made = await api('/api/communities', { session: ownerSession, method: 'POST', body: { slug, name: NAME, about: 'Daily levels on ETH and the majors. Calls are stamped, trades are shown with proof.', symbols: ['ETH', 'BTC', 'HYPE', 'SOL'] } })
if (made.status !== 201) throw new Error(`could not start the room: ${made.status} ${JSON.stringify(made.json)}`)
const ownerCode = (await api(`/api/communities/${slug}`, { session: ownerSession })).json.me.invite.code
const fillerSessions = []
for (const f of fillers) fillerSessions.push(await signIn(f))
await api(`/api/communities/${slug}/join`, { session: fillerSessions[0], method: 'POST', body: { via: ownerCode } })
await api(`/api/communities/${slug}/join`, { session: fillerSessions[1], method: 'POST', body: { via: ownerCode } })
const f1Code = (await api(`/api/communities/${slug}`, { session: fillerSessions[0] })).json.me.invite.code
await api(`/api/communities/${slug}/join`, { session: fillerSessions[2], method: 'POST', body: { via: f1Code } })
console.log(`room ${slug} · owner code ${ownerCode} · 4 members`)

// ── Chrome over CDP ────────────────────────────────────────────────────────
fs.mkdirSync(SHOTS, { recursive: true })
fs.rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
async function version() {
  for (let i = 0; i < 50; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    } catch {
      await sleep(200)
    }
  }
  throw new Error('chrome did not start')
}
const ws = new WebSocket((await version()).webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const events = []
const fetchHandlers = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
    return
  }
  if (d.method === 'Fetch.requestPaused' && fetchHandlers.has(d.sessionId)) void fetchHandlers.get(d.sessionId)(d.params)
  events.push(d)
}
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params, sessionId }))
  })

/** A clean profile (its own cookies and storage), like a new person. */
const newPerson = async () => (await send('Target.createBrowserContext', {})).result.browserContextId

async function tab(person, { w = 1440, h = 900, scheme = 'dark', session = null, wallet = null } = {}) {
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank', browserContextId: person })).result
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Network.setExtraHTTPHeaders', { headers: HDR }, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w < 500 ? 2 : 1, mobile: w < 500 }, sessionId)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, sessionId)
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
  const signInAs = async (sess, addr) => {
    await send('Network.setCookie', { name: 'yf_session', value: sess, url: BASE }, sessionId)
    await send('Page.addScriptToEvaluateOnNewDocument', { source: mockWallet(addr) }, sessionId)
  }
  if (session && wallet) await signInAs(session, wallet)
  const ev = async (s) => {
    const r = await send('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true }, sessionId)
    return r.result?.result?.value
  }
  const go = async (p) => {
    await send('Page.navigate', { url: `${BASE}${p}` }, sessionId)
    await sleep(700)
  }
  const reload = async () => {
    await send('Page.reload', {}, sessionId)
    await sleep(700)
  }
  const until = async (expr, ms = 20000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const v = await ev(expr).catch(() => null)
      if (v) return v
      await sleep(250)
    }
    return null
  }
  const shot = async (name) => {
    await sleep(350)
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
    const file = path.join(SHOTS, `group-${name}.png`)
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'))
    return file
  }
  const type = async (selector, text) => {
    await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.() })()`)
    await send('Input.insertText', { text }, sessionId)
    await sleep(150)
  }
  const fulfil = async (pattern, handler) => {
    fetchHandlers.set(sessionId, async (p) => {
      const body = handler(new URL(p.request.url))
      if (body === null) return void send('Fetch.continueRequest', { requestId: p.requestId }, sessionId)
      await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }, sessionId)
    })
    await send('Fetch.enable', { patterns: [{ urlPattern: pattern }] }, sessionId)
  }
  /** Sideways scroll anywhere on the page: the document and the phone frame's one scroller. */
  const overflow = () => ev(`(() => { const d = document.documentElement; const s = document.querySelector('[data-app-scroll]'); return Math.max(d.scrollWidth - d.clientWidth, s ? s.scrollWidth - s.clientWidth : 0) })()`)
  /** Controls under 44px tall that a thumb is meant to hit, inside the lane's own markup. */
  const smallTargets = () =>
    ev(`[...document.querySelectorAll('.grp button, .grp a.grp-btn, .grp-side button, .grp-choose button, .grp-choose a, .grp-join')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5 && el.tagName !== 'SPAN' }).map((el) => (el.className || el.tagName) + ':' + Math.round(el.getBoundingClientRect().height)).slice(0, 6).join(' | ')`)
  const mine = (method) => events.filter((e) => e.sessionId === sessionId && e.method === method)
  const errors = () => mine('Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text)
  return { ev, go, reload, until, shot, type, fulfil, overflow, smallTargets, errors, signInAs, sessionId }
}

const allErrors = []
try {
  // ── 1. a stranger opens the invite link ───────────────────────────────
  const strangerProfile = await newPerson()
  const s = await tab(strangerProfile)
  await s.go(`/g/${slug}?via=${ownerCode}`)
  await s.until(`document.querySelector('[data-room-state="ok"] [data-join-state="join"]')`)
  await sleep(3500) // past the spine's signed-out gate: a public page keeps a stranger
  const where = await s.ev(`location.pathname + location.search`)
  check('a stranger stays on the room (the spine does not send them home) and the address bar is the bare room', where === `/g/${slug}`, where)
  const invited = await s.ev(`document.querySelector('[data-invited]')?.textContent ?? ''`)
  check('the page says who invited them', /You were invited by /.test(invited) && /Joining takes one tap/.test(invited), invited)
  const viaRec = await s.ev(`sessionStorage.getItem('pantessa.community.via')`)
  check('the invite code moved into this tab (sessionStorage), for this room', !!viaRec && JSON.parse(viaRec).slug === slug && JSON.parse(viaRec).code === ownerCode, String(viaRec))
  const head = await s.ev(`(() => { const q = (x) => document.querySelector(x)?.textContent ?? ''; return { name: q('.grp-head__name'), members: q('[data-room-members]'), board: document.querySelectorAll('[data-board-rows] li').length, compose: !!document.querySelector('[data-join-to-post]') } })()`)
  check('the header answers what, who and how many; the board lists who brought people; a stranger sees "Join to post"', head.name === NAME && head.members === '4' && head.board >= 2 && head.compose === true, JSON.stringify(head))
  await s.shot('room-stranger-1440-dark')

  // ── 2. Join: the chooser, the held join ───────────────────────────────
  await s.ev(`document.querySelector('.grp-head [data-join-state="join"]').click()`)
  const chooser = await s.until(`document.querySelector('[data-join-chooser] .grp-choose__panel')?.textContent`)
  const held = await s.ev(`sessionStorage.getItem('pantessa.community.join')`)
  check('Join opens the chooser with the unified sign-in door', !!chooser && /Join ETH Swing Traders/.test(chooser) && /wallet, Google or email|Continue with a wallet/.test(chooser), String(chooser))
  check('the join is HELD in this tab with the invite it carries', !!held && JSON.parse(held).slug === slug && JSON.parse(held).via === ownerCode && typeof JSON.parse(held).at === 'number', String(held))
  await s.shot('chooser-1440-dark')
  const doorBtn = await s.ev(`(() => { const b = document.querySelector('[data-join-chooser] .grp-choose__lane.is-lead'); if (!b) return null; b.click(); return b.textContent })()`)
  const door = await s.until(`document.querySelector('[data-sheet="door"] .ca__title')?.textContent`, 8000)
  check('the chooser opens the unified door ("Sign in to Pantessa": wallet, Google, email), over the chooser', door === 'Sign in to Pantessa' || /Continue with a wallet/.test(doorBtn ?? ''), `${doorBtn} → ${door}`)
  if (door) {
    await s.shot('door-1440-dark')
    await s.ev(`document.querySelector('[data-sheet="door"] .ca__close')?.click()`)
    await sleep(400)
  }
  const heldStill = await s.ev(`sessionStorage.getItem('pantessa.community.join')`)
  check('closing the DOOR alone keeps the held join (the chooser is still up)', !!heldStill && !!(await s.ev(`!!document.querySelector('[data-join-chooser]')`)))

  // ── 3. an identity lands: the held join runs by itself ────────────────
  const guestSession = await signIn(guest)
  await s.signInAs(guestSession, guest.address)
  await s.reload()
  const memberState = await s.until(`document.querySelector('.grp-head [data-join-state="member"]') && document.querySelector('[data-invite-panel]') ? 'member' : null`, 25000)
  check('after the sign-in the visitor is a member with no further tap (the held join ran)', memberState === 'member', String(await s.ev(`document.querySelector('.grp-head [data-join-state]')?.getAttribute('data-join-state')`)))
  await s.until(`document.querySelector('[data-room-members]')?.textContent === '5'`, 8000)
  const afterJoin = await s.ev(`(() => ({ held: sessionStorage.getItem('pantessa.community.join'), url: document.querySelector('[data-invite-url]')?.value ?? '', members: document.querySelector('[data-room-members]')?.textContent, uses: document.querySelector('[data-invite-uses]')?.textContent, invited: !!document.querySelector('[data-invited]'), composer: !!document.querySelector('#room-compose') }))()`)
  const guestCode = (await api(`/api/communities/${slug}`, { session: guestSession })).json.me?.invite.code
  check('the held record is spent, the count moved to 5, the invite banner is gone and the composer seat is open', afterJoin.held === null && afterJoin.members === '5' && afterJoin.invited === false && afterJoin.composer === true, JSON.stringify(afterJoin))
  check('the invite panel shows the new member\'s OWN link (their code, not the inviter\'s), one tap to copy', !!guestCode && afterJoin.url.endsWith(`/g/${slug}?via=${guestCode}`) && guestCode !== ownerCode && /not brought anyone yet/.test(afterJoin.uses ?? ''), afterJoin.url)
  const shareHrefs = await s.ev(`[...document.querySelectorAll('[data-invite-panel] a[data-share]')].map((a) => a.getAttribute('data-share') + ' ' + new URL(a.href).searchParams.get('url')).join(' | ')`)
  check('Telegram and X are one tap each and carry that link', shareHrefs.includes(`telegram`) && shareHrefs.includes(`x `) && shareHrefs.split(guestCode).length === 3, shareHrefs)
  await s.shot('room-member-1440-dark')
  const credited = (await api(`/api/communities/${slug}`, { session: ownerSession })).json.me.invite.uses
  check('the join was credited to the inviter (their link now reads 3)', credited === 3, String(credited))

  // ── 4. the inviter and owner ──────────────────────────────────────────
  const ownerProfile = await newPerson()
  const o = await tab(ownerProfile, { session: ownerSession, wallet: owner.address })
  await o.go(`/g/${slug}`)
  await o.until(`document.querySelector('.grp-head [data-join-state="owner"]') && document.querySelector('[data-invite-uses]')`, 25000)
  const brought = await o.until(`(() => { const t = document.querySelector('[data-invite-uses]')?.textContent ?? ''; return /in this room/.test(t) ? t : null })()`, 10000)
  check('the owner sees Owner, and "You brought 3. 1st in this room."', /You brought 3\. 1st in this room\./.test(brought ?? ''), String(brought ?? (await o.ev(`document.querySelector('[data-invite-uses]')?.textContent`))))
  const ownerView = await o.ev(`(() => ({ steps: [...document.querySelectorAll('[data-owner-checklist] [data-step]')].map((li) => li.getAttribute('data-step') + (li.hasAttribute('data-done') ? ':done' : ':todo')).join(','), seats: [...document.querySelectorAll('[data-channels-panel] [data-seat]')].map((d) => d.getAttribute('data-seat')).join(','), board: [...document.querySelectorAll('[data-board-rows="invites"] li')].map((li) => li.textContent).join(' / ') }))()`)
  check('the checklist ticks from real state (a second member: done; chats and a post: to do)', ownerView.steps === 'invite:done,telegram:todo,discord:todo,post:todo', ownerView.steps)
  check('the owner gets the Telegram and Discord seats; the board ranks the owner first with 3', ownerView.seats === 'telegram,discord' && /^1.*Owner.*3/.test(ownerView.board), JSON.stringify(ownerView))
  await o.shot('room-owner-1440-dark')
  await o.ev(`document.querySelector('[data-board-tab="trades"]').click()`)
  await o.until(`document.querySelector('[data-board-tab="trades"][aria-selected="true"]') && !document.querySelector('.grp-board__note[aria-busy]')`)
  await o.ev(`document.querySelector('[data-owner-checklist] [data-step="discord"] button').click()`)
  await sleep(900)
  const focused = await o.ev(`document.querySelector('#room-discord')?.classList.contains('is-focused')`)
  check('a checklist button does the thing (Connect Discord brings the Discord seat into view and focus)', focused === true)
  const ol = await tab(ownerProfile, { scheme: 'light', session: ownerSession, wallet: owner.address })
  await ol.go(`/g/${slug}`)
  await ol.until(`document.querySelector('.grp-head [data-join-state="owner"]') && document.querySelector('[data-board-rows]')`, 25000)
  await ol.shot('room-owner-1440-light')

  // ── 5. leaving is behind the menu ─────────────────────────────────────
  await s.ev(`document.querySelector('.grp-head [data-join-state="member"]').click()`)
  const leaveItem = await s.until(`document.querySelector('.grp-join__leave')?.textContent`)
  check('Joined opens a menu; leaving is its item, never the first tap', /Leave ETH Swing Traders/.test(leaveItem ?? '') && (await s.ev(`document.querySelector('.grp-head [data-join-state]').getAttribute('data-join-state')`)) === 'member')
  await s.shot('room-leave-menu-1440-dark')
  await s.ev(`document.querySelector('.grp-join__leave').click()`)
  const leftState = await s.until(`document.querySelector('.grp-head [data-join-state="join"]') && !document.querySelector('[data-invite-panel]') ? 'left' : null`, 10000)
  check('Leave takes the seat back: Join again, no invite panel, the count returns to 4', leftState === 'left' && (await s.until(`document.querySelector('[data-room-members]')?.textContent === '4'`, 8000)) === true)
  // …and a proven identity re-joins on ONE tap, optimistic, no chooser.
  await s.ev(`document.querySelector('.grp-head [data-join-state="join"]').click()`)
  const rejoin = await s.until(`document.querySelector('.grp-head [data-join-state="member"]') ? 'member' : null`, 8000)
  check('a signed-in visitor joins on one tap with no chooser', rejoin === 'member' && !(await s.ev(`!!document.querySelector('[data-join-chooser]')`)))

  // ── 8a. phones: the room ──────────────────────────────────────────────
  const phoneStranger = await newPerson()
  const ps = await tab(phoneStranger, { w: 375, h: 812 })
  await ps.go(`/g/${slug}?via=${ownerCode}`)
  await ps.until(`document.querySelector('[data-room-state="ok"] [data-join-state="join"]') && document.querySelector('[data-board-rows]')`)
  await sleep(1200)
  const firstScreen = await ps.ev(`(() => { const b = document.querySelector('.grp-head [data-join-state="join"]').getBoundingClientRect(); return { joinBottom: Math.round(b.bottom), joinH: Math.round(b.height), h: innerHeight } })()`)
  check('phone: the invite line, the name and a 44px Join are on the first screen', firstScreen.joinBottom < firstScreen.h - 60 && firstScreen.joinH >= 44, JSON.stringify(firstScreen))
  check('phone: no sideways scroll on the room (stranger)', (await ps.overflow()) === 0, String(await ps.overflow()))
  check('phone: every control of the lane is at least 44px tall (stranger)', (await ps.smallTargets()) === '', await ps.smallTargets())
  await ps.shot('room-stranger-375-dark')
  await ps.ev(`document.querySelector('.grp-head [data-join-state="join"]').click()`)
  await ps.until(`document.querySelector('[data-join-chooser] .grp-choose__panel')`)
  check('phone: the chooser is a bottom sheet with 44px lanes', (await ps.smallTargets()) === '' && (await ps.ev(`Math.round(innerHeight - document.querySelector('.grp-choose__panel').getBoundingClientRect().bottom)`)) <= 1, await ps.smallTargets())
  await ps.shot('chooser-375-dark')
  const pm = await tab(strangerProfile, { w: 375, h: 812, scheme: 'light', session: guestSession, wallet: guest.address })
  await pm.go(`/g/${slug}`)
  await pm.until(`document.querySelector('.grp-head [data-join-state="member"]') && document.querySelector('[data-invite-panel]')`, 25000)
  await sleep(800)
  check('phone: no sideways scroll on the room (member, invite panel open)', (await pm.overflow()) === 0, String(await pm.overflow()))
  check('phone: every control of the lane is at least 44px tall (member)', (await pm.smallTargets()) === '', await pm.smallTargets())
  await pm.shot('room-member-375-light')
  const po = await tab(ownerProfile, { w: 375, h: 812, session: ownerSession, wallet: owner.address })
  await po.go(`/g/${slug}`)
  await po.until(`document.querySelector('.grp-head [data-join-state="owner"]') && document.querySelector('[data-owner-checklist]')`, 25000)
  await sleep(800)
  check('phone: no sideways scroll on the room (owner: checklist, invite, chat seats)', (await po.overflow()) === 0, String(await po.overflow()))
  check('phone: every control of the lane is at least 44px tall (owner)', (await po.smallTargets()) === '', await po.smallTargets())
  await po.shot('room-owner-375-dark')
  await po.ev(`document.querySelector('[data-room-side]').scrollIntoView({ block: 'start' })`)
  await po.shot('room-owner-side-375-dark')

  // ── 6. /g/new ─────────────────────────────────────────────────────────
  const n = await tab(await newPerson())
  await n.go('/g/new')
  await n.until(`document.querySelector('[data-new-room] [data-new-door], [data-new-room] [data-new-submit]')`)
  await sleep(3200)
  check('/g/new keeps a stranger on the form (a door, not a wall)', (await n.ev(`location.pathname`)) === '/g/new' && (await n.ev(`!!document.querySelector('[data-new-door]')`)) === true, await n.ev(`location.pathname`))
  const uiSlug = `t-group-ui-${rand()}`
  await n.type('[data-field="name"]', 'Perps & Funding Desk')
  const suggested = await n.ev(`document.querySelector('[data-field="slug"]').value`)
  check('a name suggests its address live', suggested === 'perps-and-funding-desk', suggested)
  await n.type('[data-field="slug"]', uiSlug)
  await n.type('[data-field="about"]', 'Funding, basis and the perps that are moving. Trades come with proof.')
  await n.type('[data-field="symbols"]', 'hype, $eth btc')
  const free = await n.until(`document.querySelector('[data-slug-state="free"]')?.textContent`, 8000)
  check('a free address says so (asked of the room\'s own public read)', free === 'This address is free.', String(free ?? (await n.ev(`document.querySelector('[data-slug-state]')?.getAttribute('data-slug-state')`))))
  await n.type('[data-field="name"]', 'Renamed after the address was typed')
  check('once the address is typed by hand the name stops rewriting it', (await n.ev(`document.querySelector('[data-field="slug"]').value`)) === uiSlug)
  await n.type('[data-field="name"]', 'Perps and Funding Desk')
  await n.shot('new-stranger-1440-dark')
  await n.reload()
  await n.until(`document.querySelector('[data-field="name"]')?.value`)
  const kept = await n.ev(`[...document.querySelectorAll('[data-new-room] [data-field]')].map((el) => el.value).join(' | ')`)
  check('the draft survives a reload (the Google lane\'s round trip)', kept.startsWith(`Perps and Funding Desk | ${uiSlug} | Funding, basis`) && kept.endsWith('hype, $eth btc'), kept)
  await n.type('[data-field="slug"]', slug)
  const taken = await n.until(`document.querySelector('[data-slug-state="taken"]')?.textContent`, 8000)
  check('a taken address says so before the send', /taken/.test(taken ?? ''), String(taken))
  const pn = await tab(await newPerson(), { w: 375, h: 812 })
  await pn.go('/g/new')
  await pn.until(`document.querySelector('[data-new-room] [data-new-door]')`)
  await pn.type('[data-field="name"]', 'ETH swing traders')
  await sleep(700)
  check('phone: no sideways scroll on /g/new, 44px controls', (await pn.overflow()) === 0 && (await pn.smallTargets()) === '', `${await pn.overflow()} · ${await pn.smallTargets()}`)
  await pn.shot('new-stranger-375-dark')

  // …and an owner creates a room from the form and lands on it.
  const maker = privateKeyToAccount(generatePrivateKey())
  const makerSession = await signIn(maker)
  const c = await tab(await newPerson(), { session: makerSession, wallet: maker.address })
  await c.go('/g/new')
  await c.until(`document.querySelector('[data-new-room] [data-new-submit]')`, 25000)
  await c.type('[data-field="name"]', 'Perps and Funding Desk')
  await c.type('[data-field="slug"]', uiSlug)
  await c.type('[data-field="about"]', 'Funding, basis and the perps that are moving. Trades come with proof.')
  await c.type('[data-field="symbols"]', 'hype, $eth btc')
  await c.until(`document.querySelector('[data-slug-state="free"]')`, 8000)
  await c.shot('new-owner-1440-dark')
  await c.ev(`document.querySelector('[data-new-submit]').click()`)
  const landed = await c.until(`location.pathname === '/g/${uiSlug}' && document.querySelector('[data-owner-checklist]') ? location.pathname : null`, 25000)
  const fresh = await c.ev(`(() => ({ name: document.querySelector('.grp-head__name')?.textContent, state: document.querySelector('.grp-head [data-join-state]')?.getAttribute('data-join-state'), left: document.querySelector('.grp-check__left')?.textContent, chips: [...document.querySelectorAll('.grp-head .grp-chip')].map((a) => a.textContent).join(','), draft: sessionStorage.getItem('pantessa.community.draft') }))()`)
  check('Start the room creates it and lands on the new room, as its Owner, with the first-run checklist at 0 of 4', landed === `/g/${uiSlug}` && fresh.name === 'Perps and Funding Desk' && fresh.state === 'owner' && fresh.left === '0 of 4 done' && fresh.chips === 'HYPE,ETH,BTC' && fresh.draft === null, JSON.stringify(fresh))
  await c.shot('new-room-created-1440-dark')

  // ── 7. /g ─────────────────────────────────────────────────────────────
  const d = await tab(await newPerson())
  await d.go('/g')
  const dirState = await d.until(`document.querySelector('[data-community-directory="full"]:not([aria-busy])')?.getAttribute('data-directory-state') ?? (document.querySelector('[data-room-row]') ? 'rows' : null)`)
  check('/g renders the directory to a stranger (rows, or the honest empty state with "Start the first room")', dirState === 'rows' || (dirState === 'empty' && /Start the first room/.test(await d.ev(`document.querySelector('.grp-dir__empty')?.textContent ?? ''`))), String(dirState))
  await d.shot(`directory-${dirState === 'rows' ? 'live' : 'empty'}-1440-dark`)
  const FIXTURE = {
    communities: [
      { slug, name: NAME, about: 'Daily levels on ETH and the majors. Calls are stamped, trades are shown with proof.', symbols: ['ETH', 'BTC', 'HYPE', 'SOL'], members: 5, postsWeek: 14, channels: [{ platform: 'telegram', title: 'ETH swing chat' }], ownerLabel: '@swing', createdAt: Date.now() - 9 * 864e5 },
      { slug: 't-group-fx-perps', name: 'Perps and Funding Desk', about: 'Funding, basis and the perps that are moving.', symbols: ['HYPE', 'ETH', 'BTC'], members: 212, postsWeek: 41, channels: [{ platform: 'telegram', title: null }, { platform: 'discord', title: 'desk' }], ownerLabel: '@basis', createdAt: Date.now() - 30 * 864e5 },
      { slug: 't-group-fx-stocks', name: 'Tokenized stocks, after hours', about: 'AAPL, NVDA and TSLA on chain while the exchange is closed.', symbols: ['AAPL', 'NVDA', 'TSLA', 'AMD', 'SPY', 'QQQ', 'MSFT', 'GOOG'], members: 87, postsWeek: 9, channels: [], ownerLabel: '0x71c4…9e02', createdAt: Date.now() - 4 * 864e5 },
      { slug: 't-group-fx-quiet', name: 'Macro reads', about: '', symbols: [], members: 1, postsWeek: 0, channels: [], ownerLabel: '@tenyear', createdAt: Date.now() - 864e5 },
    ],
  }
  const listOnly = (u) => (u.pathname === '/api/communities' ? FIXTURE : null)
  const df = await tab(await newPerson())
  await df.fulfil('*/api/communities?*', listOnly)
  await df.go('/g')
  await df.until(`document.querySelectorAll('[data-room-row]').length === 4`)
  await df.shot('directory-fixture-1440-dark')
  const dfl = await tab(await newPerson(), { scheme: 'light' })
  await dfl.fulfil('*/api/communities?*', listOnly)
  await dfl.go('/g')
  await dfl.until(`document.querySelectorAll('[data-room-row]').length === 4`)
  await dfl.shot('directory-fixture-1440-light')
  const dp = await tab(strangerProfile, { w: 375, h: 812, session: guestSession, wallet: guest.address })
  await dp.fulfil('*/api/communities?*', listOnly)
  await dp.go('/g')
  await dp.until(`document.querySelectorAll('[data-room-row]').length === 4`)
  const rowState = await dp.until(`document.querySelector('[data-room-row="${slug}"] [data-join-state="member"]') ? 'member' : null`, 15000)
  check('the directory lights "Joined" on the room a member sits in, from the one identity read', rowState === 'member', String(await dp.ev(`document.querySelector('[data-room-row="${slug}"] [data-join-state]')?.getAttribute('data-join-state')`)))
  check('phone: no sideways scroll on /g, 44px controls', (await dp.overflow()) === 0 && (await dp.smallTargets()) === '', `${await dp.overflow()} · ${await dp.smallTargets()}`)
  await dp.shot('directory-fixture-375-dark')

  // ── the card ──────────────────────────────────────────────────────────
  const og = await fetch(`${BASE}/g/${slug}/opengraph-image`, { headers: HDR })
  fs.writeFileSync(path.join(SHOTS, 'group-og-card.png'), Buffer.from(await og.arrayBuffer()))
  check('the room card renders as a PNG', og.status === 200 && (og.headers.get('content-type') ?? '').includes('image/png'))

  for (const [where_, t] of [['stranger', s], ['owner', o], ['owner light', ol], ['phone stranger', ps], ['phone member', pm], ['phone owner', po], ['new', n], ['new phone', pn], ['create', c], ['directory', d], ['directory fixture', df], ['directory phone', dp]]) allErrors.push(...t.errors().map((e) => `[${where_}] ${String(e).split('\n')[0]}`))
  check('no page exception on any page of the drive', allErrors.length === 0, allErrors.slice(0, 4).join(' | '))
} catch (e) {
  check('the drive ran to the end', false, String(e?.stack ?? e))
} finally {
  try {
    const out = execFileSync('npx', ['tsx', 'scripts/community-group-pins.ts', '--cleanup'], { encoding: 'utf8' })
    console.log(out.trim().split('\n').pop())
  } catch (e) {
    console.log(`cleanup failed: ${String(e?.message ?? e).split('\n')[0]}`)
  }
  console.log(`\ngroup drive: ${pass} passed / ${fail} failed · shots in ${SHOTS}`)
  ws.close()
  chrome.kill('SIGKILL')
  await sleep(300)
  fs.rmSync(PROFILE, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}
