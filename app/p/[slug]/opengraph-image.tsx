import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getSharedChat, getJobs, getChatServers, moneyMovedOf } from '@/lib/shared-chat'
import { ogMarkSvg } from '@/lib/og-marks'

// Social card for a shared chat (/p/[slug]) — without this file the segment's
// generateMetadata ships og:title/description but NO image (the root
// file-based card doesn't reach into segments that define their own OG
// metadata), which is exactly the broken placeholder X was rendering.
//
// The card is the receipt: the chat's ask as a big serif quote, the money
// moved as the emerald payoff line, and the agents that did the work as a
// medallion chain fusing into the Pantessa core (the fusion hero's language,
// same palette + fonts as app/opengraph-image.tsx).

export const runtime = 'nodejs'
export const alt = 'A shared Pantessa chat — guarded transactions from plain English.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
const ACCENT = '#34e3a0'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// Ambient glow + a faint emerald river under the medallion rail.
const AMBIENT = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="amb" cx="0.78" cy="0.45" r="0.75">
      <stop offset="0" stop-color="rgba(52,227,160,0.10)"/>
      <stop offset="0.7" stop-color="rgba(52,227,160,0)"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#amb)"/>
</svg>`

// The hub mark from app/icon.svg (same lockup as the root card).
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" fill="none">
  <rect x="0.75" y="0.75" width="50.5" height="50.5" rx="11.5" fill="#0B0E0D" stroke="rgba(255,255,255,0.16)" stroke-width="1.5"/>
  <g transform="translate(6 5)">
    <mask id="hub"><rect width="40" height="40" fill="#fff"/><circle cx="20" cy="20" r="1.9" fill="#000"/></mask>
    <g mask="url(#hub)" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round">
      <line x1="20" y1="20" x2="9" y2="9"/><line x1="20" y1="20" x2="31" y2="9"/><line x1="20" y1="20" x2="20" y2="33"/>
    </g>
    <g fill="#ffffff"><circle cx="9" cy="9" r="4.4"/><circle cx="31" cy="9" r="4.4"/><circle cx="20" cy="33" r="4.4"/></g>
    <circle cx="20" cy="20" r="3" fill="none" stroke="${ACCENT}" stroke-width="2.2"/>
  </g>
</svg>`

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
  // The serif quote scales down as the ask gets longer (titles are already
  // truncated at share time, so two steps cover the range).
  const titleSize = title.length > 34 ? 58 : 72

  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serif, serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(fonts, 'newsreader-500.ttf')),
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: BG,
          fontFamily: 'Geist',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toDataUri(AMBIENT)} width={1200} height={630} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />

        {/* header: lockup + kicker */}
        <div
          style={{
            position: 'absolute',
            top: 48,
            left: 64,
            right: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(MARK)} width={46} height={46} alt="" />
            <span style={{ color: INK, fontSize: 34, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, letterSpacing: 4, color: MUTED }}>
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: ACCENT }} />
            <span>SHARED CHAT · REAL RECEIPTS</span>
          </div>
        </div>

        {/* left column: the ask + the payoff */}
        <div
          style={{
            position: 'absolute',
            top: 168,
            left: 64,
            width: agents.length > 0 ? 780 : 1072,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              maxHeight: 240,
              overflow: 'hidden',
              fontFamily: 'Newsreader',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: titleSize,
              lineHeight: 1.08,
              letterSpacing: -1.5,
              color: INK,
            }}
          >
            <span>“{title}”</span>
          </div>
          {moved > 0 ? (
            <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 44 }}>
              <span
                style={{
                  fontSize: 84,
                  fontWeight: 600,
                  letterSpacing: -3,
                  backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`,
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                ${moved.toFixed(2)}
              </span>
              <span style={{ fontSize: 34, color: INK, marginLeft: 18, fontWeight: 500 }}>moved on-chain</span>
            </div>
          ) : (
            <div style={{ display: 'flex', marginTop: 44, fontSize: 34, color: INK, fontWeight: 500 }}>
              Guarded transactions from plain English
            </div>
          )}
          <div style={{ display: 'flex', marginTop: 18, fontSize: 22, color: MUTED, letterSpacing: 0.2 }}>
            Every step guarded, signed, and receipted — shared read-only.
          </div>
        </div>

        {/* right rail: the agents at work, fusing into the core */}
        {agents.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 150,
              right: 88,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {agents.map((a) => {
              const mark = ogMarkSvg(`${a.slug} ${a.name}`, INK, 52)
              const letter = a.name.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '?'
              return (
                <div key={a.slug} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      width: 104,
                      height: 104,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 52,
                      background: '#0B0E0D',
                      border: '1.5px solid rgba(255,255,255,0.18)',
                      boxShadow: '0 0 44px rgba(52,227,160,0.22)',
                    }}
                  >
                    {mark ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={toDataUri(mark)} width={52} height={52} alt="" />
                    ) : (
                      <span style={{ color: INK, fontSize: 44, fontWeight: 600 }}>{letter}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', width: 2, height: 26, background: 'rgba(52,227,160,0.45)' }} />
                </div>
              )
            })}
            <div
              style={{
                width: 76,
                height: 76,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 38,
                border: `2px solid rgba(52,227,160,0.7)`,
                background: 'rgba(52,227,160,0.10)',
                boxShadow: '0 0 56px rgba(52,227,160,0.35)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={toDataUri(MARK)} width={44} height={44} alt="" />
            </div>
          </div>
        )}

        {/* footer strip */}
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: 64,
            right: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 21,
          }}
        >
          <span style={{ color: MUTED, letterSpacing: 3.5 }}>EVERY DAPP · ONE CHAT</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: MUTED }}>Run it yourself</span>
            <span style={{ color: ACCENT, fontWeight: 600 }}>yeetful.com/chat</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Newsreader', data: serif, weight: 500, style: 'normal' },
        { name: 'Newsreader', data: serifItalic, weight: 500, style: 'italic' },
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
}
