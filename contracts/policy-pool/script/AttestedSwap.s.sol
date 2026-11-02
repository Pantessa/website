// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PolicyPoolHook} from "../src/PolicyPoolHook.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice One real attested swap through the Universal Router — the demo's scene 3 on a testnet.
/// @dev Env: PRIVATE_KEY (the swapper; its address is tx.origin), POLICY_SIGNER_PRIVATE_KEY (signs the attestation),
///      POLICY_POOL_HOOK, ZERO_FOR_ONE (default true = ETH→USDC), AMOUNT_IN (atoms of the input, default 0.0003 ETH),
///      ORIGIN (default "demo:sepolia-swap"), INTENT (default "demo-<timestamp>"), BEARER (default false).
///      With PLAIN=true the swap carries NO hookData — scene 2, expected to revert NotAttested.
contract AttestedSwap is Script {
    using PoolIdLibrary for PoolKey;

    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint8 constant CMD_V4_SWAP = 0x10;

    /// @dev the DEPLOYED routers decode the pre-March-2026 struct (no minHopPriceX36)
    struct ExactInputSingleParamsV1 {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function router() public view returns (IUniversalRouter) {
        if (block.chainid == 84532) return IUniversalRouter(0x492E6456D9528771018DeB9E87ef7750EF184104);
        if (block.chainid == 8453) {
            require(vm.envOr("ALLOW_BASE_MAINNET", false), "Base MAINNET needs ALLOW_BASE_MAINNET=true (rule 4)");
            return IUniversalRouter(0x6fF5693b99212Da76ad316178A184AB56D299b43);
        }
        revert("unsupported chain");
    }

    function usdc() public view returns (address) {
        return block.chainid == 84532
            ? 0x036CbD53842c5426634e7929541eC2318f3dCF7e
            : 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address swapper = vm.addr(pk);
        PolicyPoolHook hook = PolicyPoolHook(vm.envAddress("POLICY_POOL_HOOK"));
        bool zeroForOne = vm.envOr("ZERO_FOR_ONE", true);
        uint128 amountIn = uint128(vm.envOr("AMOUNT_IN", uint256(0.0003 ether)));
        bool plain = vm.envOr("PLAIN", false);

        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(usdc()),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(hook))
        });

        bytes memory hookData;
        if (!plain) {
            string memory intent = vm.envOr("INTENT", string.concat("demo-", vm.toString(block.timestamp)));
            PolicyPoolHook.Attestation memory att = PolicyPoolHook.Attestation({
                intentId: keccak256(bytes(intent)),
                poolId: PoolId.unwrap(key.toId()),
                swapper: vm.envOr("BEARER", false) ? address(0) : swapper,
                zeroForOne: zeroForOne,
                maxAmountIn: amountIn,
                expiry: block.timestamp + 600,
                origin: vm.envOr("ORIGIN", string("demo:sepolia-swap"))
            });
            (uint8 v, bytes32 r, bytes32 s) =
                vm.sign(vm.envUint("POLICY_SIGNER_PRIVATE_KEY"), hook.attestationDigest(att));
            hookData = abi.encode(att, abi.encodePacked(r, s, v));
            require(
                hook.recoverAttestationSigner(att, abi.encodePacked(r, s, v)) == hook.policySigner(),
                "attestation signer != pool's policy signer"
            );
            console2.log("intent      ", intent);
            console2.log("origin      ", att.origin);
            console2.log("intentId");
            console2.logBytes32(att.intentId);
        } else {
            console2.log("PLAIN swap: no hookData -> expect NotAttested()");
        }

        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            ExactInputSingleParamsV1({
                poolKey: key, zeroForOne: zeroForOne, amountIn: amountIn, amountOutMinimum: 0, hookData: hookData
            })
        );
        (Currency inC, Currency outC) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        params[1] = abi.encode(inC, uint256(amountIn));
        params[2] = abi.encode(outC, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);

        vm.startBroadcast(pk);
        if (!zeroForOne) {
            if (IERC20(usdc()).allowance(swapper, PERMIT2) < amountIn) {
                IERC20(usdc()).approve(PERMIT2, type(uint256).max);
            }
            IAllowanceTransfer(PERMIT2).approve(usdc(), address(router()), amountIn, uint48(block.timestamp + 1 hours));
        }
        router().execute{value: zeroForOne ? amountIn : 0}(
            abi.encodePacked(CMD_V4_SWAP), inputs, block.timestamp + 20 minutes
        );
        vm.stopBroadcast();
        console2.log("swapped; amountIn", uint256(amountIn), zeroForOne ? "ETH->USDC" : "USDC->ETH");
    }
}
