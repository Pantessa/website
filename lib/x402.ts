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
 * Derive an unsigned payment (header template + typed data) for a given payer
 * address — without signing. Works for both x402 v1 and v2 challenges.
 */
export function derivePayment(challenge: Challenge, fromAddress: string): PreparedPayment {
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
  const authorization = {
    from: getAddress(fromAddress),
    to: getAddress(entry.payTo),
    value,
    validAfter: String(now - 600), // tolerate clock skew
    validBefore: String(now + (entry.maxTimeoutSeconds ?? 300)),
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
  };
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
  init?: RequestInit,
): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 402) return first;

  const challenge = await readChallenge(first);
  const prepared = derivePayment(challenge, account.address);
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

  return fetchWithPaymentHeader(input, init, finalizePaymentHeader(prepared, signature));
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
