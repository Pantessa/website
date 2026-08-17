'use client'

// U4 — the desk conversation, made visible. A replayable strip of a REAL
// two-agent exchange (scripts/desk-demo.ts, run 2026-08-17 — the M7 loop:
// negotiate → handoff → the human signs → the agent hears back). Lines land
// sequentially like a terminal session; replay restarts it. Static content,
// no network: the point is that a stranger GETS the product in ten seconds.

import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'

type Who = 'agent' | 'desk' | 'human'

const LINES: { who: Who; text: string }[] = [
  { who: 'agent', text: 'I need this done for my human: "Buy $15 of AAPL"' },
  { who: 'desk', text: "Pantessa's swap layer will compile this deterministically — no model writes calldata — and guard-check the whole path before anyone signs." },
  { who: 'desk', text: 'options: proceed · walk away · (funding routes appear when the wallet is short)' },
  { who: 'agent', text: 'quote accepted — proceed as asked' },
  { who: 'desk', text: 'sign link minted: pantessa.com/i/5xuv45jq' },
  { who: 'agent', text: 'handing the link to my human…' },
  { who: 'human', text: 'opened the link — the ask and the guardrail contract, in plain words' },
  { who: 'human', text: 'connected a wallet — the guarded build runs' },
  { who: 'human', text: 'signed ✓' },
  { who: 'desk', text: 'status: SIGNED — moved through the guarded path' },
  { who: 'agent', text: 'my human signed — the loop is closed, and I never touched a transaction byte.' },
]

const TAG: Record<Who, { label: string; cls: string }> = {
  agent: { label: 'agent', cls: 'text-sky-400' },
  desk: { label: 'desk', cls: 'text-[color:var(--accent)]' },
  human: { label: 'human', cls: 'text-amber-400' },
}

export default function DeskTranscript() {
  const [shown, setShown] = useState(0)
  const [run, setRun] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setShown(0)
    let i = 0
    const t = setInterval(() => {
      i += 1
      setShown(i)
      if (i >= LINES.length) clearInterval(t)
    }, 900)
    return () => clearInterval(t)
  }, [run])

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' })
  }, [shown])

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-black/30 overflow-hidden" data-desk-transcript>
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2">
        <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
          A real desk session — two agents, one human signature
        </span>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="inline-flex items-center gap-1 mono text-[11px] uppercase tracking-wider text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
          aria-label="Replay the session"
        >
          <RotateCcw className="w-3 h-3" /> Replay
        </button>
      </div>
      <div ref={box} className="max-h-64 overflow-y-auto px-4 py-3 space-y-1.5">
        {LINES.slice(0, shown).map((l, i) => (
          <p key={`${run}-${i}`} className="mono text-[12.5px] leading-relaxed text-[color:var(--muted)]">
            <span className={`${TAG[l.who].cls} select-none`}>[{TAG[l.who].label}]</span> {l.text}
          </p>
        ))}
        {shown < LINES.length && (
          <p className="mono text-[12.5px] text-[color:var(--muted-2)] animate-pulse select-none">▍</p>
        )}
      </div>
    </div>
  )
}
