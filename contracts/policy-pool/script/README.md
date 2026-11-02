# Deploying the policy pool

All commands run from `contracts/policy-pool/`. Foundry lives in `~/.foundry/bin` (not on PATH by default);
`source script/env.sh` puts it on PATH and exports only the keys this project needs from `website/.env.local`
(`ALCHEMY_API_KEY` → `BASE_RPC_URL`, `PRIVATE_KEY`, and `POLICY_SIGNER_*` / `POLICY_POOL_HOOK` when present) without
printing them.

```bash
source script/env.sh
export POLICY_SIGNER_ADDRESS=0x…        # the desk's policy signer (SIGNER lane); for the Sepolia demo it was the deployer
```

## What `Deploy.s.sol` does (5 transactions with seeding, 2 without)
1. Mines a CREATE2 salt with `HookMiner` for `BEFORE_SWAP | AFTER_SWAP | BEFORE_ADD_LIQUIDITY` (`0x…08c0` bits) against the
   canonical deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C` (forge's default for `new X{salt}` in a broadcast).
2. Deploys `PolicyPoolHook(poolManager, owner, policySigner)` — owner = deployer unless `OWNER` is set.
3. `PoolManager.initialize(key, sqrtPrice)` for `ETH / USDC · fee 500 · tickSpacing 10 · hooks = the hook` at `ETH_USD`
   dollars per ETH (default 3800; pass today's number — read it from Base's plain pool, see below).
4. With `SEED_LIQUIDITY=true`: approves USDC → Permit2, Permit2 → PositionManager, then mints one full-range position
   through the PositionManager (`SEED_ETH_WEI`, `SEED_USDC_ATOMS` are the maxima; spare ETH is swept back).
   The hook sees `sender = PositionManager` and reads `msgSender()` = the owner, which is the only way a periphery
   router can be owner-gated — so the deployer must be the owner for the seed step.

Base mainnet (8453) is refused unless `ALLOW_BASE_MAINNET=true`. Standing rule 4: never without Nate's explicit yes.

## Today's ETH price from Base's own v4 pool (for `ETH_USD`)
```bash
PID=$(cast keccak $(cast abi-encode "f(address,address,uint24,int24,address)" 0x0000000000000000000000000000000000000000 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 500 10 0x0000000000000000000000000000000000000000))
cast call 0xa3c0c9b65bad0b08107aa264b0f3db444b867a71 "getSlot0(bytes32)(uint160,int24,uint24,uint24)" $PID --rpc-url "$BASE_RPC_URL"
# ETH/USD = (sqrtPriceX96 / 2^96)^2 * 1e12
```

## Base Sepolia (84532) — done 2026-11-02, see ../deployments.json
```bash
# dry run (prints the mined address, pool id and the gas estimate; nothing is sent)
ETH_USD=2294 SEED_LIQUIDITY=true SEED_ETH_WEI=2500000000000000 SEED_USDC_ATOMS=6000000 \
  forge script script/Deploy.s.sol:Deploy --rpc-url https://sepolia.base.org

# broadcast
ETH_USD=2294 SEED_LIQUIDITY=true SEED_ETH_WEI=2500000000000000 SEED_USDC_ATOMS=6000000 \
  forge script script/Deploy.s.sol:Deploy --rpc-url https://sepolia.base.org --broadcast
```
Measured on the dry run: **3,982,710 gas for all five transactions ≈ 0.00004 ETH** at Base Sepolia's 0.01 gwei
(hook deploy 2,321,280 · initialize 51,853 · USDC approve 55,725 · Permit2 approve 47,590 · mint 406,965).
Result: hook `0x75d43357ef9ADe0F4EB53B219383C0CC2CcdC8C0`, pool `0x838bdae6…d39f`, block 53526176.

Then check it:
```bash
cast code 0x75d43357ef9ADe0F4EB53B219383C0CC2CcdC8C0 --rpc-url https://sepolia.base.org | wc -c      # 20389
cast call 0x75d43357ef9ADe0F4EB53B219383C0CC2CcdC8C0 "policySigner()(address)" --rpc-url https://sepolia.base.org
cast call 0x571291b572ed32ce6751a2cb2486ebee8defb9b4 "getLiquidity(bytes32)(uint128)" 0x838bdae6a1597b8ef2062faa3f96f0af0fb461a5ce45b7ac81521cd830ffd39f --rpc-url https://sepolia.base.org
```

## Base mainnet (8453) — NOT RUN. Owner step, after Nate's yes.
Same commands with `--rpc-url "$BASE_RPC_URL" ALLOW_BASE_MAINNET=true`. Gas is the same 3.98M; at Base's ~0.01–0.05 gwei
that is ~0.00004–0.0002 ETH plus whatever liquidity is seeded. Pass the real `POLICY_SIGNER_ADDRESS` (never the burner on
mainnet) and today's `ETH_USD`. Record the result in `../deployments.json` under `"8453"`.

## One attested swap / one plain refusal (`AttestedSwap.s.sol`)
```bash
export POLICY_POOL_HOOK=0x75d43357ef9ADe0F4EB53B219383C0CC2CcdC8C0
export POLICY_SIGNER_PRIVATE_KEY=0x…   # the key behind the pool's policySigner()

# scene 2 — a plain wallet: reverts in simulation with WrappedError(hook, beforeSwap, NotAttested, HookCallFailed); nothing is sent
PLAIN=true AMOUNT_IN=300000000000000 forge script script/AttestedSwap.s.sol:AttestedSwap --rpc-url https://sepolia.base.org --broadcast

# scene 3 — attested 0.0003 ETH → USDC, origin "demo:sepolia-first-fill", bound to the swapper's tx.origin
INTENT=demo-sepolia-0001 ORIGIN=demo:sepolia-first-fill AMOUNT_IN=300000000000000 \
  forge script script/AttestedSwap.s.sol:AttestedSwap --rpc-url https://sepolia.base.org --broadcast
# USDC → ETH instead: ZERO_FOR_ONE=false AMOUNT_IN=1000000 (1 USDC); bearer attestation: BEARER=true
```
The Universal Router's `SWAP_EXACT_IN_SINGLE` is encoded with the **pre-March-2026** params struct (no
`minHopPriceX36`): that is what the deployed routers (Jan 2025) decode. Keep that in mind in the TypeScript builder too.

## Rotating the policy signer / pausing (owner only)
```bash
cast send 0x75d43357ef9ADe0F4EB53B219383C0CC2CcdC8C0 "setPolicySigner(address)" 0x… --private-key "$PRIVATE_KEY" --rpc-url https://sepolia.base.org
cast send 0x75d43357ef9ADe0F4EB53B219383C0CC2CcdC8C0 "setPaused(bool)" true      --private-key "$PRIVATE_KEY" --rpc-url https://sepolia.base.org
```

## Source verification
Sourcify needs no key: `forge verify-contract <hook> src/PolicyPoolHook.sol:PolicyPoolHook --chain 84532 --verifier sourcify --constructor-args $(cast abi-encode "c(address,address,address)" <poolManager> <owner> <signer>)`.
Basescan wants an Etherscan API key (`--verifier etherscan --etherscan-api-key …`).
