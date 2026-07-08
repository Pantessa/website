import { ImageResponse } from 'next/og'

// Social card for the home (/). Next file convention: this renders the
// og:image (and twitter image) for the page. Dark hero palette, no external
// fonts (ImageResponse's default sans keeps it dependency-free).

export const alt = 'Router — Yeetful’s agentic payments & routing layer'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#08090a'
const INK = '#f4f5f3'
const DIM = '#838a80'
const ACCENT = '#34e3a0'
const FAINT = '#5c6159'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BG,
          padding: '72px 80px',
          // subtle emerald glow from the right, like the hero network
          backgroundImage: `radial-gradient(900px 600px at 88% 30%, rgba(52,227,160,0.14), rgba(8,9,10,0) 60%)`,
        }}
      >
        {/* eyebrow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: FAINT, fontSize: 24, letterSpacing: 6 }}>
          <span>MCP ROUTING ENGINE</span>
          <span style={{ color: '#2a2e2a' }}>·</span>
          <span>USDC ON BASE</span>
          <span style={{ color: '#2a2e2a' }}>·</span>
          <span style={{ color: ACCENT }}>x402</span>
        </div>

        {/* headline */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 90, fontWeight: 600, letterSpacing: -2, lineHeight: 1.04 }}>
            <span style={{ color: INK }}>Every dapp.</span>
          </div>
          <div style={{ display: 'flex', fontSize: 90, fontWeight: 600, letterSpacing: -2, lineHeight: 1.04 }}>
            <span style={{ color: ACCENT, fontStyle: 'italic' }}>One</span>
            <span style={{ color: DIM }}>{' chat.'}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 26, fontSize: 30, color: '#b8bdb4', maxWidth: 920, lineHeight: 1.4 }}>
            Free first-party MCPs — Uniswap, Snapshot, CoW, Hyperliquid — plus your own, fused into one agent. Guardrails, your wallet signs, every call receipted.
          </div>
        </div>

        {/* footer: brand + url */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', width: 16, height: 16, borderRadius: 8, background: ACCENT }} />
            <span style={{ color: INK, fontSize: 30, fontWeight: 600 }}>yeetful</span>
          </div>
          <span style={{ color: FAINT, fontSize: 26 }}>yeetful.com</span>
        </div>
      </div>
    ),
    { ...size },
  )
}
