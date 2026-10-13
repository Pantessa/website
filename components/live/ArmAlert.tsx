'use client'

// ALERTS ON YOUR PICK (GTM squad 2026-10-13, lane ALERTS). One tap arms a
// price alert on this market through the EXISTING alerts — POST /api/alerts
// (lib/watchlists-store createAlert), the per-minute sweep, the bell in
// shell/RailAlerts. The rules are lib/pick-alerts (pure, pinned); this file
// is the browser: the session gate, ONE POST per arm on the session cookie,
// the page's shared alerts instance refreshed so the bell counts it at once,
// the held arm across the sign-in door.
//
// Seats (the coordinator's one-line mounts):
//   scoreboard — a small per-row control in the battle's recruit cell
//                (44px under a coarse pointer); on /live the page's alerts
//                instance is MarketsSide's — refreshed after the POST.
//   deck       — one control for the deck's market on the splash. The deck
//                sits BESIDE the index's side column, not inside it, so there
//                is no shared instance: the arm says so on `window`
//                (ALERTS_CHANGED_EVENT) and the index's bell re-reads now
//                instead of at its next 30s poll.
//   strip      — "Watch these": one alert per pick in one consent (the pure
//                plan names what it skips: unpriceable, already armed, over
//                the cap). Takes `markets`. Unmounted until a picker head
//                seat exists (ALERTS.md § For PICK).
//
// A market the sweep cannot price renders NOTHING (lib/pick-alerts
// alertSymbolFor) — never a button that can't do what it says. Alerts are
// an account's (rule 6): a guest or a connect-only wallet gets the unified
// sign-in door (CreateAccountButton, no redirectTo → it lands back here),
// never a raw connect modal; the arm the tap meant is held — in state for
// the wallet / email lanes (the page refreshes in place) and in
// sessionStorage for the Google lane (the page leaves) — and runs once the
// session is authed, exactly once (the record is claimed on read). A strip
// tap holds its LIST and resumes through watchPlan (QA-A2).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bell, BellRing } from 'lucide-react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSharedAlerts } from '@/components/markets/watchlist/alerts-context'
import { shownError } from '@/lib/fetch-words'
import {
  ALERTS_CHANGED_EVENT,
  ARM_RETRY_MS,
  DEFAULT_ALERT_PCT,
  HELD_ARM_KEY,
  armGate,
  isNoPriceYet,
  armLabel,
  armedWords,
  heldArmRecord,
  isPctAlertOn,
  pickAlertPlan,
  readHeldArm,
  watchPlan,
  type PickAlertBody,
  type PickAlertPlan,
} from '@/lib/pick-alerts'
import { canSellAsk } from '@/lib/sell-gate'
import { useSession } from '@/lib/session'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'
import './arm-alert.css'

export interface ArmAlertProps {
  market: string
  /** Where the control sits; the copy differs. */
  seat: 'scoreboard' | 'deck' | 'strip'
  /** The strip seat's pick ("Watch these"). */
  markets?: readonly string[]
  /** The distance, both ways. Default ±5% (Decision for Nate). */
  pct?: number
}

interface Armed {
  symbol: string
  basePrice: number | null
}

/** ONE arm = one POST with the session cookie; the server's own words come
 *  back as the error (so a "No live price" answer is recognizable). `tell`
 *  announces the write on `window` for a bell outside this subtree (the
 *  deck on `/`); a page with a shared instance refreshes that instead. */
async function postAlert(body: PickAlertBody, tell: boolean): Promise<{ basePrice: number | null }> {
  const res = await fetch('/api/alerts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as { alert?: { basePrice?: number | null }; error?: string } | null
  if (!res.ok) throw new Error(json?.error || `Alerts: ${res.status}`)
  if (tell) {
    try {
      window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT))
    } catch {}
  }
  return { basePrice: json?.alert?.basePrice ?? null }
}

export default function ArmAlert({ market, seat, markets, pct = DEFAULT_ALERT_PCT }: ArmAlertProps) {
  const { status, address } = useSession()
  const shared = useSharedAlerts()
  const tradable = useTradable()
  const pathname = usePathname() ?? '/'
  const gate = armGate(status, address)

  // The chip a fired alert hands back must pass the same gates every chip
  // on the page passes (lib/trade-venue-gate, lib/sell-gate) or it is not
  // stored at all.
  const canAct = useCallback((ask: string) => canTradeAsk(ask, tradable) && canSellAsk(ask, null), [tradable])

  const plan = useMemo(() => (seat === 'strip' ? null : pickAlertPlan(market, pct, canAct)), [seat, market, pct, canAct])
  const watch = useMemo(() => (seat === 'strip' ? watchPlan(markets ?? [], shared?.alerts, pct, canAct) : null), [seat, markets, shared?.alerts, pct, canAct])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Armed | Armed[] | null>(null)
  const heldRef = useRef<boolean>(false)
  const ranHeldRef = useRef(false)

  const sharedOn = plan ? isPctAlertOn(shared?.alerts, plan.symbol, pct) : false
  const armedOne = plan ? (sharedOn ? { symbol: plan.symbol, basePrice: (shared?.alerts ?? []).find((a) => a.symbol === plan.symbol && a.condition === 'pct_move' && a.status !== 'fired')?.basePrice ?? null } : done && !Array.isArray(done) ? done : null) : null

  // ONE arm = one POST. The shared instance (the page's bell) is refreshed
  // after it lands, so the count flips at once; a page without one is told
  // on `window`. The server anchors the rule on its own quote read; when
  // that read missed the venue for a moment ("No live price for X") the tap
  // retries once after ARM_RETRY_MS, then says so. Nothing else is retried.
  const armRow = useCallback(
    async (p: PickAlertPlan, retried = false): Promise<Armed> => {
      try {
        const r = await postAlert(p.body, !shared)
        if (shared) void shared.refresh()
        return { symbol: p.symbol, basePrice: r.basePrice }
      } catch (e) {
        if (!retried && isNoPriceYet((e as Error)?.message)) {
          await new Promise((r) => setTimeout(r, ARM_RETRY_MS))
          return armRow(p, true)
        }
        throw e
      }
    },
    [shared],
  )

  const armOne = useCallback(
    async (p: PickAlertPlan) => {
      setBusy(true)
      setError(null)
      try {
        setDone(await armRow(p))
      } catch (e) {
        setError(shownError(e, 'Alerts', 'Nothing was saved; try again in a moment.'))
      } finally {
        setBusy(false)
      }
    },
    [armRow],
  )

  const armMany = useCallback(
    async (plans: readonly PickAlertPlan[]) => {
      setBusy(true)
      setError(null)
      const armed: Armed[] = []
      try {
        for (const p of plans) armed.push(await armRow(p))
      } catch (e) {
        setError(shownError(e, 'Alerts', armed.length ? `${armed.length} armed, then it stopped; try the rest again.` : 'Nothing was saved; try again in a moment.'))
      } finally {
        setDone(armed)
        setBusy(false)
      }
    },
    [armRow],
  )

  // A guest's tap leaves a record while the door is open (the Google lane
  // leaves the page); the wallet / email lanes keep this instance, so the ref
  // alone carries it.
  // A strip tap holds its LIST (QA-A2): on resume the list is re-derived
  // through watchPlan against the owner's rules, never armed blind.
  const heldListRef = useRef<readonly string[] | null>(null)
  const hold = useCallback(() => {
    heldRef.current = true
    if (seat === 'strip') heldListRef.current = markets ?? []
    try {
      window.sessionStorage.setItem(HELD_ARM_KEY, seat === 'strip' ? heldArmRecord('', pct, pathname, Date.now(), markets ?? []) : heldArmRecord(market, pct, pathname))
    } catch {}
  }, [seat, market, markets, pct, pathname])

  // On mount: claim a fresh held record for THIS seat on THIS page (claimed
  // on read, so a second instance of the same market never arms it twice):
  // a row seat takes a record naming its market; the strip takes a list.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const rec = readHeldArm(window.sessionStorage.getItem(HELD_ARM_KEY), pathname)
      if (!rec) return
      if (seat === 'strip' ? !!rec.markets?.length : rec.market === market) {
        window.sessionStorage.removeItem(HELD_ARM_KEY)
        heldRef.current = true
        if (seat === 'strip') heldListRef.current = rec.markets ?? []
      }
    } catch {}
  }, [seat, market, pathname])

  // The held arm runs once the session is authed — exactly once.
  useEffect(() => {
    if (gate !== 'ready' || !heldRef.current || ranHeldRef.current) return
    if (seat === 'strip') {
      const list = heldListRef.current
      if (!list) return
      ranHeldRef.current = true
      heldRef.current = false
      heldListRef.current = null
      try {
        window.sessionStorage.removeItem(HELD_ARM_KEY)
      } catch {}
      const resumed = watchPlan(list, shared?.alerts, pct, canAct)
      if (resumed.plans.length) void armMany(resumed.plans)
      return
    }
    if (!plan || sharedOn) return
    ranHeldRef.current = true
    heldRef.current = false
    try {
      window.sessionStorage.removeItem(HELD_ARM_KEY)
    } catch {}
    void armOne(plan)
  }, [gate, seat, plan, sharedOn, armOne, armMany, shared?.alerts, pct, canAct])

  // ── Strip: "Watch these" ────────────────────────────────────────────────
  if (seat === 'strip') {
    if (!watch) return null
    const n = watch.plans.length
    const armedMany = Array.isArray(done) ? done : null
    if (armedMany && armedMany.length && !busy) {
      return (
        <span className="armalert armalert--strip is-armed" role="status" title={armedMany.map((a) => armedWords(a.symbol, pct, a.basePrice)).join(' · ')}>
          <BellRing className="armalert__ico" aria-hidden /> {armedMany.length} armed
        </span>
      )
    }
    if (n === 0) {
      return (
        <span className="armalert__note mono" title={watch.skipped.unpriceable.length ? `no price feed for ${watch.skipped.unpriceable.join(', ')}` : undefined}>
          {watch.sentence}
        </span>
      )
    }
    const label = (
      <>
        <Bell className="armalert__ico" aria-hidden /> {armLabel('strip', market, pct)} <span className="armalert__pct mono">{n} · ±{pct}%</span>
      </>
    )
    if (gate === 'door') {
      return (
        <span className="armalert__door" onClickCapture={hold}>
          <CreateAccountButton className="armalert armalert--strip" label={label} />
        </span>
      )
    }
    return (
      <>
        <button type="button" className="armalert armalert--strip" data-journey="Watch these" title={watch.sentence} aria-label={watch.sentence} disabled={busy || gate === 'loading'} onClick={() => void armMany(watch.plans)}>
          {busy ? 'Arming…' : label}
        </button>
        {error && (
          <span className="armalert__err mono" role="alert">
            {error}
          </span>
        )}
      </>
    )
  }

  // ── One market ──────────────────────────────────────────────────────────
  if (!plan) return null
  const short = armLabel(seat, market, pct)

  if (armedOne) {
    const words = armedWords(armedOne.symbol, pct, armedOne.basePrice)
    return (
      <span className={`armalert armalert--${seat} is-armed`} role="status" title={`${words} — manage it on the bell`} data-armed={armedOne.symbol}>
        <BellRing className="armalert__ico" aria-hidden />
        <span className="armalert__pct mono">{seat === 'deck' ? `Armed · ${words}` : 'armed'}</span>
      </span>
    )
  }

  const label = (
    <>
      <Bell className="armalert__ico" aria-hidden />
      <span className="armalert__pct mono">{short}</span>
    </>
  )

  if (gate === 'door') {
    // Rule 6: the unified door, aimed back at this page (no redirectTo); the
    // arm the tap meant is held and runs when the session lands.
    return (
      <span className="armalert__door" onClickCapture={hold} title={`${plan.sentence} — sign in to keep alerts`}>
        <CreateAccountButton className={`armalert armalert--${seat}`} label={label} />
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        className={`armalert armalert--${seat}`}
        data-journey={`Arm alert ${market}`}
        title={plan.chip ? `${plan.sentence} — hands you "${plan.chip}" when it fires` : plan.sentence}
        aria-label={plan.sentence}
        disabled={busy || gate === 'loading'}
        onClick={() => void armOne(plan)}
      >
        {busy ? (
          <span className="armalert__pct mono">Arming…</span>
        ) : (
          label
        )}
      </button>
      {error && (
        <span className="armalert__err mono" role="alert" title={error}>
          {seat === 'deck' ? error : 'not armed'}
        </span>
      )}
    </>
  )
}
