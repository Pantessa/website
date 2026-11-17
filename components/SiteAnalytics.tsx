'use client'

// Vercel Web Analytics, minus the machines. Its own bot filter passed the
// 2026-11 daily crawl (residential IPs, 2023 browsers, Lightpanda), and page
// views went from ~30 a day to ~1,500, every one of them counted as a
// person. Each page view and custom event goes through beforeSend, which
// drops it when the browser says it is driven (navigator.webdriver) or its
// user agent reads as automated (lib/bot-ua, the journey log's same rule).

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next'
import { isAutomatedUa } from '@/lib/bot-ua'

function dropMachines(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    if (navigator.webdriver === true) return null
    if (isAutomatedUa(navigator.userAgent)) return null
  } catch {
    // a browser that cannot answer is counted, as before
  }
  return event
}

export default function SiteAnalytics() {
  return <Analytics beforeSend={dropMachines} />
}
