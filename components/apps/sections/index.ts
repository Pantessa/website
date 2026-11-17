// Family → section module. Stable on purpose: a lane edits its own family
// file, never this map (two lanes editing one map is a merge conflict).

import type { AppFamily } from '@/lib/apps-page'
import type { SectionModule } from './types'
import generic from './generic'
import uniswap from './uniswap'
import wallet from './wallet'
import snapshot from './snapshot'
import hyperliquid from './hyperliquid'
import cow from './cow'
import near from './near'
import aave from './aave'
import lido from './lido'
import morpho from './morpho'
import robinhood from './robinhood'
import opensea from './opensea'
import funding from './funding'

export const SECTIONS: Record<AppFamily, SectionModule> = {
  uniswap,
  wallet,
  snapshot,
  hyperliquid,
  cow,
  near,
  aave,
  lido,
  morpho,
  robinhood,
  opensea,
  funding,
  other: generic,
}

export type { AppSectionProps, SectionModule } from './types'
