// May this wallet mint another intent link? (pricing v2 — the store half of
// lib/intent-links' pure `activeLinkCapFor`.) Fails OPEN: a store hiccup
// never blocks a mint.

import prisma from '@/lib/db'
import { getEffectivePlan } from '@/lib/billing'
import { isAdminAddress } from '@/lib/admin'
import { activeLinkCapFor } from '@/lib/intent-links'

export async function mayMintLink(creator: string): Promise<boolean> {
  try {
    const who = creator.toLowerCase()
    if (isAdminAddress(who)) return true
    const { plan } = await getEffectivePlan(who)
    if (plan.id !== 'free') return true
    const active = await prisma.intentLink.count({ where: { creator: who, revoked: false } })
    const cap = activeLinkCapFor({ isAdmin: false, paidPlan: false, hasVerifiedTrade: false })
    if (active < cap) return true
    const traded = await prisma.embedTurn.findFirst({ where: { walletAddress: who, outcome: 'signed', verification: 'verified' }, select: { id: true } })
    return !!traded
  } catch {
    return true
  }
}
