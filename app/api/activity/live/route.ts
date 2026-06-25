import { NextRequest, NextResponse } from 'next/server'
import { readTraceLines } from '@/lib/route-trace'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public, realtime routing trace — the line-by-line stream behind the Activity
 * page's routing terminal. Cursor-polled (the client passes back `cursor` as
 * `?since=`); privacy is enforced at write time (lib/route-trace) so the rows
 * carry only engine intent, service slugs, prices, and public tx hashes.
 *
 *   GET /api/activity/live           → most recent lines + cursor (seed)
 *   GET /api/activity/live?since=N   → only lines with n > N (incremental)
 */
export async function GET(req: NextRequest) {
  const sinceParam = req.nextUrl.searchParams.get('since')
  const since = sinceParam !== null && /^\d+$/.test(sinceParam) ? Number(sinceParam) : undefined
  const { lines, cursor } = await readTraceLines(since)
  return NextResponse.json(
    { lines, cursor },
    { headers: { 'cache-control': 'no-store' } },
  )
}
