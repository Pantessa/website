// MK2 SLOT — swapped by QA at integration (squad-mk2-2026-09-15): the real
// EXEC component. MARKETS keeps the stub on its own branch; this file is
// the one-line re-export the README "Slots" contract promises.
export { default } from '@/components/markets/trade/RouteTable'
import type Real from '@/components/markets/trade/RouteTable'
export type RouteTableProps = Parameters<typeof Real>[0]
