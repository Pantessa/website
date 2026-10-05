// GTM-ready squad, ONBOARD lane (2026-10-05): pure pins for the first-run
// rules. Run: npx tsx scripts/gtm-onboard-pins.ts
//
// No server, no database, no network. Each pin is a rule a stranger with no
// wallet (or an empty one) depends on.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sessionReadsAllowed } from '../lib/app-entry'
import { HOUSE_UNAVAILABLE_REPLY, PAGE_ERROR_COPY, leaksPlumbing, notAnswering, shownError } from '../lib/fetch-words'
import { GUEST_TRIAL_LIMIT, GUEST_WALL_COPY } from '../lib/guest-trial'
import { symbolStanding } from '../lib/markets'
import { symbolPageSeo } from '../lib/markets-seo'
import { quickActs } from '../lib/symbol-venues'
import { chartPairFor } from '../lib/charts'
import { parseRhFundingFollowUp } from '../lib/lifi-bridge'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : `  → ${detail}`}`)
}
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── Session-keyed polls wait for a session ──────────────────────────────────
check('polls: only an authed session reads jobs/schedules/protections', sessionReadsAllowed('authed') && !sessionReadsAllowed('guest') && !sessionReadsAllowed('loading'))
{
  const hook = code('lib/use-running-work.ts')
  const gate = hook.indexOf('sessionReadsAllowed(status)')
  const firstJobs = hook.indexOf("fetch('/api/jobs'")
  check('polls: the hook asks the rule before it fetches /api/jobs', gate > 0 && firstJobs > gate, `gate ${gate} fetch ${firstJobs}`)
  check('polls: a loading session fetches nothing', /if \(status === 'loading'\) return/.test(hook))
}

// ── Failure words ───────────────────────────────────────────────────────────
{
  const leaks = ['HTTP 500', 'posts 500', "Failed to execute 'json' on 'Response': Unexpected end of JSON input", 'Unexpected token < in JSON at position 0', 'Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']
  check('words: plumbing is recognized', leaks.every(leaksPlumbing), leaks.filter((l) => !leaksPlumbing(l)).join(' | '))
  const human = ['A list needs a name.', 'Sign in to set alerts.', 'That ticker is already on the list.', 'The tape is unavailable right now — try again in a minute.']
  check('words: sentences written for a person pass through', human.every((h) => !leaksPlumbing(h) && shownError(new Error(h), 'X') === h))
  check('words: a leaking error becomes the named fallback', leaks.every((l) => shownError(new Error(l), 'The ideas board') === notAnswering('The ideas board')))
  check('words: a non-Error becomes the named fallback', shownError(undefined, 'Alerts') === notAnswering('Alerts'))
  const all = [notAnswering('The news feed'), notAnswering('Alerts', 'Nothing was saved; try again in a moment.'), HOUSE_UNAVAILABLE_REPLY, GUEST_WALL_COPY]
  check('words: no fallback names a status code, an env var or the old brand', all.every((t) => !/\b[45]\d\d\b|[A-Z]{3,}_[A-Z_]{3,}|yeetful/i.test(t)), all.join(' | '))
  check('words: the house-unavailable reply keeps the visitor moving', /Nothing moved/.test(HOUSE_UNAVAILABLE_REPLY) && /Buy \$25 of ETH/.test(HOUSE_UNAVAILABLE_REPLY))
  // The surfaces a stranger reaches no longer print a bare status.
  const files = [
    'components/markets/community/CommunityTab.tsx',
    'components/markets/news/NewsTab.tsx',
    'components/markets/ai/AskChart.tsx',
    'components/markets/ai/AiBrief.tsx',
    'components/markets/ai/MorningTape.tsx',
    'components/markets/watchlist/useWatchlists.ts',
    'components/markets/watchlist/ImportModal.tsx',
    'components/markets/watchlist/FollowListButton.tsx',
    'components/markets/watchlist/AlertForm.tsx',
  ]
  const bare = files.filter((f) => /`(HTTP|[a-z]+) \$\{(r|res)\.status\}`/.test(code(f)) || /\(e as Error\)\.message\)|e\.message :/.test(code(f)))
  check('words: no public markets surface prints a status code or a raw exception', bare.length === 0, bare.join(', '))
  // The reads whose failure is PRINTED (the rest sit after an ok check in a fail-soft try).
  const printed = ['components/markets/community/CommunityTab.tsx', 'components/markets/watchlist/ImportModal.tsx', 'components/markets/watchlist/FollowListButton.tsx']
  const unsafe = printed.filter((f) => /await (r|res)\.json\(\)\)/.test(code(f)))
  check('words: a printed failure never comes from reading an empty body', unsafe.length === 0, unsafe.join(', '))
  const routes = ['app/api/billing/checkout/route.ts', 'app/api/billing/portal/route.ts', 'app/api/billing/ai-key/route.ts']
  const named = routes.filter((f) => /error: [`'"][^`'"]*[A-Z]{3,}_[A-Z_]{3,}/.test(code(f)) || /error: `Checkout failed: \$\{/.test(code(f)))
  check('words: billing errors name no env var and no raw provider message', named.length === 0, named.join(', '))
  check('words: the chat route answers with the reply constant', /return HOUSE_UNAVAILABLE_REPLY/.test(code('app/api/chat/route.ts')) && !/return 'house synthesis unavailable/.test(code('app/api/chat/route.ts')))
}

// ── A brief that ended on an error is not "JUST WRITTEN" ────────────────────
{
  const brief = code('components/markets/ai/AiBrief.tsx')
  check('brief: a stream that carried an error event ends in the error phase', /setPhase\(failed \? 'error' : 'done'\)/.test(brief))
  check('brief: the error line carries a Try again button', /mk-ai__retry/.test(brief))
}

// ── Guest trial: the sixth ask is never a dead button ───────────────────────
{
  const chat = code('components/ChatInterface.tsx')
  const at = chat.indexOf('guestTurnsUsed() >= GUEST_TRIAL_LIMIT')
  const block = chat.slice(at, at + 700)
  check('guest wall: a simple runtime raises the wall instead of returning silently', /if \(simple\) \{\s*setGuestWall\(true\)/.test(block) && /setInput\(raw\)/.test(block), block.slice(0, 120))
  check('guest wall: the wall offers the connect-only door', /data-guest-wall[\s\S]{0,400}walletConnectOnly/.test(chat))
  check('guest wall: the copy names the limit and the way on', GUEST_WALL_COPY.includes(String(GUEST_TRIAL_LIMIT)) && /Connect one/.test(GUEST_WALL_COPY))
}

// ── /t/<symbol> for a symbol nobody lists ───────────────────────────────────
{
  check('standing: charted symbols', ['AAPL', 'ETH', 'HYPE', 'weth'].every((s) => symbolStanding(s) === 'charted'))
  check('standing: a stable with no chart is listed, not unknown', chartPairFor('USDC') === null && symbolStanding('USDC') === 'listed' && symbolStanding('usdg') === 'listed')
  check('standing: a feedless Robinhood listing is listed', symbolStanding('CASHCAT') === 'listed')
  check('standing: a typo is unknown', ['NOTREAL', 'AAPLL', 'zzzz', ''].every((s) => symbolStanding(s) === 'unknown'))
  const seo = symbolPageSeo('NOTREAL')
  check('standing: an unknown symbol never promises a trade in its title or description', /not listed/i.test(seo.title) && !/still trade|tradable/i.test(seo.description), `${seo.title} | ${seo.description}`)
  const page = code('components/markets/shell/SymbolPage.tsx')
  const card = page.slice(page.indexOf('data-standing="unknown"'), page.indexOf('data-standing="unknown"') + 1200)
  check('standing: the unknown card links to search and offers no Buy chip', /href="\/markets"/.test(card) && !/Buy \{sym\}/.test(card.slice(0, card.indexOf(') : ('))))
}

// ── Chips name no chain id ──────────────────────────────────────────────────
{
  const labels = ['AAPL', 'TSLA', 'ETH', 'SOL', 'HYPE'].flatMap((s) => quickActs(s, chartPairFor(s)!).map((a) => a.label))
  check('chips: no quick-act label carries a chain id', labels.length > 0 && labels.every((l) => !/\b\d{4,5}\b/.test(l)), labels.join(' | '))
  const aapl = quickActs('AAPL', chartPairFor('AAPL')!)
  check('chips: the stock chip still sends the same ask', aapl[0]?.label === 'Buy $25' && aapl[0]?.ask === 'Buy $25 of AAPL', JSON.stringify(aapl[0]))
}

// ── The site has its own error page ─────────────────────────────────────────
{
  const page = code('app/error.tsx')
  const global = code('app/global-error.tsx')
  check('error page: both boundaries exist and are client components', /^'use client'/.test(src('app/error.tsx')) && /^'use client'/.test(src('app/global-error.tsx')))
  check('error page: retry plus a public way on', /reset\(\)/.test(page) && /href="\/markets"/.test(page) && /reset\(\)/.test(global) && /href="\/"/.test(global))
  check('error page: never prints the exception', !/error\.message|error\.stack/.test(page) && !/error\.message|error\.stack/.test(global))
  const words = Object.values(PAGE_ERROR_COPY).join(' ')
  check('error page: the copy says nothing ran and names no plumbing', /Nothing ran and nothing was signed/.test(words) && !leaksPlumbing(words) && !/yeetful/i.test(words))
  check('404: the not-found page offers the public markets', /href="\/markets"/.test(code('app/not-found.tsx')))
}

// ── An empty wallet's refusal always has something to press ─────────────────
{
  const route = code('app/api/chat/route.ts')
  check('funding refusal: the chip is the pending funding\'s own recheck verb', parseRhFundingFollowUp('check again')?.kind === 'recheck', JSON.stringify(parseRhFundingFollowUp('check again')))
  check('funding refusal: with no card door the reply still carries a recheck chip', /label: 'I added funds: check again', resume: 'check again'/.test(route))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
