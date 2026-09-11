// lib/watchlists-store.ts — the DB half of watchlists + alerts (server-only;
// MARKETS/WATCH, 2026-09-11). Every write is keyed on the SIWE-verified owner
// the route resolved (lib/api-key getAuthAddress — the same door /api/dca
// uses); nothing here trusts a client-named address. Reads of a PUBLIC list
// fence `isInternal: false` (the #699 class: a harness mint must never be a
// page on /lists). No caps — see lib/watchlists.ts.

import prisma from '@/lib/db'
import { mintSlug } from '@/lib/intent-links'
import {
  LIST_SLUG_RE,
  alertRuleProblem,
  cleanListName,
  cleanSectionName,
  dedupeSymbols,
  normalizeWatchSymbol,
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
  const r = await prisma.watchlist.deleteMany({ where: { id, owner: owner.toLowerCase() } })
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
  await prisma.watchlistItem.deleteMany({ where: { watchlistId: row.id, symbol } })
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

/** Guest lists → server lists, one POST on sign-in. Returns the created rows. */
export async function adoptGuestLists(owner: string, listsRaw: unknown, isInternal: boolean): Promise<WatchlistShape[]> {
  if (!Array.isArray(listsRaw)) return []
  const out: WatchlistShape[] = []
  for (const l of listsRaw.slice(0, 200) as { name?: unknown; symbols?: unknown; sections?: unknown }[]) {
    if (!l || typeof l !== 'object') continue
    out.push(await createWatchlist({ owner, name: l.name, symbols: l.symbols, sections: l.sections, isInternal }))
  }
  return out
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
