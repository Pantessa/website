// Pins for the apps page's "earn" lane (squad apps-page, 2026-11-17). The
// lane that owns this file adds its checks inside the function below; the
// harness already calls it (scripts/test-api.ts), so no lane edits the
// harness. Pure where possible: no server, no chain, no DB.
// Runnable alone:  npx tsx scripts/apps-earn-pins.ts

type Check = (name: string, ok: boolean, extra?: string) => void

export function appsEarnPins(check: Check) {
  // (the lane's checks go here)
  void check
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /apps-earn-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  appsEarnPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
