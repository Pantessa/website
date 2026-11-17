// Pins for squad lane1 (the jobs audit, 2026-11-17), lane audit. Nate: "the
// one it suggested as a default for a new account broke ... I just don't want
// broken suggestions happening anymore." Pure: no server, no chain, no DB.
// Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/jobs-audit-pins.ts
// OWNED BY THE audit LANE: only that lane edits this file.
//
// What these hold: the drive's inventory (scripts/jobs-audit-drive.ts) stays
// in step with the job sentences the source offers, every inventoried
// sentence compiles as a job (or is a named non-job), and every segment
// parser in lib/jobs.ts has a sentence in the drive.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INVENTORY, PARSER_BUILDERS, auditAsksThenRows, driveList } from './jobs-audit-drive'
import { compileJobAsk, JOB_SEGMENT_PARSERS } from '../lib/jobs'
import { JOBS_DOOR } from '../lib/first-run'
import { HERO_REEL, VENUE_BAND } from '../lib/markets-copy'
import { HOUSE_LINKS } from '../lib/house-links'
import { STARTER_ASKS } from '../components/typed-asks'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = join(__dirname, '..')
const norm = (s: string) =>
  s
    .replace(/&ldquo;|&rdquo;|&quot;/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\.$/, '')
const isThen = (s: string) => /,\s*then\b/i.test(s)
const inInventory = (s: string) => INVENTORY.some((e) => norm(e.ask) === norm(s))

/** Sentences that are deliberately NOT a job, with the reason. Empty today:
 *  every sentence the drive runs compiles. Add one only with its reason. */
export const KNOWN_NON_JOBS: Record<string, string> = {}

export function jobsAuditPins(check: Check) {
  check('jobs audit: the lane\'s pin file is wired into the harness', true)

  // 1. Every hand-inventoried offered sentence still appears where it says.
  for (const e of INVENTORY.filter((x) => x.file)) {
    const text = norm(readFileSync(join(ROOT, e.file!), 'utf8'))
    check(`jobs audit: inventory "${e.id}" still offered in ${e.file}`, text.includes(norm(e.ask)), `missing: ${e.ask}`)
  }

  // 2. The exported source constants that offer a job are all in the inventory
  //    (a new default job sentence fails here until the drive covers it).
  const exported: Array<[string, string]> = [
    ['lib/first-run JOBS_DOOR.ask', JOBS_DOOR.ask],
    ['lib/markets-copy VENUE_BAND.compound', VENUE_BAND.compound],
    ...HERO_REEL.filter((b) => isThen(b.ask)).map((b): [string, string] => [`lib/markets-copy HERO_REEL ${b.symbol}`, b.ask]),
    ...HOUSE_LINKS.filter((l) => isThen(l.ask)).map((l): [string, string] => [`lib/house-links ${l.slug}`, l.ask]),
    ...STARTER_ASKS.filter(isThen).map((a): [string, string] => ['components/typed-asks STARTER_ASKS', a]),
  ]
  for (const [where, ask] of exported) check(`jobs audit: ${where} is in the drive's inventory`, inInventory(ask), ask)

  // 3. The drive reads the audit-asks corpus' "then" rows (sanity: the regex
  //    still matches the corpus' shape).
  const aa = auditAsksThenRows(ROOT)
  check('jobs audit: the drive reads scripts/audit-asks.ts "then" rows', aa.length >= 20, `found ${aa.length}`)

  // 4. Every sentence the drive runs compiles as a job, or is a named non-job.
  const list = driveList(ROOT)
  const builtBy = new Map<string, Set<string>>()
  for (const e of list) {
    const c = compileJobAsk(e.ask)
    const ok = !!c && !('problem' in c) && !('clarify' in c)
    const known = KNOWN_NON_JOBS[e.ask]
    const why = !c ? 'not job-shaped (null)' : 'problem' in c ? `problem: ${c.problem}` : 'clarify' in c ? `clarify: ${c.clarify.question}` : ''
    check(`jobs audit: "${e.id}" compiles as a job${known ? ' (known non-job)' : ''}`, ok || !!known, `${e.ask}\n     ${why}`)
    if (ok) builtBy.set(e.id, new Set(c.steps.map((s) => s.builder)))
  }

  // 5. Every segment parser has a builder map entry and a sentence that
  //    compiles to one of its builders.
  for (const p of JOB_SEGMENT_PARSERS) {
    const builders = PARSER_BUILDERS[p.id]
    check(`jobs audit: parser "${p.id}" has a builder entry in the drive`, !!builders, 'add it to PARSER_BUILDERS + one sentence to INVENTORY')
    if (!builders) continue
    const covered = [...builtBy.values()].some((set) => builders.some((b) => set.has(b)))
    check(`jobs audit: parser "${p.id}" is exercised by a drive sentence`, covered, builders.join(', '))
  }
  for (const e of INVENTORY.filter((x) => x.parsers)) {
    const set = builtBy.get(e.id)
    for (const p of e.parsers!) {
      check(`jobs audit: "${e.id}" emits a ${p} step`, !!set && (PARSER_BUILDERS[p] ?? []).some((b) => set.has(b)), [...(set ?? [])].join(', '))
    }
  }

  // 6. The order ticket's perp + stop template is still the shape the drive runs.
  const ticket = readFileSync(join(ROOT, 'lib/order-ticket.ts'), 'utf8')
  check('jobs audit: order ticket still composes "<open>, then protect my <SYM> <side> with a N% stop"', ticket.includes('`${open}, then protect my ${sym} ${st.side} with a ${st.stopPct}% stop`'))

  // 7. Inventory ids are unique.
  const ids = list.map((e) => e.id)
  check('jobs audit: drive ids are unique', new Set(ids).size === ids.length)
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /jobs-audit-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  jobsAuditPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
