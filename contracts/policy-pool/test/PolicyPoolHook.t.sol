// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {PolicyPoolHook} from "../src/PolicyPoolHook.sol";
import {OwnerLiquidityRouter} from "./utils/OwnerLiquidityRouter.sol";

/// @notice Local tests: a fresh PoolManager, an ETH/USDC-shaped pool (fee 500, tickSpacing 10), the hook mined
///         for BEFORE_SWAP | AFTER_SWAP | BEFORE_ADD_LIQUIDITY, liquidity added as the owner, every refusal, the
///         bearer path, replay, the kill switch, the owner-only liquidity gate, and the TypeScript vector.
contract PolicyPoolHookTest is Test, Deployers, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencySettler for Currency;

    uint160 constant FLAGS = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);

    uint256 constant SIGNER_PK = 0xA11CE;
    uint256 constant OTHER_PK = 0xB0B;
    address signer = vm.addr(SIGNER_PK);
    address alice = makeAddr("alice"); // a swapper's EOA (tx.origin)
    address bob = makeAddr("bob");
    address owner = address(this);

    PolicyPoolHook hook;
    MockERC20 usdc;
    PoolKey poolKey;
    PoolId poolId;
    OwnerLiquidityRouter ownerRouter;

    ModifyLiquidityParams SEED =
        ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 1_000e18, salt: 0});

    function setUp() public {
        deployFreshManagerAndRouters();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdc.mint(address(this), 1e30);
        usdc.mint(alice, 1e30);
        ownerRouter = new OwnerLiquidityRouter(manager);
        usdc.approve(address(swapRouter), type(uint256).max);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        usdc.approve(address(ownerRouter), type(uint256).max);
        vm.deal(address(this), 1_000 ether);
        vm.deal(alice, 1_000 ether);

        (address minedAddr, bytes32 salt) =
            HookMiner.find(address(this), FLAGS, type(PolicyPoolHook).creationCode, abi.encode(manager, owner, signer));
        hook = new PolicyPoolHook{salt: salt}(manager, owner, signer);
        assertEq(address(hook), minedAddr, "hook landed off the mined address");
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, FLAGS, "flag bits");

        (poolKey, poolId) =
            initPool(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(usdc)), hook, 500, 10, SQRT_PRICE_1_1);

        // The owner seeds the pool: directly (sender == owner, via this contract's unlock callback) ...
        _ownerModifyLiquidity(SEED);
        // ... and through an IMsgSender router (the PositionManager shape).
        ownerRouter.modifyLiquidity{value: 50 ether}(poolKey, SEED);
        vm.warp(1_700_000_000);
    }

    // ───────────────────────────────────────────────────────────── helpers ──

    function _att(
        string memory seed,
        bool zeroForOne,
        uint256 maxIn,
        uint256 expiry,
        address swapper,
        string memory origin
    ) internal view returns (PolicyPoolHook.Attestation memory) {
        return PolicyPoolHook.Attestation({
            intentId: keccak256(bytes(seed)),
            poolId: PoolId.unwrap(poolId),
            swapper: swapper,
            zeroForOne: zeroForOne,
            maxAmountIn: maxIn,
            expiry: expiry,
            origin: origin
        });
    }

    function _attFor(address swapper) internal view returns (PolicyPoolHook.Attestation memory) {
        return _att("intent-1", true, 1e15, block.timestamp + 600, swapper, "desk:intent-1");
    }

    function _sign(uint256 pk, PolicyPoolHook.Attestation memory att) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hook.attestationDigest(att));
        return abi.encodePacked(r, s, v);
    }

    function _hookData(PolicyPoolHook.Attestation memory att) internal view returns (bytes memory) {
        return abi.encode(att, _sign(SIGNER_PK, att));
    }

    /// @dev Swap through the v4 test router with msg.sender = this (holds the funds) and tx.origin = `origin`.
    function _swap(bool zeroForOne, int256 amountSpecified, bytes memory hookData, address origin)
        internal
        returns (BalanceDelta)
    {
        uint256 value = (zeroForOne && amountSpecified < 0) ? uint256(-amountSpecified) : 0;
        vm.prank(address(this), origin);
        return swapRouter.swap{value: value}(
            poolKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    /// @dev The PoolManager wraps a hook's revert in ERC-7751 `WrappedError(hook, hookSelector, reason, HookCallFailed)`.
    function _expectHookRevert(bytes4 hookSelector, bytes4 err) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                hookSelector,
                abi.encodeWithSelector(err),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function _expectSwapRevert(bytes4 err) internal {
        _expectHookRevert(IHooks.beforeSwap.selector, err);
    }

    // direct liquidity path: this contract (the owner) is the unlock caller, so `sender == owner`.
    function _ownerModifyLiquidity(ModifyLiquidityParams memory params) internal returns (BalanceDelta delta) {
        delta = abi.decode(manager.unlock(abi.encode(params)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(manager), "not manager");
        ModifyLiquidityParams memory params = abi.decode(raw, (ModifyLiquidityParams));
        (BalanceDelta delta,) = manager.modifyLiquidity(poolKey, params, "");
        if (delta.amount0() < 0) {
            poolKey.currency0.settle(manager, address(this), uint256(uint128(-delta.amount0())), false);
        }
        if (delta.amount1() < 0) {
            poolKey.currency1.settle(manager, address(this), uint256(uint128(-delta.amount1())), false);
        }
        if (delta.amount0() > 0) {
            poolKey.currency0.take(manager, address(this), uint256(uint128(delta.amount0())), false);
        }
        if (delta.amount1() > 0) {
            poolKey.currency1.take(manager, address(this), uint256(uint128(delta.amount1())), false);
        }
        return abi.encode(delta);
    }

    function _findDeskFill(Vm.Log[] memory logs) internal view returns (Vm.Log memory found, bool ok) {
        bytes32 sig = keccak256("DeskFill(bytes32,bytes32,address,bytes32,bool,int128,int128,string)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == sig) return (logs[i], true);
        }
    }

    // ──────────────────────────────────────────────────────── permissions ──

    function test_permissions_exactlyThree() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.beforeSwap && p.afterSwap && p.beforeAddLiquidity);
        assertFalse(
            p.beforeInitialize || p.afterInitialize || p.afterAddLiquidity || p.beforeRemoveLiquidity
                || p.afterRemoveLiquidity || p.beforeDonate || p.afterDonate || p.beforeSwapReturnDelta
                || p.afterSwapReturnDelta || p.afterAddLiquidityReturnDelta || p.afterRemoveLiquidityReturnDelta
        );
        assertEq(hook.owner(), owner);
        assertEq(hook.policySigner(), signer);
        assertFalse(hook.paused());
    }

    function test_typehash_matchesSpec() public view {
        assertEq(
            hook.ATTESTATION_TYPEHASH(),
            keccak256(
                "Attestation(bytes32 intentId,bytes32 poolId,address swapper,bool zeroForOne,uint256 maxAmountIn,uint256 expiry,string origin)"
            )
        );
    }

    // ───────────────────────────────────────────────────────────── fills ──

    function test_fill_emitsDeskFill() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        vm.recordLogs();
        BalanceDelta delta = _swap(true, -1e15, _hookData(att), alice);

        assertEq(delta.amount0(), -1e15, "paid exactly the input");
        assertGt(delta.amount1(), 0, "received USDC");
        assertTrue(hook.usedIntent(att.intentId), "intent spent");

        (Vm.Log memory log, bool ok) = _findDeskFill(vm.getRecordedLogs());
        assertTrue(ok, "DeskFill emitted");
        assertEq(log.topics[1], att.intentId);
        assertEq(log.topics[2], keccak256(bytes(att.origin)));
        assertEq(address(uint160(uint256(log.topics[3]))), alice);
        (bytes32 pid, bool z41, int128 a0, int128 a1, string memory origin) =
            abi.decode(log.data, (bytes32, bool, int128, int128, string));
        assertEq(pid, PoolId.unwrap(poolId));
        assertTrue(z41);
        assertEq(a0, delta.amount0());
        assertEq(a1, delta.amount1());
        assertEq(origin, "desk:intent-1");
    }

    function test_fill_oneForZero_usdcIn() public {
        PolicyPoolHook.Attestation memory att =
            _att("intent-u", false, 5_000_000, block.timestamp + 600, alice, "dune:9055910");
        BalanceDelta delta = _swap(false, -5_000_000, _hookData(att), alice);
        assertEq(delta.amount1(), -5_000_000);
        assertGt(delta.amount0(), 0);
    }

    function test_fill_underMax_isFine() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        _swap(true, -1e14, _hookData(att), alice); // a tenth of the cap
    }

    function test_fill_bearer_anyOrigin() public {
        PolicyPoolHook.Attestation memory att = _attFor(address(0));
        vm.recordLogs();
        _swap(true, -1e15, _hookData(att), bob);
        (Vm.Log memory log, bool ok) = _findDeskFill(vm.getRecordedLogs());
        assertTrue(ok);
        assertEq(address(uint160(uint256(log.topics[3]))), bob, "bearer fill names tx.origin");
    }

    function test_fill_doesNotChangeEconomics() public {
        // Same swap on the same pool state through the hook and through a plain pool: identical output.
        (PoolKey memory plainKey,) = initPool(
            CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(usdc)), IHooks(address(0)), 500, 10, SQRT_PRICE_1_1
        );
        modifyLiquidityRouter.modifyLiquidity{value: 50 ether}(plainKey, SEED, "");
        modifyLiquidityRouter.modifyLiquidity{value: 50 ether}(plainKey, SEED, "");
        BalanceDelta plain = swapRouter.swap{value: 1e15}(
            plainKey,
            SwapParams({zeroForOne: true, amountSpecified: -1e15, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        BalanceDelta hooked = _swap(true, -1e15, _hookData(_attFor(alice)), alice);
        assertEq(hooked.amount0(), plain.amount0());
        assertEq(hooked.amount1(), plain.amount1());
    }

    // ─────────────────────────────────────────────────────────── refusals ──

    function test_refuse_emptyHookData() public {
        _expectSwapRevert(PolicyPoolHook.NotAttested.selector);
        _swap(true, -1e15, "", alice);
    }

    function test_refuse_garbageHookData() public {
        _expectSwapRevert(PolicyPoolHook.NotAttested.selector);
        _swap(true, -1e15, hex"deadbeef", alice);
    }

    function test_refuse_truncatedHookData() public {
        bytes memory good = _hookData(_attFor(alice));
        bytes memory cut = new bytes(good.length - 40);
        for (uint256 i; i < cut.length; i++) {
            cut[i] = good[i];
        }
        _expectSwapRevert(PolicyPoolHook.NotAttested.selector);
        _swap(true, -1e15, cut, alice);
    }

    function test_refuse_wrongPool() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        att.poolId = bytes32(uint256(1));
        bytes memory data = _hookData(att);
        _expectSwapRevert(PolicyPoolHook.WrongPool.selector);
        _swap(true, -1e15, data, alice);
    }

    function test_refuse_wrongSide() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        att.zeroForOne = false;
        bytes memory data = _hookData(att);
        _expectSwapRevert(PolicyPoolHook.WrongSide.selector);
        _swap(true, -1e15, data, alice);
    }

    function test_refuse_exactOut() public {
        PolicyPoolHook.Attestation memory att = _att("x", false, 1e30, block.timestamp + 600, alice, "demo:exact-out");
        bytes memory data = _hookData(att);
        _expectSwapRevert(PolicyPoolHook.ExactOutRefused.selector);
        _swap(false, 1e12, data, alice);
    }

    function test_refuse_overSize() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        bytes memory data = _hookData(att);
        _expectSwapRevert(PolicyPoolHook.OverSize.selector);
        _swap(true, -(1e15 + 1), data, alice);
    }

    function test_refuse_expired() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        att.expiry = block.timestamp - 1;
        bytes memory data = _hookData(att);
        _expectSwapRevert(PolicyPoolHook.Expired.selector);
        _swap(true, -1e15, data, alice);
    }

    function test_expiry_isInclusive() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        att.expiry = block.timestamp;
        _swap(true, -1e15, _hookData(att), alice);
    }

    function test_refuse_wrongSwapper() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        bytes memory data = _hookData(att);
        _expectSwapRevert(PolicyPoolHook.WrongSwapper.selector);
        _swap(true, -1e15, data, bob);
    }

    function test_refuse_replay() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        bytes memory data = _hookData(att);
        _swap(true, -1e14, data, alice);
        _expectSwapRevert(PolicyPoolHook.IntentUsed.selector);
        _swap(true, -1e14, data, alice);
    }

    function test_refuse_wrongSigner() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        bytes memory data = abi.encode(att, _sign(OTHER_PK, att));
        _expectSwapRevert(PolicyPoolHook.BadSigner.selector);
        _swap(true, -1e15, data, alice);
    }

    function test_refuse_tamperedField() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        bytes memory sig = _sign(SIGNER_PK, att);
        att.maxAmountIn = 1e30; // forged after signing
        _expectSwapRevert(PolicyPoolHook.BadSigner.selector);
        _swap(true, -1e15, abi.encode(att, sig), alice);
    }

    function test_refuse_malleableSignature() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, hook.attestationDigest(att));
        // flip to the upper-half s and the other v: still a valid ECDSA signature, rejected by design
        bytes32 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 s2 = bytes32(uint256(n) - uint256(s));
        uint8 v2 = v == 27 ? 28 : 27;
        _expectSwapRevert(PolicyPoolHook.BadSigner.selector);
        _swap(true, -1e15, abi.encode(att, abi.encodePacked(r, s2, v2)), alice);
    }

    function test_refuse_shortSignature() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        _expectSwapRevert(PolicyPoolHook.BadSigner.selector);
        _swap(true, -1e15, abi.encode(att, hex"1234"), alice);
    }

    function test_refuse_paused_thenResumes() public {
        hook.setPaused(true);
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        bytes memory data = _hookData(att);
        _expectSwapRevert(PolicyPoolHook.Paused.selector);
        _swap(true, -1e15, data, alice);
        hook.setPaused(false);
        _swap(true, -1e15, data, alice);
    }

    function test_refuse_rotatedSigner_oldAttestations() public {
        PolicyPoolHook.Attestation memory att = _attFor(alice);
        bytes memory data = _hookData(att);
        hook.setPolicySigner(vm.addr(OTHER_PK));
        _expectSwapRevert(PolicyPoolHook.BadSigner.selector);
        _swap(true, -1e15, data, alice);
        _swap(true, -1e15, abi.encode(att, _sign(OTHER_PK, att)), alice);
    }

    // ────────────────────────────────────────────────────────── liquidity ──

    function test_liquidity_nonOwnerRouter_refused() public {
        // PoolModifyLiquidityTest does not expose msgSender(): refused even when the owner calls it.
        _expectHookRevert(IHooks.beforeAddLiquidity.selector, PolicyPoolHook.OnlyOwnerLiquidity.selector);
        modifyLiquidityRouter.modifyLiquidity{value: 50 ether}(poolKey, SEED, "");
    }

    function test_liquidity_nonOwner_viaMsgSenderRouter_refused() public {
        vm.startPrank(alice);
        usdc.approve(address(ownerRouter), type(uint256).max);
        _expectHookRevert(IHooks.beforeAddLiquidity.selector, PolicyPoolHook.OnlyOwnerLiquidity.selector);
        ownerRouter.modifyLiquidity{value: 50 ether}(poolKey, SEED);
        vm.stopPrank();
    }

    function test_liquidity_owner_canAddMore() public {
        ownerRouter.modifyLiquidity{value: 50 ether}(poolKey, SEED);
        _ownerModifyLiquidity(SEED);
    }

    function test_liquidity_removal_neverGated() public {
        // Seeded by this address in setUp. Hand ownership away and pause: the old owner still gets its money out.
        hook.transferOwnership(alice);
        vm.prank(alice);
        hook.setPaused(true);

        ModifyLiquidityParams memory unseed = SEED;
        unseed.liquidityDelta = -SEED.liquidityDelta;
        BalanceDelta viaRouter = ownerRouter.modifyLiquidity(poolKey, unseed);
        BalanceDelta direct = _ownerModifyLiquidity(unseed);
        assertGt(viaRouter.amount0(), 0);
        assertGt(viaRouter.amount1(), 0);
        assertGt(direct.amount0(), 0);
        assertGt(direct.amount1(), 0);
    }

    // ─────────────────────────────────────────────────────────────── admin ──

    function test_admin_ownerOnly() public {
        vm.startPrank(alice);
        vm.expectRevert(PolicyPoolHook.NotOwner.selector);
        hook.setPolicySigner(alice);
        vm.expectRevert(PolicyPoolHook.NotOwner.selector);
        hook.setPaused(true);
        vm.expectRevert(PolicyPoolHook.NotOwner.selector);
        hook.transferOwnership(alice);
        vm.stopPrank();
    }

    function test_admin_eventsAndState() public {
        vm.expectEmit(true, false, false, true, address(hook));
        emit PolicyPoolHook.PolicySignerSet(bob);
        hook.setPolicySigner(bob);
        assertEq(hook.policySigner(), bob);

        vm.expectEmit(false, false, false, true, address(hook));
        emit PolicyPoolHook.PausedSet(true);
        hook.setPaused(true);
        assertTrue(hook.paused());

        vm.expectEmit(true, true, false, false, address(hook));
        emit PolicyPoolHook.OwnershipTransferred(owner, alice);
        hook.transferOwnership(alice);
        assertEq(hook.owner(), alice);
        vm.expectRevert(PolicyPoolHook.NotOwner.selector);
        hook.setPaused(false);
    }

    // ───────────────────────────────────────── cross-implementation vector ──

    /// @dev test/vectors/attestation.json is written by the TypeScript side (lib/policy-pool/spec.ts); the
    ///      hook's bytecode is etched at the vector's address on the vector's chain id and must reproduce the
    ///      struct hash, domain separator, digest and signer, and decode the vector's hookData.
    function test_vector_matchesTypeScript() public {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/attestation.json"));
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        address vHook = vm.parseJsonAddress(json, ".hook");
        address vSigner = vm.parseJsonAddress(json, ".signer");
        PolicyPoolHook.Attestation memory att = PolicyPoolHook.Attestation({
            intentId: vm.parseJsonBytes32(json, ".attestation.intentId"),
            poolId: vm.parseJsonBytes32(json, ".attestation.poolId"),
            swapper: vm.parseJsonAddress(json, ".attestation.swapper"),
            zeroForOne: vm.parseJsonBool(json, ".attestation.zeroForOne"),
            maxAmountIn: vm.parseJsonUint(json, ".attestation.maxAmountIn"),
            expiry: vm.parseJsonUint(json, ".attestation.expiry"),
            origin: vm.parseJsonString(json, ".attestation.origin")
        });
        bytes memory sig = vm.parseJsonBytes(json, ".signature");
        bytes memory hookData = vm.parseJsonBytes(json, ".hookData");

        vm.chainId(chainId);
        vm.etch(vHook, address(hook).code);
        PolicyPoolHook v = PolicyPoolHook(vHook);

        assertEq(v.ATTESTATION_TYPEHASH(), vm.parseJsonBytes32(json, ".typeHash"), "typeHash");
        assertEq(v.hashAttestation(att), vm.parseJsonBytes32(json, ".structHash"), "structHash");
        assertEq(v.domainSeparator(), vm.parseJsonBytes32(json, ".domainSeparator"), "domainSeparator");
        assertEq(v.attestationDigest(att), vm.parseJsonBytes32(json, ".digest"), "digest");
        assertEq(v.recoverAttestationSigner(att, sig), vSigner, "signer");

        (PolicyPoolHook.Attestation memory dAtt, bytes memory dSig) = v.decodeHookData(hookData);
        assertEq(keccak256(abi.encode(dAtt)), keccak256(abi.encode(att)), "hookData attestation");
        assertEq(keccak256(dSig), keccak256(sig), "hookData signature");
        assertEq(keccak256(hookData), keccak256(abi.encode(att, sig)), "hookData = abi.encode(att, sig)");
    }
}
