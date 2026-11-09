import type { Metadata } from 'next'
import TgEntry from './TgEntry'
import './tg.css'

// /tg — the Mini App entry (squad community, lane TELEGRAM). Telegram opens
// this page inside its own webview from a room's join button
// (`t.me/<bot>/<app>?startapp=g_<slug>__<invite>`) or from the bot's "Open"
// button in a private chat. The page hands Telegram's signed launch data to
// /api/telegram/auth, joins the room the payload names, and lands on
// /g/<slug>. No wallet, no form: Telegram's signature is the identity.
//
// Opened anywhere else it says so in one line and offers the room and the
// bot. The page is static: everything it knows arrives in the browser.

export const metadata: Metadata = {
  title: 'Pantessa in Telegram',
  description: 'Join a Pantessa room from Telegram in one tap.',
  robots: { index: false, follow: false },
}

export default function TgPage() {
  return <TgEntry />
}
