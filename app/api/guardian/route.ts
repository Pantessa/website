import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { guardianIsTestnet } from '@/lib/hl-guardian-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The guardian dashboard's one-shot state read: the wallet's delegation
// (never the key material), its policies with their latest run, and the
// recent receipt feed. Positions are served separately (/positions) —
// they're a live venue read, this is our DB.
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const [delegation, policies, runs] = await Promise.all([
    prisma.hlGuardianDelegation.findFirst({
      where: { wallet: addr },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        agentAddress: true,
        hlChain: true,
        status: true,
        approvedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
    prisma.hlGuardianPolicy.findMany({
      where: { wallet: addr, status: { not: 'done' } },
      orderBy: { createdAt: 'desc' },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      take: 20,
    }),
    prisma.hlGuardianRun.findMany({
      where: { wallet: addr },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    ])

  return NextResponse.json({ delegation, policies, runs, testnet: guardianIsTestnet() })
}
