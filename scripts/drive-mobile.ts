#!/usr/bin/env tsx
/**
 * `npm run drive:mobile` — the mobile-onboarding squad's browser gate.
 *
 * ONE Playwright + installed-Chrome session, one context per (scenario ×
 * profile), every lane's scenarios in one run, one verdict line each, non-zero
 * exit on any red. The scenario shape lives in `scripts/drive-mobile-contract.ts`
 * (read it first); this file is only the runner.
 *
 * Lane scenario files are OPTIONAL: a lane that has not landed its file yet is
 * reported SKIPPED, never a crash — the runner must be green-able on the
 * integration tree at every moment of the squad.
 *
 * Usage:
 *   BASE=http://localhost:3874 npm run drive:mobile
 *   BASE=… npm run drive:mobile -- --only=connect
 *   BASE=… npm run drive:mobile -- --profile=iphone-light
 *   BASE=… npm run drive:mobile -- --lanes=qa,connect --headed
 *
 * Read-only. Every same-origin request wears `x-yf-internal-run: 1` (so no
 * money row, referral or creator earning is ever minted by a drive) and
 * `x-yf-no-ask-log: 1` (so a drive never fills /dashboard/failures).
 */
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  ALL_PROFILES,
  DEFAULT_PROFILES,
  PROFILES,
  readLaunch,
  type DriveCtx,
  type MobileScenario,
  type ProfileId,
  type PwBrowser,
  type PwChromium,
  type PwContext,
  type PwPage,
} from './drive-mobile-contract'

const BASE = process.env.BASE ?? 'http://localhost:3874'
const ARGS = process.argv.slice(2)
const arg = (name: string) => ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''
const ONLY = arg('only')
const HEADED = ARGS.includes('--headed')
const PROFILE_FILTER = arg('profile')
const LANE_FILTER = arg('lanes')
const SCENARIO_TIMEOUT_MS = Number(arg('timeout') || 120_000)

/** Lane order = the order the squad reads them in. */
const LANES = ['qa', 'connect', 'sign', 'links', 'ux'] as const

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = '/Users/nategeier/yeetful/squad-mobile-2026-09-23/gates/shots'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

type Verdict = { id: string; profile: ProfileId | '-'; state: 'pass' | 'fail' | 'skip'; ms: number; detail: string }

async function loadLane(lane: string): Promise<{ scenarios: MobileScenario[]; missing: boolean; error?: string }> {
  const file = join(HERE, `drive-mobile-${lane}.ts`)
  if (!existsSync(file)) return { scenarios: [], missing: true }
  try {
    const mod = (await import(pathToFileURL(file).href)) as { scenarios?: unknown; default?: unknown }
    const list = (mod.scenarios ?? mod.default) as MobileScenario[] | undefined
    if (!Array.isArray(list)) {
      return { scenarios: [], missing: false, error: `exports no \`scenarios\` array` }
    }
    return { scenarios: list, missing: false }
  } catch (e) {
    return { scenarios: [], missing: false, error: (e as Error).message.split('\n')[0].slice(0, 160) }
  }
}

async function main() {
  const require_ = createRequire('/Users/nategeier/anchor.js')
  const { chromium } = require_('playwright-core') as { chromium: PwChromium }

  // Fail fast and clearly if the server under test is not up: a runner that
  // reports 20 identical reds teaches nothing.
  const probe = await fetch(`${BASE}/api/health`, { headers: { 'x-yf-internal-run': '1' } }).catch(() => null)
  const root = probe ? null : await fetch(BASE).catch(() => null)
  if (!probe && !root) {
    console.error(`\n  drive:mobile — nothing is serving ${BASE}.`)
    console.error(`  Start it:  MK2_AI_MOCK=1 MARKETS_AI_IP_HOURLY_CAP=3 TASTE_GUEST_DAILY=1 npx next start -p 3874\n`)
    process.exit(2)
  }

  const lanes = (LANE_FILTER ? LANE_FILTER.split(',') : [...LANES]).map((l) => l.trim()).filter(Boolean)
  const loaded: Array<{ lane: string; scenarios: MobileScenario[]; missing: boolean; error?: string }> = []
  for (const lane of lanes) loaded.push({ lane, ...(await loadLane(lane)) })

  console.log(`\n  drive:mobile — ${BASE}`)
  for (const l of loaded) {
    const what = l.missing
      ? 'SKIPPED (no scenario file yet)'
      : l.error
        ? `SKIPPED (${l.error})`
        : `${l.scenarios.length} scenario(s)`
    console.log(`   ${l.missing || l.error ? '⏭ ' : '· '}${l.lane.padEnd(8)} ${what}`)
  }

  const browser: PwBrowser = await chromium.launch({
    channel: 'chrome',
    executablePath: existsSync(CHROME) ? CHROME : undefined,
    headless: !HEADED,
  })

  const verdicts: Verdict[] = []
  const seen = new Set<string>()

  for (const l of loaded) {
    for (const scenario of l.scenarios) {
      if (!scenario.id.startsWith(`${l.lane}/`)) {
        verdicts.push({ id: scenario.id, profile: '-', state: 'fail', ms: 0, detail: `id must start with "${l.lane}/"` })
        continue
      }
      if (seen.has(scenario.id)) {
        verdicts.push({ id: scenario.id, profile: '-', state: 'fail', ms: 0, detail: 'duplicate scenario id' })
        continue
      }
      seen.add(scenario.id)
      if (ONLY && !scenario.id.includes(ONLY)) continue
      if (scenario.skip) {
        verdicts.push({ id: scenario.id, profile: '-', state: 'skip', ms: 0, detail: scenario.skip })
        console.log(`  ⏭  ${scenario.id} — ${scenario.skip}`)
        continue
      }

      let profiles = scenario.profiles?.length ? scenario.profiles : DEFAULT_PROFILES
      const bad = profiles.filter((p) => !ALL_PROFILES.includes(p))
      if (bad.length) {
        verdicts.push({ id: scenario.id, profile: '-', state: 'fail', ms: 0, detail: `unknown profile(s): ${bad.join(',')}` })
        console.log(`  ❌ ${scenario.id} — unknown profile(s): ${bad.join(',')}`)
        continue
      }
      if (PROFILE_FILTER) profiles = profiles.filter((p) => p === PROFILE_FILTER)
      if (!profiles.length) continue

      for (const profileId of profiles) {
        const profile = PROFILES[profileId]
        const started = Date.now()
        const notes: string[] = []
        const consoleLines: string[] = []
        const pageErrors: string[] = []
        let ctx: PwContext | null = null
        try {
          ctx = await browser.newContext({
            viewport: profile.viewport,
            userAgent: profile.userAgent,
            deviceScaleFactor: profile.deviceScaleFactor,
            colorScheme: profile.colorScheme,
            isMobile: true,
            hasTouch: true,
            extraHTTPHeaders: { 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' },
          })
          const page: PwPage = await ctx.newPage()
          page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`))
          page.on('pageerror', (e) => pageErrors.push(String(e)))

          const laneDir = join(SHOTS, scenario.id.split('/')[0])
          mkdirSync(laneDir, { recursive: true })

          const driveCtx: DriveCtx = {
            page,
            context: ctx,
            baseUrl: BASE,
            profile,
            log: (line) => notes.push(line),
            consoleLines: () => [...consoleLines],
            pageErrors: () => [...pageErrors],
            launchVerdict: () => readLaunch(consoleLines),
            comeBackFromApp: async (hiddenMs = 800) => {
              // The phone's round trip: the page is backgrounded while the
              // wallet app is in front, then foregrounded when the visitor
              // returns. Both halves fire the events the app listens for.
              await page.evaluate(`(() => {
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
                document.dispatchEvent(new Event('visibilitychange'))
                window.dispatchEvent(new Event('pagehide'))
                window.dispatchEvent(new Event('blur'))
              })()`)
              await page.waitForTimeout(hiddenMs)
              await page.evaluate(`(() => {
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
                Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
                document.dispatchEvent(new Event('visibilitychange'))
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
                window.dispatchEvent(new Event('focus'))
              })()`)
              await page.waitForTimeout(250)
            },
            shot: (name) => join(laneDir, `${name}.png`),
          }

          await Promise.race([
            scenario.run(driveCtx),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS}ms`)), SCENARIO_TIMEOUT_MS),
            ),
          ])
          const ms = Date.now() - started
          verdicts.push({ id: scenario.id, profile: profileId, state: 'pass', ms, detail: '' })
          console.log(`  ✅ ${scenario.id} [${profileId}] ${ms}ms`)
        } catch (e) {
          const ms = Date.now() - started
          const detail = (e as Error)?.message?.split('\n')[0]?.slice(0, 220) ?? String(e)
          verdicts.push({ id: scenario.id, profile: profileId, state: 'fail', ms, detail })
          console.log(`  ❌ ${scenario.id} [${profileId}] ${ms}ms — ${detail}`)
        } finally {
          for (const n of notes) console.log(`       · ${n}`)
          await ctx?.close().catch(() => {})
        }
      }
    }
  }

  await browser.close().catch(() => {})

  const pass = verdicts.filter((v) => v.state === 'pass').length
  const fail = verdicts.filter((v) => v.state === 'fail')
  const skip = verdicts.filter((v) => v.state === 'skip').length
  console.log(`\n  ${pass} passed · ${fail.length} failed · ${skip} skipped`)
  if (fail.length) {
    console.log('  RED:')
    for (const f of fail) console.log(`   ❌ ${f.id} [${f.profile}] — ${f.detail}`)
  }
  console.log('')
  process.exit(fail.length ? 1 : 0)
}

main().catch((e) => {
  console.error('drive:mobile crashed:', e)
  process.exit(2)
})
