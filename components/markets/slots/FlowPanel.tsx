// MK2 SLOT — swapped by QA at integration (squad-mk2-2026-09-15): the real
// VIZ component. MARKETS keeps the stub on its own branch; this file is
// the one-line re-export the README "Slots" contract promises.
export { default } from '@/components/markets/viz/FlowPanel'
import type Real from '@/components/markets/viz/FlowPanel'
export type FlowPanelProps = Parameters<typeof Real>[0]
