'use client'

// "Alerts that act" (MARKETS/WATCH). The form offers three doors:
//   Notify me           — in-app (the rail's needs-you strip) + optional email.
//   …then send a chip   — the alert carries an ask; when it fires the chip
//                         surfaces on the rail and YOU send it. Nothing is
//                         sent for you: the signature is the gate.
//   Runs by itself      — the autonomous layers that already exist (Spot
//                         Guardian / HL Guardian / CoW limit order) armed
//                         NOW by name, instead of an alert. The venue
//                         watches the price; our cron never touches it.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, X } from 'lucide-react'
import { chartPairFor } from '@/lib/charts'
import { alertActionChips, alertLabel, fmtQuotePrice, type AlertCondition, type AlertRule } from '@/lib/watchlists'

export default function AlertForm({
  open,
  symbol,
  last,
  onClose,
  onCreate,
  onSend,
  sendLabel,
}: {
  open: boolean
  symbol: string
  last: number | null
  onClose: () => void
  onCreate: (body: { symbol: string; condition: AlertCondition; value: number; basePrice?: number | null; actionAsk?: string | null; email?: string | null }) => Promise<unknown>
  /** The chip-send contract — sends in a chat surface, prefills otherwise. */
  onSend: (ask: string) => void
  sendLabel: string
}) {
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const [condition, setCondition] = useState<AlertCondition>('below')
  const [value, setValue] = useState<string>(() => (last ? fmtQuotePrice(last * 0.95).replace(/,/g, '') : ''))
  const [pct, setPct] = useState('5')
  const [then, setThen] = useState<'notify' | 'chip'>('notify')
  const [chipAsk, setChipAsk] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const body = useMemo(() => (typeof document === 'undefined' ? null : document.body), [])
  if (!open || !body) return null

  const numeric = condition === 'pct_move' ? Number(pct) : Number(value)
  const rule: AlertRule = { symbol, condition, value: Number.isFinite(numeric) ? numeric : 0, basePrice: condition === 'pct_move' ? last : null }
  const chips = alertActionChips(rule, pair)
  const firedChips = chips.filter((c) => !c.runsItself)
  const autoChips = chips.filter((c) => c.runsItself)
  const valid = rule.value > 0 && (condition !== 'pct_move' || (last ?? 0) > 0)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        symbol,
        condition,
        value: rule.value,
        basePrice: rule.basePrice ?? null,
        actionAsk: then === 'chip' ? chipAsk : null,
        email: email.trim() || null,
      })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="wl__scrim" onClick={onClose}>
      <div role="dialog" aria-label={`Alert on ${symbol}`} className="wl__modal" onClick={(e) => e.stopPropagation()}>
        <div className="wl__modalHead">
          <span className="wl__modalIcon">
            <Bell className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="wl__modalTitle">Alert on {symbol}</div>
            <div className="wl__modalSub mono">{last ? `last $${fmtQuotePrice(last)} · ` : ''}unlimited alerts · free</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="wl__x">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="wl__modalBody">
          <div className="wl__field">
            <label className="wl__label">When {symbol}</label>
            <div className="wl__seg" role="radiogroup" aria-label="Condition">
              {(['below', 'above', 'pct_move'] as AlertCondition[]).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={condition === c} className={`wl__segBtn${condition === c ? ' wl__segBtn--on' : ''}`} onClick={() => setCondition(c)}>
                  {c === 'below' ? 'drops to' : c === 'above' ? 'rises to' : 'moves'}
                </button>
              ))}
            </div>
            {condition === 'pct_move' ? (
              <div className="wl__inputWrap">
                <input className="wl__input" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Percent move" />
                <span className="wl__unit">% from {last ? `$${fmtQuotePrice(last)}` : 'now'}</span>
              </div>
            ) : (
              <div className="wl__inputWrap">
                <span className="wl__unit">$</span>
                <input className="wl__input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Price" />
              </div>
            )}
          </div>

          <div className="wl__field">
            <label className="wl__label">Then</label>
            <button type="button" className={`wl__opt${then === 'notify' ? ' wl__opt--on' : ''}`} onClick={() => setThen('notify')}>
              <span className="wl__optTitle">Notify me</span>
              <span className="wl__optSub">on the rail the minute it fires{email.trim() ? ' · and by email' : ''}</span>
            </button>
            {firedChips.map((c) => (
              <button
                key={c.ask}
                type="button"
                className={`wl__opt${then === 'chip' && chipAsk === c.ask ? ' wl__opt--on' : ''}`}
                onClick={() => {
                  setThen('chip')
                  setChipAsk(c.ask)
                }}
              >
                <span className="wl__optTitle">…and hand me “{c.label}”</span>
                <span className="wl__optSub">the chip appears when it fires — you send it, your wallet signs</span>
              </button>
            ))}
            <input className="wl__input wl__input--email" type="email" placeholder="email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          </div>

          {autoChips.length > 0 && (
            <div className="wl__field">
              <label className="wl__label">Or let it run by itself</label>
              {autoChips.map((c) => (
                <button key={c.ask} type="button" className="wl__opt wl__opt--auto" onClick={() => onSend(c.ask)}>
                  <span className="wl__optTitle">{c.label}</span>
                  <span className="wl__optSub">signed once, watches the price for you · {sendLabel}</span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="wl__err">{error}</p>}
          <div className="wl__row wl__row--end">
            <span className="wl__muted mono">{valid ? alertLabel(rule) : 'name a price'}</span>
            <button type="button" className="wl__btn wl__btn--accent" disabled={busy || !valid || (then === 'chip' && !chipAsk)} onClick={submit}>
              {busy ? 'Arming…' : 'Set alert'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    body,
  )
}
