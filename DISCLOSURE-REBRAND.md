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
  github.com/Yeetful.
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
>   (github.com/Yeetful) so the history stays inspectable.
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
> serves nothing), the source repo is **archived** on github.com/Yeetful,
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
