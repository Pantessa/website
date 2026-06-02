import Link from 'next/link'
import { Zap } from 'lucide-react'

const FOOTER_LINKS = {
  x: 'https://x.com/yeetfuly',
  telegram: '#', // placeholder — supply real URL
  site: 'https://yeetful.com',
}

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__top">
        <div className="footer__brand">
          <Link className="logo" href="/">
            <span className="logo__mark">
              <Zap width={15} height={15} strokeWidth={2.5} />
            </span>
            <span className="logo__word">yeetful</span>
          </Link>
          <p className="footer__tag">
            MCP power chat — combine any x402 agent. Pay per call, in USDC on Base.
          </p>
        </div>
        <div className="footer__links">
          <a href={FOOTER_LINKS.x} target="_blank" rel="noopener noreferrer">
            X / Twitter
          </a>
          <a href={FOOTER_LINKS.telegram} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>
          <a href={FOOTER_LINKS.site} target="_blank" rel="noopener noreferrer">
            yeetful.com
          </a>
        </div>
      </div>
      <div className="footer__bottom">
        <span className="mono">© 2026 YEETFUL</span>
        <span className="mono">BUILT ON THE x402 STANDARD</span>
      </div>
    </footer>
  )
}
