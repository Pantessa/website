// THE TOUR's panels by id (COORDINATOR-OWNED, frozen after the contract).
// A lane fills its own side's file; this map never changes.
import type { ComponentType } from 'react'
import type { TourId } from '@/lib/home-tour'
import AskSide from './Ask'
import AutopilotsSide from './Autopilots'
import BuildSide from './Build'
import ChartsSide from './Charts'
import CommunitySide from './Community'
import EarnSide from './Earn'
import LinksSide from './Links'
import WalletSide from './Wallet'

export const TOUR_PANELS: Record<TourId, ComponentType> = {
  charts: ChartsSide,
  ask: AskSide,
  links: LinksSide,
  autopilots: AutopilotsSide,
  community: CommunitySide,
  earn: EarnSide,
  wallet: WalletSide,
  build: BuildSide,
}
