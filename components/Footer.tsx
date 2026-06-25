import Link from 'next/link'
import { YeetfulMark } from '@/components/Logo'

const FOOTER_LINKS = {
  github: 'https://github.com/Yeetful',
  x: 'https://x.com/yeetful_ai',
  telegram: 'https://t.me/yeetful',
  site: 'https://yeetful.com',
}

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__top">
        <div className="footer__brand">
          <Link className="logo" href="/">
            <YeetfulMark size={20} />
            <span className="logo__word">yeetful</span>
          </Link>
          <p className="footer__tag">
            MCP power chat — combine any x402 agent. Pay per call, in USDC on Base.
          </p>
        </div>
        <div className="footer__links">
          <Link href="/docs">Docs</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/docs/terms">Terms</Link>
          <Link href="/docs/privacy">Privacy</Link>
          <a href={FOOTER_LINKS.github} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
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
