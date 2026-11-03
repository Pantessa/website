# The policy pool — `PolicyPoolHook`

A Uniswap v4 hook that makes the pool itself enforce the Pantessa desk policy. Every swap must carry an
**attestation**: one EIP-712 message signed by the desk's **policy signer** saying *this intent, this pool, this side, up
to this size, before this time, from this wallet (or bearer)*. No attestation, forged attestation, wrong pool, wrong side,
over size, expired, wrong `tx.origin`, replayed, or paused → the swap reverts with a named error before any money moves.
A fill emits **`DeskFill`** with the intent id and the verbatim provenance string (`dune:9055910`, `desk:<intentId>`, …),
which Dune indexes. The hook never touches economics: no deltas, no fee override — the pool prices like any 0.05% pool.

Dune reads · Pantessa builds · the client's custody signs · the receipt lands back in Dune. This is the on-chain half.

Contract of record: `/Users/nate/pantessa/squad-policy-pool-2026-11-02/README.md` "The hook". Executable spec shared with
the TypeScript side: `lib/policy-pool/spec.ts` (EIP-712 domain/types, hookData encoding, event/error ABI).
`test/vectors/attestation.json` (five vectors: bound, bearer, unicode origin, max size, empty origin) proves both sides hash and sign the same bytes.

## Layout
```
foundry.toml · remappings.txt          solc 0.8.26, cancun, optimizer 1M runs, no via-IR needed
src/PolicyPoolHook.sol                 the hook (BaseHook + OpenZeppelin EIP712 + ECDSA)
src/base/BaseHook.sol                  vendored verbatim from v4-periphery's last copy (it moved to OZ/uniswap-hooks)
test/PolicyPoolHook.t.sol              31 local tests on a fresh PoolManager (fills, every refusal, replay, pause, liquidity gate, admin, vector)
test/PolicyPoolHook.fork.t.sol         10 Base MAINNET fork tests through the REAL PoolManager / PositionManager / Universal Router
test/utils/OwnerLiquidityRouter.sol    a test router exposing IMsgSender.msgSender() like the PositionManager
test/vectors/attestation.json          5 TS↔Solidity vectors written by the SIGNER lane (scripts/policy-pool-attestation-vectors.ts)
script/Deploy.s.sol                    mine salt → CREATE2 deploy → initialize pool → (optional) seed via PositionManager
script/AttestedSwap.s.sol              one attested swap (or a plain refused one) through the Universal Router
script/env.sh · script/README.md       keys from website/.env.local without printing; exact commands + measured gas
abi/PolicyPoolHook.json                compiled ABI for the TypeScript side (`forge inspect … abi`)
deployments.json                       addresses, pool id, deploy block, txs (Base Sepolia live; mainnet not deployed)
lib/forge-std · lib/v4-periphery       git submodules (v4-core, OpenZeppelin 5.0.2, solmate, permit2 nested under v4-periphery)
```

## Build and test
```bash
export PATH=~/.foundry/bin:$PATH          # or: source script/env.sh (also exports the RPC key for the fork tests)
cd contracts/policy-pool
git submodule update --init --recursive   # first time, from a fresh clone
forge build
forge test --match-path test/PolicyPoolHook.t.sol -vv           # local, no network
source script/env.sh && forge test --match-path test/PolicyPoolHook.fork.t.sol -vv   # Base mainnet fork (read-only); skips without a key
forge test                                                       # both
```
Regenerate the ABI after a change: `forge inspect src/PolicyPoolHook.sol:PolicyPoolHook abi --json > abi/PolicyPoolHook.json`.
Regenerate the vectors (website root, SIGNER lane's script): `npx tsx scripts/policy-pool-attestation-vectors.ts`.

## The hook, in checks (beforeSwap, in this order)
`Paused` → decode `abi.encode(Attestation, bytes sig)` or `NotAttested` → `WrongPool` → `WrongSide` → exact-in only
(`ExactOutRefused`) → `-amountSpecified <= maxAmountIn` (`OverSize`) → `block.timestamp <= expiry` (`Expired`) →
`swapper == 0 || tx.origin == swapper` (`WrongSwapper`) → `!usedIntent[intentId]` (`IntentUsed`) → EIP-712 recover ==
`policySigner` (`BadSigner`) → mark the intent spent → `(selector, ZERO_DELTA, 0)`.
`afterSwap` decodes again and emits `DeskFill(intentId, keccak256(origin), swapper or tx.origin, poolId, zeroForOne, amount0, amount1, origin)`.
`beforeAddLiquidity`: `sender == owner`, or `IMsgSender(sender).msgSender() == owner` (the PositionManager path);
otherwise `OnlyOwnerLiquidity`. Removal is not hooked, so it is never gated — funds are never trapped behind the policy.
Admin (owner): `setPolicySigner`, `setPaused`, `transferOwnership`; events `PolicySignerSet`, `PausedSet`, `OwnershipTransferred`.
Views for the builder's guard: `hashAttestation`, `attestationDigest`, `domainSeparator`, `recoverAttestationSigner`, `decodeHookData`.

A hook revert reaches the caller wrapped by the PoolManager as ERC-7751
`WrappedError(hook, beforeSwap.selector, abi.encodeWithSelector(<error>), abi.encodeWithSelector(HookCallFailed))`.
The TypeScript decoder must unwrap that to name the refusal (the fork test's `_assertHookRevert` shows how).

## Deployed
**Base Sepolia (84532)**: hook `0x75d43357ef9ADe0F4EB53B219383C0CC2CcdC8C0`, pool id
`0x838bdae6a1597b8ef2062faa3f96f0af0fb461a5ce45b7ac81521cd830ffd39f` (ETH/USDC `0x036C…cF7e`, 500/10), deploy block
53526176, ~$12 of full-range depth. Policy signer = the desk signer `0xC1e953C24250FcFc2A332c641A2aD30e8bC740a0`
(rotated from the deployer burner in `0xeb40b18c…0e2d`, block 53529706). Two attested fills on chain: `0xcc6bdc22…f7d9`
(burner-signed bootstrap, origin `demo:sepolia-first-fill`) and `0x1b83f31c…b57d` (desk-signer-signed, 0.0002 ETH →
0.481197 USDC, origin `desk:signer-rotated`). Everything in `deployments.json`.
**Base mainnet: not deployed** (rule 4).

## Threat notes
- **A bearer attestation (`swapper = 0`) is a bearer instrument.** Anyone holding the bytes can spend it once, from any
  wallet, until `expiry`. It exists for smart-account custody, where `tx.origin` is a relayer. Keep it single use (it is —
  `usedIntent`), short-lived (the signer issues `now + 600`), sized to the order (`maxAmountIn`), and hand it only to the
  party that will sign the swap. Prefer a bound attestation whenever the swapper is an EOA.
- **The policy signer key is the same class of secret as the kill switch.** Whoever holds it can authorise any swap into
  the pool up to any size, on either side, to any origin string Dune will believe. Keep it out of the browser, out of the
  repo, rotate with `setPolicySigner`, and pause with `setPaused` on compromise. On Sepolia the signer was the deployer burner
  for the first hour and is now the desk key (`POLICY_SIGNER_ADDRESS`); a mainnet deployment gets its own key, never the burner.
- **The attestation is not a price.** It bounds the input, not the output; slippage is the swapper's `amountOutMinimum`
  on the router. The guard in front of the signature keeps doing that job.
- **`tx.origin` binding is weaker than `msg.sender` binding** and is deliberate: swaps reach the pool through routers,
  so the EOA is only visible as `tx.origin`. It stops a stolen bound attestation being used from another wallet; it does
  not stop the bound wallet being phished into sending the swap it was attested for.
- **The owner gate on liquidity reads `IMsgSender.msgSender()` from the calling router.** A malicious contract can claim
  any `msgSender()`, so this gate keeps strangers out of a well-behaved PositionManager path; it is not a security
  boundary against a hostile router — nor does it need to be: adding liquidity gives the pool more depth, never less.
- **Anyone can `initialize` other pools with this hook** (no beforeInitialize permission). Only the pinned pool id is
  attested, so a stranger's pool with this hook is inert: no attestation names it, the owner never seeds it.
- The hook holds no funds and has no `receive`; there is nothing to drain.
