// lib/step-status.ts — THE progress-state vocabulary. One word map, one
// tone map, one live-set for a job's lifecycle; every surface (JobCard,
// the rail, shared logs, receipts) imports from here instead of keeping
// its own copy — five diverging tables once said "complete" / "done" /
// "✓ complete" for the same state (PLAN-progress-ui.md). Tones are the
// CSS state tokens (--done / --live / --fail) so light and dark repaint
// together; dependency-free so server components can import it too.

export type JobStatus = 'running' | 'waiting_signature' | 'waiting_settlement' | 'done' | 'failed' | 'canceled'

/** Statuses that mean the job still moves — polling stays on, rail rows count as running. */
export const LIVE_JOB_STATUSES: JobStatus[] = ['running', 'waiting_signature', 'waiting_settlement']

export const isLiveJobStatus = (s: string): boolean => (LIVE_JOB_STATUSES as string[]).includes(s)

/** The canonical human word for a job status — the same everywhere it appears. */
export function jobStatusWord(status: string): string {
  switch (status) {
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    case 'waiting_signature':
      return 'needs your signature'
    case 'waiting_settlement':
      return 'settling…'
    default:
      return 'running'
  }
}

/** Tone (a CSS color value) for a job or step state — never a hardcoded hex. */
export function statusTone(status: string): string {
  switch (status) {
    case 'done':
      return 'var(--done)'
    case 'failed':
      return 'var(--fail)'
    case 'canceled':
      return 'var(--muted-2)'
    case 'waiting_signature':
      return 'var(--fg)'
    default:
      return 'var(--live)'
  }
}
