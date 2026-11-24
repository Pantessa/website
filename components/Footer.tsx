import Link from 'next/link'
import { YeetfulMark } from '@/components/Logo'
import ThemeToggle from '@/components/ThemeToggle'
import SpineLink from '@/components/SpineLink'
import { X_PROFILE_URL } from '@/lib/social'
import { MARKETS_HREF } from '@/lib/markets'

/** `app`: the link lands inside the app shell, which sends a signed-out
 *  visitor home — so it renders as a SpineLink (the sign-in door for them).
 *  `file`: the link is a file in public/ — a plain anchor that downloads it. */
type FooterLink = { label: string; href: string; ext?: boolean; app?: boolean; file?: boolean }

/** The public brand kit (2026-11-24): logos, palette, tiles, backgrounds and
 *  the guidelines PDF, zipped. Built by `brand-kit/src/build-public.mjs` in the
 *  Drive brand folder, which holds the master; this is the copy the site serves. */
const BRAND_KIT_HREF = '/brand/kit/pantessa-brand-kit.zip'

/** The subreddit, r/Pantessa (2026-11-24). */
const REDDIT_URL = 'https://www.reddit.com/r/Pantessa/'

const GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Community',
    links: [
      // X is @askPantessa (lib/social); Telegram matches it at t.me/askpantessa.
      { label: 'X / Twitter', href: X_PROFILE_URL, ext: true },
      { label: 'Telegram', href: 'https://t.me/askpantessa', ext: true },
      { label: 'Reddit', href: REDDIT_URL, ext: true },
      { label: 'GitHub', href: 'https://github.com/Pantessa', ext: true },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Markets', href: MARKETS_HREF, app: true },
      { label: 'Intent Links', href: '/links' },
      { label: 'Mosaic', href: '/mosaic' },
      { label: 'Site Buttons', href: '/links/embed' },
      { label: 'Live Activity', href: '/activity' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Blog', href: '/blog' },
      { label: 'Brand Kit', href: BRAND_KIT_HREF, file: true },
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
    href: X_PROFILE_URL,
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: 'Telegram',
    href: 'https://t.me/askpantessa',
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  {
    label: 'Reddit',
    href: REDDIT_URL,
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z" />
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
              <YeetfulMark size={23} tight />
              <span className="logo__word">pantessa</span>
            </Link>
            <p className="footer__tag">
              The chart that executes. Stocks 24/7, perps, spot and yield in one wallet.
              Pantessa builds the trade and your wallet signs. It never holds your money.
              You keep the pen.
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
                    ) : link.file ? (
                      <a href={link.href} download>
                        {link.label}
                      </a>
                    ) : link.app ? (
                      <SpineLink href={link.href}>{link.label}</SpineLink>
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
