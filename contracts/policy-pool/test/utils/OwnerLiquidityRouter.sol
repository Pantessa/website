// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
import {IMsgSender} from "@uniswap/v4-periphery/src/interfaces/IMsgSender.sol";

/// @notice Test-only liquidity router that, like v4-periphery's PositionManager, exposes the original caller
///         through `IMsgSender.msgSender()` for the duration of the unlock. The hook's owner gate on
///         beforeAddLiquidity reads it. Pays from the caller (transferFrom / msg.value), refunds spare ETH.
contract OwnerLiquidityRouter is IUnlockCallback, IMsgSender {
    using CurrencySettler for Currency;

    IPoolManager public immutable manager;
    address private _locker;

    error NotManager();

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    function msgSender() external view returns (address) {
        return _locker;
    }

    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params)
        external
        payable
        returns (BalanceDelta delta)
    {
        _locker = msg.sender;
        delta = abi.decode(manager.unlock(abi.encode(msg.sender, key, params)), (BalanceDelta));
        _locker = address(0);
        uint256 spare = address(this).balance;
        if (spare > 0) CurrencyLibrary.ADDRESS_ZERO.transfer(msg.sender, spare);
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert NotManager();
        (address payer, PoolKey memory key, ModifyLiquidityParams memory params) =
            abi.decode(raw, (address, PoolKey, ModifyLiquidityParams));
        (BalanceDelta delta,) = manager.modifyLiquidity(key, params, "");
        _close(key.currency0, payer, delta.amount0());
        _close(key.currency1, payer, delta.amount1());
        return abi.encode(delta);
    }

    function _close(Currency currency, address payer, int128 amount) private {
        if (amount < 0) {
            // ETH is paid from this contract's balance (msg.value forwarded by the caller); ERC20s from the payer.
            currency.settle(manager, currency.isAddressZero() ? address(this) : payer, uint256(uint128(-amount)), false);
        } else if (amount > 0) {
            currency.take(manager, payer, uint256(uint128(amount)), false);
        }
    }

    receive() external payable {}
}
