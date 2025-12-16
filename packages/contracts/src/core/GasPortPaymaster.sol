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
        // Decode payment token from paymasterAndData
        // Format: <paymaster_address(20)><token_address(20)><signature(65)>
        require(userOp.paymasterAndData.length >= 40, "Invalid paymaster data");

        address paymentToken;
        assembly {
            // Skip first 20 bytes (paymaster address), read next 20 bytes (token address)
            paymentToken := shr(96, calldataload(add(userOp.paymasterAndData.offset, 20)))
        }

        // Verify token is supported
        if (!supportedTokens[paymentToken]) revert TokenNotSupported();

        // Check if user has sufficient token balance
        uint256 requiredTokenAmount = _calculateTokenAmount(maxCost, paymentToken);
        require(
            IERC20(paymentToken).balanceOf(userOp.sender) >= requiredTokenAmount,
            "Insufficient token balance"
        );

        // Check if user has approved this contract
        require(
            IERC20(paymentToken).allowance(userOp.sender, address(this)) >= requiredTokenAmount,
            "Insufficient token allowance"
        );

        // Encode context for postOp
        bytes memory context = abi.encode(
            userOp.sender,
            paymentToken,
            requiredTokenAmount,
            maxCost
        );

        // Return success (validationData = 0 means valid)
        return (context, 0);
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
        // Decode context
        (address sender, address paymentToken, uint256 prechargedAmount, uint256 maxCost) =
            abi.decode(context, (address, address, uint256, uint256));

        // Only charge if operation succeeded or reverted (not if postOp reverted)
        if (mode != IPaymaster.PostOpMode.postOpReverted) {
            // Calculate actual token amount based on actual gas cost
            uint256 actualTokenAmount = _calculateTokenAmount(actualGasCost, paymentToken);

            // Transfer tokens from user to this contract
            bool success = IERC20(paymentToken).transferFrom(
                sender,
                address(this),
                actualTokenAmount
            );
            require(success, "Token transfer failed");

            // If collected more than needed (precharge), refund difference
            if (prechargedAmount > actualTokenAmount) {
                uint256 refund = prechargedAmount - actualTokenAmount;
                IERC20(paymentToken).transfer(sender, refund);
            }

            // Add to revenue in treasury
            if (treasury != address(0)) {
                IERC20(paymentToken).approve(treasury, actualTokenAmount);
                // Treasury will account this as revenue
            }

            emit UserOperationSponsored(sender, actualGasCost, paymentToken);
        }
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

    /**
     * @notice Calculate required token amount for gas cost
     * @param gasCostInWei Gas cost in wei
     * @param token Token address
     * @return Token amount required
     */
    function _calculateTokenAmount(uint256 gasCostInWei, address token) internal view returns (uint256) {
        // TODO: Integrate with price oracle for real conversion
        // For now, simplified 1:1 for stablecoins, or use fixed rate

        // If token is ETH (address(0)), return same amount
        if (token == address(0)) {
            return gasCostInWei;
        }

        // For stablecoins (USDC, USDT, DAI), assume 1 ETH = $2000
        // This should be replaced with real price oracle in production
        uint256 ethPriceInUSD = 2000;

        // Get token decimals
        uint8 tokenDecimals = 6; // USDC/USDT default
        if (token == 0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1) {
            tokenDecimals = 18; // DAI
        }

        // Convert: gasCostInWei (18 decimals) * ethPrice / 10^18 * 10^tokenDecimals
        uint256 tokenAmount = (gasCostInWei * ethPriceInUSD * (10 ** tokenDecimals)) / (10 ** 18);

        return tokenAmount;
    }
}
