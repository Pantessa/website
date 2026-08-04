// The one EIP-712 shape every builder in this package produces. Kept as a
// standalone type module so signing stays the CONSUMER's job — this package
// builds and verifies payloads; it never holds a key.

export interface Eip712TypedData {
  domain: Record<string, unknown>
  types: Record<string, { name: string; type: string }[]>
  primaryType: string
  message: Record<string, unknown>
}
