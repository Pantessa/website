import { redirect } from 'next/navigation'

// Users merged INTO the Adoption page (2026-07-22) — one progress view:
// wallet growth, money flow, the link economy, the milestone funnel, and the
// per-wallet cohort journey all live on /dashboard/admin now.
export default function UsersRedirect() {
  redirect('/dashboard/admin')
}
