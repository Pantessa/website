import { redirect } from 'next/navigation'

// The Router is the landing page (/). Keep /router as a permanent redirect
// so the brand slug and any older links resolve to the home.
export default function RouterRedirect() {
  redirect('/')
}
