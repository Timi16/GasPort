// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IPaymaster} from "../interfaces/IPaymaster.sol";
import {UserOperation} from "../libraries/UserOperation.sol";

/**
 * @title GasPortPaymaster
 * @notice EIP-4337 compliant paymaster that enables cross-chain gas sponsorship
 * @dev Allows users to pay gas fees using any supported token from any supported chain
 */
contract GasPortPaymaster is IPaymaster {
    /// @notice EntryPoint contract address (EIP-4337)
    address public immutable entryPoint;

    /// @notice Treasury contract that manages liquidity pools
    address public treasury;

    /// @notice Owner address for admin functions
    address public owner;

    /// @notice Mapping of approved sponsors who can subsidize gas
    mapping(address => bool) public approvedSponsors;

    /// @notice Mapping of daily spending limits per sponsor
    mapping(address => uint256) public dailyLimit;

    /// @notice Mapping of daily spent amounts per sponsor
    mapping(address => uint256) public dailySpent;

    /// @notice Mapping to track last reset timestamp for daily limits
    mapping(address => uint256) public lastResetTimestamp;

    /// @notice Mapping of whitelisted tokens for payment
    mapping(address => bool) public supportedTokens;

    /// @notice Emergency pause flag
    bool public paused;

    /// Events
    event SponsorAdded(address indexed sponsor, uint256 dailyLimit);
    event SponsorRemoved(address indexed sponsor);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event UserOperationSponsored(address indexed sender, uint256 actualGasCost, address paymentToken);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    /// Errors
    error Unauthorized();
    error Paused();
    error InvalidEntryPoint();
    error InvalidTreasury();
    error SponsorNotApproved();
    error DailyLimitExceeded();
    error TokenNotSupported();

    /// Modifiers
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) revert InvalidEntryPoint();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    /**
     * @notice Constructor
     * @param _entryPoint EIP-4337 EntryPoint contract address
     * @param _treasury Treasury contract address
     * @param _owner Owner address
     */
    constructor(address _entryPoint, address _treasury, address _owner) {
        if (_entryPoint == address(0) || _treasury == address(0) || _owner == address(0)) {
            revert InvalidTreasury();
        }

        entryPoint = _entryPoint;
        treasury = _treasury;
        owner = _owner;
    }

    /**
     * @notice Validate user operation and determine if paymaster will pay
     * @param userOp The user operation
     * @param userOpHash Hash of the user operation
     * @param maxCost Maximum cost of this operation (gas * maxFeePerGas)
     * @return context Context data to be passed to postOp
     * @return validationData Validation data (0 for success)
     */
    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external override onlyEntryPoint whenNotPaused returns (bytes memory context, uint256 validationData) {
        // TODO: Implement validation logic
        // 1. Decode payment token from userOp.paymasterAndData
        // 2. Verify sponsor approval and limits
        // 3. Check token balance and allowances
        // 4. Return validation result

        return (abi.encode(userOp.sender, maxCost), 0);
    }

    /**
     * @notice Post-operation handler called after user operation execution
     * @param mode Whether the op succeeded or reverted
     * @param context Context data from validatePaymasterUserOp
     * @param actualGasCost Actual gas cost of the operation
     */
    function postOp(
        IPaymaster.PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external override onlyEntryPoint {
        // TODO: Implement post-op logic
        // 1. Decode context
        // 2. Charge user in their chosen token
        // 3. Update daily spent amounts
        // 4. Emit events
    }

    /**
     * @notice Add approved sponsor
     * @param sponsor Address of the sponsor
     * @param limit Daily spending limit
     */
    function addSponsor(address sponsor, uint256 limit) external onlyOwner {
        approvedSponsors[sponsor] = true;
        dailyLimit[sponsor] = limit;
        lastResetTimestamp[sponsor] = block.timestamp;
        emit SponsorAdded(sponsor, limit);
    }

    /**
     * @notice Remove approved sponsor
     * @param sponsor Address of the sponsor to remove
     */
    function removeSponsor(address sponsor) external onlyOwner {
        approvedSponsors[sponsor] = false;
        emit SponsorRemoved(sponsor);
    }

    /**
     * @notice Add supported payment token
     * @param token Address of the token
     */
    function addToken(address token) external onlyOwner {
        supportedTokens[token] = true;
        emit TokenAdded(token);
    }

    /**
     * @notice Remove supported payment token
     * @param token Address of the token
     */
    function removeToken(address token) external onlyOwner {
        supportedTokens[token] = false;
        emit TokenRemoved(token);
    }

    /**
     * @notice Update treasury address
     * @param newTreasury New treasury address
     */
    function updateTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidTreasury();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /**
     * @notice Pause the paymaster
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @notice Unpause the paymaster
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @notice Deposit ETH to EntryPoint for gas sponsorship
     */
    function deposit() external payable {
        (bool success, ) = entryPoint.call{value: msg.value}(
            abi.encodeWithSignature("depositTo(address)", address(this))
        );
        require(success, "Deposit failed");
    }

    /**
     * @notice Withdraw ETH from EntryPoint
     * @param withdrawAddress Address to withdraw to
     * @param amount Amount to withdraw
     */
    function withdrawTo(address payable withdrawAddress, uint256 amount) external onlyOwner {
        (bool success, ) = entryPoint.call(
            abi.encodeWithSignature("withdrawTo(address,uint256)", withdrawAddress, amount)
        );
        require(success, "Withdrawal failed");
    }
}
