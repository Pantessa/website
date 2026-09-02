# Rebrand disclosure — ready-to-post drafts (prepared 2026-08-11)

**Why this exists (§1.1 of HANDOFF-gtm-bulletproof.md):**
`uniswap-embed.yeetful.com` is still listed by MetaMask (eth-phishing-detect)
and SEAL, and since 2026-08-05 `yeetful.com` 307-redirects to the brand-new
`pantessa.com`. A blocklisted host's parent domain redirecting to a fresh
domain is the textbook drainer-rotation signature. **A rebrand you announced
is a fact; a redirect a scanner discovers is a finding.** These drafts get
the announcement on the record before launch traffic arrives.

**Owner action (Nate):** post A, then B, then C — ideally the same day, and
before any KOL DM or launch thread. Each draft is self-contained and cites
only publicly verifiable facts (no internal PR numbers). The public anchor
they all cite is `https://www.pantessa.com/rebrand` — **merge the lane PR so
that page is live before posting.**

Status of the supporting facts, verified 2026-08-11:
- MetaMask stalelist and SEAL `domain.txt` both still carry
  `uniswap-embed.yeetful.com`; `pantessa.com` and `yeetful.com` are clean on both.
- Both fork deployments are deleted (404); both repos are archived on
  github.com/Pantessa (the org renamed from Yeetful 2026-08-17; the old org
  URL now 404s, though old repo URLs still 301 until the name is reclaimed).
- `pantessa@1.0.0` and `yeetful@0.11.0` are live on npm.

---

## Draft A — comment on the open MetaMask appeal
**Where:** https://github.com/MetaMask/eth-phishing-detect/issues/273376
(post from the org GitHub account that filed it)

> **Update from the site owner — remediation complete, plus a proactive
> disclosure.**
>
> Since filing this appeal, we have fully retired everything the listing
> flagged:
>
> - Both fork deployments (`uniswap-embed.yeetful.com` and the CoW fork) are
>   **deleted** — the hosts serve nothing and return no content.
> - Both source repositories are **archived read-only** on our GitHub org
>   (github.com/Pantessa) so the history stays inspectable.
> - Every link to them was removed from our product, and we adopted a
>   standing internal policy: never host or brand an interface that looks
>   like someone else's product. We understand why the listing happened;
>   hosting third-party-branded interfaces was our mistake.
>
> **Proactive disclosure, so you hear it from us rather than a scanner:** on
> **2026-08-05 we renamed the company from Yeetful to Pantessa**. As a
> result, `www.yeetful.com` now returns a 307 redirect to
> `www.pantessa.com`. The redirect is deliberate and permanent-for-now, so
> that previously shared links and installed embeds keep working. We are
> aware that "domain associated with a listed host redirects to a brand-new
> domain" resembles infrastructure rotation — the public, dated record of
> the rename is here: https://www.pantessa.com/rebrand — and we would rather
> over-disclose than have it discovered.
>
> **Request:** remove `uniswap-embed.yeetful.com` from the list (the host is
> permanently dead), and please treat `pantessa.com` as the same
> organization in good standing. Happy to provide deploy history, DNS
> records, signed messages from our treasury or deployer addresses, or
> anything else that helps verification.

---

## Draft B — Blockaid dApp registration / rebrand notice
**Where:** blockaid.io report / dApp-registration intake (see
BLOCKAID-APPEAL.md for the in-wallet "Report an issue" path, which attaches
the request payload)

> **Subject:** dApp registration + rebrand disclosure — Pantessa (formerly
> Yeetful)
>
> We operate **Pantessa** (https://www.pantessa.com), an agent-chat platform
> that builds guarded on-chain transactions which users sign from their own
> wallets, plus x402 (EIP-3009 `TransferWithAuthorization`) USDC
> micropayments on Base — typical value $0.004 per call, single-use nonce,
> short `validBefore`, never an allowance.
>
> Three things we want on your record, from us directly:
>
> 1. **Rebrand:** on 2026-08-05 we renamed from Yeetful to Pantessa.
>    `www.yeetful.com` now 307-redirects to `www.pantessa.com`; the redirect
>    stays up so installed integrations keep working. Public dated record:
>    https://www.pantessa.com/rebrand
> 2. **History:** one subdomain of the old domain,
>    `uniswap-embed.yeetful.com`, was listed by eth-phishing-detect and SEAL
>    after we hosted a forked open-source DEX interface there as an embed
>    demo. That was our error; the deployment is deleted, the repo is
>    archived, and an appeal is open
>    (MetaMask/eth-phishing-detect#273376). No Pantessa property hosts
>    third-party-branded interfaces.
> 3. **Registration request:** please register `pantessa.com` /
>    `www.pantessa.com` as legitimate, associated with `yeetful.com` as its
>    predecessor, and allowlist our x402 settlement receiver
>    `0xe630826c26760f46339cda35621e3aac63736c4a` (Base, USDC) — details and
>    example transactions on request.

---

## Draft C — SEAL blocklist appeal
**Where:** the Security Alliance blocklist intake (the repo that publishes
`domain.txt`; file through its stated process — issue or security contact)

> **Subject:** Delisting request + rebrand disclosure —
> `uniswap-embed.yeetful.com` (host permanently dead)
>
> We are the owners of `yeetful.com`. `uniswap-embed.yeetful.com` appears in
> your domain blocklist; it hosted a forked open-source Uniswap interface
> with our chat embed mounted, as a demo of our embed product. Hosting a
> DEX-branded interface off the DEX's own domain was our mistake — we
> understand exactly why it was listed.
>
> Current state, verifiable now: the deployment is **deleted** (the host
> serves nothing), the source repo is **archived** on github.com/Pantessa,
> and our standing policy is to never host third-party-branded interfaces.
> A parallel appeal is open with MetaMask
> (eth-phishing-detect#273376).
>
> **Disclosure so you hear it from us:** on 2026-08-05 we renamed the
> company to **Pantessa**; `www.yeetful.com` now 307-redirects to
> `www.pantessa.com` (kept alive for installed integrations). The public,
> dated record is https://www.pantessa.com/rebrand — we're flagging the
> redirect ourselves because we know what that shape can look like from the
> outside.
>
> **Request:** remove `uniswap-embed.yeetful.com` (dead host, remediated
> cause), and note `pantessa.com` as the same organization in good
> standing. We can prove domain control, sign from our deployer or treasury
> addresses, or provide deploy history on request.

---

## After posting

- Track responses in this file (append dated notes below).
- When both delistings land: retire nothing immediately — standing rule 7's
  corollary (don't change serving hostnames mid-appeal) keeps applying until
  the appeals CLOSE; the `yeetful.com` redirect itself stays until traffic
  is flat regardless.
- If either list responds with questions, answer from the org account and
  mirror the answer onto `/rebrand` if it adds new public facts.

## Response log

- (none yet)

---

# Round 2 — paste-ready (2026-08-18)

**Why a round 2:** the appeal above (Draft A's target, `#273376`) is **CLOSED,
not pending**. Verified live 2026-08-18 via `gh api`:

```
repos/MetaMask/eth-phishing-detect/issues/273376
  state=closed  state_reason=completed
  created_at=2026-07-30T16:30:36Z  closed_at=2026-07-30T21:13:06Z  closed_by=AlexHerman1
  comments=2:
    AlexHerman1 2026-07-30T21:13:06Z  "neither of these domains are blocked."
    nategeier   2026-07-31T06:51:17Z  (correction: the request domain is
                uniswap-embed.yeetful.com, still in the stalelist — no reply in 18 days)
```

The maintainer checked the two domains named in the *scope note*
(`yeetful.com`, `www.yeetful.com`) rather than the one in the request, and
closed. Nate's correction went into an already-closed issue and reaches nobody.
**Draft A must therefore be a NEW issue** through the repo's own removal
template. Drafts B and C are retargeted below so they can be pasted the same
sitting. Everything cites the live evidence captured today.

## Evidence captured 2026-08-18 (the RIGHT feeds — never config.json)

| check | result |
|---|---|
| `GET https://phishing-detection.api.cx.metamask.io/v1/stalelist` | `data.lastUpdated = 1786729072` (2026-08-14T17:37:52Z), `data.blocklist` = 105,924 entries, **contains `uniswap-embed.yeetful.com`**; `allowlist` (58) and `fuzzylist` (8) do not contain any yeetful/pantessa host |
| `GET https://phishing-detection.api.cx.metamask.io/v1/diffsSince/1786729072` | 3,279 diffs since the stalelist; **none** touch a yeetful.com or pantessa.com host (no removal recorded) |
| `yeetful.com`, `www.yeetful.com`, `pantessa.com`, `www.pantessa.com` on the stalelist | **not present** (clean) |
| SEAL `https://raw.githubusercontent.com/security-alliance/blocklists/main/domain.txt` | 105,170 lines; **line 54178 = `uniswap-embed.yeetful.com`**; no other yeetful/pantessa host |
| `curl -I https://uniswap-embed.yeetful.com/` | `HTTP/2 404` |
| `curl -I https://cow-embed.yeetful.com/` | `HTTP/2 404` |
| `curl -I https://www.yeetful.com/` | `HTTP/2 307` → `https://www.pantessa.com` |
| `curl -I https://www.pantessa.com/rebrand` | `HTTP/2 200` |
| `gh api repos/Pantessa/uniswap-embed` / `…/cowswap` | `archived: true` (org renamed `Yeetful` → `Pantessa`; old repo URLs 301-redirect; `github.com/Yeetful` itself now 404s) |
| Issue template in the repo | `.github/ISSUE_TEMPLATE/02-blocklist-removal.yaml` — title prefix `Blocklist removal request`, auto-label `blocklist removal`, auto-assignee `@MetaMask/user-safety`; fields: *Legitimate domains…* (required), *Please explain why this content is legitimate*, *Is this a duplicate request?* (checkbox, required) |

## Draft A′ — NEW MetaMask issue (replaces the dead #273376)

**Owner item — Nate posts. Two ways, prefer the first (the web form applies
the template's label + assignee, which a CLI-created issue cannot):**

1. **Web form (preferred):**
   `https://github.com/MetaMask/eth-phishing-detect/issues/new?template=02-blocklist-removal.yaml`
   Title, then paste each block below into its field, tick the checkbox.
2. **CLI (same content, template headings reproduced in the body; the
   `blocklist removal` label needs write access so it is NOT passed — a
   maintainer or the template bot applies it):**
   ```bash
   gh issue create \
     --repo MetaMask/eth-phishing-detect \
     --title "Blocklist removal request: uniswap-embed.yeetful.com (dead host; re-file of #273376, closed on the wrong domain)" \
     --body-file /Users/nategeier/yeetful/website/POSTS/metamask-issue-A-prime.md
   ```
   (`POSTS/metamask-issue-A-prime.md` is this section's body, verbatim.)

**Title**

> Blocklist removal request: uniswap-embed.yeetful.com (dead host; re-file of #273376, closed on the wrong domain)

**Field: Legitimate domains, IPs, IPFS hashes, or IPNS names**

> https://uniswap-embed.yeetful.com

**Field: Please explain why this content is legitimate**

> **Request:** remove `uniswap-embed.yeetful.com` from `eth_phishing_detect_config.blocklist`. The host has been permanently decommissioned and returns HTTP 404. This is a re-file of #273376, which was closed with "neither of these domains are blocked" — the two domains checked appear to have been the ones in that issue's *scope note* (`yeetful.com`, `www.yeetful.com`, which are indeed not blocked and were never in question) rather than the domain in the request. A correction was posted into the closed issue on 2026-07-31; re-filing so it reaches the queue.
>
> **The entry is still live, checked today (2026-08-18):**
>
> ```
> GET https://phishing-detection.api.cx.metamask.io/v1/stalelist
>   data.lastUpdated = 1786729072
>   data.blocklist   → contains "uniswap-embed.yeetful.com"
>   data.allowlist   → does not
> GET https://phishing-detection.api.cx.metamask.io/v1/diffsSince/1786729072
>   → no removal for uniswap-embed.yeetful.com
> ```
>
> **What was hosted there.** Yeetful (now Pantessa — see below) sells an embeddable chat widget for on-chain apps. To demonstrate that the widget installs on an existing app in a few lines, we deployed a fork of the open-source Uniswap interface with our widget mounted, at this subdomain (and a CoW Swap fork at `cow-embed.yeetful.com`, which is also retired and 404s, and is not on the list). A well-known DEX interface served from a domain that is not the DEX's, on a subdomain carrying the protocol's name, is indistinguishable from a wallet-draining clone at scan time. The listing was a fair call and we are not disputing it — the format was the problem regardless of intent. The fork was the upstream open-source interface plus ~25 lines to mount the widget; it did not modify routing, contract addresses or recipients, never asked for a seed phrase or key, and never held funds.
>
> **Remediation, complete and verifiable:**
>
> - `curl -I https://uniswap-embed.yeetful.com/` → 404 (deployment deleted)
> - `curl -I https://cow-embed.yeetful.com/` → 404 (deployment deleted)
> - Both fork repositories are archived read-only so the diff against upstream stays auditable: https://github.com/Pantessa/uniswap-embed and https://github.com/Pantessa/cowswap
> - Every link to them was removed from our product, and our standing policy is to never host a fork of any third party's interface under our domains, for any purpose.
>
> **Proactive disclosure, so you hear it from us rather than a scanner:** on 2026-08-05 we renamed the company from **Yeetful to Pantessa**. As a result `www.yeetful.com` now returns a **307 redirect to `www.pantessa.com`**, kept up deliberately so previously shared links and installed embeds keep working; our GitHub org was renamed the same way (`github.com/Yeetful` → `github.com/Pantessa`, old repo URLs redirect). We know that "domain associated with a listed host redirects to a brand-new domain" resembles infrastructure rotation. The public, dated record of the rename — with a verify-it-yourself table — is https://www.pantessa.com/rebrand. We would rather over-disclose than have it discovered.
>
> **Scope.** This request covers only the one retired subdomain, so that a decommissioned host does not stay attached to our production domains in downstream aggregators (ChainPatrol already surfaces `yeetful.com` as a related asset of a blocked one). No change is requested for `yeetful.com`, `www.yeetful.com`, `pantessa.com` or `www.pantessa.com` — all four are absent from the stalelist today.
>
> **Ownership / verification.** I own `yeetful.com` and `pantessa.com` and can prove control by DNS TXT, a file at a path you name, or a signed message from our published treasury address `0x9Cc0B7A0DdB091E17647d689206e730131E9892A`. Public org and source: https://github.com/Pantessa · SDK on npm: `pantessa` (formerly `yeetful`) · contact: nate@nate.pro.
>
> Thank you for maintaining this list. The pattern that got us listed does real harm and should stay aggressively enforced.

**Field: Is this a duplicate request?**

> - [x] I have checked the issues page and confirmed this is not a duplicate request
>   *(it is a deliberate re-file of the closed #273376, stated in the title and first paragraph — the only other hits for this host are repository sync PRs)*

## Draft B′ — Blockaid registration (retargeted, paste-ready)

**Where:** Blockaid's dApp registration / false-positive intake at
blockaid.io (the "Report an issue" link inside the MetaMask "deceptive
request" warning reaches the same queue with the request payload attached —
see `BLOCKAID-APPEAL.md`). Owner submits.

> **Subject:** dApp registration + rebrand disclosure — Pantessa (formerly Yeetful)
>
> We operate **Pantessa** (https://www.pantessa.com), an agent-chat platform that builds guarded on-chain transactions which users sign from their own wallets, plus x402 (EIP-3009 `TransferWithAuthorization`) USDC micropayments on Base — typical value $0.004 per call, single-use nonce, short `validBefore`, never an allowance.
>
> Three things we want on your record, from us directly:
>
> 1. **Rebrand:** on 2026-08-05 we renamed from Yeetful to Pantessa. `www.yeetful.com` now 307-redirects to `www.pantessa.com`; the redirect stays up so installed integrations keep working. Our GitHub org renamed too (github.com/Yeetful → github.com/Pantessa). Public dated record with a verify-yourself table: https://www.pantessa.com/rebrand
> 2. **History:** one subdomain of the old domain, `uniswap-embed.yeetful.com`, was listed by eth-phishing-detect and SEAL after we hosted a forked open-source DEX interface there as an embed demo. That was our error; the deployment is deleted (404), the repo is archived (https://github.com/Pantessa/uniswap-embed), and a removal request is filed with MetaMask (eth-phishing-detect — the original #273376 was closed on a misread of the domain; a re-file is linked from /rebrand). No Pantessa property hosts third-party-branded interfaces.
> 3. **Registration request:** please register `pantessa.com` / `www.pantessa.com` as legitimate, associated with `yeetful.com` as its predecessor, and allowlist our x402 settlement receiver `0xe630826c26760f46339cda35621e3aac63736c4a` (Base, USDC) — details and example transactions on request.
>
> Contact: nate@nate.pro · treasury (signing available) `0x9Cc0B7A0DdB091E17647d689206e730131E9892A`.

## Draft C′ — SEAL delisting request (retargeted, paste-ready)

**Where:** `github.com/security-alliance/blocklists` is a **read-only mirror
with issues disabled** (verified 2026-08-18: `has_issues=false`, README =
"read-only mirror of blocklists maintained by SEAL"). Route the text through
SEAL's own contact path instead — https://securityalliance.org/contact (form)
and/or the SEAL 911 Telegram bot — Nate picks whichever they answer; note the
channel used in the response log below.

> **Subject:** Delisting request + rebrand disclosure — `uniswap-embed.yeetful.com` (host permanently dead)
>
> We are the owners of `yeetful.com` (now Pantessa, `pantessa.com`). `uniswap-embed.yeetful.com` appears in your `domain.txt` blocklist (line 54178 of the current mirror); it hosted a forked open-source Uniswap interface with our chat embed mounted, as a demo of our embed product. Hosting a DEX-branded interface off the DEX's own domain was our mistake — we understand exactly why it was listed.
>
> Current state, verifiable now: the deployment is **deleted** (`curl -I https://uniswap-embed.yeetful.com/` → 404), the source repo is **archived** at https://github.com/Pantessa/uniswap-embed, and our standing policy is to never host third-party-branded interfaces. A removal request is filed with MetaMask's eth-phishing-detect as well.
>
> **Disclosure so you hear it from us:** on 2026-08-05 we renamed the company to **Pantessa**; `www.yeetful.com` now 307-redirects to `www.pantessa.com` (kept alive for installed integrations). The public, dated record is https://www.pantessa.com/rebrand — we're flagging the redirect ourselves because we know what that shape can look like from the outside.
>
> **Request:** remove `uniswap-embed.yeetful.com` (dead host, remediated cause), and note `pantessa.com` as the same organization in good standing. We can prove domain control (DNS TXT / file / signed message from `0x9Cc0B7A0DdB091E17647d689206e730131E9892A`) or provide deploy history on request. Contact: nate@nate.pro.

## After posting (round 2)

- `/rebrand` (app/rebrand/page.tsx) now says #273376 was **closed on
  2026-07-30 after the wrong domains were checked** and that a new request is
  being filed (squad GTM branch, 2026-08-18; harness-pinned). Once A′ is
  filed, replace the placeholder sentence + the verify-table row with the
  new issue link (a `TODO(owner)` comment marks both spots).
- Track responses below. Delisting = `isRemoval:true` for the host in
  `/v1/diffsSince/<lastUpdated>` (`npm run digest:gtm` watches this daily) and
  the line disappearing from SEAL `domain.txt`.

## Response log (round 2)

- 2026-08-18 — A′/B′/C′ drafted (squad GTM lane), not yet posted.
