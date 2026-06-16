// Send a real onboarding email to verify the Resend setup end-to-end.
// Usage: RESEND_API_KEY=re_… npx tsx scripts/send-test-email.ts you@example.com [Name]
// Optional overrides: EMAIL_FROM, EMAIL_REPLY_TO, NEXT_PUBLIC_SITE_URL.
import { sendOnboardingEmail, emailEnabled } from '../lib/email'

const to = process.argv[2]
const name = process.argv[3]

if (!to) {
  console.error('Usage: npx tsx scripts/send-test-email.ts <to-email> [name]')
  process.exit(1)
}
if (!emailEnabled()) {
  console.error('RESEND_API_KEY is not set. Get one at https://resend.com → API Keys.')
  process.exit(1)
}

sendOnboardingEmail({ to, name })
  .then((ok) => {
    if (ok) {
      console.log(`✓ sent onboarding email to ${to}`)
    } else {
      console.error(`✗ send returned false — check the address and the Resend dashboard for the delivery.`)
      process.exit(1)
    }
  })
  .catch((e) => {
    console.error(`✗ send failed: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  })
