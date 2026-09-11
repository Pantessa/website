'use client'

// The Wallet panel — what "Wallet details" opens, and the body of the
// /wallet page.
//
// It used to open RainbowKit's account modal: an avatar, a copy-address
// button and Disconnect. Fine for a MetaMask user who has the extension's
// own balance view one click away; nothing at all for an embedded (CDP)
// wallet, whose owner signed up by email and has NO other window onto the
// money. "I funded it with a card — did it arrive? on which chain?" had no
// answer anywhere in the product (2026-09-08, Nate's own Stripe purchase).
//
// This is that window: every app chain, priced, with the gas verdict per
// chain (tokens with no gas is the wall the funding layer otherwise finds
// for you later), recent transfers with explorer links, and the two ways in
// (card via the on-ramp door, receive via address/QR) and the way OUT — a
// Send door over the chat's own guarded transfer (components/WalletSendForm,
// POST /api/wallet/send). RainbowKit's modal stays reachable as "Wallet
// settings" for switch/disconnect — it is still the right place for that,
// it was just the wrong place for THIS.
//
// One body, two frames (2026-09-11, Nate: "I love our wallet model, can we
// make this a page in the app"). WalletDetails is the whole window — the
// reads, the landed flashes, the doors, send, receive, recent — and it
// renders inside the modal (layout "modal": the one column people know) or
// on the /wallet page (layout "page": holdings by chain on the left under a
// split-by-chain bar; the doors, the forms they open and the whole activity
// feed on the right). The modal carries a door to the page.
//
// Connect-to-act: reads by address, no SIWE. A wallet created a minute ago
// can see itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useYeetfulStore } from '@/lib/store'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAccount, useSignMessage } from 'wagmi'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  ExternalLink,
  Fuel,
  Loader2,
  Maximize2,
  QrCode,
  RefreshCw,
  Send,
  Settings2,
  Wallet,
  X,
} from 'lucide-react'
import { getChainMark } from '@/components/chain-marks'
import WalletSendForm from '@/components/WalletSendForm'
import { startOnrampSession } from '@/lib/onramp-client'
import { ONRAMP_ASSET, ONRAMP_DEFAULT_NETWORK, ONRAMP_NETWORK_LABEL } from '@/lib/onramp'
import { loadFundWait, type FundWait } from '@/lib/funding-arrival'
import { timeAgo } from '@/lib/dashboard-ui'
import type { WalletChainView, WalletView } from '@/lib/wallet-view'
import { isWalletPath, WALLET_PAGE_HREF } from '@/lib/wallet-page'
import TokenIcon from '@/components/TokenIcon'
import { cn } from '@/lib/utils'

const CDP_CONNECTOR = 'cdp-embedded-wallet'
/** Opening amount for a card top-up from the panel. A suggestion Stripe lets
 *  the user change, not a computed plan — there is no ask to size it to. */
const PANEL_TOPUP_USD = 25
/** Re-read while open; the route caches 45s so this costs one read a minute. */
const REFRESH_MS = 30_000
/** Recent rows per frame: the modal keeps its six, the page has room for the
 *  whole feed /api/wallet returns (twelve). */
const RECENT_ROWS = { modal: 6, page: 12 } as const

const fmtUsd = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtBal = (s: string) => {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (n === 0) return '0'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return n.toPrecision(3).replace(/\.?0+$/, '')
}

/** Which wallet this is, in words: the header of either frame. */
export function walletKind(connectorId: string | undefined, connectorName: string | undefined): { label: string; sub: string } {
  if (connectorId === CDP_CONNECTOR) return { label: 'Pantessa wallet', sub: 'created with your email · keys stay with you' }
  if (connectorId === 'yeetful-host-wallet') return { label: 'Host page wallet', sub: 'the wallet the embedding site connected' }
  return { label: connectorName || 'Connected wallet', sub: 'your own wallet, signing in-page' }
}

function GasBadge({ gas }: { gas: WalletChainView['gas'] }) {
  if (gas === 'ok' || gas === 'empty') return null
  const none = gas === 'none'
  return (
    <span
      title={
        none
          ? 'Tokens are here but there is no ETH to pay gas — nothing on this chain can move until a little ETH lands.'
          : 'Enough ETH to sign, but a plan would keep more back. A small top-up avoids a stall.'
      }
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide',
        none ? 'border-amber-500/40 text-amber-400' : 'border-[var(--line-2)] text-[color:var(--muted)]',
      )}
    >
      <Fuel className="w-3 h-3" />
      {none ? 'no gas' : 'low gas'}
    </span>
  )
}

function ChainRow({ chain, current, landed, onAsk }: { chain: WalletChainView; current: boolean; landed: number | null; onAsk: (prompt: string) => void }) {
  const [open, setOpen] = useState(false)
  const Mark = getChainMark(chain.key)
  const empty = chain.holdings.length === 0
  return (
    <div className={cn('rounded-xl border transition-colors', landed ? 'border-[color:var(--accent)]/60 bg-[color:var(--accent)]/[0.06]' : 'border-[var(--line)] bg-[var(--surf-1)]')}>
      <button
        type="button"
        onClick={() => !empty && setOpen((o) => !o)}
        className={cn('w-full flex items-center gap-3 px-3.5 py-2.5 text-left', empty ? 'cursor-default' : 'hover:bg-white/[0.03]')}
        aria-expanded={open}
      >
        <span className="w-7 h-7 grid place-items-center rounded-lg bg-black/30 border border-[var(--line)] flex-shrink-0">
          {Mark ? <Mark size={18} /> : <span className="w-3 h-3 rounded-full" style={{ background: chain.color }} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[color:var(--fg)]">{chain.name}</span>
            {current && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[color:var(--muted-2)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)]" /> wallet is here
              </span>
            )}
            <GasBadge gas={chain.gas} />
            {chain.unread && <span className="text-[10px] uppercase tracking-wide text-amber-400">didn&rsquo;t answer</span>}
          </span>
          <span className="block text-[11.5px] text-[color:var(--muted)] truncate">
            {landed
              ? `+${fmtUsd(landed)} just landed`
              : empty
                ? chain.unread
                  ? 'balance unknown right now'
                  : 'nothing here'
                : chain.holdings.map((h) => `${fmtBal(h.balance)} ${h.symbol}`).slice(0, 3).join(' · ') + (chain.holdings.length > 3 ? ` · +${chain.holdings.length - 3}` : '')}
          </span>
        </span>
        <span className="text-right flex-shrink-0">
          <span className="block mono text-[13px] tabular-nums text-[color:var(--fg)]">{empty && !chain.unread ? '—' : fmtUsd(chain.totalUsd)}</span>
        </span>
        {!empty && <ChevronDown className={cn('w-4 h-4 text-[color:var(--muted-2)] transition-transform', open && 'rotate-180')} />}
      </button>
      {open && !empty && (
        <div className="border-t border-[var(--line)] px-3.5 py-2 space-y-1">
          {chain.holdings.map((h) => (
            <div key={`${h.symbol}-${h.address}`} className="flex flex-wrap items-center gap-3 text-[12px]">
              {/* The mark sits in the chain icon's column, so holdings hang
                  under their chain instead of floating in an empty gutter.
                  chainId is what tells AAPL-the-equity from a same-named
                  token anywhere else. */}
              <span className="w-7 grid place-items-center">
                <TokenIcon symbol={h.symbol} size={20} chainId={chain.id} />
              </span>
              <span className="flex-1 min-w-0 flex items-baseline gap-2">
                <span className="font-medium text-[color:var(--fg)]">{h.symbol}</span>
                <span className="mono text-[11.5px] text-[color:var(--muted)] truncate">{fmtBal(h.balance)}</span>
                {h.native && <span className="text-[10px] uppercase tracking-wide text-[color:var(--muted-2)]">gas</span>}
              </span>
              <span className="mono tabular-nums text-[color:var(--muted)]">{h.valueUsd == null ? 'unpriced' : fmtUsd(h.valueUsd)}</span>
              {/* "Act on THIS" chips (Robinhood stocks: sell / buy more / DCA;
                  idle USDG → a stock). A tap prefills the chat composer —
                  never sends; the wallet signature stays the only gate. */}
              {h.actions && h.actions.length > 0 && (
                <span className="basis-full flex flex-wrap gap-1.5 pl-10 pt-0.5">
                  {h.actions.map((a) => (
                    <button
                      key={a.prompt}
                      type="button"
                      onClick={() => onAsk(a.prompt)}
                      title={a.prompt}
                      className="rounded-full border border-[var(--line)] bg-black/20 px-2.5 py-0.5 text-[11px] text-[color:var(--fg)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
                    >
                      {a.label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Each chain's share of the total, for the page's split bar, richest first.
 *  A chain that didn't answer is left out (never drawn as a share it might
 *  not have), and so is dust under a cent. */
function chainShares(chains: WalletChainView[]) {
  const priced = chains.filter((c) => !c.unread && c.totalUsd >= 0.01)
  const sum = priced.reduce((s, c) => s + c.totalUsd, 0)
  if (sum <= 0) return []
  return priced
    .map((c) => ({ id: c.id, name: c.name, color: c.color, usd: c.totalUsd, share: c.totalUsd / sum }))
    .sort((a, b) => b.share - a.share)
}

const fmtShare = (share: number) => (share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`)

/** The page's split-by-chain bar: where the money sits, at a glance, in each
 *  chain's own color. One chain would be the whole bar, so it draws from two
 *  chains up. */
function SplitBar({ chains }: { chains: WalletChainView[] }) {
  const shares = chainShares(chains)
  if (shares.length < 2) return null
  return (
    <div className="mt-4" data-wallet-split>
      <div
        role="img"
        aria-label={`Split by chain: ${shares.map((s) => `${s.name} ${fmtShare(s.share)}`).join(', ')}`}
        className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full"
      >
        {shares.map((s) => (
          <span
            key={s.id}
            title={`${s.name} · ${fmtUsd(s.usd)} · ${fmtShare(s.share)}`}
            className="h-full"
            style={{ flexGrow: s.share, flexBasis: 0, minWidth: 3, background: s.color }}
          />
        ))}
      </div>
      <div aria-hidden className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[color:var(--muted)]">
        {shares.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
            {s.name}
            <span className="mono tabular-nums text-[color:var(--muted-2)]">{fmtShare(s.share)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** The whole wallet window, frame-agnostic: the modal and the /wallet page
 *  both render this. */
export function WalletDetails({
  address,
  layout,
  onLeave,
  onWalletSettings,
}: {
  address: `0x${string}`
  layout: 'modal' | 'page'
  /** The frame should step aside: a row chip carried its ask to the chat, or
   *  wallet settings is taking over. The modal closes; the page stays put. */
  onLeave?: () => void
  /** RainbowKit's account modal — switch wallet / disconnect / copy. */
  onWalletSettings?: () => void
}) {
  const page = layout === 'page'
  const { chain } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const pathname = usePathname()
  const router = useRouter()
  const setComposerPrefill = useYeetfulStore((s) => s.setComposerPrefill)
  // A row chip lands its ask in the chat composer (prefill only — a chip
  // never fires a money action; the user reads it and presses enter). On a
  // chat surface the store prefill is enough; anywhere else (the /wallet page
  // included), carry it to /chat via the same ?prompt= contract the landing's
  // examples use.
  const askFromRow = useCallback(
    (prompt: string) => {
      setComposerPrefill(prompt)
      const onChatSurface = /^\/(chat|i\/|embed|p\/)/.test(pathname ?? '')
      if (!onChatSurface) router.push(`/chat?prompt=${encodeURIComponent(prompt)}`)
      onLeave?.()
    },
    [setComposerPrefill, pathname, router, onLeave],
  )
  const [view, setView] = useState<WalletView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [receive, setReceive] = useState(false)
  const [sending, setSending] = useState(false)
  const [justSent, setJustSent] = useState<string | null>(null)
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)
  const [wait, setWait] = useState<FundWait | null>(null)
  // Per-chain "+$X just landed" flashes: totals from the previous read.
  const prevTotals = useRef<Map<number, number>>(new Map())
  const [landed, setLanded] = useState<Map<number, number>>(new Map())

  const load = useCallback(
    async (fresh: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/wallet?address=${address}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' })
        const data = (await res.json()) as WalletView & { error?: string }
        if (!res.ok) throw new Error(data.error || `Could not read the wallet (${res.status}).`)
        // Compare against the last read: a chain whose total rose is money
        // that just arrived — say so on the row for a beat.
        const flashes = new Map<number, number>()
        for (const c of data.chains) {
          const before = prevTotals.current.get(c.id)
          if (before !== undefined && c.totalUsd - before >= 0.5) flashes.set(c.id, Math.round((c.totalUsd - before) * 100) / 100)
          prevTotals.current.set(c.id, c.totalUsd)
        }
        if (flashes.size) {
          setLanded(flashes)
          setTimeout(() => setLanded(new Map()), 20_000)
        }
        setView(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read the wallet.')
      } finally {
        setLoading(false)
      }
    },
    [address],
  )

  // Every mount is a fresh look: the modal mounts this body on each open, the
  // page on arrival (and again on an account switch — it keys by address).
  useEffect(() => {
    prevTotals.current = new Map()
    setView(null)
    setSending(false)
    setReceive(false)
    setJustSent(null)
    setWait(loadFundWait(address))
    void load(false)
    const t = setInterval(() => void load(false), REFRESH_MS)
    return () => clearInterval(t)
  }, [address, load])

  const funded = useMemo(() => (view ? view.chains.filter((c) => c.holdings.length > 0 || c.unread) : []), [view])
  const emptyChains = useMemo(() => (view ? view.chains.filter((c) => c.holdings.length === 0 && !c.unread) : []), [view])
  const stalled = useMemo(() => (view ? view.chains.filter((c) => c.gas === 'none') : []), [view])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the address is shown for manual copy */
    }
  }

  // Called synchronously off the click: startOnrampSession opens the tab as
  // its first statement (a popup after an await is not a user gesture).
  const buy = async () => {
    if (buying) return
    setBuyError(null)
    setBuying(true)
    const res = await startOnrampSession({
      address,
      fund: { presetFiatUsd: PANEL_TOPUP_USD, asset: ONRAMP_ASSET, network: ONRAMP_DEFAULT_NETWORK },
      signMessage: signMessageAsync,
    })
    setBuying(false)
    if (!res.ok) setBuyError(res.error)
  }

  // ── The window's pieces. Each frame arranges them; the pieces themselves
  //    are the same in both. ──

  const addressRow = (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={copy}
        title="Copy address"
        className="inline-flex max-w-full items-center gap-1.5 mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] bg-[var(--surf-1)] border border-[var(--line)] rounded-lg px-2.5 py-1.5 transition-colors"
      >
        <span className={cn('min-w-0 truncate', !page && 'max-w-[260px]')}>{address}</span>
        {copied ? <Check className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--accent)]" /> : <Copy className="w-3.5 h-3.5 flex-shrink-0" />}
      </button>
      {chain && <span className="text-[11px] text-[color:var(--muted-2)]">wallet on {chain.name}</span>}
    </div>
  )

  const totalRow = (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-2)]">Across every chain</div>
        <div
          className={cn(
            'leading-none font-semibold tracking-tight tabular-nums text-[color:var(--fg)]',
            page ? 'mt-2 text-[40px] sm:text-[52px]' : 'mt-1 text-[34px]',
          )}
        >
          {view ? fmtUsd(view.totalUsd) : loading ? <span className="text-[color:var(--muted-2)]">…</span> : '—'}
        </div>
        <div className={cn('mt-1.5 text-[color:var(--muted)]', page ? 'text-[13px]' : 'text-[11.5px]')}>
          {view
            ? funded.length
              ? `on ${funded.filter((c) => !c.unread).map((c) => c.name).join(', ') || 'no chain yet'}`
              : 'nothing on any chain yet'
            : error
              ? error
              : 'reading balances…'}
          {view?.failedChains.length ? ` · ${view.failedChains.join(', ')} didn’t answer` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void load(true)}
        disabled={loading}
        className="flex-shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-[color:var(--muted)] hover:text-[color:var(--fg)] disabled:opacity-50 transition-colors"
        title="Read again now"
      >
        <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        {view ? `updated ${timeAgo(view.updatedAt)}` : 'refresh'}
      </button>
    </div>
  )

  // A card purchase is in flight — say we're watching for it.
  const waitBanner = wait && (
    <div className="flex items-start gap-2 rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/[0.06] px-3.5 py-2.5 text-[12px]">
      <Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin text-[color:var(--accent)] flex-shrink-0" />
      <span className="text-[color:var(--fg)]">
        Watching {ONRAMP_NETWORK_LABEL[wait.network] ?? wait.network} for your card purchase
        <span className="text-[color:var(--muted)]"> · opened {timeAgo(new Date(wait.openedAt).toISOString())}. The moment it lands, the chat picks up &ldquo;{wait.resume}&rdquo;.</span>
      </span>
    </div>
  )

  // Gas stalls, named before they bite.
  const stallBanner = stalled.length > 0 && (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-2.5 text-[12px]">
      <Fuel className="w-3.5 h-3.5 mt-0.5 text-amber-400 flex-shrink-0" />
      <span className="text-[color:var(--fg)]">
        {stalled.map((c) => c.name).join(' and ')} {stalled.length > 1 ? 'hold' : 'holds'} tokens but no ETH for gas
        <span className="text-[color:var(--muted)]"> — nothing there can move until a little ETH lands. Ask the chat to fund it and it plans the gas leg for you.</span>
      </span>
    </div>
  )

  const chainsList = (
    <div className="space-y-1.5">
      {view ? (
        <>
          {funded.map((c) => (
            <ChainRow key={c.id} chain={c} current={chain?.id === c.id} landed={landed.get(c.id) ?? null} onAsk={askFromRow} />
          ))}
          {emptyChains.length > 0 && (
            <div className="px-1 pt-1 text-[11.5px] text-[color:var(--muted-2)]">
              Nothing on {emptyChains.map((c) => c.name).join(' · ')}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[52px] rounded-xl border border-[var(--line)] bg-[var(--surf-1)] animate-pulse" />
          ))}
        </div>
      )}
    </div>
  )

  // Ways in — and the way out. On the page they stack as the right column's
  // head from lg up.
  const doors = (
    <div className={cn('grid grid-cols-1 sm:grid-cols-3 gap-2', page && 'lg:grid-cols-1')}>
      <button
        type="button"
        onClick={() => void buy()}
        disabled={buying}
        className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-2.5 text-left hover:border-[var(--line-2)] disabled:opacity-60 transition-colors"
      >
        {buying ? <Loader2 className="w-4 h-4 animate-spin text-[color:var(--muted-2)]" /> : <CreditCard className="w-4 h-4 text-[color:var(--accent)]" />}
        <span className="min-w-0">
          <span className="block text-[12.5px] font-medium text-[color:var(--fg)]">Add funds with a card</span>
          <span className="block text-[11px] text-[color:var(--muted)]">lands as {ONRAMP_ASSET} on {ONRAMP_NETWORK_LABEL[ONRAMP_DEFAULT_NETWORK]} · via Stripe</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          setSending((v) => !v)
          setReceive(false)
          setJustSent(null)
        }}
        disabled={!view}
        data-wallet-send-door
        className={cn(
          'flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors disabled:opacity-60',
          sending ? 'border-[var(--line-2)] bg-[var(--surf-2)]' : 'border-[var(--line)] bg-[var(--surf-1)] hover:border-[var(--line-2)]',
        )}
      >
        <Send className="w-4 h-4 text-[color:var(--accent)]" />
        <span className="min-w-0">
          <span className="block text-[12.5px] font-medium text-[color:var(--fg)]">Send to another wallet</span>
          <span className="block text-[11px] text-[color:var(--muted)]">{funded.length ? 'any token you hold · you sign' : 'nothing to send yet'}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          setReceive((r) => !r)
          setSending(false)
        }}
        className={cn(
          'flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
          receive ? 'border-[var(--line-2)] bg-[var(--surf-2)]' : 'border-[var(--line)] bg-[var(--surf-1)] hover:border-[var(--line-2)]',
        )}
      >
        <QrCode className="w-4 h-4 text-[color:var(--accent)]" />
        <span className="min-w-0">
          <span className="block text-[12.5px] font-medium text-[color:var(--fg)]">Receive from another wallet</span>
          <span className="block text-[11px] text-[color:var(--muted)]">same address on every chain</span>
        </span>
      </button>
    </div>
  )

  // What the doors open.
  const forms = (
    <>
      {buyError && <div className="text-[11.5px] text-[color:var(--sell)]">{buyError}</div>}
      {sending && view && (
        <WalletSendForm
          address={address}
          chains={view.chains}
          onBack={() => setSending(false)}
          onSent={(info) => {
            setJustSent(info.summary)
            // The index lags a block or two; read again shortly, and
            // once more so the Recent list picks the transfer up.
            setTimeout(() => void load(true), 4_000)
            setTimeout(() => void load(true), 20_000)
          }}
        />
      )}
      {justSent && !sending && (
        <div className="flex items-center gap-2 rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/[0.06] px-3.5 py-2 text-[12px]">
          <Check className="w-3.5 h-3.5 text-[color:var(--accent)] flex-shrink-0" />
          <span className="text-[color:var(--fg)] truncate">Sent — {justSent}</span>
        </div>
      )}
      {receive && (
        <div className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-3">
          <div className="rounded-lg bg-white p-2 flex-shrink-0">
            <QRCodeSVG value={address} size={96} bgColor="#ffffff" fgColor="#000000" level="M" />
          </div>
          <div className="min-w-0 text-[12px] text-[color:var(--muted)]">
            Send ETH or USDC to this address on Base, Ethereum, Arbitrum or Optimism. Send a little ETH too if you want it to be able to move on that chain.
            <code className="block mt-1.5 mono text-[11px] text-[color:var(--fg)] break-all">{address}</code>
          </div>
        </div>
      )}
    </>
  )

  // Recent activity. The page says so when the index has nothing for this
  // wallet; with no index configured it stays quiet (an empty list would
  // claim a history it never read).
  const recentRows = view ? view.activity.slice(0, RECENT_ROWS[layout]) : []
  const recentEyebrow = <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-2)] mb-1.5">Recent</div>
  const recent =
    recentRows.length > 0 ? (
      <div>
        {recentEyebrow}
        <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surf-1)]">
          {recentRows.map((a) => (
            <a
              key={`${a.chain}-${a.hash}`}
              href={a.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 px-3.5 py-2 text-[12px] hover:bg-white/[0.03] transition-colors"
            >
              {a.direction === 'in' ? (
                <ArrowDownLeft className="w-3.5 h-3.5 text-[color:var(--accent)] flex-shrink-0" />
              ) : (
                <ArrowUpRight className="w-3.5 h-3.5 text-[color:var(--muted)] flex-shrink-0" />
              )}
              <span className="flex-1 min-w-0 truncate text-[color:var(--fg)]">
                {a.direction === 'in' ? 'Received' : a.direction === 'out' ? 'Sent' : 'Moved'} {a.amount ? `${fmtBal(a.amount)} ` : ''}
                {a.asset}
                <span className="text-[color:var(--muted)]"> · {a.chain}</span>
              </span>
              <span className="text-[11px] text-[color:var(--muted-2)] flex-shrink-0">
                {a.timestamp ? timeAgo(new Date(a.timestamp * 1000).toISOString()) : ''}
              </span>
              <ExternalLink className="w-3 h-3 text-[color:var(--muted-2)] flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>
    ) : page && view?.sources.includes('alchemy') ? (
      <div>
        {recentEyebrow}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-3 text-[12px] text-[color:var(--muted)]">
          No transfers on any chain yet.
        </div>
      </div>
    ) : null

  // Wallet settings — RainbowKit's modal: switch / disconnect / copy.
  const settings = onWalletSettings && (
    <button
      type="button"
      onClick={() => {
        onLeave?.()
        onWalletSettings()
      }}
      className="inline-flex items-center gap-1.5 text-[11.5px] text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
    >
      <Settings2 className="w-3.5 h-3.5" />
      Wallet settings — switch or disconnect
    </button>
  )

  if (!page) {
    return (
      <div className="space-y-4">
        {addressRow}
        {totalRow}
        {waitBanner}
        {stallBanner}
        {chainsList}
        {doors}
        {forms}
        {recent}
        {settings}
      </div>
    )
  }

  // The page: what you hold on the left, what you can do and what happened on
  // the right. Below lg the columns stack in the modal's order.
  return (
    <div data-wallet-layout="page" className="grid items-start gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <div className="min-w-0 space-y-5">
        {addressRow}
        <div>
          {totalRow}
          {view && <SplitBar chains={view.chains} />}
        </div>
        {waitBanner}
        {stallBanner}
        {chainsList}
      </div>
      <div className="min-w-0 space-y-4">
        {doors}
        {forms}
        {recent}
        {settings}
      </div>
    </div>
  )
}

export default function WalletPanel({
  open,
  onClose,
  onWalletSettings,
}: {
  open: boolean
  onClose: () => void
  /** RainbowKit's account modal — switch wallet / disconnect / copy. */
  onWalletSettings?: () => void
}) {
  const { address, connector } = useAccount()
  const pathname = usePathname()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const kind = walletKind(connector?.id, connector?.name)

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && address && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-[6vh]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-label="Your wallet"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[540px] rounded-2xl border border-[var(--line-2)] bg-[var(--bg)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-5 pt-4 pb-3.5 border-b border-[var(--line)]">
              <span className="w-8 h-8 grid place-items-center rounded-lg bg-black/40 border border-[var(--line)] text-[color:var(--accent)]">
                <Wallet className="w-4 h-4" strokeWidth={2.5} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[color:var(--fg)]">{kind.label}</div>
                <div className="mono text-[10px] text-[color:var(--muted-2)] truncate">{kind.sub}</div>
              </div>
              {/* The page this window grew into (/wallet): the same body with
                  the whole screen, one step away. */}
              {!isWalletPath(pathname ?? '') && (
                <Link
                  href={WALLET_PAGE_HREF}
                  onClick={onClose}
                  aria-label="Open the wallet page"
                  title="Open as a page"
                  className="w-7 h-7 grid place-items-center rounded-lg text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-white/5 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </Link>
              )}
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-7 h-7 grid place-items-center rounded-lg text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[74vh] overflow-y-auto px-5 py-4">
              <WalletDetails address={address} layout="modal" onLeave={onClose} onWalletSettings={onWalletSettings} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
