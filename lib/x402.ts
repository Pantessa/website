import { getAddress, toHex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

/**
 * Minimal, version-aware x402 payer.
 *
 * The published `x402-fetch` (v1.2.0) only implements x402 **v1**. Our two
 * upstreams disagree on protocol version:
 *
 *   - Yeetful Anthropic MCP → x402 **v1** (network "base", `maxAmountRequired`,
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

const USDC_BY_CHAIN: Record<number, { address: string; name: string; version: string }> = {
  8453: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2" },
  84532: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USDC", version: "2" },
  137: { address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", name: "USD Coin", version: "2" },
};

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

interface BuiltPayment {
  headerName: string; // "PAYMENT-SIGNATURE" (v2) or "X-PAYMENT" (v1)
  value: string; // base64-encoded PaymentPayload
}

async function buildPayment(account: PrivateKeyAccount, challenge: Challenge): Promise<BuiltPayment> {
  const entry = pickEvmAccepts(challenge.accepts ?? []);
  const chainId = chainIdForNetwork(entry.network);
  const usdc = USDC_BY_CHAIN[chainId];

  const value = entry.amount ?? entry.maxAmountRequired;
  if (!value) throw new Error("x402 challenge is missing a payment amount.");

  const asset = entry.asset ?? usdc?.address;
  if (!asset) throw new Error("x402 challenge is missing the asset address.");

  const name = entry.extra?.name ?? usdc?.name;
  const version = entry.extra?.version ?? usdc?.version;
  if (!name || !version) throw new Error("Cannot resolve the USDC EIP-712 domain for signing.");

  const now = Math.floor(Date.now() / 1000);
  const from = account.address;
  const to = getAddress(entry.payTo);
  const validAfter = now - 600; // tolerate clock skew
  const validBefore = now + (entry.maxTimeoutSeconds ?? 300);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));

  const signature = await account.signTypedData({
    domain: { name, version, chainId, verifyingContract: getAddress(asset) },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from,
      to,
      value: BigInt(value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });

  const authorization = {
    from,
    to,
    value,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce,
  };

  const x402Version = challenge.x402Version ?? 1;

  if (x402Version >= 2) {
    // v2: PAYMENT-SIGNATURE header, chosen requirement wrapped in `accepted`.
    const payload = {
      x402Version,
      resource: challenge.resource,
      accepted: entry,
      payload: { signature, authorization },
      extensions: challenge.extensions ?? {},
    };
    return { headerName: "PAYMENT-SIGNATURE", value: base64Encode(JSON.stringify(payload)) };
  }

  // v1: X-PAYMENT header, flat scheme/network.
  const payload = {
    x402Version,
    scheme: "exact",
    network: entry.network,
    payload: { signature, authorization },
  };
  return { headerName: "X-PAYMENT", value: base64Encode(JSON.stringify(payload)) };
}

/**
 * `fetch`, but it transparently answers any x402 `402 Payment Required`
 * challenge (v1 or v2) by signing an EIP-3009 authorization, attaching it in
 * the correct header, and retrying once.
 */
export async function payAndFetch(
  account: PrivateKeyAccount,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 402) return first;

  const challenge = await readChallenge(first);
  const payment = await buildPayment(account, challenge);

  const headers = new Headers(init?.headers);
  headers.set(payment.headerName, payment.value);

  return fetch(input, { ...init, headers });
}

/**
 * Build a concise human-readable failure reason from a non-OK x402 response.
 * Prefers the settlement `errorReason`, then a JSON body `error` field, then
 * the HTTP status. Common x402 errors: `invalid_exact_evm_insufficient_balance`
 * (fund the wallet with USDC), `invalid_exact_evm_signature`.
 */
export async function failureReason(res: Response): Promise<string> {
  const settle = decodeSettlement(res);
  if (settle?.errorReason) return `${res.status} — payment ${settle.errorReason}`;
  try {
    const body = (await res.clone().json()) as { error?: string };
    if (body?.error) return `${res.status} — ${body.error}`;
  } catch {
    /* not JSON */
  }
  const text = await res.text().catch(() => "");
  return `${res.status} ${res.statusText} ${text}`.trim();
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
