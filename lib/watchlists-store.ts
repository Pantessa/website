// lib/watchlists-store.ts — the DB half of watchlists + alerts (server-only;
// MARKETS/WATCH, 2026-09-11). Every write is keyed on the SIWE-verified owner
// the route resolved (lib/api-key getAuthAddress — the same door /api/dca
// uses); nothing here trusts a client-named address. Reads of a PUBLIC list
// fence `isInternal: false` (the #699 class: a harness mint must never be a
// page on /lists). No caps — see lib/watchlists.ts.

import prisma from '@/lib/db'
import { mintSlug } from '@/lib/intent-links'
import {
  DEFAULT_LIST_NAME,
  LIST_SLUG_RE,
  alertRuleProblem,
  cleanListName,
  cleanSectionName,
  dedupeSymbols,
  normalizeWatchSymbol,
  planHeldAutofill,
  slugify,
  type AlertCondition,
  type WatchlistSection,
  type WatchlistShape,
} from '@/lib/watchlists'

type ListRow = NonNullable<Awaited<ReturnType<typeof prisma.watchlist.findUnique>>>
type ItemRow = NonNullable<Awaited<ReturnType<typeof prisma.watchlistItem.findFirst>>>

/** Row + items → the README shape. Sections are derived from item.section in
 *  item order, so the stored order IS the rendered order. */
export function toShape(row: ListRow, items: ItemRow[]): WatchlistShape {
  const sorted = [...items].sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
  const sections: WatchlistSection[] = []
  const byName = new Map<string, WatchlistSection>()
  for (const it of sorted) {
    if (!it.section) continue
    let s = byName.get(it.section)
    if (!s) {
      s = { name: it.section, symbols: [] }
      byName.set(it.section, s)
      sections.push(s)
    }
    s.symbols.push(it.symbol)
  }
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    slug: row.slug,
    symbols: sorted.map((i) => i.symbol),
    ...(sections.length ? { sections } : {}),
    isPublic: row.isPublic,
    forkOf: row.forkOf,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listWatchlists(owner: string): Promise<WatchlistShape[]> {
  const rows = await prisma.watchlist.findMany({
    where: { owner: owner.toLowerCase() },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { items: true },
  })
  return rows.map((r) => toShape(r, r.items))
}

export async function getOwnedWatchlist(owner: string, id: string): Promise<WatchlistShape | null> {
  const row = await prisma.watchlist.findFirst({ where: { id, owner: owner.toLowerCase() }, include: { items: true } })
  return row ? toShape(row, row.items) : null
}

export interface CreateWatchlistInput {
  owner: string
  name: unknown
  symbols?: unknown
  sections?: unknown
  forkOf?: string | null
  isInternal: boolean
}

/** Sections in → per-symbol section labels. A symbol in two sections keeps the first. */
function sectionOf(sections: unknown): Map<string, string> {
  const m = new Map<string, string>()
  if (!Array.isArray(sections)) return m
  for (const s of sections as { name?: unknown; symbols?: unknown }[]) {
    const name = cleanSectionName(s?.name)
    if (!name || !Array.isArray(s.symbols)) continue
    for (const sym of dedupeSymbols(s.symbols as string[])) if (!m.has(sym)) m.set(sym, name)
  }
  return m
}

export async function createWatchlist(input: CreateWatchlistInput): Promise<WatchlistShape> {
  const owner = input.owner.toLowerCase()
  const symbols = dedupeSymbols(Array.isArray(input.symbols) ? (input.symbols as string[]) : [])
  const sec = sectionOf(input.sections)
  // Sectioned symbols not listed in `symbols` still belong to the list.
  for (const sym of sec.keys()) if (!symbols.includes(sym)) symbols.push(sym)
  const last = await prisma.watchlist.findFirst({ where: { owner }, orderBy: { position: 'desc' }, select: { position: true } })
  const id = mintSlug(10)
  const row = await prisma.watchlist.create({
    data: {
      id,
      owner,
      name: cleanListName(input.name),
      position: (last?.position ?? -1) + 1,
      forkOf: input.forkOf ?? null,
      isInternal: input.isInternal,
      items: {
        create: symbols.map((symbol, i) => ({ id: mintSlug(10), symbol, section: sec.get(symbol) ?? null, position: i })),
      },
    },
    include: { items: true },
  })
  return toShape(row, row.items)
}

export interface UpdateWatchlistInput {
  name?: unknown
  isPublic?: unknown
  slug?: unknown
  /** Full symbol order (reorder); symbols not in the list are ignored, missing ones keep their relative tail order. */
  order?: unknown
  /** Full sections map (replaces). */
  sections?: unknown
  position?: unknown
}

export type UpdateResult = { list: WatchlistShape } | { problem: string; status: number }

export async function updateWatchlist(owner: string, id: string, input: UpdateWatchlistInput): Promise<UpdateResult> {
  const row = await prisma.watchlist.findFirst({ where: { id, owner: owner.toLowerCase() }, include: { items: true } })
  if (!row) return { problem: 'No such list on this wallet.', status: 404 }
  const data: { name?: string; isPublic?: boolean; slug?: string | null; position?: number } = {}
  if (input.name !== undefined) data.name = cleanListName(input.name, row.name)
  if (typeof input.position === 'number' && Number.isFinite(input.position)) data.position = Math.max(0, Math.floor(input.position))
  if (input.isPublic !== undefined) {
    data.isPublic = input.isPublic === true
    // Going public mints a slug if none was named; going private keeps it
    // (the URL stays reserved for the owner, the page 404s until re-shared).
    if (data.isPublic && !row.slug && input.slug === undefined) data.slug = await freeSlug(row.name)
  }
  if (input.slug !== undefined) {
    if (input.slug === null) data.slug = null
    else {
      const s = String(input.slug).toLowerCase().trim()
      if (!LIST_SLUG_RE.test(s)) return { problem: 'slug must be 3–32 chars of a-z, 0-9 and dashes.', status: 400 }
      const taken = await prisma.watchlist.findUnique({ where: { slug: s }, select: { id: true } })
      if (taken && taken.id !== row.id) return { problem: 'That slug is taken.', status: 409 }
      data.slug = s
    }
  }
  await prisma.watchlist.update({ where: { id: row.id }, data })

  if (input.order !== undefined || input.sections !== undefined) {
    const held = new Map(row.items.map((i) => [i.symbol, i]))
    let order = row.items.sort((a, b) => a.position - b.position).map((i) => i.symbol)
    if (Array.isArray(input.order)) {
      const wanted = dedupeSymbols(input.order as string[]).filter((s) => held.has(s))
      order = [...wanted, ...order.filter((s) => !wanted.includes(s))]
    }
    const sec = input.sections !== undefined ? sectionOf(input.sections) : null
    await prisma.$transaction(
      order.map((symbol, i) =>
        prisma.watchlistItem.update({
          where: { id: held.get(symbol)!.id },
          data: { position: i, ...(sec ? { section: sec.get(symbol) ?? null } : {}) },
        }),
      ),
    )
  }
  const fresh = await prisma.watchlist.findUnique({ where: { id: row.id }, include: { items: true } })
  return { list: toShape(fresh!, fresh!.items) }
}

async function freeSlug(name: string): Promise<string> {
  const base = slugify(name) || 'list'
  const stem = base.length < 3 ? `${base}-list`.slice(0, 32) : base
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? stem : `${stem.slice(0, 26)}-${mintSlug(4).toLowerCase()}`
    if (!LIST_SLUG_RE.test(candidate)) continue
    const taken = await prisma.watchlist.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!taken) return candidate
  }
  return `list-${mintSlug(8).toLowerCase()}`
}

export async function deleteWatchlist(owner: string, id: string): Promise<boolean> {
  const o = owner.toLowerCase()
  const row = await prisma.watchlist.findFirst({ where: { id, owner: o }, include: { items: { select: { symbol: true } } } })
  if (!row) return false
  const r = await prisma.watchlist.deleteMany({ where: { id: row.id, owner: o } })
  // Deleting a list removes its tickers — remembered like a row removal, so
  // the holdings autofill never refills them into the next list.
  if (r.count > 0) await recordSeen(prisma, o, row.items.map((i) => i.symbol))
  return r.count > 0
}

/** Add symbols (idempotent — re-adding is a no-op, the row keeps its spot). */
export async function addItems(owner: string, id: string, symbolsRaw: unknown, sectionRaw?: unknown): Promise<UpdateResult> {
  const row = await prisma.watchlist.findFirst({ where: { id, owner: owner.toLowerCase() }, include: { items: true } })
  if (!row) return { problem: 'No such list on this wallet.', status: 404 }
  const list = Array.isArray(symbolsRaw) ? (symbolsRaw as string[]) : typeof symbolsRaw === 'string' ? [symbolsRaw] : []
  const symbols = dedupeSymbols(list)
  if (symbols.length === 0) return { problem: 'Name at least one symbol.', status: 400 }
  const section = cleanSectionName(sectionRaw)
  const held = new Set(row.items.map((i) => i.symbol))
  let pos = row.items.reduce((m, i) => Math.max(m, i.position), -1) + 1
  const fresh = symbols.filter((s) => !held.has(s))
  if (fresh.length) {
    await prisma.watchlistItem.createMany({
      data: fresh.map((symbol) => ({ id: mintSlug(10), watchlistId: row.id, symbol, section, position: pos++ })),
      skipDuplicates: true,
    })
    await prisma.watchlist.update({ where: { id: row.id }, data: { updatedAt: new Date() } })
  }
  const after = await prisma.watchlist.findUnique({ where: { id: row.id }, include: { items: true } })
  return { list: toShape(after!, after!.items) }
}

export async function removeItem(owner: string, id: string, symbolRaw: unknown): Promise<UpdateResult> {
  const symbol = normalizeWatchSymbol(String(symbolRaw ?? ''))
  if (!symbol) return { problem: 'Name the symbol to remove.', status: 400 }
  const row = await prisma.watchlist.findFirst({ where: { id, owner: owner.toLowerCase() } })
  if (!row) return { problem: 'No such list on this wallet.', status: 404 }
  const r = await prisma.watchlistItem.deleteMany({ where: { watchlistId: row.id, symbol } })
  // A removal is remembered: the holdings autofill never puts it back. Only
  // adding it again by hand does (the add is the owner's word, not ours).
  if (r.count > 0) await recordSeen(prisma, row.owner, [symbol])
  const after = await prisma.watchlist.findUnique({ where: { id: row.id }, include: { items: true } })
  return { list: toShape(after!, after!.items) }
}

/** Move one symbol to a section (null = unsectioned). */
export async function setItemSection(owner: string, id: string, symbolRaw: unknown, sectionRaw: unknown): Promise<UpdateResult> {
  const symbol = normalizeWatchSymbol(String(symbolRaw ?? ''))
  if (!symbol) return { problem: 'Name the symbol.', status: 400 }
  const row = await prisma.watchlist.findFirst({ where: { id, owner: owner.toLowerCase() } })
  if (!row) return { problem: 'No such list on this wallet.', status: 404 }
  const section = sectionRaw === null ? null : cleanSectionName(sectionRaw)
  const r = await prisma.watchlistItem.updateMany({ where: { watchlistId: row.id, symbol }, data: { section } })
  if (r.count === 0) return { problem: `${symbol} is not on this list.`, status: 404 }
  const after = await prisma.watchlist.findUnique({ where: { id: row.id }, include: { items: true } })
  return { list: toShape(after!, after!.items) }
}

// ── Public lists (/lists/<slug>) ────────────────────────────────────────────

export interface PublicList extends WatchlistShape {
  followers: number
}

/** The public page's read. BOTH fences: is_public AND NOT is_internal. */
export async function publicWatchlistBySlug(slugRaw: string): Promise<PublicList | null> {
  const slug = String(slugRaw ?? '').toLowerCase()
  if (!LIST_SLUG_RE.test(slug)) return null
  const row = await prisma.watchlist.findFirst({ where: { slug, isPublic: true, isInternal: false }, include: { items: true } })
  if (!row) return null
  const followers = await prisma.watchlist.count({ where: { forkOf: slug, isInternal: false } })
  return { ...toShape(row, row.items), followers }
}

/** Follow = copy the public list into the caller's lists with fork_of set.
 *  Following your own list is refused (it's already yours). */
export async function forkWatchlist(owner: string, slugRaw: string, isInternal: boolean): Promise<UpdateResult> {
  const src = await publicWatchlistBySlug(slugRaw)
  if (!src) return { problem: 'No such public list.', status: 404 }
  if (src.owner === owner.toLowerCase()) return { problem: 'That list is already yours.', status: 409 }
  const list = await createWatchlist({ owner, name: src.name, symbols: src.symbols, sections: src.sections, forkOf: src.slug, isInternal })
  return { list }
}

const asStrings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])

/** Guest lists → server lists, one POST on sign-in.
 *   · A guest list named like one of the account's lists merges into it
 *     (the default "My watchlist" on both sides is one list, not two);
 *     anything else is created, sections kept.
 *   · Symbols the guest's holdings AUTOFILL placed (`auto`) come along only
 *     when the account has never seen them — on none of its lists and not in
 *     its ledger — so a holding the owner removed on another device is not
 *     carried back in by a signed-out visit. A list emptied by that filter
 *     is dropped; a list the guest left empty on purpose is kept.
 *   · The guest's own removals (`dismissed`) join the account's ledger.
 *  Returns the lists written (created or merged into). */
export async function adoptGuestLists(
  ownerRaw: string,
  listsRaw: unknown,
  isInternal: boolean,
  held: { auto?: unknown; dismissed?: unknown } = {},
): Promise<WatchlistShape[]> {
  const owner = ownerRaw.toLowerCase()
  const auto = new Set(dedupeSymbols(asStrings(held.auto)))
  const dismissed = dedupeSymbols(asStrings(held.dismissed))
  const existing = await prisma.watchlist.findMany({ where: { owner }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { items: true } })
  const watched = new Set(existing.flatMap((r) => r.items.map((i) => i.symbol)))
  const seen = auto.size ? new Set((await prisma.watchlistHoldingSeen.findMany({ where: { owner }, select: { symbol: true } })).map((r) => r.symbol)) : new Set<string>()
  const keep = (s: string) => !auto.has(s) || (!watched.has(s) && !seen.has(s))
  const byName = new Map<string, string>()
  for (const r of existing) if (!byName.has(r.name.toLowerCase())) byName.set(r.name.toLowerCase(), r.id)

  const out: WatchlistShape[] = []
  for (const l of (Array.isArray(listsRaw) ? listsRaw.slice(0, 200) : []) as { name?: unknown; symbols?: unknown; sections?: unknown }[]) {
    if (!l || typeof l !== 'object') continue
    const given = dedupeSymbols(asStrings(l.symbols))
    const sectionsIn = Array.isArray(l.sections) ? (l.sections as { name?: unknown; symbols?: unknown }[]) : []
    const sections = sectionsIn.map((s) => ({ name: s?.name, symbols: dedupeSymbols(asStrings(s?.symbols)).filter(keep) }))
    const symbols = given.filter(keep)
    const hadAny = given.length > 0 || sectionsIn.some((s) => asStrings(s?.symbols).length > 0)
    if (hadAny && symbols.length === 0 && !sections.some((s) => s.symbols.length)) continue
    const name = cleanListName(l.name)
    const targetId = byName.get(name.toLowerCase())
    if (targetId) {
      const merged = await mergeIntoList(targetId, symbols, sections)
      if (merged) out.push(merged)
    } else {
      const created = await createWatchlist({ owner, name, symbols, sections, isInternal })
      byName.set(name.toLowerCase(), created.id)
      out.push(created)
    }
  }
  if (dismissed.length) await recordSeen(prisma, owner, dismissed)
  return out
}

/** Append the symbols a list doesn't hold yet, at its tail, each with its
 *  section from `sections`; rows already on the list keep their spot. */
async function mergeIntoList(listId: string, symbols: string[], sections: unknown): Promise<WatchlistShape | null> {
  const row = await prisma.watchlist.findUnique({ where: { id: listId }, include: { items: true } })
  if (!row) return null
  const sec = sectionOf(sections)
  const all = [...symbols]
  for (const s of sec.keys()) if (!all.includes(s)) all.push(s)
  const held = new Set(row.items.map((i) => i.symbol))
  let pos = row.items.reduce((m, i) => Math.max(m, i.position), -1) + 1
  const fresh = all.filter((s) => !held.has(s))
  if (fresh.length) {
    await prisma.watchlistItem.createMany({
      data: fresh.map((symbol) => ({ id: mintSlug(10), watchlistId: row.id, symbol, section: sec.get(symbol) ?? null, position: pos++ })),
      skipDuplicates: true,
    })
    await prisma.watchlist.update({ where: { id: row.id }, data: { updatedAt: new Date() } })
  }
  const after = await prisma.watchlist.findUnique({ where: { id: row.id }, include: { items: true } })
  return after ? toShape(after, after.items) : null
}

// ── Holdings autofill (the account path) ────────────────────────────────────
// lib/watchlists planHeldAutofill is the rule; this is its DB half. The
// ledger (watchlist_holdings_seen) is per owner, so a removal on one device
// holds on every device the owner signs in from.

type Db = Pick<typeof prisma, 'watchlistHoldingSeen'>

/** Remember symbols in the owner's ledger (idempotent; first write wins). */
async function recordSeen(db: Db, owner: string, symbols: readonly string[], added: ReadonlySet<string> = new Set()): Promise<void> {
  const clean = dedupeSymbols([...symbols])
  if (!clean.length) return
  await db.watchlistHoldingSeen.createMany({
    data: clean.map((symbol) => ({ owner: owner.toLowerCase(), symbol, added: added.has(symbol) })),
    skipDuplicates: true,
  })
}

export interface HeldSyncResult {
  /** The list the autofill wrote to, fresh; the primary list when nothing
   *  was added; null when the owner has no list and nothing was added. */
  list: WatchlistShape | null
  /** Symbols appended this call, in holdings order. */
  added: string[]
  /** Ledger symbols on none of the owner's lists — what the owner removed. */
  dismissed: string[]
}

/** One account sync: the owner's primary list (first by position) gains the
 *  held symbols it has never seen; every held symbol lands in the ledger.
 *  Serialized per owner (a transaction-scoped advisory lock), so two tabs
 *  restoring at once can't both create "My watchlist" or double-append. */
export async function syncHeldSymbols(ownerRaw: string, heldRaw: unknown, isInternal: boolean): Promise<HeldSyncResult> {
  const owner = ownerRaw.toLowerCase()
  const held = asStrings(heldRaw).slice(0, 500)
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`watchlist-held:${owner}`}::text))`
      const rows = await tx.watchlist.findMany({ where: { owner }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { items: true } })
      const seen = new Set((await tx.watchlistHoldingSeen.findMany({ where: { owner }, select: { symbol: true } })).map((r) => r.symbol))
      const watched = new Set(rows.flatMap((r) => r.items.map((i) => i.symbol)))
      const plan = planHeldAutofill({ held, watched, seen })
      let list: WatchlistShape | null = rows[0] ? toShape(rows[0], rows[0].items) : null
      if (plan.add.length) {
        const primary =
          rows[0] ?? (await tx.watchlist.create({ data: { id: mintSlug(10), owner, name: DEFAULT_LIST_NAME, position: 0, isInternal }, include: { items: true } }))
        let pos = primary.items.reduce((m, i) => Math.max(m, i.position), -1) + 1
        await tx.watchlistItem.createMany({
          data: plan.add.map((symbol) => ({ id: mintSlug(10), watchlistId: primary.id, symbol, position: pos++ })),
          skipDuplicates: true,
        })
        await tx.watchlist.update({ where: { id: primary.id }, data: { updatedAt: new Date() } })
        const fresh = await tx.watchlist.findUnique({ where: { id: primary.id }, include: { items: true } })
        list = fresh ? toShape(fresh, fresh.items) : null
      }
      await recordSeen(tx, owner, plan.newlySeen, new Set(plan.add))
      const nowWatched = new Set([...watched, ...plan.add])
      return { list, added: plan.add, dismissed: [...seen].filter((s) => !nowWatched.has(s)) }
    },
    { timeout: 15_000 },
  )
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export interface AlertShape {
  id: string
  owner: string
  symbol: string
  condition: AlertCondition
  value: number
  basePrice: number | null
  status: 'active' | 'fired' | 'paused'
  actionAsk: string | null
  email: string | null
  lastChecked: string | null
  lastPrice: number | null
  firedAt: string | null
  firedPrice: number | null
  createdAt: string
}

type AlertRow = NonNullable<Awaited<ReturnType<typeof prisma.priceAlert.findUnique>>>

export function alertToShape(r: AlertRow): AlertShape {
  return {
    id: r.id,
    owner: r.owner,
    symbol: r.symbol,
    condition: r.condition as AlertCondition,
    value: r.value,
    basePrice: r.basePrice,
    status: r.status as AlertShape['status'],
    actionAsk: r.actionAsk,
    email: r.email,
    lastChecked: r.lastChecked?.toISOString() ?? null,
    lastPrice: r.lastPrice,
    firedAt: r.firedAt?.toISOString() ?? null,
    firedPrice: r.firedPrice,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function listAlerts(owner: string): Promise<AlertShape[]> {
  const rows = await prisma.priceAlert.findMany({ where: { owner: owner.toLowerCase() }, orderBy: { createdAt: 'desc' } })
  return rows.map(alertToShape)
}

const ASK_MAX = 200
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i

export type CreateAlertResult = { alert: AlertShape } | { problem: string; status: number }

export async function createAlert(
  owner: string,
  body: { symbol?: unknown; condition?: unknown; value?: unknown; basePrice?: unknown; actionAsk?: unknown; email?: unknown },
  isInternal: boolean,
): Promise<CreateAlertResult> {
  const symbol = normalizeWatchSymbol(String(body.symbol ?? ''))
  const rule = {
    symbol: symbol ?? '',
    condition: body.condition as AlertCondition,
    value: Number(body.value),
    basePrice: body.basePrice == null ? null : Number(body.basePrice),
  }
  const problem = alertRuleProblem(rule)
  if (problem) return { problem, status: 400 }
  const actionAsk = typeof body.actionAsk === 'string' && body.actionAsk.trim() ? body.actionAsk.replace(/\s+/g, ' ').trim().slice(0, ASK_MAX) : null
  let email: string | null = null
  if (typeof body.email === 'string' && body.email.trim()) {
    const e = body.email.trim().toLowerCase()
    if (!EMAIL_RE.test(e)) return { problem: 'That email does not look deliverable.', status: 400 }
    // The recipient must have confirmed mail from us (the double-opt-in
    // subscriber row) — otherwise any signed-in wallet could point unlimited
    // alerts at a stranger's inbox (integration review, 2026-09-11).
    const sub = await prisma.subscriber.findUnique({ where: { email: e }, select: { status: true } })
    if (sub?.status !== 'verified') {
      return { problem: `${e} hasn't confirmed mail from Pantessa yet — subscribe with it (footer form), click the confirm link, then set the alert. In-app notifications still work without it.`, status: 400 }
    }
    email = e
  }
  const row = await prisma.priceAlert.create({
    data: {
      id: mintSlug(10),
      owner: owner.toLowerCase(),
      symbol: rule.symbol,
      condition: rule.condition,
      value: rule.value,
      basePrice: rule.condition === 'pct_move' ? rule.basePrice : null,
      actionAsk,
      email,
      isInternal,
    },
  })
  return { alert: alertToShape(row) }
}

export async function setAlertStatus(owner: string, id: string, op: 'pause' | 'resume' | 'rearm'): Promise<CreateAlertResult> {
  const row = await prisma.priceAlert.findFirst({ where: { id, owner: owner.toLowerCase() } })
  if (!row) return { problem: 'No such alert on this wallet.', status: 404 }
  if (op === 'pause' && row.status !== 'active') return { problem: `Alert is ${row.status} — nothing to pause.`, status: 409 }
  if (op === 'resume' && row.status !== 'paused') return { problem: `Alert is ${row.status} — nothing to resume.`, status: 409 }
  if (op === 'rearm' && row.status !== 'fired') return { problem: `Alert is ${row.status} — nothing to re-arm.`, status: 409 }
  const updated = await prisma.priceAlert.update({
    where: { id: row.id },
    data: op === 'pause' ? { status: 'paused' } : { status: 'active', firedAt: null, firedPrice: null },
  })
  return { alert: alertToShape(updated) }
}

export async function deleteAlert(owner: string, id: string): Promise<boolean> {
  const r = await prisma.priceAlert.deleteMany({ where: { id, owner: owner.toLowerCase() } })
  return r.count > 0
}

export interface NotificationShape {
  id: string
  alertId: string
  symbol: string
  title: string
  body: string
  actionAsk: string | null
  price: number
  seenAt: string | null
  createdAt: string
}

export async function listNotifications(owner: string, unseenOnly = true): Promise<NotificationShape[]> {
  const rows = await prisma.alertNotification.findMany({
    where: { owner: owner.toLowerCase(), ...(unseenOnly ? { seenAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return rows.map((r) => ({
    id: r.id,
    alertId: r.alertId,
    symbol: r.symbol,
    title: r.title,
    body: r.body,
    actionAsk: r.actionAsk,
    price: r.price,
    seenAt: r.seenAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}

export async function markNotificationsSeen(owner: string, ids: string[] | 'all'): Promise<number> {
  const r = await prisma.alertNotification.updateMany({
    where: { owner: owner.toLowerCase(), seenAt: null, ...(ids === 'all' ? {} : { id: { in: ids.slice(0, 200) } }) },
    data: { seenAt: new Date() },
  })
  return r.count
}
