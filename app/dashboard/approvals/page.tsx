import { redirect } from 'next/navigation'

// Approvals grew per-agent spend caps and became the Agents tab.
export default function ApprovalsRedirect() {
  redirect('/dashboard/agents')
}
