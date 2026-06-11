'use client'

import { useEffect, useRef, useState } from 'react'
import type { McpServer } from '@/lib/store'
import BrandIcon from '@/components/BrandIcon'

/**
 * Live x402 Runner — a hero demo where the selected agents autonomously fire
 * paid calls and a USDC wallet balance ticks down. Purely illustrative
 * (client-only animation); no real payments happen here.
 */

const ACCENT = '#3ECF8E'

const ACTIONS = {
  inference: ['POST /v1/chat', 'POST /v1/responses', 'POST /embeddings', 'POST /v1/completions'],
  data: {
    tripadvisor: ['GET /location/search', 'GET /reviews', 'GET /photos'],
    'wolfram-alpha': ['POST /query', 'GET /compute', 'GET /units/convert'],
    coingecko: ['GET /simple/price', 'GET /coins/markets', 'GET /trending'],
    coinmarketcap: ['GET /quotes/latest', 'GET /listings'],
    messari: ['GET /assets/metrics', 'GET /news'],
    'the-graph': ['POST /subgraphs/query', 'POST /entities'],
    _default: ['GET /query', 'POST /fetch'],
  } as Record<string, string[]>,
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
function clock(): string {
  const d = new Date()
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}
function actionFor(server: McpServer): string {
  if (server.kind === 'inference') return pick(ACTIONS.inference)
  return pick(ACTIONS.data[server.id] || ACTIONS.data._default)
}

interface LogEntry {
  key: number
  t: string
  system?: boolean
  msg?: string
  caller?: string
  target?: string
  targetServer?: McpServer
  action?: string
  price?: number
}

export default function RunnerDemo({ agents, catalog }: { agents: McpServer[]; catalog: McpServer[] }) {
  const [running, setRunning] = useState(true)
  const [balance, setBalance] = useState(50)
  const [calls, setCalls] = useState(0)
  const [spent, setSpent] = useState(0)
  const [log, setLog] = useState<LogEntry[]>([])
  const seq = useRef(0)
  // Mirrors `balance` so the interval can compute refills without side effects
  // inside a state updater (see tick).
  const balanceRef = useRef(50)

  // Keep latest agents/catalog in refs so the interval always sees fresh data.
  const agentsRef = useRef(agents)
  const catalogRef = useRef(catalog)
  agentsRef.current = agents
  catalogRef.current = catalog

  useEffect(() => {
    if (!running) return
    const tick = () => {
      const cat = catalogRef.current
      if (cat.length < 2) return
      const callers = agentsRef.current.length ? agentsRef.current : cat.slice(0, 2)
      const caller = pick(callers)
      const target = pick(cat.filter((s) => s.id !== caller.id))
      const price = parseFloat(target.priceUsd || '0.01')
      seq.current += 1
      const entry: LogEntry = {
        key: seq.current,
        t: clock(),
        caller: caller.name,
        target: target.name,
        targetServer: target,
        action: actionFor(target),
        price,
      }

      // Decide the refill HERE, not inside a state updater: updaters must be
      // pure (React double-invokes them in dev), and the old in-updater
      // `seq.current += 1` + nested setLog produced duplicate feed keys.
      const next = +(balanceRef.current - price).toFixed(4)
      const refill = next < 0.5
      const entries: LogEntry[] = refill
        ? [
            { key: (seq.current += 1), t: clock(), system: true, msg: 'wallet auto-funded  +$50.0000 USDC' },
            entry,
          ]
        : [entry]

      setLog((l) => [...entries, ...l].slice(0, 24))
      setCalls((c) => c + 1)
      setSpent((s) => +(s + price).toFixed(4))
      balanceRef.current = refill ? +(next + 50).toFixed(4) : next
      setBalance(balanceRef.current)
    }
    const iv = setInterval(tick, 850)
    return () => clearInterval(iv)
  }, [running])

  return (
    <div className="runner">
      <div className="runner__head">
        <div className="runner__title">
          <span className={`runner__dot ${running ? 'is-live' : ''}`} />
          <span className="mono runner__label">x402 RUNNER</span>
        </div>
        <button className="runner__toggle" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Run'}
        </button>
      </div>

      <div className="runner__wallet">
        <div className="runner__walletlabel mono">AGENT WALLET · USDC ON BASE</div>
        <div className="runner__balance">
          <span className="runner__bal-num">{balance.toFixed(4)}</span>
          <span className="runner__bal-cur mono">USDC</span>
        </div>
        <div className="runner__stats">
          <div className="runner__stat">
            <div className="runner__stat-num mono">{calls}</div>
            <div className="runner__stat-lbl">calls paid</div>
          </div>
          <div className="runner__stat">
            <div className="runner__stat-num mono">${spent.toFixed(4)}</div>
            <div className="runner__stat-lbl">spent autonomously</div>
          </div>
        </div>
      </div>

      <div className="runner__feed mono" aria-live="polite">
        {log.length === 0 && <div className="runner__empty">waiting for agents…</div>}
        {log.map((e) =>
          e.system ? (
            <div key={e.key} className="runner__line runner__line--sys">
              <span className="runner__t">{e.t}</span>
              <span className="runner__sys">↻ {e.msg}</span>
            </div>
          ) : (
            <div key={e.key} className="runner__line">
              <span className="runner__t">{e.t}</span>
              <span className="runner__caller">{e.caller}</span>
              <span className="runner__arrow">→</span>
              <span className="runner__target">
                <span className="runner__glyph">{e.targetServer && <BrandIcon server={e.targetServer} size={13} />}</span>
                {e.target}
              </span>
              <span className="runner__action">{e.action}</span>
              <span className="runner__code">402→200</span>
              <span className="runner__price" style={{ color: ACCENT }}>
                −${e.price!.toFixed(4)}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
