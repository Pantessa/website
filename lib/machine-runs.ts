// The landing machine's scripts — four real house asks, each broken into the
// stages the runtime actually walks (read → scan → plan → build → guard →
// sign → settle/arm/schedule). Pure data so the harness can pin the shape and
// so the copy stays honest: every line here mirrors something a real turn
// prints (guard names come from lib/tx-guardrails, the LiFi diamond is the
// pinned one, the Guardian cadence is the real per-minute cron). NOT a video
// script — the endings differ on purpose: a buy ends in a receipt, a stop
// ends ARMED, a DCA ends SCHEDULED. That difference IS the product.
//
// Slugs match lib/house-links so the "open the real link" CTA lands on the
// seeded /i/<slug> page that runs this exact ask for real.

export type StageTone = 'read' | 'scan' | 'plan' | 'build' | 'guard' | 'sign' | 'settle'

export interface MachineStage {
  /** Rail label — short, mono, uppercase. */
  key: string
  /** One sentence: what the system just did, in product voice. */
  head: string
  /** Artifact lines — the mono receipt of that stage. `>` prefix reads as
   *  emitted output; a leading `!` marks a refusal-shaped line (amber). */
  lines: string[]
  tone: StageTone
  /** Dwell in ms before the next stage starts. */
  ms: number
}

/** The route the run draws, node by node, as the stages land. Two nodes is
 *  the honest shape for every one of these asks: money is somewhere, and it
 *  needs to be somewhere else before the ask can settle. */
export interface MachineGraph {
  from: { name: string; sub: string; mark?: string }
  to: { name: string; sub: string; mark?: string }
  /** Legs drawn between them — dashed at PLAN, solid at BUILD, walked at SIGN. */
  legs: { label: string }[]
  /** What gets stamped at the destination when the run ends. */
  terminal: string
}

export interface MachineRun {
  slug: string
  /** The ask, verbatim — same string the seeded house link carries. */
  ask: string
  /** Short tab label. */
  tab: string
  /** What makes this run worth watching, one line, shown under the tabs. */
  premise: string
  /** Mark keys (protocol-marks registry) for the venue stack. */
  marks: string[]
  /** Words in `ask` the READ stage lifts out as parsed pills. */
  pills: { t: string; k: string }[]
  graph: MachineGraph
  stages: MachineStage[]
  /** How the run ends, in three words — stamped on the final card. */
  outcome: string
}

export const MACHINE_RUNS: MachineRun[] = [
  {
    slug: 'buy-aapl',
    ask: 'Buy $10 of AAPL',
    tab: 'Buy a stock',
    premise: 'An empty wallet on the wrong chain. The ask still lands.',
    marks: ['robinhood-free', 'near-intents-mcp-yeetful'],
    pills: [
      { t: 'buy', k: 'action' },
      { t: '$10', k: 'notional' },
      { t: 'AAPL', k: 'asset' },
    ],
    graph: {
      from: { name: 'Base', sub: '$9.77 USDC', mark: 'base' },
      to: { name: 'Robinhood Chain', sub: '0 USDG', mark: 'robinhood-free' },
      legs: [{ label: '$1.50 → gas ETH' }, { label: '$9.00 → USDG' }],
      terminal: '0.0231 AAPL',
    },
    stages: [
      {
        key: 'READ',
        tone: 'read',
        ms: 1500,
        head: 'The sentence becomes a spec — no model writes calldata here.',
        lines: [
          '> action  buy',
          '> spend   $10.00 (dollar-denominated)',
          '> asset   AAPL → tokenized equity, Robinhood Chain (4663)',
          '> settle  USDG · 6 decimals',
        ],
      },
      {
        key: 'SCAN',
        tone: 'scan',
        ms: 2100,
        head: 'It looks at what you actually hold — everywhere — before it answers.',
        lines: [
          '> base       $9.77 USDC   · gas 0.0009 ETH',
          '> arbitrum   $0.00        · gas 0.0000 ETH',
          '> ethereum   $0.00        · gas 0.0000 ETH',
          '> chain 4663 0 USDG       · gas 0.0000 ETH',
          '! short $10.00 USDG and gas on 4663',
        ],
      },
      {
        key: 'PLAN',
        tone: 'plan',
        ms: 2000,
        head: '“Insufficient funds” isn’t an answer. It’s a to-do list.',
        lines: [
          '> 1  bridge $1.50 Base USDC → gas ETH on 4663',
          '> 2  bridge $9.00 Base USDC → USDG on 4663',
          '> 3  buy ~$8.60 of AAPL once it settles',
          '> compiled as ONE job · you sign each step',
        ],
      },
      {
        key: 'BUILD',
        tone: 'build',
        ms: 1900,
        head: 'Deterministic builders. Pinned contracts. Never freehand.',
        lines: [
          '> venue    LiFi diamond 0x1231…4EaE (canonical, pinned)',
          '> approve  exact amount · no unlimited allowance',
          '> calldata 0x3a2b1f…c04a  (re-decoded by an independent guard)',
          '> quote    valid 42s · refresh recipe attached',
        ],
      },
      {
        key: 'GUARD',
        tone: 'guard',
        ms: 2200,
        head: 'Every check fails closed. A build that can’t prove itself never reaches your wallet.',
        lines: [
          '✓ recipient is the pinned settlement contract',
          '✓ amount matches the quote, to the wei',
          '✓ selector on the allowlist for this venue',
          '✓ fill price within 0.4% of our own on-chain quote',
          '✓ under your $200/day cap · kill switch clear',
          '✓ dry-run reverts nothing',
        ],
      },
      {
        key: 'SIGN',
        tone: 'sign',
        ms: 1700,
        head: 'Your wallet pops. Yeetful holds no keys — it never has.',
        lines: [
          '> step 1/3  signed 0x7d1a…88bc',
          '> step 2/3  signed 0x44e0…19af · arrived in 14s',
          '> step 3/3  re-quoted at sign time, then signed',
        ],
      },
      {
        key: 'SETTLE',
        tone: 'settle',
        ms: 2600,
        head: 'A receipt, not a status page.',
        lines: [
          '✓ 0.0231 AAPL settled on Robinhood Chain',
          '> tx 0x8c1d…9a2f ↗  · public activity feed',
          '> fee 0.20% · half of it claimable by the link’s creator',
        ],
      },
    ],
    outcome: 'Stock bought',
  },
  {
    slug: 'protected-long',
    ask: 'I want a 2X Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop',
    tab: 'Open & protect',
    premise: 'Two intents in one sentence. The second one never sleeps.',
    marks: ['hyperliquid-free', 'near-intents-mcp-yeetful'],
    pills: [
      { t: '2X', k: 'leverage' },
      { t: 'Long', k: 'side' },
      { t: '$12', k: 'notional' },
      { t: 'HYPE', k: 'asset' },
      { t: '5% stop', k: 'protection' },
    ],
    graph: {
      from: { name: 'Base', sub: '$18.40 USDC', mark: 'base' },
      to: { name: 'Hyperliquid', sub: '$0.00 margin', mark: 'hyperliquid-free' },
      legs: [{ label: '$6.20 deposit' }, { label: '2x long + stop' }],
      terminal: 'Guardian armed',
    },
    stages: [
      {
        key: 'READ',
        tone: 'read',
        ms: 1600,
        head: 'One sentence, two jobs: a position to open and a promise to keep.',
        lines: [
          '> side      long · leverage 2x cross',
          '> notional  $12.00 → collateral $6.00',
          '> asset     HYPE perp · Hyperliquid',
          '> standing  stop-loss at −5% from fill',
        ],
      },
      {
        key: 'SCAN',
        tone: 'scan',
        ms: 2000,
        head: 'The account is empty. That’s onboarding, not an error.',
        lines: [
          '> hyperliquid  $0.00 margin available',
          '> base         $18.40 USDC · gas ok',
          '> leverage      currently 10x cross — would have run your "2X" at 10x',
          '! deposit leg prepended · leverage set explicitly first',
        ],
      },
      {
        key: 'BUILD',
        tone: 'build',
        ms: 2000,
        head: 'Leverage is a transaction, not a caption.',
        lines: [
          '> pre   updateLeverage(HYPE, 2, cross) · asset-pinned',
          '> 1/2   deposit $6.20 → Hyperliquid (bridge + settle)',
          '> 2/2   order  long 2x $12 HYPE · IOC',
          '> maxLeverage checked live — fails closed above venue cap',
        ],
      },
      {
        key: 'GUARD',
        tone: 'guard',
        ms: 2100,
        head: 'Guardrails re-fire per step, on fresh state.',
        lines: [
          '✓ deposit address is the tool’s one-time address, byte-for-byte',
          '✓ order size matches the parsed notional / leverage',
          '✓ delegated agent key scoped to this account only',
          '✓ key is revocable by you, instantly, from the dashboard',
          '✓ under caps · kill switch clear',
        ],
      },
      {
        key: 'SIGN',
        tone: 'sign',
        ms: 1600,
        head: 'Two clicks: set the leverage, then take the position.',
        lines: [
          '> 1/2  leverage set · 0x2f80…4c11',
          '> 2/2  filled  $12.02 long HYPE @ 2x',
        ],
      },
      {
        key: 'ARMED',
        tone: 'settle',
        ms: 3000,
        head: 'And then it keeps working — with nobody at the keyboard.',
        lines: [
          '✓ Guardian ARMED · stop at −5% ($34.71)',
          '> checked every minute by cron · fail-closed guard',
          '> fired 2026-07-14 on a real ETH stop: filled, $11.93, 10/10 checks',
          '> revoke the key any time · Yeetful never custodies',
        ],
      },
    ],
    outcome: 'Position protected',
  },
  {
    slug: 'dca-eth',
    ask: 'DCA $25 into ETH weekly',
    tab: 'Recurring buy',
    premise: 'No bot to host. No hot key to leak. Just a sentence with a calendar.',
    marks: ['uniswap', 'near-intents-mcp-yeetful'],
    pills: [
      { t: '$25', k: 'size' },
      { t: 'ETH', k: 'asset' },
      { t: 'weekly', k: 'cadence' },
    ],
    graph: {
      from: { name: 'Your wallet', sub: '$25 stable / week', mark: 'yeetful' },
      to: { name: 'Uniswap v3', sub: 'quoted at fire time', mark: 'uniswap' },
      legs: [{ label: 'one job per period' }],
      terminal: 'ETH, every week',
    },
    stages: [
      {
        key: 'READ',
        tone: 'read',
        ms: 1500,
        head: 'The cadence gate fires before the swap gate — a recurring buy must never become a one-shot.',
        lines: [
          '> cadence  weekly · UTC calendar periods',
          '> size     $25.00 per period',
          '> buy      ETH · sell the chain stable',
          '> venue    Uniswap v3, quoted fresh each period',
        ],
      },
      {
        key: 'PLAN',
        tone: 'plan',
        ms: 1900,
        head: 'A schedule, not a standing approval.',
        lines: [
          '> schedule created · next fire Mon 00:00 UTC',
          '> each period compiles ONE native-swap job',
          '> run claim is unique per period — no double buys, ever',
          '> a missed week lapses; it never back-fills a surprise',
        ],
      },
      {
        key: 'BUILD',
        tone: 'build',
        ms: 1800,
        head: 'Nothing runs on stale math.',
        lines: [
          '> quote taken at FIRE time, not at setup time',
          '> QuoterV2 scan → SwapRouter02 multicall',
          '> deadline-bearing calldata ships with a refresh recipe',
          '> dead calldata is never offered — the card re-quotes itself',
        ],
      },
      {
        key: 'GUARD',
        tone: 'guard',
        ms: 1900,
        head: 'The same gate every other build walks through.',
        lines: [
          '✓ router + selector pinned for this chain',
          '✓ min-out re-derived from a live quote',
          '✓ spend policy re-checked at fire time, not at setup',
          '✓ pause / resume / cancel from chat or the rail',
        ],
      },
      {
        key: 'SCHEDULED',
        tone: 'settle',
        ms: 2800,
        head: 'It waits. You get a signature request on the day.',
        lines: [
          '✓ DCA active · $25 → ETH, weekly',
          '> or arm it once with a Spend Permission and it runs itself',
          '> every fill receipted with its tx hash, in your ledger',
        ],
      },
    ],
    outcome: 'Schedule armed',
  },
  {
    slug: 'bridge-usdc',
    ask: 'Swap 5 USDC from Base to Arbitrum',
    tab: 'Cross-chain',
    premise: 'The address a model invents is the one that steals your money.',
    marks: ['near-intents-mcp-yeetful'],
    pills: [
      { t: '5 USDC', k: 'amount' },
      { t: 'Base', k: 'from' },
      { t: 'Arbitrum', k: 'to' },
    ],
    graph: {
      from: { name: 'Base', sub: '5.00 USDC', mark: 'base' },
      to: { name: 'Arbitrum', sub: '0.00 USDC', mark: 'arbitrum' },
      legs: [{ label: 'NEAR Intents · 1Click' }],
      terminal: '4.994 USDC',
    },
    stages: [
      {
        key: 'READ',
        tone: 'read',
        ms: 1400,
        head: 'from → to is its own grammar. It never half-matches a send.',
        lines: [
          '> amount  5.00 USDC',
          '> origin  Base (8453)',
          '> target  Arbitrum (42161)',
          '> venue   NEAR Intents · 1Click',
        ],
      },
      {
        key: 'BUILD',
        tone: 'build',
        ms: 1900,
        head: 'The venue’s own tool returns the deposit address. We call it directly.',
        lines: [
          '> quote     5.000000 USDC → 4.994 USDC',
          '> deposit   0x9d3c…71b2  (one-time, issued by the venue)',
          '> the planner never sees this address — it cannot invent one',
        ],
      },
      {
        key: 'GUARD',
        tone: 'guard',
        ms: 2200,
        head: 'This guard exists because of a live near-miss. It fails closed.',
        lines: [
          '✓ transfer target === the tool’s one-time deposit address',
          '✓ amount moves EXACTLY the quoted amount — not a wei more',
          '✓ token contract is canonical USDC on Base',
          '✓ no unlimited approval anywhere in the path',
          '! any mismatch → refuse and say why. No signature burned.',
        ],
      },
      {
        key: 'SIGN',
        tone: 'sign',
        ms: 1600,
        head: 'One signature. Yours.',
        lines: ['> signed 0x51ce…7d38 · Base', '> watching 1Click for settlement…'],
      },
      {
        key: 'SETTLE',
        tone: 'settle',
        ms: 2500,
        head: 'Landed — and the agent knows it landed.',
        lines: [
          '✓ 4.994 USDC on Arbitrum · 38s',
          '> tx 0xa77b…2e10 ↗',
          '> in-flight money is counted: ask again mid-settlement and it says so',
        ],
      },
    ],
    outcome: 'Money moved',
  },
]

/** Total scripted runtime of a run, ms — used by the progress bar. */
export function runDuration(run: MachineRun): number {
  return run.stages.reduce((n, s) => n + s.ms, 0)
}
