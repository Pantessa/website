// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IMsgSender} from "@uniswap/v4-periphery/src/interfaces/IMsgSender.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BaseHook} from "./base/BaseHook.sol";

/// @title PolicyPoolHook — the Pantessa desk policy, enforced by the pool itself.
/// @notice A Uniswap v4 hook that refuses every swap not carrying an ATTESTATION signed by the desk's
///         policy signer, and emits `DeskFill` with the intent's provenance after a fill. The hook never
///         changes a swap's economics: beforeSwap returns a zero delta and no fee override; afterSwap
///         returns no delta. Liquidity may only be ADDED by the owner (the tenant seeds its own pool);
///         removal is never gated, so funds are never trapped behind the policy.
/// @dev Contract of record: /Users/nate/pantessa/squad-policy-pool-2026-11-02/README.md "The hook";
///      executable form `lib/policy-pool/spec.ts` (EIP-712 domain/types, hookData encoding, ABI).
///      Solidity and TypeScript must agree byte for byte — test/vectors/attestation.json proves it.
contract PolicyPoolHook is BaseHook, EIP712 {
    using PoolIdLibrary for PoolKey;

    // ─────────────────────────────────────────────────────────────── types ──

    /// @notice One signed permission to swap once, on one pool, one side, up to a size, before an expiry.
    /// @dev Field order is the hookData/EIP-712 order (spec.ts HOOK_DATA_PARAMS / ATTESTATION_TYPES).
    struct Attestation {
        /// keccak256(utf8(desk intent id)) — single use on-chain.
        bytes32 intentId;
        /// v4 PoolId = keccak256(abi.encode(PoolKey)).
        bytes32 poolId;
        /// EOA expected as tx.origin; address(0) = bearer (any origin; smart-account custody).
        address swapper;
        /// Swap direction; must equal the swap's.
        bool zeroForOne;
        /// Atoms of the input currency; the swap must be exact-in and within this.
        uint256 maxAmountIn;
        /// Unix seconds; block.timestamp <= expiry.
        uint256 expiry;
        /// Provenance, emitted verbatim: `dune:<queryId>`, `desk:<intentId>`, `demo:<label>`.
        string origin;
    }

    // ───────────────────────────────────────────────────────────── constants ──

    /// @dev keccak256("Attestation(bytes32 intentId,bytes32 poolId,address swapper,bool zeroForOne,uint256 maxAmountIn,uint256 expiry,string origin)")
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 intentId,bytes32 poolId,address swapper,bool zeroForOne,uint256 maxAmountIn,uint256 expiry,string origin)"
    );

    string public constant EIP712_NAME = "PantessaPolicyPool";
    string public constant EIP712_VERSION = "1";

    // ─────────────────────────────────────────────────────────────── storage ──

    /// @notice The tenant. Seeds liquidity, rotates the policy signer, pauses.
    address public owner;
    /// @notice The desk's policy signer: the only key whose attestations the pool accepts.
    address public policySigner;
    /// @notice Kill switch: every swap reverts `Paused()` while set. Liquidity removal still works.
    bool public paused;
    /// @notice intentId → spent. An attestation is single use.
    mapping(bytes32 => bool) public usedIntent;

    // ──────────────────────────────────────────────────────────────── events ──

    /// @notice One fill through the policy pool, with the desk's provenance.
    /// @param intentId the attestation's intentId
    /// @param originHash keccak256(bytes(origin)) — the indexed twin of the verbatim string
    /// @param swapper att.swapper, or tx.origin for a bearer attestation
    /// @param poolId the pool the fill happened in
    /// @param zeroForOne direction
    /// @param amount0 the swap's BalanceDelta amount0 (negative = paid into the pool)
    /// @param amount1 the swap's BalanceDelta amount1
    /// @param origin the attestation's provenance string, verbatim
    event DeskFill(
        bytes32 indexed intentId,
        bytes32 indexed originHash,
        address indexed swapper,
        bytes32 poolId,
        bool zeroForOne,
        int128 amount0,
        int128 amount1,
        string origin
    );
    event PolicySignerSet(address indexed signer);
    event PausedSet(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ──────────────────────────────────────────────────────────────── errors ──

    error NotAttested();
    error WrongPool();
    error WrongSide();
    error ExactOutRefused();
    error OverSize();
    error Expired();
    error WrongSwapper();
    error IntentUsed();
    error BadSigner();
    error Paused();
    error OnlyOwnerLiquidity();
    error NotOwner();

    // ─────────────────────────────────────────────────────────── construction ──

    constructor(IPoolManager _manager, address _owner, address _policySigner)
        BaseHook(_manager)
        EIP712(EIP712_NAME, EIP712_VERSION)
    {
        owner = _owner;
        policySigner = _policySigner;
        emit OwnershipTransferred(address(0), _owner);
        emit PolicySignerSet(_policySigner);
    }

    /// @inheritdoc BaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ───────────────────────────────────────────────────────────────── admin ──

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setPolicySigner(address signer) external onlyOwner {
        policySigner = signer;
        emit PolicySignerSet(signer);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─────────────────────────────────────────────────────────── hook: swaps ──

    /// @dev Every check in the README's order. Marks the intent spent. Zero delta, no fee override.
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (paused) revert Paused();
        (Attestation memory att, bytes memory sig) = _decodeOrRefuse(hookData);

        if (att.poolId != PoolId.unwrap(key.toId())) revert WrongPool();
        if (att.zeroForOne != params.zeroForOne) revert WrongSide();
        if (params.amountSpecified >= 0) revert ExactOutRefused();
        if (uint256(-params.amountSpecified) > att.maxAmountIn) revert OverSize();
        if (block.timestamp > att.expiry) revert Expired();
        if (att.swapper != address(0) && tx.origin != att.swapper) revert WrongSwapper();
        if (usedIntent[att.intentId]) revert IntentUsed();
        if (recoverAttestationSigner(att, sig) != policySigner) revert BadSigner();

        usedIntent[att.intentId] = true;
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev The attestation was validated in beforeSwap in this same unlock; decode again and emit.
    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        (Attestation memory att,) = abi.decode(hookData, (Attestation, bytes));
        address swapper = att.swapper != address(0) ? att.swapper : tx.origin;
        emit DeskFill(
            att.intentId,
            keccak256(bytes(att.origin)),
            swapper,
            PoolId.unwrap(key.toId()),
            params.zeroForOne,
            delta.amount0(),
            delta.amount1(),
            att.origin
        );
        return (BaseHook.afterSwap.selector, 0);
    }

    // ────────────────────────────────────────────────────── hook: liquidity ──

    /// @dev Only the owner adds liquidity. `sender` is whoever called the PoolManager: the owner itself
    ///      (a direct unlock), or a periphery router acting for the owner — v4 routers expose the
    ///      original caller through `IMsgSender.msgSender()` (PositionManager does), which is the only
    ///      way the PositionManager path can be owner-gated at all. A router that does not implement it
    ///      is refused. Removal is not hooked (no beforeRemoveLiquidity permission), so it is never gated.
    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        if (sender != owner && _routedSender(sender) != owner) revert OnlyOwnerLiquidity();
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _routedSender(address sender) private view returns (address) {
        if (sender.code.length == 0) return address(0);
        try IMsgSender(sender).msgSender() returns (address original) {
            return original;
        } catch {
            return address(0);
        }
    }

    // ────────────────────────────────────────────────────────── EIP-712 views ──

    /// @notice EIP-712 struct hash of an attestation (`origin` hashed as keccak256(bytes(origin))).
    function hashAttestation(Attestation memory att) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                att.intentId,
                att.poolId,
                att.swapper,
                att.zeroForOne,
                att.maxAmountIn,
                att.expiry,
                keccak256(bytes(att.origin))
            )
        );
    }

    /// @notice The digest the policy signer signs: keccak256("\x19\x01" ‖ domainSeparator ‖ structHash).
    function attestationDigest(Attestation memory att) public view returns (bytes32) {
        return _hashTypedDataV4(hashAttestation(att));
    }

    /// @notice The EIP-712 domain separator for this hook on this chain.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Recovers the attestation's signer; address(0) for a malformed or malleable signature.
    /// @dev OpenZeppelin ECDSA.tryRecover rejects s in the upper half-order and v ∉ {27, 28}.
    function recoverAttestationSigner(Attestation memory att, bytes memory sig) public view returns (address) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(attestationDigest(att), sig);
        if (err != ECDSA.RecoverError.NoError) return address(0);
        return recovered;
    }

    /// @notice abi.decode(hookData, (Attestation, bytes)) — exposed so the decode can be try/caught and
    ///         so the TypeScript side can check its encoding against the chain.
    function decodeHookData(bytes calldata hookData) external pure returns (Attestation memory att, bytes memory sig) {
        (att, sig) = abi.decode(hookData, (Attestation, bytes));
    }

    /// @dev Empty or undecodable hookData → NotAttested().
    function _decodeOrRefuse(bytes calldata hookData) private view returns (Attestation memory att, bytes memory sig) {
        if (hookData.length == 0) revert NotAttested();
        try this.decodeHookData(hookData) returns (Attestation memory a, bytes memory s) {
            return (a, s);
        } catch {
            revert NotAttested();
        }
    }
}
