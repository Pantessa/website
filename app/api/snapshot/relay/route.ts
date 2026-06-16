import { NextRequest, NextResponse } from 'next/server'

// Relay a user-signed Snapshot vote to the Snapshot sequencer. The user already
// authorized it by signing the EIP-712 typed data with their own wallet — this
// route just forwards the { address, sig, data } envelope. We post directly to
// the free sequencer (no x402 cost) rather than back through the paid MCP, since
// the signature IS the authorization and the relay carries no extra trust.

const SEQUENCER = process.env.SNAPSHOT_SEQUENCER_URL ?? 'https://seq.snapshot.org'

interface RelayBody {
  address?: string
  sig?: string
  typedData?: { domain: unknown; types: unknown; message: unknown }
}

export async function POST(req: NextRequest) {
  let body: RelayBody
  try {
    body = (await req.json()) as RelayBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { address, sig, typedData } = body
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'A valid voter `address` is required' }, { status: 400 })
  }
  if (!sig || typeof sig !== 'string') {
    return NextResponse.json({ error: 'A `sig` is required' }, { status: 400 })
  }
  if (!typedData?.domain || !typedData?.types || !typedData?.message) {
    return NextResponse.json({ error: 'A complete `typedData` is required' }, { status: 400 })
  }

  const envelope = {
    address,
    sig,
    data: { domain: typedData.domain, types: typedData.types, message: typedData.message },
  }

  let res: Response
  try {
    res = await fetch(SEQUENCER, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      cache: 'no-store',
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach the Snapshot sequencer: ${e instanceof Error ? e.message : 'network error'}` },
      { status: 502 },
    )
  }

  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  if (!res.ok) {
    // Snapshot returns { error, error_description } on rejection (e.g. no voting
    // power, proposal closed, bad signature).
    const reason =
      data && typeof data === 'object' && 'error_description' in data
        ? (data as { error_description: string }).error_description
        : typeof data === 'string'
          ? data
          : 'Vote rejected by Snapshot'
    return NextResponse.json({ error: reason }, { status: res.status })
  }

  return NextResponse.json({ ok: true, receipt: data })
}
