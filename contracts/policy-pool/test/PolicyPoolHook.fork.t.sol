// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PolicyPoolHook} from "../src/PolicyPoolHook.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice Base MAINNET fork (read-only, nothing is broadcast): the hook deployed against the real PoolManager,
///         a fresh ETH/USDC policy pool seeded through the real PositionManager, and swaps routed through the real
///         Universal Router with hookData — the path the desk's builder uses. Skips when no RPC is configured.
/// @dev `BASE_RPC_URL`, else `https://base-mainnet.g.alchemy.com/v2/$ALCHEMY_API_KEY` (see script/env.sh).
contract PolicyPoolHookForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // Base (8453) pins — squad README "Chains and pins"; bytecode verified with eth_getCode 2026-11-02.
    IPoolManager constant MANAGER = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    IUniversalRouter constant ROUTER = IUniversalRouter(0x6fF5693b99212Da76ad316178A184AB56D299b43);
    IPositionManager constant POSM = IPositionManager(0x7C5f5A4bBd8fD63184577525326123B519429bDc);
    IAllowanceTransfer constant PERMIT2 = IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    uint160 constant FLAGS = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);
    uint8 constant CMD_V4_SWAP = 0x10;

    /// @dev The DEPLOYED Universal Router (Jan 2025) decodes the pre-March-2026 struct, without `minHopPriceX36`.
    struct ExactInputSingleParamsV1 {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    uint256 constant SIGNER_PK = 0xA11CE;
    address signer = vm.addr(SIGNER_PK);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    PolicyPoolHook hook;
    PoolKey poolKey;
    PoolId poolId;
    bool forked;

    /// @dev the PositionManager's SWEEP refunds spare ETH and TAKE_ALL pays ETH out to msg.sender
    receive() external payable {}

    function setUp() public {
        string memory url = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(url).length == 0) {
            string memory key = vm.envOr("ALCHEMY_API_KEY", string(""));
            if (bytes(key).length > 0) url = string.concat("https://base-mainnet.g.alchemy.com/v2/", key);
        }
        if (bytes(url).length == 0) return;
        try vm.createSelectFork(url) {
            forked = true;
        } catch {
            return;
        }
        require(block.chainid == 8453, "not Base");

        (address minedAddr, bytes32 salt) = HookMiner.find(
            address(this), FLAGS, type(PolicyPoolHook).creationCode, abi.encode(MANAGER, address(this), signer)
        );
        hook = new PolicyPoolHook{salt: salt}(MANAGER, address(this), signer);
        assertEq(address(hook), minedAddr);

        poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        // Open at the live price of Base's plain ETH/USDC 500/10 pool, so the fill numbers are real.
        PoolKey memory plain = poolKey;
        plain.hooks = IHooks(address(0));
        (uint160 sqrtPriceX96,,,) = MANAGER.getSlot0(plain.toId());
        if (sqrtPriceX96 == 0) sqrtPriceX96 = 3_980_000_000_000_000_000_000_000; // ≈ $2,520/ETH fallback
        MANAGER.initialize(poolKey, sqrtPriceX96);

        vm.deal(address(this), 100 ether);
        deal(USDC, address(this), 1_000_000e6);
        vm.deal(alice, 100 ether);
        deal(USDC, alice, 1_000_000e6);

        _seed(address(this), 10 ether, 30_000e6);
    }

    modifier onFork() {
        if (!forked) {
            vm.skip(true, "no BASE_RPC_URL / ALCHEMY_API_KEY: fork test skipped");
            return;
        }
        _;
    }

    // ───────────────────────────────────────────────────────────── helpers ──

    /// @dev Calldata + value for a full-range mint through the REAL PositionManager (sender = POSM,
    ///      msgSender() = the caller). Approvals are set here too.
    function _seedCall(address who, uint256 ethAmt, uint256 usdcAmt) internal returns (bytes memory data) {
        (uint160 sqrtPriceX96,,,) = MANAGER.getSlot0(poolId);
        int24 lower = TickMath.minUsableTick(10);
        int24 upper = TickMath.maxUsableTick(10);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), ethAmt, usdcAmt
        );
        bytes memory actions =
            abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(poolKey, lower, upper, liquidity, ethAmt, usdcAmt, who, bytes(""));
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        params[2] = abi.encode(poolKey.currency0, who);
        vm.startPrank(who);
        IERC20(USDC).approve(address(PERMIT2), type(uint256).max);
        PERMIT2.approve(USDC, address(POSM), type(uint160).max, type(uint48).max);
        vm.stopPrank();
        data = abi.encodeCall(IPositionManager.modifyLiquidities, (abi.encode(actions, params), block.timestamp + 60));
    }

    function _seed(address who, uint256 ethAmt, uint256 usdcAmt) internal {
        bytes memory data = _seedCall(who, ethAmt, usdcAmt);
        vm.prank(who);
        (bool ok, bytes memory ret) = address(POSM).call{value: ethAmt}(data);
        require(ok, string(ret));
    }

    function _att(string memory seed, bool zeroForOne, uint256 maxIn, address swapper, string memory origin)
        internal
        view
        returns (PolicyPoolHook.Attestation memory)
    {
        return PolicyPoolHook.Attestation({
            intentId: keccak256(bytes(seed)),
            poolId: PoolId.unwrap(poolId),
            swapper: swapper,
            zeroForOne: zeroForOne,
            maxAmountIn: maxIn,
            expiry: block.timestamp + 600,
            origin: origin
        });
    }

    function _hookData(PolicyPoolHook.Attestation memory att) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, hook.attestationDigest(att));
        return abi.encode(att, abi.encodePacked(r, s, v));
    }

    /// @dev V4_SWAP through the Universal Router: SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE_ALL.
    function _routerCalldata(bool zeroForOne, uint128 amountIn, bytes memory hookData)
        internal
        view
        returns (bytes memory)
    {
        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)
        );
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            ExactInputSingleParamsV1({
                poolKey: poolKey, zeroForOne: zeroForOne, amountIn: amountIn, amountOutMinimum: 0, hookData: hookData
            })
        );
        (Currency inC, Currency outC) =
            zeroForOne ? (poolKey.currency0, poolKey.currency1) : (poolKey.currency1, poolKey.currency0);
        params[1] = abi.encode(inC, uint256(amountIn));
        params[2] = abi.encode(outC, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        return abi.encodeCall(IUniversalRouter.execute, (abi.encodePacked(CMD_V4_SWAP), inputs, block.timestamp + 60));
    }

    /// @dev msg.sender = this (holds the funds), tx.origin = `origin`. Returns the raw revert data on failure.
    function _routerSwap(bool zeroForOne, uint128 amountIn, bytes memory hookData, address origin)
        internal
        returns (bool ok, bytes memory ret)
    {
        if (!zeroForOne) IERC20(USDC).approve(address(PERMIT2), type(uint256).max);
        if (!zeroForOne) PERMIT2.approve(USDC, address(ROUTER), type(uint160).max, type(uint48).max);
        vm.prank(address(this), origin);
        (ok, ret) =
            address(ROUTER).call{value: zeroForOne ? amountIn : 0}(_routerCalldata(zeroForOne, amountIn, hookData));
    }

    function _assertHookRevert(bytes memory ret, bytes4 err) internal view {
        _assertHookRevert(ret, IHooks.beforeSwap.selector, err);
    }

    function _assertHookRevert(bytes memory ret, bytes4 hookSelector, bytes4 err) internal view {
        // WrappedError(address target, bytes4 selector, bytes reason, bytes details)
        assertEq(bytes4(ret), CustomRevert.WrappedError.selector, "not an ERC-7751 wrapped hook revert");
        bytes memory body = new bytes(ret.length - 4);
        for (uint256 i; i < body.length; i++) {
            body[i] = ret[i + 4];
        }
        (address target, bytes4 sel, bytes memory reason,) = abi.decode(body, (address, bytes4, bytes, bytes));
        assertEq(target, address(hook), "reverting contract");
        assertEq(sel, hookSelector, "hook selector");
        assertEq(bytes4(reason), err, "hook error");
    }

    function _findDeskFill(Vm.Log[] memory logs) internal view returns (Vm.Log memory found, bool ok) {
        bytes32 sig = keccak256("DeskFill(bytes32,bytes32,address,bytes32,bool,int128,int128,string)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == sig) return (logs[i], true);
        }
    }

    // ─────────────────────────────────────────────────────────────── tests ──

    function testFork_setup_poolLiveAtRealPrice() public onFork {
        (uint160 sqrtPriceX96, int24 tick,,) = MANAGER.getSlot0(poolId);
        assertGt(sqrtPriceX96, 0);
        assertGt(MANAGER.getLiquidity(poolId), 0, "seeded through the real PositionManager");
        emit log_named_int("tick", tick);
    }

    function testFork_universalRouter_attestedFill_emitsDeskFill() public onFork {
        PolicyPoolHook.Attestation memory att = _att("fork-1", true, 0.01 ether, alice, "dune:9055910");
        uint256 usdcBefore = IERC20(USDC).balanceOf(address(this));
        vm.recordLogs();
        (bool ok, bytes memory ret) = _routerSwap(true, 0.01 ether, _hookData(att), alice);
        assertTrue(ok, string(ret));
        uint256 got = IERC20(USDC).balanceOf(address(this)) - usdcBefore;
        assertGt(got, 15e6, "0.01 ETH should buy more than $15 of USDC");
        emit log_named_decimal_uint("USDC out for 0.01 ETH", got, 6);

        (Vm.Log memory log, bool found) = _findDeskFill(vm.getRecordedLogs());
        assertTrue(found, "DeskFill");
        assertEq(log.topics[1], att.intentId);
        assertEq(log.topics[2], keccak256("dune:9055910"));
        assertEq(address(uint160(uint256(log.topics[3]))), alice);
        (, bool z41, int128 a0, int128 a1, string memory origin) =
            abi.decode(log.data, (bytes32, bool, int128, int128, string));
        assertTrue(z41);
        assertEq(a0, -int128(int256(0.01 ether)));
        assertEq(uint256(uint128(a1)), got);
        assertEq(origin, "dune:9055910");
        assertTrue(hook.usedIntent(att.intentId));
    }

    function testFork_universalRouter_usdcIn_bearer() public onFork {
        PolicyPoolHook.Attestation memory att = _att("fork-2", false, 25e6, address(0), "desk:buy-25-eth");
        uint256 ethBefore = address(this).balance;
        (bool ok, bytes memory ret) = _routerSwap(false, 25e6, _hookData(att), bob);
        assertTrue(ok, string(ret));
        assertGt(address(this).balance, ethBefore, "received ETH for $25");
    }

    function testFork_plainWallet_refused_NotAttested() public onFork {
        (bool ok, bytes memory ret) = _routerSwap(true, 0.01 ether, "", alice);
        assertFalse(ok);
        _assertHookRevert(ret, PolicyPoolHook.NotAttested.selector);
    }

    function testFork_forgedAttestation_refused_BadSigner() public onFork {
        PolicyPoolHook.Attestation memory att = _att("fork-3", true, 1 ether, alice, "demo:forged");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, hook.attestationDigest(att));
        (bool ok, bytes memory ret) = _routerSwap(true, 0.01 ether, abi.encode(att, abi.encodePacked(r, s, v)), alice);
        assertFalse(ok);
        _assertHookRevert(ret, PolicyPoolHook.BadSigner.selector);
    }

    function testFork_overCap_refused_OverSize() public onFork {
        PolicyPoolHook.Attestation memory att = _att("fork-4", true, 0.01 ether, alice, "desk:5000-vs-500-cap");
        (bool ok, bytes memory ret) = _routerSwap(true, 0.02 ether, _hookData(att), alice);
        assertFalse(ok);
        _assertHookRevert(ret, PolicyPoolHook.OverSize.selector);
    }

    function testFork_replay_refused_IntentUsed() public onFork {
        PolicyPoolHook.Attestation memory att = _att("fork-5", true, 0.01 ether, alice, "desk:replay");
        bytes memory data = _hookData(att);
        (bool ok,) = _routerSwap(true, 0.005 ether, data, alice);
        assertTrue(ok);
        (bool ok2, bytes memory ret) = _routerSwap(true, 0.005 ether, data, alice);
        assertFalse(ok2);
        _assertHookRevert(ret, PolicyPoolHook.IntentUsed.selector);
    }

    function testFork_wrongOrigin_refused_WrongSwapper() public onFork {
        PolicyPoolHook.Attestation memory att = _att("fork-6", true, 0.01 ether, alice, "desk:origin");
        (bool ok, bytes memory ret) = _routerSwap(true, 0.01 ether, _hookData(att), bob);
        assertFalse(ok);
        _assertHookRevert(ret, PolicyPoolHook.WrongSwapper.selector);
    }

    function testFork_positionManager_nonOwner_refused() public onFork {
        bytes memory data = _seedCall(alice, 1 ether, 3_000e6);
        vm.prank(alice);
        (bool ok, bytes memory ret) = address(POSM).call{value: 1 ether}(data);
        assertFalse(ok, "a stranger seeded the policy pool");
        _assertHookRevert(ret, IHooks.beforeAddLiquidity.selector, PolicyPoolHook.OnlyOwnerLiquidity.selector);
    }

    function testFork_positionManager_owner_canAddMore() public onFork {
        uint128 before = MANAGER.getLiquidity(poolId);
        _seed(address(this), 1 ether, 3_000e6);
        assertGt(MANAGER.getLiquidity(poolId), before);
    }
}
