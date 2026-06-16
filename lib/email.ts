// Transactional email via Resend (https://resend.com). Best-effort by design:
// sending NEVER throws and NEVER fails the caller's request — a signup is still
// recorded even if delivery hiccups. Disabled (no-op) when RESEND_API_KEY is
// unset, so the app runs fine without email configured.

const RESEND_API_KEY = process.env.RESEND_API_KEY
// Override with EMAIL_FROM once a domain is verified in Resend; the
// onboarding@resend.dev sender works out of the box for testing.
const FROM = process.env.EMAIL_FROM ?? 'Yeetful <onboarding@resend.dev>'

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
}: {
  to: string
  subject: string
  html: string
}): Promise<boolean> {
  if (!RESEND_API_KEY || isUndeliverable(to)) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    return res.ok
  } catch {
    return false // best-effort — never let a delivery error break the flow
  }
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'

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
