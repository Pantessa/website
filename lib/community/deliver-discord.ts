// Lane DISCORD owns this file: announce one post to one linked Discord
// channel (its stored webhook URL). Contract: best-effort, resolves false
// (never throws) when unconfigured or Discord refuses.
import type { Deliverer } from './fanout'

export const deliverDiscord: Deliverer = async () => false
