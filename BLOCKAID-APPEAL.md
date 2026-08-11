# Blockaid false-positive appeal — x402 receiver wallet

> **Rebranded 2026-08-05:** the product formerly at `www.yeetful.com` is now
> **Pantessa** at `https://www.pantessa.com` (the old domain 307-redirects and
> stays up for installed integrations). The public record of the rename lives at
> `https://www.pantessa.com/rebrand`. Any appeal filed from this doc should name
> **both** domains so the redirect is disclosed, not discovered. Ready-to-post
> drafts for the rebrand disclosure itself (MetaMask appeal #273376, Blockaid,
> SEAL) are in `DISCLOSURE-REBRAND.md`.

MetaMask shows a **"This is a deceptive request"** warning (Powered by Blockaid)
when a user signs an x402 micropayment in the Pantessa chat. It flags the payment
**receiver** address as an "untrusted EOA." This is a false positive: the address
is Pantessa's own x402 settlement wallet, receiving standard EIP-3009
`TransferWithAuthorization` micropayments (typically **$0.004**), not a drainer.

MetaMask defers entirely to Blockaid's list — **no front-end change suppresses
this.** The fix is to get the address + domain de-flagged / allowlisted with
Blockaid. This doc is the appeal to submit.

## Facts (paste into the report)

| Field | Value |
|---|---|
| Flagged address (x402 receiver) | `0xe630826c26760f46339cda35621e3aac63736c4a` |
| Chain | Base mainnet (chainId 8453) |
| Token | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals) |
| Signature type | EIP-3009 `TransferWithAuthorization` (gasless USDC transfer auth) |
| Typical value | `4000` base units = **$0.004 USDC** per call |
| dApp domain | `https://www.pantessa.com` (apex `https://pantessa.com`) |
| Prior domain | `https://www.yeetful.com` — renamed 2026-08-05, now 307 → pantessa.com |
| What it is | x402 agent-payment platform: users pay per MCP/API call in USDC on Base |

## Where to submit (in order)

1. **In-wallet "Report an issue" link** — the warning itself has
   *"Something doesn't look right? **Report an issue**"* which routes to Blockaid's
   false-positive intake. Fastest path; submit from the actual warning so the
   request payload is attached.
2. **Blockaid** — submit a false-positive / site-registration request via
   blockaid.io (their site has a report / dApp-registration flow). Register both
   domains and the receiver address as legitimate.
3. **MetaMask support** — secondary, in case the flag persists after Blockaid
   clears it (cache).

## Appeal text (copy-paste body)

> **Subject:** False-positive "deceptive request" on a legitimate x402 USDC micropayment
>
> The address `0xe630826c26760f46339cda35621e3aac63736c4a` on Base (8453) is the
> settlement-receiver wallet for **Pantessa** (https://www.pantessa.com, formerly
> Yeetful at https://www.yeetful.com — renamed 2026-08-05, old domain kept as a
> redirect; public record: https://www.pantessa.com/rebrand), an x402
> agent-payment platform. Users sign EIP-3009 `TransferWithAuthorization` messages
> to pay **per API/MCP call in USDC** — typical value `4000` base units (**$0.004**).
> These are standard, user-initiated x402 micropayments, not asset-draining
> approvals: each authorization is for a single small fixed amount with a short
> `validBefore` window and a unique nonce; there is no unlimited allowance.
>
> MetaMask (via Blockaid) currently shows "This is a deceptive request … untrusted
> EOA," which scares legitimate users away from a $0.004 payment. Please review and
> allowlist the receiver address and the domains `www.pantessa.com` and
> `www.yeetful.com`. Happy to provide example settled transactions, the x402
> challenge/response, and the typed-data schema on request.

## Stopgaps while the appeal is pending

- **In-app explainer (shipped):** the chat now shows a pre-signature confirmation
  with the real `$` amount and an honest note that the wallet may show this
  false-positive — so new users aren't spooked. (`components/PaymentConfirm.tsx`)
- **Receiver rotation (optional, owner-only):** the flag is address-specific, so
  moving x402 receipts to a fresh wallet clears it immediately — but it can
  re-accrue, and it touches the funded house wallet, so it's an owner decision.
- **Standard facilitator (longer-term):** routing settlement through a known x402
  facilitator (e.g. Coinbase's) makes the counterparty trusted infra rather than a
  bare EOA, reducing the "untrusted EOA" trigger. Larger change.

## Verify the amount is correct (not $4000)

The wallet shows `Value: 4000`. USDC has **6 decimals**, so that is `4000 / 1e6 =
$0.004`. A real $4000 charge would show `4000000000`. The signature matches the
advertised $0.004/call price.
