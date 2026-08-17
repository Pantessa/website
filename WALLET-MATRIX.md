# Wallet matrix — will a stranger's wallet actually sign what we build?

Written 2026-08-17 off a live miss: Nate pressed the Hyperliquid card's own
"Close SYRUP" chip in prod and got

> An internal error was received. Details: Provided chainId "1337" must
> match the active chainId "4663" Version: viem@2.48.1

The ladder was right (a perfect reduce-only IOC close, nine guard checks
green, `tx-built` in telemetry). The **wallet** was the wall. MetaMask
refuses `eth_signTypedData_v4` whose `domain.chainId` is not the chain the
wallet is currently on — and Hyperliquid's L1 actions are signed under a
constant `chainId: 1337` that no wallet is ever "on". So every user-signed
HL order, leverage set, and close had been unsignable from MetaMask, on any
chain, since the day the layer shipped. Our harness never saw it because
the harness signs with raw keys, which police nothing.

That is the whole lesson of this file: **the server harness proves the
build; it cannot prove the signature.** Wild users bring wallets with
opinions. This document is (1) the matrix of what each artifact asks a
wallet to do and which wallets say no, (2) the instruments that now catch
this class automatically, and (3) the by-hand drill for launch day.

## 1. What shipped for the SYRUP miss (PR: fix/hl-delegated-sign)

- **Delegated execution for Hyperliquid L1 actions.** The venue's own
  answer to 1337 is its "Enable trading" step — an approved agent key signs
  L1 actions for the user. We already had that key: the guardian
  delegation (one per wallet, trade-only, can never withdraw, 90-day
  `valid_until`). Now the chat/i/embed card uses it too:
  - the wallet signs a **personal_sign consent** over the action's own hash
    (`lib/hyperliquid-exec.hlConsentMessage`) — chain-agnostic in every
    wallet; the relay recovers it, re-guards the action, and only then the
    agent signs the **same bytes** (`signL1ActionWithDelegation`);
  - path choice is deterministic: active delegation → consent (one popup);
    else try direct typed data, and a chain-mismatch refusal (which never
    opened a popup) switches to the delegated door in the same gesture —
    minting the agent first via the connect-only `/api/hl/delegation`
    (approveAgent typed data on the wallet's OWN chain, so MetaMask signs
    it; activation is signature-gated, a stranger's signature activates
    nothing);
  - the venue-visible agent name is now `pantessa` (rows minted under
    `yeetful-guardian` keep working; Nate's own row is one of them).
  Still one signature per action. `Rabby`, raw keys and the harness may
  keep signing 1337 directly.
- **The wallet-refusal beacon** (`lib/wallet-refusal.ts` →
  `POST /api/ask-failures/wallet`): a built + guarded artifact the wallet
  refused now lands in `/dashboard/failures` as kind `wallet-refused`,
  `had_funds` TRUE, `reply` = the wallet's own words, `funds_detail` = the
  connector + wallet chain. Human rejections never log; harness runs opt
  out (`x-yf-no-ask-log`). This is the instrument that would have caught
  the SYRUP wall on day one instead of in a screenshot.
- **The typed-data domain-chain audit** (test:api): every component that
  calls `signTypedDataAsync` must `switchChainAsync` onto the domain's
  chain first or sit on a reasoned allowlist. Two silent offenders were
  fixed en route: x402 payment signatures in chat and grant signatures.
- **Owner drill after deploy (Nate, MetaMask, any chain):** press "Close
  SYRUP" (or any smaller HL action). Expect ONE popup — a plain-text
  consent naming the action, wallet, nonce, hash — then a fill and the
  "via your Pantessa agent" tag. No "Enable trading" step: the venue
  already lists our agent `0xf6af…8419` on the account (checked via
  `extraAgents`, valid until 2026-10-15). If the venue has forgotten the
  agent, the card offers the one-time approval and continues.

## 2. The matrix — what each artifact asks the wallet, and who says no

Legend: **align** = the button switches the wallet onto the domain chain
before asking (MetaMask happy); **own** = the domain chainId IS the
wallet's current chain by construction; **none** = the domain carries no
chainId; **delegated** = unswitchable venue chain, so a consent + agent
door exists.

| Artifact | Wallet op | Domain chain | Status | Notes |
|---|---|---|---|---|
| Uniswap v3/v4/LiFi swaps, bridges, sends, Aave, Lido, NFT transfer, funding legs | `eth_sendTransaction` (SendTxButton / SendTxChain) | n/a | ✅ | Wallet switches to the tx chain; deadline calldata refreshes (#427/#428) |
| CoW swap / limit order | `signTypedData_v4` | order chain | ✅ align | SignOrderButton switches first (was already the Coinbase lesson) |
| OpenSea Seaport listing | `signTypedData_v4` (+ approve tx) | NFT chain | ✅ align | SignNftListingButton |
| Snapshot vote | `signTypedData_v4` | none | ✅ none | Snapshot's domain is name+version only |
| DCA autopilot / Spot Guardian arm (Spend Permission) | `signTypedData_v4` | Base 8453 | ✅ align | Arm buttons switch to Base |
| Spend grant | `signTypedData_v4` | grant chain | ✅ align (fixed this PR) | SignGrantButton never switched before |
| x402 paid catalog (wallet mode) | `signTypedData_v4` EIP-3009 | Base 8453 | ✅ align (fixed this PR) | ChatInterface payment loop never switched before |
| HL builder-fee cap approval | `signTypedData_v4` | own | ✅ own | Client builds it with the wallet's chainId |
| HL guardian approveAgent (dashboard + new connect-only door) | `signTypedData_v4` | own | ✅ own | |
| **HL order / close / leverage** | `signTypedData_v4` domain **1337** | unswitchable | ✅ **delegated** (this PR) | Was ❌ in MetaMask forever; direct path kept for wallets that allow it |
| SIWE / HL consent / intent-link claims | `personal_sign` | n/a | ✅ | Every wallet, any chain |

Wallet-side behaviors we know (add rows as strangers teach us):

| Wallet | Polices typed-data domain chain? | ERC-1271 (smart) | Second popup after an awaited call | Notes |
|---|---|---|---|---|
| MetaMask (extension + mobile) | **YES** — `Provided chainId "X" must match the active chainId "Y"`, thrown before any UI | no | ok | The majority wallet. The 1337 class. |
| Rabby | no | no | ok | Signs 1337 directly |
| Coinbase Wallet (EOA ext) | unverified | no | **breaks** — each signature needs its own gesture (the SignHlActionButton stepper exists for this) | keep `coinbaseWallet` eoaOnly |
| Coinbase Smart Wallet | n/a | **yes** — HL, CoW-presign paths that need EOA recovery will not verify | | Out of scope for HL by design |
| WalletConnect (Rainbow, Trust, …) | wallet-dependent | usually no | mobile round-trip | The delegated door covers the strict ones automatically |
| Our headless mock (`personal_sign` proxied to a local signer) | **configurable** — see §3 | no | ok | Run it STRICT: reject typed data whose domain chain ≠ active chain |

## 3. Instruments — how this class is caught without a human

1. **`/dashboard/failures` kind `wallet-refused`** (funded=1 queue). Zero
   rows after a stranger session = the wallets said yes. One row = a
   product gap with the wallet name, chain, artifact and the wallet's exact
   words attached. `npm run digest:gtm` lists funded failures first, so
   these ride the daily digest for free.
2. **`test:api` typed-data audit** — a new `signTypedDataAsync` caller
   that neither aligns the chain nor carries an allowlist reason fails the
   gate before it ships.
3. **`test:api` HL delegated checks** — consent binds bytes (stranger /
   tampered / fee-approval refuse), 409 door without an agent, offline
   agent-key round trip, connect-only mint on the wallet's chain,
   signature-gated activation.
4. **The strict mock wallet (headless recipe, memory
   `headless-dashboard-verify`)** — inject the mock EIP-6963 provider with
   `eth_signTypedData_v4` that THROWS MetaMask's exact error when
   `Number(domain.chainId) !== activeChain`. Proven 2026-08-17 on a prod
   build: Nate's-address drive took the delegated branch (one
   `personal_sign`, zero typed-data prompts, relay refused the impostor
   consent); a fresh-wallet drive rejected 1337, logged the refusal, minted
   the agent, signed approveAgent on 4663, and the venue answered "Must
   deposit before performing actions" — the honest end for a wallet with no
   HL account. Use it for every new signature surface.

## 4. Launch-day drill — by hand, ten minutes per wallet, before ten strangers

Do this on **www.pantessa.com** with `/dashboard/failures` open in a
second tab. One row per line; write the wallet's exact words if it says no.

| # | Ask (our own chips) | MetaMask · wallet on Base | MetaMask · wallet on Robinhood 4663 | Rabby | Coinbase ext | phone (WalletConnect) |
|---|---|---|---|---|---|---|
| 1 | Swap $1 of ETH to USDC (Base) | | | | | |
| 2 | Sell $50 of ETH (CoW) | | | | | |
| 3 | Buy $12 of AAPL on Robinhood (bridge + buy) | | | | | |
| 4 | Close SYRUP / any HL close (delegated) | | | | | |
| 5 | I want a 2X long $12 of HYPE + 5% stop (leverage + order + guardian) | | | | | |
| 6 | Protect my ETH on Base with a 10% stop (Spot Guardian, Spend Permission) | | | | | |
| 7 | DCA $10 into AAPL weekly (confirm-mode buy) | | | | | |
| 8 | Stake 0.05 ETH with Lido | | | | | |
| 9 | Sell my NFT (Seaport listing) | | | | | |
| 10 | Snapshot vote | | | | | |

Pass = the wallet prompt opens, the artifact settles, the receipt renders,
`/dashboard/failures` gained nothing. Anything else is a row here AND a
`wallet-refused` row there. Fill the MetaMask columns first — it is the
wallet most strangers bring, and every 4663-column cell is a chain the
wallet is "not on" for everything but Robinhood.

## 5. What we still cannot prove without a person

- That a real MetaMask popup renders our consent text legibly (it does
  render `personal_sign` text; check the line breaks on mobile).
- Coinbase Wallet extension's typed-data domain policy (unverified either
  way — the delegated door makes it moot for HL).
- Phone wallets over WalletConnect: round-trip latency vs the 120-second
  nonce freshness on HL builds (a slow approve → "stale — ask again").
