// Transactional email via Resend (https://resend.com). Best-effort by design:
// sending NEVER throws and NEVER fails the caller's request — a signup is still
// recorded even if delivery hiccups. Disabled (no-op) when RESEND_API_KEY is
// unset, so the app runs fine without email configured.
//
// The yeetful.com domain is verified in Resend (DKIM resend._domainkey +
// SPF/return-path on send.yeetful.com), so production mail authenticates as
// yeetful.com. Replies route to a human via EMAIL_REPLY_TO.

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM = process.env.EMAIL_FROM ?? 'Yeetful <onboarding@yeetful.com>'
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'nate@yeetful.com'
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'

export function emailEnabled(): boolean {
  return !!RESEND_API_KEY
}

/** Skip obviously non-deliverable test addresses so the harness doesn't hit Resend. */
function isUndeliverable(to: string): boolean {
  return /@(?:[^.]+\.)*(?:test|example|invalid|localhost)$/i.test(to) || /@example\.(?:com|org|net)$/i.test(to)
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
}: {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
}): Promise<boolean> {
  if (!RESEND_API_KEY || isUndeliverable(to)) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to,
        subject,
        html,
        ...(text ? { text } : {}),
        reply_to: replyTo ?? REPLY_TO,
      }),
    })
    return res.ok
  } catch {
    return false // best-effort — never let a delivery error break the flow
  }
}

// ── Landing-page email signup (double opt-in) ────────────────────────────────

export function verifyEmailHtml(token: string): { subject: string; html: string } {
  const url = `${SITE}/api/subscribe/verify?token=${encodeURIComponent(token)}`
  return {
    subject: 'Confirm your email · Yeetful',
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px">
      <h2>One click to confirm</h2>
      <p>Tap below to confirm this email and start getting Yeetful updates.</p>
      <p><a href="${url}" style="display:inline-block;background:#34E0A1;color:#0b0b0c;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Confirm email</a></p>
      <p style="color:#888;font-size:12px">If you didn't sign up, ignore this email.</p>
    </div>`,
  }
}

export const WELCOME_EMAIL = {
  subject: "You're in · Yeetful",
  html: `<div style="font-family:system-ui,sans-serif;max-width:480px">
    <h2>Welcome to Yeetful</h2>
    <p>You're on the list — expect occasional updates on agent expense accounts, new x402 services, and what we're shipping.</p>
    <p><a href="${SITE}">yeetful.com</a></p>
  </div>`,
}

// ── Onboarding email ─────────────────────────────────────────────────────────
// Plainspoken voice, one wink, signed by a human. Visual style matches the
// signup emails above (system-ui, the site's emerald accent) so all yeetful
// mail looks consistent.

export function onboardingEmail(opts: { name?: string } = {}): {
  subject: string
  html: string
  text: string
} {
  const hi = opts.name ? `Hi ${opts.name},` : 'Hi there,'
  const dashboard = `${SITE}/dashboard`
  const docs = `${SITE}/docs/quickstart`
  const subject = 'welcome to yeetful — the two-minute version'

  const text = [
    hi,
    '',
    'Yeetful gives your AI agent an expense account: an allowlist plus per-call and per-day USDC budgets, enforced before any payment is signed. Connect a wallet, set the rules, and every call your agent makes is paid per-use on Base — with a receipt for each one.',
    '',
    'One thing to do now: open your dashboard, connect a wallet, and set your first budget.',
    `→ ${dashboard}`,
    '',
    `Wiring it into your own agent takes about twenty lines: ${docs}`,
    '',
    'No invoices, no API-key sprawl, no surprise bill at 2am.',
    '',
    '— Nate, yeetful',
  ].join('\n')

  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#0b0b0c;line-height:1.55">
    <p style="font-size:13px;font-weight:600;letter-spacing:-0.02em;margin:0 0 20px">yeetful</p>
    <h2 style="margin:0 0 16px">An expense account for your agent.</h2>
    <p>${hi}</p>
    <p>Yeetful gives your AI agent an expense account: an allowlist plus per-call and per-day USDC budgets, enforced <em>before</em> any payment is signed. Connect a wallet, set the rules, and every call your agent makes is paid per-use on Base — with a receipt for each one.</p>
    <p>One thing to do now: open your dashboard, connect a wallet, and set your first budget.</p>
    <p><a href="${dashboard}" style="display:inline-block;background:#34E0A1;color:#0b0b0c;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open your dashboard →</a></p>
    <p style="color:#888;font-size:13px">Wiring it into your own agent takes about twenty lines — the <a href="${docs}">quickstart</a> has it. No invoices, no API-key sprawl, no surprise bill at 2am.</p>
    <p>— Nate, yeetful</p>
  </div>`

  return { subject, html, text }
}

/** Send the onboarding/welcome email. Best-effort (returns false on any failure). */
export async function sendOnboardingEmail(opts: { to: string; name?: string }): Promise<boolean> {
  const { subject, html, text } = onboardingEmail({ name: opts.name })
  return sendEmail({ to: opts.to, subject, html, text })
}
