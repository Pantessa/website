// lib/legal.ts — the legal entity in ONE place (squad five-million, DESKPAGE
// lane, 2026-11-03; plan §7.3: "No institution signs an MSA against
// 'TO BE COMPLETED'").
//
// Until today the Terms, the Privacy policy and the footer each carried their
// own copy of the entity name, and the Terms carried the governing-law and
// venue placeholders inline. Now every page reads these four strings from
// here, and each one is overridable by an env var so Nate can complete the
// Terms with a deploy, not a PR:
//
//   LEGAL_ENTITY          the contracting entity ("Yeetful, Inc.")
//   LEGAL_ENTITY_SHORT    the footer's copyright line ("PANTESSA INC.")
//   LEGAL_GOVERNING_LAW   the Terms' governing law
//   LEGAL_VENUE           the Terms' courts
//
// The defaults are EXACTLY the strings the pages shipped with (pinned), so an
// unset env changes nothing. Server-side only: the three readers are server
// components. Pure helper `legalFromEnv` so the harness can pin the override
// without restarting a server.

export interface LegalStrings {
  entity: string
  entityShort: string
  governingLaw: string
  venue: string
}

/** The marker the Terms carry while counsel has not supplied the values. */
export const LEGAL_PLACEHOLDER = 'TO BE COMPLETED'

/** The strings as they shipped on 2026-09-03 (Terms) / 2026-09-18 (Privacy). */
export const LEGAL_DEFAULTS: Readonly<LegalStrings> = {
  entity: 'Yeetful, Inc.',
  entityShort: 'PANTESSA INC.',
  governingLaw: `[governing jurisdiction — ${LEGAL_PLACEHOLDER}]`,
  venue: `[venue — ${LEGAL_PLACEHOLDER}]`,
}

export const LEGAL_ENV_NAMES = {
  entity: 'LEGAL_ENTITY',
  entityShort: 'LEGAL_ENTITY_SHORT',
  governingLaw: 'LEGAL_GOVERNING_LAW',
  venue: 'LEGAL_VENUE',
} as const

/** Pure: the four strings from an env record, defaults where unset or blank. */
export function legalFromEnv(env: Record<string, string | undefined>): LegalStrings {
  const pick = (name: string, fallback: string): string => {
    const v = env[name]?.trim()
    return v ? v : fallback
  }
  return {
    entity: pick(LEGAL_ENV_NAMES.entity, LEGAL_DEFAULTS.entity),
    entityShort: pick(LEGAL_ENV_NAMES.entityShort, LEGAL_DEFAULTS.entityShort),
    governingLaw: pick(LEGAL_ENV_NAMES.governingLaw, LEGAL_DEFAULTS.governingLaw),
    venue: pick(LEGAL_ENV_NAMES.venue, LEGAL_DEFAULTS.venue),
  }
}

/** True once neither Terms value still carries the placeholder. */
export function legalIsComplete(l: LegalStrings): boolean {
  return !l.governingLaw.includes(LEGAL_PLACEHOLDER) && !l.venue.includes(LEGAL_PLACEHOLDER)
}

const LEGAL = legalFromEnv(process.env)

/** The contracting entity, as the Terms and the Privacy policy name it. */
export const LEGAL_ENTITY = LEGAL.entity
/** The footer's copyright line. */
export const LEGAL_ENTITY_SHORT = LEGAL.entityShort
/** The Terms' governing law. */
export const GOVERNING_LAW = LEGAL.governingLaw
/** The Terms' courts. */
export const VENUE = LEGAL.venue
