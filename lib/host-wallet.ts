// Host-wallet bridge (embed contract v1.1) — the child half.
//
// When the chat runs inside a cross-origin iframe (/embed) and the host page
// uses the `yeetful/embed` SDK (>= 0.9.0) with a configured EIP-1193 provider,
// the SDK relays JSON-RPC over postMessage:
//
//   child → parent  { source:'yeetful-embed', v:1, type:'rpc', id, method, params? }
//   parent → child  { … type:'rpc:result', id, result }
//                 | { … type:'rpc:error',  id, error:{ code, message } }
//   parent → child  { … type:'wallet', accounts:string[], chainId:string|null }
//                   (sent after 'ready' when the host configured a provider, and
//                    on accountsChanged / chainChanged / disconnect; empty
//                    accounts = bridge available but not connected)
//
// This module provides (1) the transport — a promise-map RPC client pinned to
// the ONE host origin, with child-side timeouts — and (2) a wagmi v2 connector
// ('yeetfulHost') that turns the bridge into a real wagmi account, so
// useAccount / useSignTypedData / useSendTransaction / useSwitchChain all work
// inside the iframe while every signature pops the user's own wallet on the
// HOST page. The parent side enforces a method allowlist (see the docs page);
// disallowed methods come back as rpc:error code 4200.
//
// Origin discipline mirrors EmbedChat: we only accept messages whose
// event.origin === the pinned host origin, and only post to that origin. The
// transport installs its OWN window 'message' listener (simpler than routing
// through EmbedChat's) with identical checks.

import { createConnector } from 'wagmi'
import { getAddress, numberToHex, SwitchChainError, UserRejectedRequestError, type Address } from 'viem'

const SOURCE = 'yeetful-embed'
const V = 1

// ── Timeouts ────────────────────────────────────────────────────────────────
// Interactive methods wait on a human at the host page's wallet — give them
// 5 minutes. Everything else is a plain RPC round-trip — 30s.
const INTERACTIVE_METHODS = new Set([
  'eth_requestAccounts',
  'personal_sign',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
])
export const INTERACTIVE_TIMEOUT_MS = 300_000
export const DEFAULT_TIMEOUT_MS = 30_000

export const isInteractiveMethod = (method: string) => INTERACTIVE_METHODS.has(method)

/** EIP-1193-shaped provider error (viem sniffs `.code`, e.g. 4001 = rejected). */
export class HostRpcError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = 'HostRpcError'
    this.code = code
  }
}

// ── Announce store (module-global; SSR-safe — no window access) ─────────────

export interface HostWalletState {
  /** A 'wallet' announce has arrived — the host page configured a provider. */
  available: boolean
  accounts: Address[]
  /** As announced by the host (hex '0x2105' or decimal string); null = unknown. */
  chainId: string | null
}

const INITIAL_STATE: HostWalletState = { available: false, accounts: [], chainId: null }
let state: HostWalletState = INITIAL_STATE
const stateListeners = new Set<(s: HostWalletState) => void>()

export function getHostWalletState(): HostWalletState {
  return state
}
/** SSR snapshot for useSyncExternalStore — the pre-announce constant. */
export function getHostWalletServerState(): HostWalletState {
  return INITIAL_STATE
}
export function subscribeHostWallet(fn: (s: HostWalletState) => void): () => void {
  stateListeners.add(fn)
  return () => stateListeners.delete(fn)
}
function setHostWalletState(next: HostWalletState) {
  state = next
  stateListeners.forEach((fn) => fn(next))
}

const isHexAddress = (s: unknown): s is Address => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s)

/** Validate a 'wallet' announce payload; null when malformed (drop it). */
export function parseWalletAnnounce(d: unknown): HostWalletState | null {
  const m = d as { accounts?: unknown; chainId?: unknown } | null
  if (!m || !Array.isArray(m.accounts)) return null
  const accounts = m.accounts.filter(isHexAddress).map((a) => getAddress(a))
  const chainId = typeof m.chainId === 'string' && m.chainId ? m.chainId : null
  return { available: true, accounts, chainId }
}

/** '0x2105' | '8453' → 8453; null/garbage → null. */
export function parseChainId(chainId: string | null): number | null {
  if (!chainId) return null
  const n = Number(chainId)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

// ── Transport ───────────────────────────────────────────────────────────────
// Pure request/dispatch core: postMessage side-effect + timeouts injected, so
// the promise-map logic is unit-testable without a window (scripts/
// test-host-wallet.ts).

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class HostBridgeTransport {
  private pending = new Map<string, Pending>()
  constructor(
    private post: (msg: Record<string, unknown>) => void,
    private timeouts: { interactive: number; default: number } = {
      interactive: INTERACTIVE_TIMEOUT_MS,
      default: DEFAULT_TIMEOUT_MS,
    },
  ) {}

  request(method: string, params?: unknown[]): Promise<unknown> {
    const id = crypto.randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const ms = isInteractiveMethod(method) ? this.timeouts.interactive : this.timeouts.default
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('host wallet request timed out'))
      }, ms)
      this.pending.set(id, { resolve, reject, timer })
      this.post({ source: SOURCE, v: V, type: 'rpc', id, method, ...(params !== undefined ? { params } : {}) })
    })
  }

  /** Feed an (already origin-verified) message. Returns true when consumed. */
  handleMessage(data: unknown): boolean {
    const d = data as {
      source?: unknown
      v?: unknown
      type?: unknown
      id?: unknown
      result?: unknown
      error?: { code?: unknown; message?: unknown }
    } | null
    if (!d || d.source !== SOURCE || d.v !== V) return false
    if (d.type !== 'rpc:result' && d.type !== 'rpc:error') return false
    if (typeof d.id !== 'string') return false
    const p = this.pending.get(d.id)
    if (!p) return false
    this.pending.delete(d.id)
    clearTimeout(p.timer)
    if (d.type === 'rpc:result') p.resolve(d.result)
    else {
      const code = typeof d.error?.code === 'number' ? d.error.code : -32603
      const message = typeof d.error?.message === 'string' ? d.error.message : 'host wallet request failed'
      p.reject(new HostRpcError(code, message))
    }
    return true
  }
}

// ── Singleton bridge (browser-only) ─────────────────────────────────────────

let bridge: { origin: string; transport: HostBridgeTransport } | null = null

/**
 * Wire the bridge to the ONE host origin. Idempotent; the first caller pins
 * the origin for the page's lifetime (an /embed load has exactly one host).
 * No-op outside an iframe. Call this BEFORE posting 'ready' so the host's
 * initial 'wallet' announce is never missed.
 */
export function initHostWalletBridge(hostOrigin: string): HostBridgeTransport | null {
  if (typeof window === 'undefined' || window.parent === window) return null
  if (bridge) return bridge.origin === hostOrigin ? bridge.transport : null
  const transport = new HostBridgeTransport((msg) => window.parent.postMessage(msg, hostOrigin))
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== hostOrigin) return
    const d = e.data as { source?: unknown; v?: unknown; type?: unknown } | null
    if (!d || d.source !== SOURCE || d.v !== V) return
    if (d.type === 'wallet') {
      const announce = parseWalletAnnounce(d)
      if (announce) setHostWalletState(announce)
    } else {
      transport.handleMessage(d)
    }
  })
  bridge = { origin: hostOrigin, transport }
  return transport
}

export function getHostWalletBridge(): HostBridgeTransport | null {
  return bridge?.transport ?? null
}

// ── The wagmi connector ─────────────────────────────────────────────────────

export const HOST_WALLET_CONNECTOR_ID = 'yeetfulHost'

type ProviderEvent = 'accountsChanged' | 'chainChanged' | 'disconnect'
type Listener = (...args: unknown[]) => void

/**
 * 'Host wallet' — a wagmi v2 connector backed by the postMessage bridge.
 *
 * Registered GLOBALLY in lib/wagmi.ts but inert everywhere except a bridged
 * /embed: it carries NO `icon`, so RainbowKit's isEIP6963Connector check
 * (name + uid + data:image icon — see the cdp-embedded.ts note) never lists it
 * in the Connect Wallet modal, `isAuthorized()` is false until a host announce
 * arrives, and nothing outside EmbedChat connects it programmatically. The
 * main-site RainbowKit flow (incl. the load-bearing eoaOnly Coinbase setup) is
 * untouched.
 *
 * disconnect() only clears LOCAL wagmi state — we can't disconnect the host
 * page's wallet, and the bridge stays available for a later reconnect.
 */
export function hostWalletConnector() {
  return createConnector<{
    request(args: { method: string; params?: unknown }): Promise<unknown>
    on(event: ProviderEvent, fn: Listener): void
    removeListener(event: ProviderEvent, fn: Listener): void
  }>((config) => {
    let connected = false
    let unsubscribeStore: (() => void) | null = null
    let lastAccountsKey: string | null = null
    let lastChainId: string | null = null

    // Tiny emitter so getProvider() is EIP-1193-shaped for anything that
    // subscribes directly (viem only calls request(), but be a good citizen).
    const providerListeners = new Map<ProviderEvent, Set<Listener>>()
    const emitProvider = (event: ProviderEvent, ...args: unknown[]) =>
      providerListeners.get(event)?.forEach((fn) => fn(...args))

    const provider = {
      async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
        const transport = getHostWalletBridge()
        if (!transport) throw new HostRpcError(4900, 'Host wallet bridge is not available')
        return transport.request(method, params as unknown[] | undefined)
      },
      on(event: ProviderEvent, fn: Listener) {
        if (!providerListeners.has(event)) providerListeners.set(event, new Set())
        providerListeners.get(event)!.add(fn)
      },
      removeListener(event: ProviderEvent, fn: Listener) {
        providerListeners.get(event)?.delete(fn)
      },
    }

    async function resolveChainId(): Promise<number> {
      const announced = parseChainId(getHostWalletState().chainId)
      if (announced !== null) return announced
      const hex = (await provider.request({ method: 'eth_chainId' })) as string
      const n = parseChainId(hex)
      if (n === null) throw new Error(`host wallet returned an unparseable chainId: ${hex}`)
      return n
    }

    return {
      id: HOST_WALLET_CONNECTOR_ID,
      name: 'Host wallet',
      type: 'yeetfulHost' as const,

      async setup() {
        // Track host-side announces for the connected session: account/chain
        // changes flow into wagmi; an empty announce = the host disconnected.
        if (unsubscribeStore) return
        unsubscribeStore = subscribeHostWallet((s) => {
          if (!connected) return
          if (!s.available || s.accounts.length === 0) {
            this.onDisconnect()
            return
          }
          const accountsKey = s.accounts.join(',')
          if (accountsKey !== lastAccountsKey) {
            lastAccountsKey = accountsKey
            this.onAccountsChanged(s.accounts)
          }
          if (s.chainId !== lastChainId) {
            lastChainId = s.chainId
            const n = parseChainId(s.chainId)
            if (n !== null) this.onChainChanged(String(n))
          }
        })
      },

      async connect({ chainId, withCapabilities } = {}) {
        // Prefer already-announced accounts (silent — the host wallet is
        // connected); only eth_requestAccounts when we genuinely need the host
        // page's wallet to prompt.
        const announced = getHostWalletState()
        let accounts: Address[]
        if (announced.accounts.length > 0) {
          accounts = announced.accounts
        } else {
          const raw = (await provider.request({ method: 'eth_requestAccounts' })) as unknown
          accounts = (Array.isArray(raw) ? raw : []).filter(isHexAddress).map((a) => getAddress(a))
          if (accounts.length === 0) throw new UserRejectedRequestError(new Error('no accounts returned by the host wallet'))
        }
        let currentChainId = await resolveChainId()
        if (chainId !== undefined && currentChainId !== chainId) {
          // Best-effort — wagmi surfaces an unsupported chain on the account.
          const chain = await this.switchChain?.({ chainId }).catch(() => null)
          currentChainId = chain?.id ?? currentChainId
        }
        connected = true
        lastAccountsKey = accounts.join(',')
        lastChainId = getHostWalletState().chainId
        return {
          // wagmi 2.14 connect() generic: EIP-5792 capability-annotated accounts
          // when asked (we have none to report), plain addresses otherwise.
          accounts: (withCapabilities ? accounts.map((address) => ({ address, capabilities: {} })) : accounts) as never,
          chainId: currentChainId,
        }
      },

      async disconnect() {
        // Local only: the host's wallet stays connected to the host page and
        // the bridge stays up (announces keep flowing; reconnect is one click).
        connected = false
        lastAccountsKey = null
        lastChainId = null
      },

      async getAccounts() {
        const announced = getHostWalletState()
        if (announced.accounts.length > 0) return announced.accounts
        const raw = (await provider.request({ method: 'eth_accounts' })) as unknown
        return (Array.isArray(raw) ? raw : []).filter(isHexAddress).map((a) => getAddress(a))
      },

      async getChainId() {
        return resolveChainId()
      },

      async getProvider() {
        return provider
      },

      async isAuthorized() {
        // True only once the host announced connected accounts — false on the
        // main site (no bridge), so wagmi's reconnect-on-mount never touches
        // this connector there.
        return getHostWalletState().accounts.length > 0
      },

      async switchChain({ chainId }) {
        const chain = config.chains.find((c) => c.id === chainId)
        if (!chain) throw new SwitchChainError(new Error(`chain ${chainId} is not configured`))
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: numberToHex(chainId) }],
        })
        lastChainId = String(chainId)
        config.emitter.emit('change', { chainId })
        emitProvider('chainChanged', numberToHex(chainId))
        return chain
      },

      onAccountsChanged(accounts) {
        if (accounts.length === 0) this.onDisconnect()
        else {
          config.emitter.emit('change', { accounts: accounts.map((a) => getAddress(a)) })
          emitProvider('accountsChanged', accounts)
        }
      },

      onChainChanged(chainIdStr) {
        const n = parseChainId(chainIdStr)
        if (n === null) return
        config.emitter.emit('change', { chainId: n })
        emitProvider('chainChanged', numberToHex(n))
      },

      onDisconnect() {
        connected = false
        lastAccountsKey = null
        lastChainId = null
        config.emitter.emit('disconnect')
        emitProvider('disconnect')
      },
    }
  })
}
