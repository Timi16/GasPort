// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "../interfaces/IERC20.sol";
import {ReentrancyGuard} from "../libraries/ReentrancyGuard.sol";

/**
 * @title GasPortTreasury
 * @notice Manages liquidity pools for cross-chain gas payments
 * @dev Deployed on each supported chain to hold and distribute tokens
 */
contract GasPortTreasury is ReentrancyGuard {
    /// @notice Owner address
    address public owner;

    /// @notice Paymaster address that can withdraw funds
    address public paymaster;

    /// @notice Router address for cross-chain operations
    address public router;

    /// @notice Mapping of supported tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Liquidity provider shares
    /// LP address => token address => share amount
    mapping(address => mapping(address => uint256)) public lpShares;

    /// @notice Total shares per token
    mapping(address => uint256) public totalShares;

    /// @notice Total liquidity per token
    mapping(address => uint256) public totalLiquidity;

    /// @notice Revenue accumulated per token (for LP rewards)
    mapping(address => uint256) public accumulatedRevenue;

    /// @notice Emergency pause flag
    bool public paused;

    /// Events
    event LiquidityAdded(address indexed provider, address indexed token, uint256 amount, uint256 shares);
    event LiquidityRemoved(address indexed provider, address indexed token, uint256 amount, uint256 shares);
    event TokenSwapped(address indexed from, address indexed to, uint256 amountIn, uint256 amountOut);
    event RevenueDistributed(address indexed token, uint256 amount);
    event PaymasterUpdated(address indexed oldPaymaster, address indexed newPaymaster);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event EmergencyWithdrawal(address indexed token, address indexed to, uint256 amount);

    /// Errors
    error Unauthorized();
    error Paused();
    error TokenNotSupported();
    error InsufficientLiquidity();
    error InvalidAmount();
    error TransferFailed();

    /// Modifiers
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != paymaster && msg.sender != router) {
            revert Unauthorized();
        }
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    /**
     * @notice Constructor
     * @param _owner Owner address
     */
    constructor(address _owner) {
        owner = _owner;
    }

    /**
     * @notice Add liquidity to the treasury
     * @param token Token address
     * @param amount Amount to add
     * @return shares Amount of shares minted
     */
    function addLiquidity(
        address token,
        uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (amount == 0) revert InvalidAmount();

        // Calculate shares to mint
        if (totalShares[token] == 0) {
            shares = amount;
        } else {
            shares = (amount * totalShares[token]) / totalLiquidity[token];
        }

        // Transfer tokens
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }

        // Update state
        lpShares[msg.sender][token] += shares;
        totalShares[token] += shares;
        totalLiquidity[token] += amount;

        emit LiquidityAdded(msg.sender, token, amount, shares);
    }

    /**
     * @notice Remove liquidity from the treasury
     * @param token Token address
     * @param shares Amount of shares to burn
     * @return amount Amount of tokens returned
     */
    function removeLiquidity(
        address token,
        uint256 shares
    ) external nonReentrant whenNotPaused returns (uint256 amount) {
        if (lpShares[msg.sender][token] < shares) revert InsufficientLiquidity();

        // Calculate amount to return (including revenue share)
        uint256 totalValue = totalLiquidity[token] + accumulatedRevenue[token];
        amount = (shares * totalValue) / totalShares[token];

        // Update state
        lpShares[msg.sender][token] -= shares;
        totalShares[token] -= shares;

        // Reduce liquidity and revenue proportionally
        uint256 liquidityToRemove = (shares * totalLiquidity[token]) / totalShares[token];
        uint256 revenueToRemove = amount - liquidityToRemove;

        totalLiquidity[token] -= liquidityToRemove;
        accumulatedRevenue[token] -= revenueToRemove;

        // Transfer tokens
        if (!IERC20(token).transfer(msg.sender, amount)) {
            revert TransferFailed();
        }

        emit LiquidityRemoved(msg.sender, token, amount, shares);
    }

    /**
     * @notice Withdraw tokens (only authorized contracts)
     * @param token Token address
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyAuthorized nonReentrant whenNotPaused {
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (totalLiquidity[token] < amount) revert InsufficientLiquidity();

        totalLiquidity[token] -= amount;

        if (!IERC20(token).transfer(to, amount)) {
            revert TransferFailed();
        }
    }

    /**
     * @notice Add revenue (from gas payments)
     * @param token Token address
     * @param amount Revenue amount
     */
    function addRevenue(address token, uint256 amount) external onlyAuthorized {
        accumulatedRevenue[token] += amount;
        emit RevenueDistributed(token, amount);
    }

    /**
     * @notice Set paymaster address
     * @param newPaymaster New paymaster address
     */
    function setPaymaster(address newPaymaster) external onlyOwner {
        address oldPaymaster = paymaster;
        paymaster = newPaymaster;
        emit PaymasterUpdated(oldPaymaster, newPaymaster);
    }

    /**
     * @notice Set router address
     * @param newRouter New router address
     */
    function setRouter(address newRouter) external onlyOwner {
        address oldRouter = router;
        router = newRouter;
        emit RouterUpdated(oldRouter, newRouter);
    }

    /**
     * @notice Add supported token
     * @param token Token address
     */
    function addToken(address token) external onlyOwner {
        supportedTokens[token] = true;
        emit TokenAdded(token);
    }

    /**
     * @notice Remove supported token
     * @param token Token address
     */
    function removeToken(address token) external onlyOwner {
        supportedTokens[token] = false;
        emit TokenRemoved(token);
    }

    /**
     * @notice Emergency withdrawal (only owner, when paused)
     * @param token Token address
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        if (!paused) revert();

        if (token == address(0)) {
            payable(to).transfer(amount);
        } else {
            IERC20(token).transfer(to, amount);
        }

        emit EmergencyWithdrawal(token, to, amount);
    }

    /**
     * @notice Pause the treasury
     */
    function pause() external onlyOwner {
        paused = true;
    }

    /**
     * @notice Unpause the treasury
     */
    function unpause() external onlyOwner {
        paused = false;
    }

    /**
     * @notice Get LP balance
     * @param provider LP address
     * @param token Token address
     * @return balance Token balance including revenue share
     */
    function getLPBalance(address provider, address token) external view returns (uint256 balance) {
        if (totalShares[token] == 0) return 0;

        uint256 shares = lpShares[provider][token];
        uint256 totalValue = totalLiquidity[token] + accumulatedRevenue[token];
        balance = (shares * totalValue) / totalShares[token];
    }

    /**
     * @notice Receive ETH
     */
    receive() external payable {}
}
