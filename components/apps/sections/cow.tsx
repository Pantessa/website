'use client'

// STUB (squad apps-page contract). The lane that owns the "cow" family
// replaces this with the family's own section: full / side / line, and the
// headline it gives the page when it is the only app open. Until then the
// app renders through the generic section.

import generic from './generic'
import type { SectionModule } from './types'

const mod: SectionModule = { Section: generic.Section }
export default mod
