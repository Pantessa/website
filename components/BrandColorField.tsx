'use client'

// One color control for the creator page: a swatch that opens the OS picker,
// a hex field, and the refusal spoken in advance. The server (PATCH
// /api/intent-links/brand) is still the authority — normalizeBg/normalizeAccent
// run there — but re-stating the accent rule here means the creator learns it
// from the field instead of from a 400.

import { useEffect, useState } from 'react'
import { normalizeHex } from '@/lib/brand-theme'
import { colorFieldError } from '@/lib/brand-presets'

export function BrandColorField({
  role,
  label,
  hint,
  value,
  onApply,
  disabled,
}: {
  role: 'bg' | 'accent'
  label: string
  hint: string
  /** The stored color, or null when the page is on the house default. */
  value: string | null
  onApply: (hex: string) => void | Promise<unknown>
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [busy, setBusy] = useState(false)
  // Follow the stored value when it changes underneath (a preset tap, a scan)
  // — the field always shows what the page is actually wearing.
  useEffect(() => setDraft(value ?? ''), [value])

  const dirty = (normalizeHex(draft) ?? draft) !== (value ?? '') && draft.trim() !== ''
  const error = draft.trim() ? colorFieldError(role, draft) : null

  const apply = async (raw: string) => {
    const hex = normalizeHex(raw)
    if (!hex || colorFieldError(role, hex)) return
    setBusy(true)
    try {
      await onApply(hex)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-medium text-[color:var(--fg)]">{label}</label>
      <div className="flex items-center gap-2">
        {/* The OS picker. Its swatch IS the current color, so a creator can
            dial one in by eye; committing happens on change (not on every
            drag frame — browsers fire `change` at release). */}
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={normalizeHex(draft) ?? normalizeHex(value) ?? (role === 'bg' ? '#0f172a' : '#38bdf8')}
          onChange={(e) => {
            setDraft(e.target.value)
            void apply(e.target.value)
          }}
          disabled={disabled || busy}
          className="h-8 w-9 flex-shrink-0 cursor-pointer rounded-lg border border-[var(--line)] bg-[var(--bg)] p-0.5 disabled:opacity-50"
        />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !error) void apply(draft)
          }}
          placeholder={role === 'bg' ? '#0f172a' : '#38bdf8'}
          maxLength={7}
          spellCheck={false}
          className="mono w-24 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-[12px] text-[color:var(--fg)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void apply(draft)}
          disabled={disabled || busy || !dirty || !!error}
          className="mono text-[11px] text-[color:var(--muted-2)] transition-colors hover:text-[color:var(--fg)] disabled:opacity-40"
        >
          {busy ? 'applying…' : 'apply'}
        </button>
      </div>
      <p className={`text-[11px] ${error ? 'text-amber-400' : 'text-[color:var(--muted-2)]'}`}>{error ?? hint}</p>
    </div>
  )
}
