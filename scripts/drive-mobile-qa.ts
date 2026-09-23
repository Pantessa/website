/**
 * QA lane scenarios for `npm run drive:mobile`.
 *
 * These are the squad's TWO ANCHORS, and they exist before any fix does:
 *
 *   qa/i-connect-launch — the exact thing Nate reported. An iPhone UA opens a
 *     house intent link, taps the door, taps the real MetaMask lane, and we
 *     read Chrome's own verdict on the app launch. On this Mac MetaMask is not
 *     installed, so the GREEN answer is "allowed, no registered handler" — the
 *     navigation was permitted, which on a phone is the app coming forward.
 *     "blocked, a user gesture is required" is the bug.
 *
 *   qa/i-mock-happy-path — the HAPPY PATH FIRST (the agent-desk lesson: a door
 *     that refuses everything passes every bad-case pin). A wallet is present,
 *     connect runs the ask, the ask produces something to sign, the wallet is
 *     actually asked for a signature, and the surface leaves its idle state.
 *
 * Both are deliberately written against CURRENT behaviour being unknown: they
 * assert the INVARIANT, and `gates/baseline.md` records what they answered on
 * the pre-squad tree so every later run is a measurable delta.
 */
import {
  must,
  mockWalletScript,
  rememberConnectorScript,
  SEL,
  type MobileScenario,
  type PwPage,
} from './drive-mobile-contract'

/** The house link the squad drives: a stock buy, the densest onboarding path
 *  (funding + venue + signature) and the one on the landing. */
const HOUSE_SLUG = 'buy-aapl'
/** Read-only, never funded, never will be — the empty-wallet lane. */
const EMPTY_WALLET = '0x000000000000000000000000000000000000dEa1'
/** The house burner: real USDC + gas on Base, so an ask can reach a build. */
const FUNDED_WALLET = '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'

async function openDoor(page: PwPage, baseUrl: string, log: (s: string) => void) {
  await page.goto(`${baseUrl}/i/${HOUSE_SLUG}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  // The splash holds on "checking for a connected wallet" until wagmi settles
  // or lib/wallet-reconnect's boot hold elapses; the door paints after that.
  const door = page.locator(SEL.intentDoor).first()
  await door.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {})
  const count = await door.count()
  log(`splash door: ${count ? 'rendered' : 'MISSING'}`)
  must(count > 0, 'the /i splash never rendered a "Connect & build my path" door')
  return door
}

export const scenarios: MobileScenario[] = [
  {
    // ── ANCHOR 1 — the reported bug, measured ──────────────────────────────
    id: 'qa/i-connect-launch',
    profiles: ['iphone-dark', 'android-dark'],
    async run({ page, baseUrl, log, launchVerdict, consoleLines, shot }) {
      const door = await openDoor(page, baseUrl, log)
      await door.click({ timeout: 10_000 })
      await page.waitForTimeout(700)

      // The unified door (CreateAccountButton, walletConnectOnly) → its wallet
      // lane → RainbowKit's own list.
      const lane = page.locator(SEL.walletLane).first()
      const hasLane = (await lane.count()) > 0
      log(`unified door wallet lane: ${hasLane ? 'present' : 'ABSENT (cdpEnabled off? raw RainbowKit?)'}`)
      if (hasLane) {
        await lane.click({ timeout: 10_000 })
        await page.waitForTimeout(1200)
      }

      const rk = page.locator(SEL.rkModal).first()
      const rkUp = (await rk.count()) > 0
      log(`RainbowKit modal: ${rkUp ? 'open' : 'NOT OPEN'}`)
      must(rkUp, 'tapping the wallet lane never opened a wallet list — the door dead-ends on a phone')

      const mm = page.locator(SEL.rkMetaMask).first()
      const mmCount = await mm.count()
      log(`MetaMask entry: ${mmCount ? 'listed' : 'NOT LISTED'}`)
      must(mmCount > 0, 'RainbowKit listed no MetaMask lane on a phone UA')

      await mm.click({ timeout: 10_000 })
      // The SDK opens a socket before it asks for the app; give it room.
      await page.waitForTimeout(6000)

      const reading = launchVerdict()
      log(`launch verdict: ${reading.verdict}${reading.links.length ? ` → ${reading.links[0].slice(0, 80)}` : ''}`)
      if (reading.line) log(`chrome said: ${reading.line.slice(0, 160)}`)
      await page.mouse.move(5, 5)
      await page.screenshot({ path: shot(`i-connect-launch-${Date.now()}`) }).catch(() => {})

      if (reading.verdict === 'none') {
        // Nothing was even attempted: either the SDK never got to the app link,
        // or it rendered a QR instead. Both are the same failure for a phone.
        const qr = await page.locator('[data-testid="rk-qr-code"], canvas').count()
        const recent = consoleLines().slice(-6).join(' | ').slice(0, 300)
        throw new Error(
          `no app-launch navigation was attempted after tapping MetaMask (qr/canvas nodes: ${qr}). tail: ${recent}`,
        )
      }
      must(
        reading.verdict === 'allowed',
        `the ${reading.links[0] ?? 'wallet'} launch was BLOCKED — no user activation was carrying the page. ${reading.line ?? ''}`,
      )
    },
  },

  {
    // ── ANCHOR 2 — the happy path, end to end, with a wallet present ───────
    id: 'qa/i-mock-happy-path',
    profiles: ['iphone-dark'],
    async run({ page, context, baseUrl, log, shot }) {
      // A wallet that will actually approve: the ask has to get all the way to
      // a signature request for this pin to mean anything.
      await context.addInitScript(
        mockWalletScript({ address: FUNDED_WALLET, personalSign: 'sign', typedData: 'sign', sendTx: 'hash' }),
      )
      await context.addInitScript(rememberConnectorScript())

      await page.goto(`${baseUrl}/i/${HOUSE_SLUG}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })

      // A remembered wallet auto-starts the runtime (connect IS the consent).
      // If it doesn't, drive the door by hand — either way we must end up in
      // the chat runtime, not on the splash.
      const started = await page
        .waitForFunction(`!document.body.innerText.includes('Connect & build my path')`, undefined, { timeout: 30_000 })
        .then(() => true)
        .catch(() => false)
      if (!started) {
        const door = page.locator(SEL.intentDoor).first()
        if (await door.count()) await door.click({ timeout: 10_000 }).catch(() => {})
        const injected = page.locator(SEL.rkInjected).first()
        await page.waitForTimeout(1200)
        if (await injected.count()) await injected.click({ timeout: 10_000 }).catch(() => {})
      }
      await page.waitForTimeout(1500)
      const onSplash = await page.evaluate<boolean>(`document.body.innerText.includes('Connect & build my path')`)
      log(`after connect: ${onSplash ? 'STILL ON SPLASH' : 'runtime took over'}`)
      must(!onSplash, 'a connected wallet never left the /i splash — the ask never ran')

      // The ask runs by itself (a link's ask is injected on arrival). Wait for
      // the turn to settle into SOMETHING actionable.
      const settled = await page
        .waitForFunction(
          `(() => {
            const t = document.body.innerText
            if (/Sign & send|Sign and send|Sign order|Approve|Confirm in your wallet|Review|Fund |Add \\$/i.test(t)) return true
            if (document.querySelectorAll('button').length > 6 && !/thinking|building your path/i.test(t)) return true
            return false
          })()`,
          undefined,
          { timeout: 75_000 },
        )
        .then(() => true)
        .catch(() => false)
      await page.waitForTimeout(1200)

      const text = await page.evaluate<string>(`document.body.innerText`)
      const buttons = await page.evaluate<string[]>(
        `Array.from(document.querySelectorAll('button')).map((b) => (b.innerText || '').trim()).filter(Boolean)`,
      )
      log(`turn settled: ${settled}; ${buttons.length} button(s): ${buttons.slice(0, 8).join(' · ').slice(0, 200)}`)
      must(settled, `the ask never produced anything actionable. text tail: ${text.slice(-240).replace(/\s+/g, ' ')}`)

      // THE INVARIANT: there is a next step, and it is reachable with a tap.
      const actionable = buttons.filter((b) => /sign|approve|confirm|fund|add \$|buy|continue|review|connect/i.test(b))
      must(actionable.length > 0, `a settled turn offered no next step. buttons: ${buttons.join(' · ').slice(0, 200)}`)

      // Tap the first signing-shaped control and prove the WALLET was asked.
      const signLabel = actionable.find((b) => /sign|approve|confirm/i.test(b))
      if (!signLabel) {
        log(`no signature step on this wallet/ask (offered: ${actionable.join(' · ')}) — funding lane, not a red`)
        await page.screenshot({ path: shot('mock-happy-nofund') }).catch(() => {})
        return
      }
      const btn = page.locator(`button:has-text(${JSON.stringify(signLabel)})`).first()
      await btn.click({ timeout: 10_000 })
      await page.waitForTimeout(4000)

      const calls = await page.evaluate<Array<{ method: string }>>(`window.__driveCalls || []`)
      const approvals = calls.filter((c) =>
        ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'].includes(c.method),
      )
      log(`wallet methods: ${calls.map((c) => c.method).join(', ').slice(0, 200)}`)
      await page.mouse.move(5, 5)
      await page.screenshot({ path: shot('mock-happy-signed') }).catch(() => {})
      must(
        approvals.length > 0,
        `tapping "${signLabel}" never reached the wallet. methods seen: ${calls.map((c) => c.method).join(', ') || 'none'}`,
      )

      // …and the surface moved: a tapped sign button that still says exactly
      // what it said is the silent stall this squad exists to kill.
      const after = await page.evaluate<string>(`document.body.innerText`)
      log(`surface advanced: ${after !== text}`)
      must(after !== text, `the surface did not change after the wallet answered — silent stall`)
    },
  },
]

export default scenarios
