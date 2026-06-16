// Transactional email via Resend. The yeetful.com domain is verified in Resend
// (DKIM resend._domainkey + SPF/return-path on send.yeetful.com), so mail sent
// here authenticates as yeetful.com. Set RESEND_API_KEY to enable; without it,
// sending throws a clear error and `emailConfigured()` is false (callers can
// degrade gracefully rather than crash a request).

import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM ?? 'Yeetful <onboarding@yeetful.com>'
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'nate@yeetful.com'
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'

/** True when RESEND_API_KEY is present — gate optional sends on this. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

function client(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY is not set — cannot send email.')
  return new Resend(key)
}

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html: string
  text: string
  replyTo?: string
}

/** Send one email through Resend. Throws on misconfig or a Resend API error. */
export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const { data, error } = await client().emails.send({
    from: FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: input.replyTo ?? REPLY_TO,
  })
  if (error) throw new Error(`Resend error: ${error.message}`)
  if (!data?.id) throw new Error('Resend returned no message id')
  return { id: data.id }
}

// ── Onboarding email ─────────────────────────────────────────────────────────
// Brand: Paper background, Ink text, a single Yeet-green CTA, plainspoken voice,
// one wink, signed by a human. Table + inline styles for email-client compat.

const C = {
  ink: '#0A0A0B',
  paper: '#FAFAF7',
  smoke: '#6B6B6F',
  mist: '#C9C9C5',
  fog: '#EDEDE8',
  yeet: '#C6FF3D',
}
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Geist', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

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

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:${C.paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;font-family:${FONT};">
  <tr><td style="padding-bottom:28px;">
    <span style="font-size:20px;font-weight:600;letter-spacing:-0.04em;color:${C.ink};">yeetful</span>
  </td></tr>
  <tr><td style="font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:${C.ink};padding-bottom:16px;">
    An expense account for your agent.
  </td></tr>
  <tr><td style="font-size:16px;line-height:1.6;color:${C.ink};padding-bottom:16px;">
    ${hi}
  </td></tr>
  <tr><td style="font-size:16px;line-height:1.6;color:${C.ink};padding-bottom:16px;">
    Yeetful gives your AI agent an expense account: an allowlist plus per-call and per-day USDC budgets, enforced <em>before</em> any payment is signed. Connect a wallet, set the rules, and every call your agent makes is paid per-use on Base — with a receipt for each one.
  </td></tr>
  <tr><td style="font-size:16px;line-height:1.6;color:${C.ink};padding-bottom:28px;">
    One thing to do now: open your dashboard, connect a wallet, and set your first budget.
  </td></tr>
  <tr><td style="padding-bottom:28px;">
    <a href="${dashboard}" style="display:inline-block;background:${C.yeet};color:${C.ink};text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:12px;">Open your dashboard →</a>
  </td></tr>
  <tr><td style="font-size:15px;line-height:1.6;color:${C.smoke};padding-bottom:28px;border-top:1px solid ${C.mist};padding-top:24px;">
    Wiring it into your own agent takes about twenty lines — the <a href="${docs}" style="color:${C.ink};text-decoration:underline;">quickstart</a> has it. No invoices, no API-key sprawl, no surprise bill at 2am.
  </td></tr>
  <tr><td style="font-size:16px;line-height:1.6;color:${C.ink};padding-bottom:6px;">
    — Nate, yeetful
  </td></tr>
  <tr><td style="font-size:12px;line-height:1.5;color:${C.smoke};padding-top:28px;">
    <a href="${SITE}" style="color:${C.smoke};text-decoration:underline;">yeetful.com</a> · Replies go to a human.
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`

  return { subject, html, text }
}

/** Send the onboarding/welcome email. */
export async function sendOnboardingEmail(opts: {
  to: string
  name?: string
}): Promise<{ id: string }> {
  const { subject, html, text } = onboardingEmail({ name: opts.name })
  return sendEmail({ to: opts.to, subject, html, text })
}
