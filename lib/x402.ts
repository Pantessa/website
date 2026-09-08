import { getAddress, toHex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

/**
 * Minimal, version-aware x402 payer.
 *
 * The published `x402-fetch` (v1.2.0) only implements x402 **v1**. Our two
 * upstreams disagree on protocol version:
 *
 *   - Pantessa Anthropic MCP → x402 **v1** (network "base", `maxAmountRequired`,
 *     payment sent in the `X-PAYMENT` header, flat `{scheme, network, payload}`).
 *   - TripAdvisor (paysponge) → x402 **v2** (CAIP-2 network "eip155:8453",
 *     `amount`, payment sent in the `PAYMENT-SIGNATURE` header, payload wrapped
 *     in an `accepted` object).
 *
 * The EIP-3009 `TransferWithAuthorization` signature is identical across both;
 * only the envelope and header names differ. This payer reads the challenge,
 * detects the version, and formats accordingly.
 *
 * Spec: https://github.com/coinbase/x402 — specs/x402-specification-v2.md +
 * specs/transports-v2/http.md.
 */

const NETWORK_NAME_TO_CHAIN_ID: Record<string, number> = {
  base: 8453,
  "base-sepolia": 84532,
  avalanche: 43114,
  "avalanche-fuji": 43113,
  polygon: 137,
  "polygon-amoy": 80002,
  iotex: 4689,
  sei: 1329,
  "sei-testnet": 1328,
};

export const USDC_BY_CHAIN: Record<number, { address: string; name: string; version: string }> = {
  8453: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2" },
  84532: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USDC", version: "2" },
  137: { address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", name: "USD Coin", version: "2" },
};

// ─────────────────────────────────────────────────────────────────────────
//  PAYMENT BOUNDS (2026-09-08, SECURITY-AUDIT §B1 / §E1)
//
//  A 402 challenge is content authored by the SELLER. Until this fence the
//  payer signed the challenge's `amount`, `asset` and `payTo` verbatim — the
//  house burner for every auto-paid call, and the USER's wallet in wallet
//  mode, where the confirm card showed the DIRECTORY price ($0.01) while the
//  bytes carried whatever the challenge said. A listed "$0.01" endpoint could
//  ask for a 500 USDC EIP-3009 authorization to any address.
//
//  The rule: every payment is bounded by what the directory ADVERTISED
//  (`priceUsd`) plus a small tolerance, AND by an absolute per-call ceiling,
//  AND the asset must be the chain's canonical USDC, AND (when the directory
//  has recorded the seller's receiver) the payee must be that receiver. A
//  challenge outside the bounds is refused by name BEFORE anything is signed;
//  the settled amount is the CHALLENGE amount (≤ bounds), never the listed
//  price, so the ledger is honest. Fail closed: no bounds → no payment.
// ─────────────────────────────────────────────────────────────────────────

/** Hard per-call ceiling in USD — nothing a directory service asks per call
 *  clears this, whatever it advertises (the test directory tops out at $1). */
export const X402_ABSOLUTE_CEILING_USD = 2;
/** Tolerance over the advertised price (gateways round; a v1 `maxAmountRequired`
 *  can sit a hair above the listed price). 25% of $0.01 is a quarter cent. */
export const X402_PRICE_TOLERANCE = 0.25;
/** Rounding slack in USD for prices near zero (a $0.001 listing is 1000 atomic). */
export const X402_PRICE_SLACK_USD = 0.001;
const USDC_DECIMALS = 6;

export type X402RefusalCode = "amount" | "ceiling" | "asset" | "network" | "receiver" | "house-ceiling" | "unbounded";

/** A payment refused by the bounds — the message is user-facing copy. */
export class X402RefusedError extends Error {
  readonly code: X402RefusalCode;
  readonly askedUsd: number | null;
  constructor(code: X402RefusalCode, message: string, askedUsd: number | null = null) {
    super(message);
    this.name = "X402RefusedError";
    this.code = code;
    this.askedUsd = askedUsd;
  }
}

export function isX402Refusal(err: unknown): err is X402RefusedError {
  return err instanceof X402RefusedError || (err instanceof Error && err.name === "X402RefusedError");
}

export interface PaymentBounds {
  /** The directory's listed price for this call, USD. `0` = a free service:
   *  any 402 it raises is refused (a "free" row that charges is the attack). */
  advertisedUsd: number;
  /** The seller's receiver on record (`mcp_servers.receiver`, lowercased);
   *  when present the challenge's `payTo` must match it. */
  receiver?: string | null;
  /** Service name for the refusal copy. */
  label?: string;
  /** House-side reservation hook (burner payments only): called with the
   *  challenge amount BEFORE signing; a returned string is a refusal. */
  reserve?: (amountUsd: number) => Promise<string | null>;
}

export function usdToAtomic(usd: number): bigint {
  return BigInt(Math.ceil(Math.max(0, usd) * 10 ** USDC_DECIMALS - 1e-9));
}

export function atomicToUsd(atomic: bigint | string): number {
  const n = typeof atomic === "string" ? BigInt(atomic) : atomic;
  return Number(n) / 10 ** USDC_DECIMALS;
}

/** The largest challenge amount (atomic USDC) the bounds accept for a listed price. */
export function maxAcceptableAtomic(advertisedUsd: number): bigint {
  const adv = Number.isFinite(advertisedUsd) && advertisedUsd > 0 ? advertisedUsd : 0;
  const tolerated = usdToAtomic(adv * (1 + X402_PRICE_TOLERANCE) + X402_PRICE_SLACK_USD);
  const ceiling = usdToAtomic(X402_ABSOLUTE_CEILING_USD);
  return tolerated < ceiling ? tolerated : ceiling;
}

const fmtUsd = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;

/**
 * Check one chosen `accepts` entry against the bounds. Pure; throws
 * X402RefusedError with user-facing copy, or returns the checked facts.
 */
export function checkChallengeBounds(
  entry: AcceptsEntry,
  chainId: number,
  bounds: PaymentBounds | null | undefined,
): { amountAtomic: bigint; amountUsd: number; payTo: string; asset: string } {
  const who = bounds?.label ?? "This service";
  if (!bounds) {
    throw new X402RefusedError("unbounded", `${who} raised a payment challenge but no listed price was available to bound it — refused; nothing was signed.`);
  }
  const usdc = USDC_BY_CHAIN[chainId];
  if (!usdc) {
    throw new X402RefusedError("network", `${who} wants to be paid on a network Pantessa doesn't pay on (chain ${chainId}) — refused; nothing was signed.`);
  }
  const rawValue = entry.amount ?? entry.maxAmountRequired;
  if (!rawValue || !/^\d+$/.test(String(rawValue))) throw new Error("x402 challenge is missing a payment amount.");
  const amountAtomic = BigInt(rawValue);
  const amountUsd = atomicToUsd(amountAtomic);
  const asset = entry.asset ?? usdc.address;
  if (asset.toLowerCase() !== usdc.address.toLowerCase()) {
    throw new X402RefusedError("asset", `${who} asked to be paid in a token that isn't USDC on this chain (${asset}) — refused; Pantessa only pays USDC. Nothing was signed.`);
  }
  let payTo: string;
  try {
    payTo = getAddress(entry.payTo);
  } catch {
    throw new Error("x402 challenge payTo is not a valid address.");
  }
  if (bounds.receiver && bounds.receiver.toLowerCase() !== payTo.toLowerCase()) {
    throw new X402RefusedError("receiver", `${who}'s challenge names a different payee (${payTo}) than the receiver on record — refused; nothing was signed.`);
  }
  if (amountAtomic > usdToAtomic(X402_ABSOLUTE_CEILING_USD)) {
    throw new X402RefusedError(
      "ceiling",
      `${who} asked for ${fmtUsd(amountUsd)} per call — above Pantessa's ${fmtUsd(X402_ABSOLUTE_CEILING_USD)} per-call ceiling. Refused; nothing was signed.`,
      amountUsd,
    );
  }
  if (amountAtomic > maxAcceptableAtomic(bounds.advertisedUsd)) {
    const listed = bounds.advertisedUsd > 0 ? `is listed at ${fmtUsd(bounds.advertisedUsd)}` : "is listed as free";
    throw new X402RefusedError(
      "amount",
      `${who} asked for ${fmtUsd(amountUsd)} per call but ${listed} — refused; nothing was signed. Pantessa pays a listed price (plus a small rounding tolerance), never more.`,
      amountUsd,
    );
  }
  return { amountAtomic, amountUsd, payTo, asset: usdc.address };
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

interface AcceptsEntry {
  scheme: string;
  network: string;
  amount?: string; // v2
  maxAmountRequired?: string; // v1
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

interface Challenge {
  x402Version?: number;
  accepts?: AcceptsEntry[];
  resource?: { url: string; description?: string; mimeType?: string };
  extensions?: Record<string, unknown>;
}

export interface SettlementReceipt {
  success?: boolean;
  errorReason?: string;
  transaction?: string;
  network?: string;
  payer?: string;
}

function chainIdForNetwork(network: string): number {
  if (network.startsWith("eip155:")) {
    const id = Number(network.split(":")[1]);
    if (Number.isFinite(id)) return id;
  }
  const mapped = NETWORK_NAME_TO_CHAIN_ID[network];
  if (mapped) return mapped;
  throw new Error(`Unsupported x402 network: ${network}`);
}

function base64Encode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

function pickEvmAccepts(accepts: AcceptsEntry[]): AcceptsEntry {
  const evm = accepts.filter(
    (a) => a.scheme === "exact" && (a.network.startsWith("eip155:") || a.network in NETWORK_NAME_TO_CHAIN_ID),
  );
  if (evm.length === 0) throw new Error("No supported EVM payment option in x402 challenge.");
  return evm.find((a) => chainIdForNetwork(a.network) === 8453) ?? evm[0];
}

async function readChallenge(res: Response): Promise<Challenge> {
  try {
    const body = (await res.clone().json()) as Challenge;
    if (body?.accepts?.length) return body;
  } catch {
    /* not JSON — try the header */
  }
  // v2 transport delivers the challenge in a PAYMENT-REQUIRED header (base64).
  const header =
    res.headers.get("payment-required") ?? res.headers.get("x-payment-required");
  if (header) {
    try {
      return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Challenge;
    } catch {
      /* fall through */
    }
  }
  throw new Error("402 received but no x402 challenge could be parsed.");
}

/**
 * EIP-712 typed data the payer must sign. Sent to the browser when the user's
 * connected wallet is paying; values are strings for JSON transport (the client
 * converts the uint256 fields to bigint before signing).
 */
export interface SigningRequest {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: typeof TRANSFER_WITH_AUTHORIZATION_TYPES;
  primaryType: "TransferWithAuthorization";
  message: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

/**
 * An unsigned payment: the header template (with a null signature slot) plus the
 * typed data to sign. Either the burner signs it locally, or it's shipped to the
 * browser for the connected wallet to sign.
 */
export interface PreparedPayment {
  headerName: string; // "PAYMENT-SIGNATURE" (v2) or "X-PAYMENT" (v1)
  payloadTemplate: Record<string, unknown>; // payload.signature is null until finalized
  signing: SigningRequest;
  /** The CHALLENGE amount in USD (what the signature authorizes) — ≤ the
   *  bounds by construction. Render THIS on any confirm surface, never the
   *  directory's listed price. */
  amountUsd: number;
  /** Checksummed payee the authorization pays. */
  payTo: string;
}

/** Fetch once; return the parsed challenge if it's a 402, else null. */
export async function getChallenge(input: string, init?: RequestInit): Promise<Challenge | null> {
  const res = await fetch(input, init);
  if (res.status !== 402) {
    await res.arrayBuffer().catch(() => {}); // drain to free the socket
    return null;
  }
  return readChallenge(res);
}

/**
 * The on-chain account an x402 endpoint is paid to (`payTo`), read straight from
 * its 402 challenge. This is the receiver in the MCP's OWN config — whoever
 * controls it collects the MCP's revenue. Returns null if the endpoint isn't a
 * readable x402 402. Used to verify MCP ownership (sign in with this wallet).
 */
export async function getReceiver(input: string, init?: RequestInit): Promise<string | null> {
  try {
    const challenge = await getChallenge(input, init);
    if (!challenge?.accepts?.length) return null;
    return getAddress(pickEvmAccepts(challenge.accepts).payTo);
  } catch {
    return null;
  }
}

/**
 * Derive an unsigned payment (header template + typed data) for a given payer
 * address — without signing. Works for both x402 v1 and v2 challenges.
 *
 * `bounds` is REQUIRED: the challenge's amount/asset/payee are checked
 * against the directory's listed price + the absolute ceiling + the chain's
 * canonical USDC (+ the recorded receiver when known) before any typed data
 * exists. A challenge outside the bounds throws X402RefusedError with
 * user-facing copy; nothing is signed.
 */
export function derivePayment(challenge: Challenge, fromAddress: string, bounds: PaymentBounds): PreparedPayment {
  const entry = pickEvmAccepts(challenge.accepts ?? []);
  const chainId = chainIdForNetwork(entry.network);
  const checked = checkChallengeBounds(entry, chainId, bounds);
  const usdc = USDC_BY_CHAIN[chainId];
  if (!usdc) throw new X402RefusedError("network", `Unsupported x402 payment chain ${chainId}.`);

  const value = checked.amountAtomic.toString();
  // The asset is PINNED to the chain's USDC (checked above), so the EIP-712
  // domain is USDC's own — a challenge's `extra` can't steer the signature
  // onto another verifying contract's domain.
  const asset = usdc.address;
  const name = usdc.name;
  const version = usdc.version;

  const now = Math.floor(Date.now() / 1000);
  // EIP-3009 validity window. `maxTimeoutSeconds` is the gateway's hold hint, but
  // some gateways set it as low as 30s (e.g. CoinMarketCap) — fine for the burner
  // (signs + retries in <1s) but far too short for WALLET mode, where the human
  // reviews and signs in their wallet over several seconds, so the authorization
  // expires before the retry settles → a bare "402 Payment Required". Floor the
  // window to a human-friendly minimum; a longer validBefore is strictly more
  // permissive on-chain (EIP-3009 only checks validAfter < now < validBefore).
  const SIGN_WINDOW_FLOOR_SECONDS = 600;
  const window = Math.max(entry.maxTimeoutSeconds ?? 300, SIGN_WINDOW_FLOOR_SECONDS);
  const authorization = {
    from: getAddress(fromAddress),
    to: checked.payTo,
    value,
    validAfter: String(now - 600), // tolerate clock skew
    validBefore: String(now + window),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };

  const domain = { name, version, chainId, verifyingContract: getAddress(asset) };
  const x402Version = challenge.x402Version ?? 1;

  let headerName: string;
  let payloadTemplate: Record<string, unknown>;
  if (x402Version >= 2) {
    // v2: PAYMENT-SIGNATURE header, chosen requirement wrapped in `accepted`.
    headerName = "PAYMENT-SIGNATURE";
    payloadTemplate = {
      x402Version,
      resource: challenge.resource,
      accepted: entry,
      payload: { signature: null, authorization },
      extensions: challenge.extensions ?? {},
    };
  } else {
    // v1: X-PAYMENT header, flat scheme/network.
    headerName = "X-PAYMENT";
    payloadTemplate = {
      x402Version,
      scheme: "exact",
      network: entry.network,
      payload: { signature: null, authorization },
    };
  }

  return {
    headerName,
    payloadTemplate,
    signing: { domain, types: TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization", message: authorization },
    amountUsd: checked.amountUsd,
    payTo: checked.payTo,
  };
}

/** The USD a prepared payment's SIGNATURE authorizes (from the signed value,
 *  not any side field) — the only honest ledger amount for wallet mode. */
export function preparedAmountUsd(prepared: Pick<PreparedPayment, "signing"> | null | undefined): number | null {
  const v = prepared?.signing?.message?.value;
  if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
  return atomicToUsd(v);
}

/** Insert a signature into a prepared payment and base64-encode the header value. */
export function finalizePaymentHeader(
  prepared: PreparedPayment,
  signature: string,
): { name: string; value: string } {
  const tpl = prepared.payloadTemplate as { payload: { signature: string | null } };
  tpl.payload.signature = signature;
  return { name: prepared.headerName, value: base64Encode(JSON.stringify(prepared.payloadTemplate)) };
}

/** Retry a request with a finalized payment header attached. */
export function fetchWithPaymentHeader(
  input: string,
  init: RequestInit | undefined,
  header: { name: string; value: string },
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set(header.name, header.value);
  return fetch(input, { ...init, headers });
}

/**
 * `fetch`, but it transparently answers any x402 `402 Payment Required`
 * challenge (v1 or v2) by signing an EIP-3009 authorization with the burner
 * account, attaching it in the correct header, and retrying once.
 */
export async function payAndFetch(
  account: PrivateKeyAccount,
  input: string,
  init: RequestInit | undefined,
  bounds: PaymentBounds,
): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 402) return first;

  const challenge = await readChallenge(first);
  // Bounds first — a refusal throws before any typed data is signed.
  const prepared = derivePayment(challenge, account.address, bounds);
  // House-side reservation (the daily ceiling) — also before signing.
  if (bounds.reserve) {
    const refusal = await bounds.reserve(prepared.amountUsd);
    if (refusal) throw new X402RefusedError("house-ceiling", refusal, prepared.amountUsd);
  }
  const m = prepared.signing.message;
  const d = prepared.signing.domain;
  const signature = await account.signTypedData({
    domain: { ...d, verifyingContract: d.verifyingContract as `0x${string}` },
    types: prepared.signing.types,
    primaryType: prepared.signing.primaryType,
    message: {
      from: m.from as `0x${string}`,
      to: m.to as `0x${string}`,
      value: BigInt(m.value),
      validAfter: BigInt(m.validAfter),
      validBefore: BigInt(m.validBefore),
      nonce: m.nonce as `0x${string}`,
    },
  });

  const res = await fetchWithPaymentHeader(input, init, finalizePaymentHeader(prepared, signature));
  settledAmounts.set(res, prepared.amountUsd);
  return res;
}

/** Amount (USD) the payer AUTHORIZED for the response's request — keyed on the
 *  Response object payAndFetch returned. null = nothing was paid (no 402). */
const settledAmounts = new WeakMap<Response, number>();
export function paidAmountUsd(res: Response): number | null {
  return settledAmounts.get(res) ?? null;
}

/**
 * Build a concise human-readable failure reason from a non-OK x402 response.
 * Prefers the settlement `errorReason`, then a JSON body `error` field, then
 * the HTTP status. Common x402 errors: `invalid_exact_evm_insufficient_balance`
 * (fund the wallet with USDC), `invalid_exact_evm_signature`.
 */
export async function failureReason(res: Response): Promise<string> {
  const cap = (s: string) => (s.length > 400 ? s.slice(0, 400) + "…" : s);
  const settle = decodeSettlement(res);
  if (settle?.errorReason) return `${res.status} — payment ${settle.errorReason}`;
  try {
    const body = (await res.clone().json()) as { error?: unknown; message?: unknown; detail?: unknown; errors?: unknown };
    // Gateways disagree on the error field; some make it an OBJECT or array
    // (e.g. JSON:API `errors: [{title, detail}]`) — stringify so we never
    // surface a useless "[object Object]".
    const raw = body?.error ?? body?.message ?? body?.detail ?? body?.errors;
    if (raw !== undefined && raw !== null) {
      const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
      return cap(`${res.status} — ${msg}`);
    }
  } catch {
    /* not JSON */
  }
  const text = await res.text().catch(() => "");
  return cap(`${res.status} ${res.statusText} ${text}`.trim());
}

/** Decode the settlement header (v2 `PAYMENT-RESPONSE` or v1 `X-PAYMENT-RESPONSE`). */
export function decodeSettlement(res: Response): SettlementReceipt | undefined {
  const header =
    res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  if (!header) return undefined;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as SettlementReceipt;
  } catch {
    return undefined;
  }
}
