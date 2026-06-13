'use client'

// Active-org selection — CLIENT state by design (F3): the SIWE session stays
// untouched; every API call passes the org explicitly (?org= / orgId) and the
// server re-checks membership on each request. Persisted so a reload keeps
// you in the org you were working in.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface OrgSummary {
  id: string
  name: string
  slug: string
  role: 'owner' | 'admin' | 'member'
  memberCount: number
  perDayUsd: number | null
}

interface OrgScopeState {
  /** null = personal scope. */
  activeOrgId: string | null
  setActiveOrg: (id: string | null) => void
}

export const useOrgStore = create<OrgScopeState>()(
  persist(
    (set) => ({
      activeOrgId: null,
      setActiveOrg: (id) => set({ activeOrgId: id }),
    }),
    { name: 'yeetful-org-scope' },
  ),
)
