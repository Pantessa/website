// MCP ownership claim (x402-launch M5). The operator of an MCP claims it by
// proving control of its backing GitHub repo — they commit a well-known file
// naming their wallet, and we read it back via the GitHub API. Combined with a
// SIWE session (which proves the wallet), that binds the MCP to an owner: the
// creator-of-record for its launchpad token.
//
// Why a repo file and not OAuth: committing to `.well-known/` requires write
// access to the repo, so the file IS the proof of control — no OAuth app,
// scopes, or secrets to manage. (A GitHub-login UX layer can come later.)

/** Where the claimant proves control of their repo. */
export const CLAIM_PATH = '.well-known/yeetful-claim.txt'

/** repo must be "owner/name" (GitHub's allowed character set). */
export function isValidRepo(repo: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)
}

/** The line the claimant must put in CLAIM_PATH. */
export function claimFileContent(address: string): string {
  return `yeetful-claim ${address.toLowerCase()}`
}

export type ClaimVerification = { ok: boolean; reason?: string; login?: string }

/**
 * Verify that whoever controls `repo` intends to claim it for `address`, by
 * reading CLAIM_PATH via the GitHub contents API and checking it names the
 * wallet. Sets GITHUB_TOKEN in the env to raise the API rate limit.
 */
export async function verifyRepoClaim(repo: string, address: string): Promise<ClaimVerification> {
  if (!isValidRepo(repo)) return { ok: false, reason: 'Repo must be in "owner/name" form.' }

  const url = `https://api.github.com/repos/${repo}/contents/${CLAIM_PATH}`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw+json',
    'User-Agent': 'yeetful',
  }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  let res: Response
  try {
    res = await fetch(url, { headers })
  } catch {
    return { ok: false, reason: 'Could not reach GitHub. Try again.' }
  }
  if (res.status === 404) {
    return { ok: false, reason: `Add ${CLAIM_PATH} to ${repo} containing your wallet address, then retry.` }
  }
  if (!res.ok) return { ok: false, reason: `GitHub returned ${res.status}.` }

  const text = await res.text()
  if (!text.toLowerCase().includes(address.toLowerCase())) {
    return { ok: false, reason: `${CLAIM_PATH} does not contain your wallet address.` }
  }
  return { ok: true, login: repo.split('/')[0] }
}
