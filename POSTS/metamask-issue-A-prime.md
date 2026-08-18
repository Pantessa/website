<!-- Body for `gh issue create` — Draft A′ from DISCLOSURE-REBRAND.md (2026-08-18). OWNER POSTS. -->

### Legitimate domains, IPs, IPFS hashes, or IPNS names

https://uniswap-embed.yeetful.com

### Please explain why this content is legitimate

**Request:** remove `uniswap-embed.yeetful.com` from `eth_phishing_detect_config.blocklist`. The host has been permanently decommissioned and returns HTTP 404. This is a re-file of #273376, which was closed with "neither of these domains are blocked" — the two domains checked appear to have been the ones in that issue's *scope note* (`yeetful.com`, `www.yeetful.com`, which are indeed not blocked and were never in question) rather than the domain in the request. A correction was posted into the closed issue on 2026-07-31; re-filing so it reaches the queue.

**The entry is still live, checked today (2026-08-18):**

```
GET https://phishing-detection.api.cx.metamask.io/v1/stalelist
  data.lastUpdated = 1786729072
  data.blocklist   → contains "uniswap-embed.yeetful.com"
  data.allowlist   → does not
GET https://phishing-detection.api.cx.metamask.io/v1/diffsSince/1786729072
  → no removal for uniswap-embed.yeetful.com
```

**What was hosted there.** Yeetful (now Pantessa — see below) sells an embeddable chat widget for on-chain apps. To demonstrate that the widget installs on an existing app in a few lines, we deployed a fork of the open-source Uniswap interface with our widget mounted, at this subdomain (and a CoW Swap fork at `cow-embed.yeetful.com`, which is also retired and 404s, and is not on the list). A well-known DEX interface served from a domain that is not the DEX's, on a subdomain carrying the protocol's name, is indistinguishable from a wallet-draining clone at scan time. The listing was a fair call and we are not disputing it — the format was the problem regardless of intent. The fork was the upstream open-source interface plus ~25 lines to mount the widget; it did not modify routing, contract addresses or recipients, never asked for a seed phrase or key, and never held funds.

**Remediation, complete and verifiable:**

- `curl -I https://uniswap-embed.yeetful.com/` → 404 (deployment deleted)
- `curl -I https://cow-embed.yeetful.com/` → 404 (deployment deleted)
- Both fork repositories are archived read-only so the diff against upstream stays auditable: https://github.com/Pantessa/uniswap-embed and https://github.com/Pantessa/cowswap
- Every link to them was removed from our product, and our standing policy is to never host a fork of any third party's interface under our domains, for any purpose.

**Proactive disclosure, so you hear it from us rather than a scanner:** on 2026-08-05 we renamed the company from **Yeetful to Pantessa**. As a result `www.yeetful.com` now returns a **307 redirect to `www.pantessa.com`**, kept up deliberately so previously shared links and installed embeds keep working; our GitHub org was renamed the same way (`github.com/Yeetful` → `github.com/Pantessa`, old repo URLs redirect). We know that "domain associated with a listed host redirects to a brand-new domain" resembles infrastructure rotation. The public, dated record of the rename — with a verify-it-yourself table — is https://www.pantessa.com/rebrand. We would rather over-disclose than have it discovered.

**Scope.** This request covers only the one retired subdomain, so that a decommissioned host does not stay attached to our production domains in downstream aggregators (ChainPatrol already surfaces `yeetful.com` as a related asset of a blocked one). No change is requested for `yeetful.com`, `www.yeetful.com`, `pantessa.com` or `www.pantessa.com` — all four are absent from the stalelist today.

**Ownership / verification.** I own `yeetful.com` and `pantessa.com` and can prove control by DNS TXT, a file at a path you name, or a signed message from our published treasury address `0x9Cc0B7A0DdB091E17647d689206e730131E9892A`. Public org and source: https://github.com/Pantessa · SDK on npm: `pantessa` (formerly `yeetful`) · contact: nate@nate.pro.

Thank you for maintaining this list. The pattern that got us listed does real harm and should stay aggressively enforced.

### Is this a duplicate request?

- [x] I have checked the issues page and confirmed this is not a duplicate request
  *(it is a deliberate re-file of the closed #273376, stated in the title and first paragraph — the only other hits for this host are repository sync PRs)*
