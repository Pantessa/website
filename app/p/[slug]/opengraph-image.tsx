import { ImageResponse } from 'next/og'
import { getSharedChat, getJobs, getChatServers, moneyMovedOf } from '@/lib/shared-chat'
import { ogMarkSvg, gemMarkSvg } from '@/lib/og-marks'
import { OG, OG_TILES, OgEyebrow, OgFrame, OgLockup, ogAppTileSvg, ogDataUri, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'

// Social card for a shared chat (/p/[slug]) — without this file the segment's
// generateMetadata ships og:title/description but NO image (the root
// file-based card doesn't reach into segments that define their own OG
// metadata), which is exactly the broken placeholder X was rendering.
//
// The card is the receipt: the chat's ask as the display line, the money
// moved as the payoff line, and the agents that did the work as a chain of
// app tiles leading into the Pantessa mark.
//
// THE LOOK (2026-11-25; brand guidelines sections 5 and 7, lib/og-brand): flat
// on #07080D. Another app's mark rides an app tile, cut out in the ground
// colour, every tile the same size; the tiles are blue, violet and magenta
// (decoration), kept clear of the dollars so no tile reads as a move.

export const runtime = 'nodejs'
export const alt = 'A shared Pantessa chat — guarded transactions from plain English.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(undefined, { bare: true })
const TILE = 96

type Params = { params: Promise<{ slug: string }> }

export default async function Image({ params }: Params) {
  const { slug } = await params
  const chat = await getSharedChat(slug)
  const [jobs, servers] = chat
    ? await Promise.all([getJobs(chat.messages), getChatServers(chat)])
    : [new Map(), { display: [] as { slug: string; name: string }[] }]
  const moved = moneyMovedOf(jobs as Awaited<ReturnType<typeof getJobs>>)
  const agents = servers.display.slice(0, 3)

  const title = chat?.title ?? 'A shared Pantessa chat'
  // The quote scales down as the ask gets longer (titles are already
  // truncated at share time, so three steps cover the range).
  const titleSize = title.length > 60 ? 46 : title.length > 34 ? 54 : 66

  const fonts = await brandOgFonts()

  return new ImageResponse(
    (
      <OgFrame>
        {/* header: lockup + kicker */}
        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={MARK} />
          <OgEyebrow>SHARED CHAT · REAL RECEIPTS</OgEyebrow>
        </div>

        {/* left column: the ask + the payoff */}
        <div style={{ position: 'absolute', top: 160, left: 64, width: agents.length > 0 ? 800 : 1072, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', maxHeight: 216, overflow: 'hidden', ...ogDisplay(titleSize), lineHeight: 1.1 }}>
            <span>“{title}”</span>
          </div>
          {moved > 0 ? (
            <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 38 }}>
              <span style={{ ...ogNum(72), letterSpacing: -2 }}>${moved.toFixed(2)}</span>
              <span style={{ fontSize: 32, color: OG.ink, marginLeft: 18, fontWeight: 500 }}>moved on-chain</span>
            </div>
          ) : (
            <div style={{ display: 'flex', marginTop: 38, fontSize: 34, color: OG.ink, fontWeight: 600, letterSpacing: -0.5 }}>Guarded transactions from plain English</div>
          )}
          <div style={{ display: 'flex', marginTop: 16, fontSize: 22, color: OG.muted }}>Every step guarded, signed, and receipted — shared read-only.</div>
        </div>

        {/* right rail: the agents at work, one app tile each, leading into the mark */}
        {agents.length > 0 && (
          <div style={{ position: 'absolute', top: 148, right: 96, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {agents.map((a, i) => {
              const mark = ogMarkSvg(`${a.slug} ${a.name}`, OG.bg, 48)
              const letter = a.name.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '?'
              return (
                <div key={a.slug} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: TILE, height: TILE, display: 'flex', position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ogDataUri(ogAppTileSvg(TILE, OG_TILES[i % 3]))} width={TILE} height={TILE} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />
                    {mark ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ogDataUri(mark)} width={48} height={48} alt="" />
                    ) : (
                      <span style={{ color: OG.bg, fontSize: 42, fontWeight: 600 }}>{letter}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', width: 2, height: 14, background: OG.line }} />
                </div>
              )
            })}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ogDataUri(MARK)} width={64} height={64} alt="" style={{ marginTop: 6 }} />
          </div>
        )}

        {/* footer strip */}
        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={ogLabel(18)}>EVERY DAPP · ONE CHAT</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: OG.muted, fontSize: 20 }}>Run it yourself</span>
            <span style={ogNum(20, OG.violet)}>pantessa.com/chat</span>
          </div>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
