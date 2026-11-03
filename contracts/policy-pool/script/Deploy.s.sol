// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";
import {PolicyPoolHook} from "../src/PolicyPoolHook.sol";

/// @notice Deploys PolicyPoolHook through the canonical CREATE2 deployer at a mined address, sets the policy
///         signer, initializes the ETH/USDC policy pool (fee 500, tickSpacing 10) and, with SEED_LIQUIDITY=true,
///         mints a small full-range position through the PositionManager.
/// @dev Env: PRIVATE_KEY (deployer = owner unless OWNER is set), POLICY_SIGNER_ADDRESS, ETH_USD (whole dollars,
///      default 3800), SEED_LIQUIDITY (bool), SEED_ETH_WEI, SEED_USDC_ATOMS. Base mainnet (8453) is refused
///      unless ALLOW_BASE_MAINNET=true — standing rule 4: real money needs Nate's explicit yes.
contract Deploy is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 constant FLAGS = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);

    struct Pins {
        IPoolManager manager;
        IPositionManager posm;
        address usdc;
        string name;
    }

    function pins() public view returns (Pins memory) {
        if (block.chainid == 84532) {
            return Pins({
                manager: IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408),
                posm: IPositionManager(0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80),
                usdc: 0x036CbD53842c5426634e7929541eC2318f3dCF7e,
                name: "base-sepolia"
            });
        }
        if (block.chainid == 8453) {
            require(
                vm.envOr("ALLOW_BASE_MAINNET", false),
                "Base MAINNET: set ALLOW_BASE_MAINNET=true only with Nate's explicit yes (rule 4)"
            );
            return Pins({
                manager: IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b),
                posm: IPositionManager(0x7C5f5A4bBd8fD63184577525326123B519429bDc),
                usdc: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,
                name: "base"
            });
        }
        revert("unsupported chain: Base Sepolia (84532) or Base (8453)");
    }

    /// @notice sqrtPriceX96 for `ethUsd` dollars per ETH with currency0 = ETH (18 dec) and currency1 = USDC (6 dec):
    ///         price = ethUsd * 1e6 / 1e18 raw units → sqrt(price) * 2^96.
    function sqrtPriceForEthUsd(uint256 ethUsd) public pure returns (uint160) {
        // sqrt(ethUsd * 2^192 / 1e12): ethUsd * 2^192 fits (2^192 * 1e6 < 2^212)
        uint256 ratioX192 = (ethUsd << 192) / 1e12;
        return uint160(FixedPointMathLib.sqrt(ratioX192));
    }

    function run() external {
        Pins memory p = pins();
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("OWNER", deployer);
        address policySigner = vm.envAddress("POLICY_SIGNER_ADDRESS");
        uint256 ethUsd = vm.envOr("ETH_USD", uint256(3800));
        bool seed = vm.envOr("SEED_LIQUIDITY", false);

        console2.log("chain        ", p.name, block.chainid);
        console2.log("deployer     ", deployer);
        console2.log("owner        ", owner);
        console2.log("policy signer", policySigner);

        bytes memory ctorArgs = abi.encode(p.manager, owner, policySigner);
        (address predicted, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, FLAGS, type(PolicyPoolHook).creationCode, ctorArgs);
        console2.log("mined hook   ", predicted);
        console2.logBytes32(salt);

        vm.startBroadcast(pk);
        PolicyPoolHook hook = new PolicyPoolHook{salt: salt}(p.manager, owner, policySigner);
        require(address(hook) == predicted, "CREATE2 address mismatch (is the deployer the canonical CREATE2 proxy?)");
        require(hook.policySigner() == policySigner && hook.owner() == owner, "constructor state");

        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(p.usdc),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(hook))
        });
        uint160 sqrtPriceX96 = sqrtPriceForEthUsd(ethUsd);
        p.manager.initialize(key, sqrtPriceX96);
        console2.log("pool initialized at ETH/USD", ethUsd);
        console2.log("sqrtPriceX96", sqrtPriceX96);
        console2.log("poolId");
        console2.logBytes32(PoolId.unwrap(key.toId()));

        if (seed) {
            require(
                owner == deployer,
                "SEED_LIQUIDITY needs the deployer to be the owner (the hook gates adds to the owner)"
            );
            uint256 ethAmt = vm.envOr("SEED_ETH_WEI", uint256(0.002 ether));
            uint256 usdcAmt = vm.envOr("SEED_USDC_ATOMS", uint256(5_000_000));
            _seed(p, key, deployer, sqrtPriceX96, ethAmt, usdcAmt);
        }
        vm.stopBroadcast();

        console2.log("hook         ", address(hook));
        console2.log("deploy block ", block.number);
    }

    function _seed(
        Pins memory p,
        PoolKey memory key,
        address who,
        uint160 sqrtPriceX96,
        uint256 ethAmt,
        uint256 usdcAmt
    ) internal {
        int24 lower = TickMath.minUsableTick(10);
        int24 upper = TickMath.maxUsableTick(10);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), ethAmt, usdcAmt
        );
        require(liquidity > 0, "seed amounts too small");
        if (IERC20(p.usdc).allowance(who, PERMIT2) < usdcAmt) IERC20(p.usdc).approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2)
            .approve(p.usdc, address(p.posm), uint160(usdcAmt), uint48(block.timestamp + 1 hours));

        bytes memory actions =
            abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(key, lower, upper, liquidity, ethAmt, usdcAmt, who, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        params[2] = abi.encode(key.currency0, who);
        p.posm.modifyLiquidities{value: ethAmt}(abi.encode(actions, params), block.timestamp + 30 minutes);
        console2.log("seeded liquidity", uint256(liquidity));
        console2.log("  ETH wei (max) ", ethAmt);
        console2.log("  USDC atoms(max)", usdcAmt);
    }
}
