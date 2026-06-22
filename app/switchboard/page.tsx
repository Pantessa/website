import { redirect } from 'next/navigation'

// Switchboard is now the landing page. Keep /switchboard as a permanent
// redirect so older links (nav, docs, sitemap, shared URLs) still resolve.
export default function SwitchboardRedirect() {
  redirect('/')
}
