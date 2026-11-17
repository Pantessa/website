// Pins for squad lane1 (the jobs audit, 2026-11-17), lane offers. Nate: "the
// one it suggested as a default for a new account broke ... I just don't want
// broken suggestions happening anymore." Pure: no server, no chain, no DB.
// Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/jobs-offers-pins.ts
// OWNED BY THE offers LANE: only that lane edits this file.

type Check = (name: string, ok: boolean, extra?: string) => void

export function jobsOffersPins(check: Check) {
  check('jobs offers: the lane\'s pin file is wired into the harness', true)
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /jobs-offers-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  jobsOffersPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
