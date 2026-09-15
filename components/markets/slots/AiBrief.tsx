// MK2 SLOT — swapped by QA at integration (squad-mk2-2026-09-15): the real
// AI component. MARKETS keeps the stub on its own branch; this file is
// the one-line re-export the README "Slots" contract promises.
export { default } from '@/components/markets/ai/AiBrief'
import type Real from '@/components/markets/ai/AiBrief'
export type AiBriefProps = Parameters<typeof Real>[0]
