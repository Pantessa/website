'use client'

// "While you're away" — the /live trigger rules armed on the SERVER
// (2026-10-13). The rail's three rules run in the browser and die with the
// tab; this seat arms the same rule as a print_alerts row, which
// /api/cron/prints evaluates every minute over Dune's feed from a stored
// cursor (lib/print-alerts). A firing lands on the bell (the price alerts'
// own notification path) and in the mail when the rule named a verified
// address; the chip it carries is sent only by the wallet.
//
// Owner-only (rule 6: SIWE gates account surfaces): a signed-in wallet
// arms with one tap; a guest or a connected-only wallet gets the UNIFIED
// door (CreateAccountButton, no redirectTo — the sign-in keeps them on
// this page) and the tap is HELD: in a ref for the lanes that refresh in
// place, in sessionStorage for the Google lane that leaves, and it runs
// exactly once when the session reads authed. The body never names an
// owner, a wallet or a recipient — the server reads the session.

import { useCallback, useEffect, useRef, useState } from 'react'
import CreateAccountButton from '@/components/CreateAccountButton'
import type { DuneVenueId } from '@/lib/dune'
import { HELD_PRINT_ARM_KEY, feedStatusWords, heldPrintArmRecord, printAlertLabel, printVenueWords, readHeldPrintArm, type FeedStatusShape, type HeldPrintArm, type PrintAlertShape } from '@/lib/print-alerts'
import { useSession } from '@/lib/session'
import { TRIGGER_LABEL, fmtUsd, type TriggerRule, type TriggerThresholds } from '@/lib/tape'

const RULES: readonly TriggerRule[] = ['big-print', 'whale-repeat', 'flow-skew']

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

function pathHere(): string {
  return typeof window === 'undefined' ? '/live' : window.location.pathname
}

export default function ServerTriggers({ market, venues, thresholds }: { market: string | null; venues: readonly DuneVenueId[]; thresholds: TriggerThresholds }) {
  const { status, address } = useSession()
  const authed = status === 'authed' && !!address
  const [alerts, setAlerts] = useState<PrintAlertShape[]>([])
  const [feeds, setFeeds] = useState<FeedStatusShape[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const heldRef = useRef<HeldPrintArm | null>(null)

  const refresh = useCallback(async () => {
    if (!authed) {
      setAlerts([])
      setFeeds([])
      return
    }
    try {
      const r = await api<{ alerts: PrintAlertShape[]; feeds: FeedStatusShape[] }>('/api/print-alerts')
      setAlerts(r.alerts)
      setFeeds(r.feeds)
    } catch (e) {
      setNote((e as Error).message)
    }
  }, [authed])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      setNow(Date.now())
      void refresh()
    }, 30_000)
    return () => clearInterval(t)
  }, [refresh])

  const post = useCallback(
    async (arm: HeldPrintArm) => {
      await api('/api/print-alerts', {
        method: 'POST',
        body: JSON.stringify({ rule: arm.rule, market: arm.market, venues: [...venues], ...(arm.rule === 'big-print' ? { bigPrintUsd: arm.bigPrintUsd } : {}) }),
      })
    },
    [venues],
  )

  const arm = useCallback(
    async (rule: TriggerRule) => {
      setBusy(rule)
      try {
        await post({ rule, market, bigPrintUsd: thresholds.bigPrintUsd })
        setNote(null)
        await refresh()
      } catch (e) {
        setNote((e as Error).message)
      }
      setBusy(null)
    },
    [post, market, thresholds.bigPrintUsd, refresh],
  )

  // A guest's tap is held through the door and runs once the session lands.
  const hold = useCallback(
    (rule: TriggerRule) => {
      const held: HeldPrintArm = { rule, market, bigPrintUsd: thresholds.bigPrintUsd }
      heldRef.current = held
      try {
        sessionStorage.setItem(HELD_PRINT_ARM_KEY, heldPrintArmRecord(held, pathHere(), Date.now()))
      } catch {
        // storage blocked: the ref still carries it for the in-place lanes
      }
    },
    [market, thresholds.bigPrintUsd],
  )
  useEffect(() => {
    if (!authed) return
    let held = heldRef.current
    if (!held) {
      try {
        held = readHeldPrintArm(sessionStorage.getItem(HELD_PRINT_ARM_KEY), pathHere(), Date.now())
      } catch {
        held = null
      }
    }
    if (!held) return
    heldRef.current = null
    try {
      sessionStorage.removeItem(HELD_PRINT_ARM_KEY)
    } catch {
      // nothing to clear
    }
    const run = held
    setBusy(run.rule)
    void post(run)
      .then(() => setNote(null))
      .catch((e: Error) => setNote(e.message))
      .then(() => refresh())
      .then(() => setBusy(null))
  }, [authed, post, refresh])

  const setOp = useCallback(
    async (id: string, op: 'pause' | 'resume') => {
      try {
        await api('/api/print-alerts', { method: 'PATCH', body: JSON.stringify({ id, op }) })
        setNote(null)
      } catch (e) {
        setNote((e as Error).message)
      }
      await refresh()
    },
    [refresh],
  )
  const remove = useCallback(
    async (id: string) => {
      try {
        await api(`/api/print-alerts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        setNote(null)
      } catch (e) {
        setNote((e as Error).message)
      }
      await refresh()
    },
    [refresh],
  )

  // The row this seat would arm: same rule, same market scope, same bar.
  const rowFor = (rule: TriggerRule) => alerts.find((a) => a.rule === rule && (a.market ?? '') === (market ?? '') && (rule !== 'big-print' || a.thresholds.bigPrintUsd === thresholds.bigPrintUsd))
  const where = market ?? 'any market'
  const feedLine = feeds.filter((f) => venues.includes(f.venue)).map((f) => feedStatusWords(f, now)).join(' ')
  const footer = note
    ? note
    : !authed
      ? `Sign in to keep a rule watching while this tab is closed: a cron reads ${printVenueWords(venues)} every minute and a firing lands on the bell. The chip moves nothing until you sign.`
      : feedLine || `Reads ${printVenueWords(venues)} every minute from where the last pass left off. A firing lands on the bell and in your mail (a verified address, set on the alert); the chip moves nothing until you sign.`

  return (
    <section className="live__server" aria-label="While you're away" data-slot="server-triggers">
      <header className="live__rh">
        <span className="live__rk">While you&apos;re away</span>
        <span className="live__rv mono">a cron reads the feed every minute</span>
      </header>
      <ul className="live__srules">
        {RULES.map((rule) => {
          const row = rowFor(rule)
          const name = rule === 'big-print' ? `Big print ≥ ${fmtUsd(thresholds.bigPrintUsd)}` : TRIGGER_LABEL[rule]
          return (
            <li key={rule} className={`live__srule${row ? ' is-armed' : ''}`} data-rule={rule} data-armed={row ? row.status : undefined}>
              <span className="live__srule-n">
                {name} <span className="live__srule-w mono">on {where}</span>
              </span>
              {row ? (
                <span className="live__sarmed mono" role="status" title={printAlertLabel(row)}>
                  {row.status === 'paused' ? 'paused' : 'armed'}
                  {row.firedCount ? ` · fired ${row.firedCount}×` : ''}
                  <button type="button" className="live__sctl" onClick={() => setOp(row.id, row.status === 'paused' ? 'resume' : 'pause')} aria-label={row.status === 'paused' ? `Resume ${name}` : `Pause ${name}`} title={row.status === 'paused' ? 'Resume' : 'Pause'}>
                    {row.status === 'paused' ? '▶' : '⏸'}
                  </button>
                  <button type="button" className="live__sctl" onClick={() => remove(row.id)} aria-label={`Remove ${name}`} title="Remove">
                    ×
                  </button>
                </span>
              ) : authed ? (
                <button type="button" className="live__sarm" disabled={busy === rule} onClick={() => arm(rule)} data-journey={`Arm print alert ${rule}`} title={`Arms "${name} on ${where}" on the server — the bell and your mail carry it when it fires`}>
                  {busy === rule ? 'arming…' : 'Keep watching'}
                </button>
              ) : (
                <CreateAccountButton className="live__sarm" label={status === 'loading' ? '…' : 'Sign in to keep watching'} onOpenChange={(open) => open && hold(rule)} />
              )}
            </li>
          )
        })}
      </ul>
      <p className="live__note mono">{footer}</p>
    </section>
  )
}
