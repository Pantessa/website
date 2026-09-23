/**
 * QA lane scenarios for `npm run drive:mobile`.
 *
 * These are the squad's ANCHORS, and they exist before any fix does. Happy
 * path FIRST (the agent-desk lesson: a door that refuses everything passes
 * every bad-case pin).
 *
 *   qa/i-connect-launch — the exact thing Nate reported. An iPhone UA opens a
 *     house intent link, taps the door, taps the real MetaMask lane, and we
 *     read Chrome's own verdict on the app launch. MetaMask is not installed
 *     on this Mac, so the GREEN answer is "allowed — no registered handler":
 *     the navigation was PERMITTED, which on a phone is the app coming
 *     forward. "blocked — a user gesture is required" is the bug.
 *
 *   qa/i-ask-runs — a wallet is present, the link's ask runs by itself, the
 *     turn settles into something actionable, and tapping that next step
 *     advances the surface. No dead button, no silent stall.
 *
 *   qa/siwe-round-trip — a real signature on a phone, across the round trip to
 *     the wallet app and back: connect → "Sign in with wallet" → the burner
 *     signs SIWE for real → the page comes back from the app → the session is
 *     live. This is "sign in to keep", and it is the cheapest deterministic
 *     proof that a signature survives the trip.
 *
 * `gates/baseline.md` records what these answered on the pre-squad tree, so
 * every later run is a measurable delta.
 */
import {
  burnerAddress,
  mockWalletScript,
  must,
  rememberConnectorScript,
  signSiweWithBurner,
  waitForAuth,
  waitForText,
  SEL,
  type DriveCtx,
  type MobileScenario,
  type PwPage,
} from './drive-mobile-contract'

/** The house link the squad drives: a stock buy — the densest onboarding path
 *  (funding + venue + signature) and the one on the landing. */
const HOUSE_SLUG = 'buy-aapl'

/** Chrome that belongs to the shell, not to the turn: never the "next step". */
const CHROME_LABEL = /^(sign in with wallet|wallet details|embed|share|copy|close|dismiss|0x[0-9a-f…]|menu|back)/i

async function labelsOf(page: PwPage): Promise<string[]> {
  return page.evaluate<string[]>(
    `Array.from(document.querySelectorAll('button')).map((b) => (b.innerText || '').trim())`,
  )
}

/** Index of the first control that is a real next step for the TURN. */
function pickAction(labels: string[]): number {
  return labels.findIndex(
    (l) =>
      l &&
      !CHROME_LABEL.test(l.split('\n')[0].trim()) &&
      /sign|approve|confirm|fund|add \$|buy|just enough|all my|continue|review|keep going/i.test(l),
  )
}

async function openLink(ctx: DriveCtx, slug = HOUSE_SLUG) {
  await ctx.page.goto(`${ctx.baseUrl}/i/${slug}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
}

export const scenarios: MobileScenario[] = [
  {
    // ── ANCHOR 1 — the reported bug, measured in Chrome's own words ────────
    id: 'qa/i-connect-launch',
    profiles: ['iphone-dark', 'android-dark'],
    async run(ctx) {
      const { page, log, launchVerdict, consoleLines, shot } = ctx
      await openLink(ctx)

      const door = page.locator(SEL.intentDoor).first()
      await door.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {})
      must((await door.count()) > 0, 'the /i splash never rendered a "Connect & build my path" door')
      log('splash door: rendered')
      await door.click({ timeout: 10_000 })
      await page.waitForTimeout(700)

      const lane = page.locator(SEL.walletLane).first()
      const hasLane = (await lane.count()) > 0
      log(`unified door wallet lane: ${hasLane ? 'present' : 'ABSENT (cdpEnabled off? raw RainbowKit?)'}`)
      if (hasLane) {
        await lane.click({ timeout: 10_000 })
        await page.waitForTimeout(1200)
      }

      const rkUp = (await page.locator(SEL.rkModal).first().count()) > 0
      log(`RainbowKit modal: ${rkUp ? 'open' : 'NOT OPEN'}`)
      must(rkUp, 'tapping the wallet lane never opened a wallet list — the door dead-ends on a phone')

      const mm = page.locator(SEL.rkMetaMask).first()
      must((await mm.count()) > 0, 'RainbowKit listed no MetaMask lane on a phone UA')
      log('MetaMask entry: listed')

      await mm.click({ timeout: 10_000 })
      // The SDK opens its socket before it asks for the app; give it room.
      await page.waitForTimeout(6000)

      const reading = launchVerdict()
      log(
        `launch verdict: ${reading.verdict} (blocked x${reading.blockedCount} / allowed x${reading.allowedCount}, ${reading.links.length} distinct link)`,
      )
      if (reading.blockedLine) log(`chrome: ${reading.blockedLine.slice(0, 130)}`)
      await page.mouse.move(2, 2)
      await page.screenshot({ path: shot(`i-connect-launch-${ctx.profile.id}`) }).catch(() => {})

      if (reading.verdict === 'none') {
        const qr = await page.locator('[data-testid="rk-qr-code"], canvas').count()
        throw new Error(
          `no app-launch navigation was attempted after tapping MetaMask (qr/canvas nodes: ${qr}). console tail: ${consoleLines().slice(-4).join(' | ').slice(0, 220)}`,
        )
      }
      must(
        reading.verdict === 'allowed',
        `the wallet app launch was BLOCKED — no user activation was carrying the page when the SDK asked for the app. Chrome: ${(reading.line ?? '').slice(0, 140)}`,
      )
    },
  },


  {
    // ── ANCHOR 1b — the SAFETY NET behind anchor 1 ─────────────────────────
    // #822's contract: ask for the app, WATCH, and when the launch was dropped
    // put a REAL BUTTON up within WALLET_APP_SETTLE_MS — a tap carries its own
    // activation. This pin exists so a CONNECT-lane fix can never quietly
    // remove the net while chasing the automatic launch, and so we know the
    // visitor is offered a way through TODAY.
    id: 'qa/i-connect-handoff-fallback',
    profiles: ['iphone-dark'],
    async run(ctx) {
      const { page, log, launchVerdict, shot } = ctx
      await openLink(ctx)
      const door = page.locator(SEL.intentDoor).first()
      await door.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {})
      must((await door.count()) > 0, 'the /i splash never rendered its door')
      await door.click({ timeout: 10_000 })
      await page.waitForTimeout(700)
      const lane = page.locator(SEL.walletLane).first()
      if (await lane.count()) {
        await lane.click({ timeout: 10_000 })
        await page.waitForTimeout(1200)
      }
      const mm = page.locator(SEL.rkMetaMask).first()
      must((await mm.count()) > 0, 'no MetaMask lane listed')
      await mm.click({ timeout: 10_000 })

      // WALLET_APP_SETTLE_MS is 1200ms; give the card a generous 4s.
      const carded = await waitForText(page, /Open MetaMask to continue/i, 4000)
      const before = launchVerdict()
      log(`before the card: blocked x${before.blockedCount} / allowed x${before.allowedCount}`)
      log(`handoff card within 4s: ${carded}`)
      await page.mouse.move(2, 2)
      await page.screenshot({ path: shot('i-connect-handoff-card') }).catch(() => {})
      must(
        carded,
        'the automatic launch was dropped AND no "Open MetaMask" card appeared — the visitor is stranded on a page that says nothing',
      )

      // The card must be reachable: above RainbowKit's z-index 2147483646 and
      // actually clickable, not painted behind the modal.
      const cta = page.locator('button:has-text("Open MetaMask")').first()
      must((await cta.count()) > 0, 'the card has no button')
      must(await cta.isEnabled(), 'the handoff button is disabled — the one control offered cannot be pressed')
      await cta.click({ timeout: 10_000 })
      await page.waitForTimeout(1500)

      const after = launchVerdict()
      log(`after tapping the card: blocked x${after.blockedCount} / allowed x${after.allowedCount}`)
      must(
        after.allowedCount > before.allowedCount,
        `tapping "Open MetaMask" produced no permitted launch (allowed stayed at ${before.allowedCount}) — the safety net is also dropped`,
      )
    },
  },

  {
    // ── ANCHOR 2 — a connected wallet gets a next step it can tap ──────────
    id: 'qa/i-ask-runs',
    profiles: ['iphone-dark'],
    async run(ctx) {
      const { page, context, log, shot } = ctx
      const addr = await burnerAddress()
      // A wallet that will actually approve — the ask has to be able to get
      // all the way to a signature for this pin to mean anything.
      await context.addInitScript(
        mockWalletScript({ address: addr, personalSign: 'sign', typedData: 'sign', sendTx: 'hash' }),
      )
      await context.addInitScript(rememberConnectorScript())
      await openLink(ctx)

      // A remembered wallet auto-starts the runtime (connect IS the consent).
      const left = await page
        .waitForFunction(`!document.body.innerText.includes('Connect & build my path')`, undefined, { timeout: 35_000 })
        .then(() => true)
        .catch(() => false)
      log(`after connect: ${left ? 'runtime took over' : 'STILL ON SPLASH'}`)
      must(left, 'a connected wallet never left the /i splash — the ask never ran')

      const settled = await page
        .waitForFunction(
          `(() => {
            const t = document.body.innerText
            if (/thinking|building your path/i.test(t)) return false
            return /Sign & send|Sign and send|Sign order|Approve|Just enough|All my|Add \\$|Fund /i.test(t)
              || document.querySelectorAll('button').length > 4
          })()`,
          undefined,
          { timeout: 80_000 },
        )
        .then(() => true)
        .catch(() => false)
      await page.waitForTimeout(1500)

      const labels = await labelsOf(page)
      const before = await page.evaluate<string>(`document.body.innerText`)
      log(`turn settled: ${settled}; controls: ${labels.filter(Boolean).map((l) => l.split('\n')[0]).join(' · ').slice(0, 180)}`)
      must(settled, `the ask never produced anything actionable. tail: ${before.slice(-200).replace(/\s+/g, ' ')}`)

      const i = pickAction(labels)
      await page.mouse.move(2, 2)
      await page.screenshot({ path: shot('i-ask-runs-settled') }).catch(() => {})
      must(
        i >= 0,
        `a settled turn offered no next step for the TURN (only shell chrome). controls: ${labels.filter(Boolean).join(' · ').slice(0, 200)}`,
      )
      log(`next step: "${labels[i].split('\n')[0]}"`)

      // Tapping it must DO something. A control that leaves the surface byte
      // identical is the dead button this squad exists to kill.
      await page.locator('button').nth(i).click({ timeout: 15_000 })
      await page.waitForTimeout(6000)
      const after = await page.evaluate<string>(`document.body.innerText`)
      const calls = await page.evaluate<Array<{ method: string }>>(`window.__driveCalls || []`)
      log(`wallet methods: ${calls.map((c) => c.method).join(', ').slice(0, 160) || 'none (pre-signature step)'}`)
      await page.screenshot({ path: shot('i-ask-runs-tapped') }).catch(() => {})
      must(after !== before, 'the next step was a DEAD BUTTON — the surface did not change after the tap')
    },
  },

  {
    // ── ANCHOR 3 — a real signature survives the trip to the app ───────────
    id: 'qa/siwe-round-trip',
    profiles: ['iphone-dark'],
    async run(ctx) {
      const { page, context, log, comeBackFromApp, shot } = ctx
      const addr = await burnerAddress()
      await context.exposeFunction('__driveSignSiwe', ((raw: string) => signSiweWithBurner(raw)) as never)
      // deferMs: the wallet answers a beat later, the way it does when the
      // phone has actually switched apps.
      await context.addInitScript(
        mockWalletScript({ address: addr, siweBridge: true, personalSign: 'reject', deferMs: 900 }),
      )
      await context.addInitScript(rememberConnectorScript())

      await page.goto(`${ctx.baseUrl}/markets`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForTimeout(4000)

      const signIn = page.locator('button:has-text("Sign in")').first()
      must((await signIn.count()) > 0, 'no "Sign in" control on /markets with a connected wallet')
      await signIn.click({ timeout: 10_000 })
      await page.waitForTimeout(600)

      // The unified door's wallet lane (present when cdpEnabled) or straight
      // through — either way a SIWE personal_sign must be asked for.
      const lane = page.locator(SEL.walletLane).first()
      if (await lane.count()) {
        await lane.click({ timeout: 10_000 })
        await page.waitForTimeout(800)
      }
      const injected = page.locator(SEL.rkInjected).first()
      if (await injected.count()) {
        await injected.click({ timeout: 10_000 })
      }

      // The phone leaves for the wallet and comes back mid-signature.
      await comeBackFromApp(900)
      await page.waitForTimeout(500)

      const session = await waitForAuth(page, 30_000)
      const calls = await page.evaluate<Array<{ method: string }>>(`window.__driveCalls || []`)
      const asked = calls.filter((c) => c.method === 'personal_sign').length
      log(`personal_sign asked: ${asked}; session after the round trip: ${session ?? 'none'}`)
      await page.mouse.move(2, 2)
      await page.screenshot({ path: shot('siwe-round-trip') }).catch(() => {})

      must(asked > 0, 'the sign-in door never asked the wallet to sign — the signature never left the page')
      must(
        session?.toLowerCase() === addr.toLowerCase(),
        `the wallet signed and the page came back from the app, but no session for ${addr} landed (server says ${session ?? 'none'}) — the round trip lost it`,
      )
    },
  },
]

export default scenarios
