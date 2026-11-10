// THE TOUR · AUTOPILOTS — the standing orders' own words (lane SIDES-B).
// Each sentence here is in a grammar the product parses TODAY; the pins
// (scripts/landing-sides-b-pins.ts) send every one through its parser:
//   • stopSentence  = lib/trade-asks composeAsk(perp, 'protect') verbatim,
//                     read by lib/hl-guardian parseGuardianArm;
//   • alertSentence = lib/watchlists alertLabel for a `pct_move` rule;
//   • JOB_STEPS     = the kinds lib/jobs compileJobAsk gives the job sentence
//                     in lib/home-tour/autopilots (sign, then auto).
// Pure and client-safe.

/** The alert on the panel: a move of this many percent, either way. */
export const ALERT_PCT = 5

/** "Protect my ETH long with a 5% stop" — the Hyperliquid guardian's arm sentence. */
export function stopSentence(symbol: string, pct: number): string {
  return `Protect my ${symbol} long with a ${pct}% stop`
}

/** "ETH moves 5% from $3,412.20" — an alert as the bell lists it. */
export function alertSentence(symbol: string, pct: number, from: string | null): string {
  return `${symbol} moves ${pct}%${from ? ` from ${from}` : ''}`
}

export interface JobStepWords {
  /** The runner's step kind (lib/jobs CompiledStep.kind). */
  kind: 'sign' | 'auto'
  what: string
  who: string
}

/** The two steps of the panel's job, in order, in plain words. */
export const JOB_STEPS: readonly JobStepWords[] = [
  { kind: 'sign', what: 'Open the long', who: 'your wallet signs' },
  { kind: 'auto', what: 'Arm the stop', who: 'runs on the fill' },
]
