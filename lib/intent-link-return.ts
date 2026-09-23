// lib/intent-link-return.ts — what /i/<slug> does when the visitor COMES BACK.
//
// OWNED BY THE LINKS LANE (mobile-onboarding squad, 2026-09-23). Measured on
// the unmodified tree with Playwright + Chrome at 375 (iPhone UA, a
// remembered wallet): a RELOAD of /i/bridge-usdc after the sign card was
// offered fired a second `POST /api/chat` and a second `open → connect →
// built`, and the thread holding the first card was gone (a guest thread
// lives in memory only). On a phone that reload is the normal way back from
// the wallet app — iOS evicts the background tab, in-app browsers reload on
// return — so a visitor who approved the deposit in MetaMask walked back
// into a FRESH sign card for the same swap. Sign that one too and the money
// moves twice. The creator's funnel counted them twice as well.
//
// The rule: the runtime remembers the run it offered this wallet, per link,
// for a short while. A return inside that window never auto-fires the ask
// again. It says what state the visitor left in, and the chips carry the
// two honest next steps — "it went through" (nothing to do) or "it didn't,
// build it again" (which SENDS; a chip sends, a URL never fires a turn).
// Everything here is pure and harness-pinned; the runtime only calls it.

export type LinkRunOutcome = 'started' | 'built' | 'signed'

export type LinkRun = {
  v: 1
  slug: string
  /** Lowercased wallet the run was offered to; null for a run that started
   *  before the address was known (never, in practice — kept honest). */
  wallet: string | null
  outcome: LinkRunOutcome
  /** ms epoch of the most recent state change. */
  at: number
  /** The receipt, when the run signed: the explorer URL the beacon carried. */
  txUrl?: string
  valueUsd?: number
}

/** A run older than this is a visit the person walked away from, not one
 *  they are still in. Long enough for a wallet round-trip on a slow phone
 *  (app store, a seed phrase, a bridge that takes minutes); short enough
 *  that tomorrow's tap on the same link is a new run. */
export const LINK_RUN_TTL_MS = 30 * 60 * 1000

export const LINK_RUN_VERSION = 1 as const

export function linkRunKey(slug: string): string {
  return `pantessa.ilink.run.${slug}`
}

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** The stored run for this link, or null (missing, malformed, wrong version,
 *  wrong slug, older than the TTL, or dated in the future by more than a
 *  minute — a clock skew we will not reason about). */
export function readLinkRun(storage: StorageLike | null | undefined, slug: string, now: number): LinkRun | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(linkRunKey(slug))
    if (!raw) return null
    const run = JSON.parse(raw) as Partial<LinkRun>
    if (run?.v !== LINK_RUN_VERSION || run.slug !== slug) return null
    if (run.outcome !== 'started' && run.outcome !== 'built' && run.outcome !== 'signed') return null
    if (typeof run.at !== 'number' || !Number.isFinite(run.at)) return null
    if (now - run.at > LINK_RUN_TTL_MS || run.at - now > 60_000) return null
    return {
      v: 1,
      slug,
      wallet: typeof run.wallet === 'string' ? run.wallet.toLowerCase() : null,
      outcome: run.outcome,
      at: run.at,
      ...(typeof run.txUrl === 'string' && /^https:\/\//.test(run.txUrl) ? { txUrl: run.txUrl } : {}),
      ...(typeof run.valueUsd === 'number' && Number.isFinite(run.valueUsd) ? { valueUsd: run.valueUsd } : {}),
    }
  } catch {
    return null
  }
}

/** Write (or overwrite) the run. Storage that throws is storage we don't
 *  have — the runtime then behaves as it always did. */
export function writeLinkRun(storage: StorageLike | null | undefined, run: Omit<LinkRun, 'v'>): void {
  if (!storage) return
  try {
    storage.setItem(linkRunKey(run.slug), JSON.stringify({ v: LINK_RUN_VERSION, ...run, wallet: run.wallet?.toLowerCase() ?? null }))
  } catch {
    /* no storage — nothing to remember with */
  }
}

export function clearLinkRun(storage: StorageLike | null | undefined, slug: string): void {
  try {
    storage?.removeItem(linkRunKey(slug))
  } catch {
    /* ignore */
  }
}

export type ReturnVerdict =
  /** Nothing to pick up: run the ask as usual. */
  | { kind: 'fresh' }
  /** A build was offered to this wallet minutes ago and the page came back:
   *  the wallet may have signed it. HOLD — never re-fire. */
  | { kind: 'hold'; run: LinkRun }
  /** This wallet signed this link's ask minutes ago: show the receipt. */
  | { kind: 'signed'; run: LinkRun }

/**
 * The decision, given the stored run and the wallet that just arrived.
 *  · no run / expired → fresh
 *  · a run for ANOTHER wallet → fresh (their run, not this wallet's)
 *  · 'started' (nothing was ever offered to the wallet) → fresh: re-running
 *    a refusal or an answer costs nothing and cannot double-sign
 *  · 'built' → hold; 'signed' → signed
 * A wallet-less return (the runtime asks before the address lands) is
 * judged on the run alone — the hold is the safer default.
 */
export function returnVerdict(run: LinkRun | null, wallet: string | null | undefined, now: number): ReturnVerdict {
  if (!run) return { kind: 'fresh' }
  if (now - run.at > LINK_RUN_TTL_MS) return { kind: 'fresh' }
  if (wallet && run.wallet && wallet.toLowerCase() !== run.wallet) return { kind: 'fresh' }
  if (run.outcome === 'signed') return { kind: 'signed', run }
  if (run.outcome === 'built') return { kind: 'hold', run }
  return { kind: 'fresh' }
}

/** Funnel honesty: a return inside the window is the SAME visit. The
 *  once-only beacons ('open', 'connect') are not posted again. */
export function beaconsAlreadyPosted(verdict: ReturnVerdict): ReadonlyArray<'open' | 'connect'> {
  return verdict.kind === 'fresh' ? [] : ['open', 'connect']
}

function minutesAgo(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000))
  if (m < 1) return 'moments ago'
  if (m === 1) return 'a minute ago'
  return `${m} minutes ago`
}

/** The words on the came-back card, and its chips. `again` SENDS the ask;
 *  `done` closes the card and opens the onward paths. Pinned. */
export function returnCopy(verdict: Exclude<ReturnVerdict, { kind: 'fresh' }>, ask: string, now: number): {
  eyebrow: string
  title: string
  body: string
  chips: { done: string; again: string }
  txUrl: string | null
} {
  const when = minutesAgo(verdict.run.at, now)
  if (verdict.kind === 'signed') {
    return {
      eyebrow: 'Already signed',
      title: 'This one went through.',
      body: `You signed "${ask}" ${when}. Nothing here needs signing again — the receipt is below. Running it again would move the money a second time.`,
      chips: { done: "I'M DONE", again: 'RUN IT AGAIN' },
      txUrl: verdict.run.txUrl ?? null,
    }
  }
  return {
    eyebrow: 'Welcome back',
    title: "Don't sign this twice.",
    body: `A transaction for "${ask}" was open in your wallet ${when}. If you approved it there, it's done — check your wallet's activity. If you cancelled, build it again.`,
    chips: { done: 'IT WENT THROUGH', again: "IT DIDN'T — BUILD IT AGAIN" },
    txUrl: null,
  }
}

// ── The seam for SIGN's round-trip outcome ──────────────────────────────
// SIGN's lib/sign-round-trip.ts will one day know how a signature request
// ended while the page was away (the tx landed / the wallet cancelled). This
// is the one function that turns that knowledge into the card's next state;
// IntentRuntime exposes it through `linkReturnSeam` so the coordinator can
// wire the export in one line. Pure, pinned.
export type RoundTripOutcome = { kind: 'signed'; txUrl?: string; valueUsd?: number } | { kind: 'cancelled' } | { kind: 'unknown' }

/** The card after SIGN says how the round trip ended: signed → the receipt
 *  card; cancelled → no card (the ask may run again); unknown → unchanged. */
export function verdictAfterRoundTrip(current: ReturnVerdict | null, outcome: RoundTripOutcome, now: number): ReturnVerdict | null {
  if (!current || current.kind === 'fresh') return current
  if (outcome.kind === 'unknown') return current
  if (outcome.kind === 'cancelled') return null
  return {
    kind: 'signed',
    run: { ...current.run, outcome: 'signed', at: now, ...(outcome.txUrl ? { txUrl: outcome.txUrl } : {}), ...(outcome.valueUsd !== undefined ? { valueUsd: outcome.valueUsd } : {}) },
  }
}
