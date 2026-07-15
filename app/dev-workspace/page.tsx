import { notFound } from 'next/navigation'
import DevWorkspaceHarness from '@/components/DevWorkspaceHarness'

// Headless verification harness for App Mode: renders AppModeWorkspace for an
// arbitrary address (?as=0x…) WITHOUT a wagmi connection — the preview browser
// can't connect a real wallet, and the workspace is read-only until a
// signature is actually requested. Gated on DEV_WORKSPACE=1 (set in
// .env.local, never on Vercel) so it 404s everywhere but a local verify run.
export const dynamic = 'force-dynamic'

export default function DevWorkspacePage() {
  if (process.env.DEV_WORKSPACE !== '1') notFound()
  return <DevWorkspaceHarness />
}
