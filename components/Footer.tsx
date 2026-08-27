import Link from 'next/link'
import { YeetfulMark } from '@/components/Logo'
import ThemeToggle from '@/components/ThemeToggle'

type FooterLink = { label: string; href: string; ext?: boolean }

const GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Community',
    links: [
      // Social handles keep the pre-rebrand names ON PURPOSE — those accounts
      // have not been renamed (the `pantessa` GitHub org does not exist), so
      // pointing at a new handle would turn a working link into a 404.
      { label: 'X / Twitter', href: 'https://x.com/yeetful_ai', ext: true },
      { label: 'Telegram', href: 'https://t.me/yeetful', ext: true },
      { label: 'GitHub', href: 'https://github.com/Pantessa', ext: true },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Intent Links', href: '/links' },
      { label: 'Mosaic', href: '/mosaic' },
      { label: 'Site Buttons', href: '/links/embed' },
      { label: 'Live Activity', href: '/activity' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Blog', href: '/blog' },
      { label: 'Terms', href: '/docs/terms' },
      { label: 'Privacy', href: '/docs/privacy' },
      // The public record of the 2026-08-05 rename — kept in the footer so
      // security reviewers can find it from any page (§1.1 disclosure).
      { label: 'Formerly Yeetful', href: '/rebrand' },
    ],
  },
  {
    // The deep-dive surfaces — out of the main nav, still one click away.
    // Servers moved here from the dashboard rail (Nate, 2026-07-23).
    title: 'Under the hood',
    links: [
      { label: 'MCP Servers', href: '/servers' },
      { label: 'Benchmarks', href: '/benchmarks' },
      { label: 'Router Tools', href: '/tools' },
      { label: 'Status', href: '/incidents' },
    ],
  },
  {
    title: 'Devs / Claude Wizards',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Embed Anywhere', href: '/docs/embed' },
      { label: 'Creator Earnings', href: '/docs/creator-earnings' },
      { label: 'SDK on npm', href: 'https://www.npmjs.com/package/pantessa', ext: true },
    ],
  },
]

const SOCIALS: { label: string; href: string; icon: React.ReactNode }[] = [
  {
    label: 'X / Twitter',
    href: 'https://x.com/yeetful_ai',
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: 'Telegram',
    href: 'https://t.me/yeetful',
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  {
    label: 'GitHub',
    href: 'https://github.com/Pantessa',
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
        <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58l-.02-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
      </svg>
    ),
  },
]

export default function Footer() {
  return (
    <footer className="footer">
      {/* Full-bleed living texture — a slow emerald aurora over a drifting grid */}
      <div className="footer__texture" aria-hidden>
        <div className="footer__aurora" />
        <div className="footer__grid" />
      </div>

      <div className="footer__inner">
        <div className="footer__cols">
          <div className="footer__brand">
            <Link className="logo" href="/">
              <YeetfulMark size={22} />
              <span className="logo__word">pantessa</span>
            </Link>
            <p className="footer__tag">
              You have an intent — we do the rest. A link carries the ask; Pantessa builds
              guarded transactions only your wallet can sign, and keeps working between
              your turns.
            </p>
            <div className="footer__socials">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="footer__social"
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          {GROUPS.map((group) => (
            <nav key={group.title} className="footer__group" aria-label={group.title}>
              <h3 className="footer__grouptitle">{group.title}</h3>
              <ul className="footer__grouplinks">
                {group.links.map((link) => (
                  <li key={link.label}>
                    {link.ext ? (
                      <a href={link.href} target="_blank" rel="noopener noreferrer">
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href}>{link.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="footer__bottom">
          <span className="mono">© 2026 PANTESSA INC.</span>
          <div className="footer__bottomright">
            <span className="mono">NON-CUSTODIAL · YOUR WALLET SIGNS</span>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Oversized wordmark bleeding off the bottom edge */}
      <div className="footer__wordmark" aria-hidden>
        <span>pantessa</span>
      </div>
    </footer>
  )
}
