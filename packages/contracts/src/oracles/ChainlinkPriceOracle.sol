// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/**
 * @title ChainlinkPriceOracle
 * @notice Fetches real-time token prices from Chainlink oracles
 * @dev Integrates with Chainlink Price Feeds on Arbitrum One
 */
contract ChainlinkPriceOracle is IPriceOracle {
    /// @notice Owner address
    address public owner;

    /// @notice Staleness threshold (1 hour)
    uint256 public constant STALENESS_THRESHOLD = 1 hours;

    /// @notice Price feed addresses
    mapping(address => address) public priceFeeds;

    /// @notice Supported tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Last known prices (fallback)
    mapping(address => uint256) public lastKnownPrices;

    /// @notice Last update timestamps
    mapping(address => uint256) public lastUpdateTimes;

    /// Errors
    error Unauthorized();
    error TokenNotSupported();
    error StalePriceData();
    error InvalidPrice();
    error OracleError();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _owner) {
        owner = _owner;

        // Initialize with Arbitrum One Chainlink feeds
        // These are the official, production Chainlink addresses

        // ETH/USD: 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612
        priceFeeds[address(0)] = 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612;
        supportedTokens[address(0)] = true;

        // USDC/USD: 0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3
        priceFeeds[0xaf88d065e77c8cC2239327C5EDb3A432268e5831] = 0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3;
        supportedTokens[0xaf88d065e77c8cC2239327C5EDb3A432268e5831] = true;

        // USDT/USD: 0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7
        priceFeeds[0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9] = 0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7;
        supportedTokens[0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9] = true;

        // DAI/USD: Use same as ETH (DAI is $1 stablecoin)
        // For DAI, we'll return a fixed $1.00 price
        priceFeeds[0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1] = address(0); // Special case
        supportedTokens[0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1] = true;

        // ARB/USD: 0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6
        priceFeeds[0x912CE59144191C1204E64559FE8253a0e49E6548] = 0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6;
        supportedTokens[0x912CE59144191C1204E64559FE8253a0e49E6548] = true;
    }

    /**
     * @notice Get ETH price in USD
     * @return Price in USD with 8 decimals
     */
    function getEthPrice() external view override returns (uint256) {
        return _getPrice(address(0));
    }

    /**
     * @notice Get token price in USD
     * @param token Token address
     * @return Price in USD with 8 decimals
     */
    function getTokenPrice(address token) external view override returns (uint256) {
        return _getPrice(token);
    }

    /**
     * @notice Get latest price with metadata
     * @param token Token address (address(0) for ETH)
     * @return price Price in USD with 8 decimals
     * @return updatedAt Timestamp of last update
     * @return isStale Whether the price is stale
     */
    function getLatestPrice(address token) external view override returns (
        uint256 price,
        uint256 updatedAt,
        bool isStale
    ) {
        if (!supportedTokens[token]) revert TokenNotSupported();

        // Special case for DAI (stablecoin)
        if (token == 0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1) {
            return (100000000, block.timestamp, false); // $1.00 with 8 decimals
        }

        address feed = priceFeeds[token];
        if (feed == address(0)) revert TokenNotSupported();

        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAtTimestamp,
            uint80
        ) {
            if (answer <= 0) revert InvalidPrice();

            price = uint256(answer);
            updatedAt = updatedAtTimestamp;
            isStale = block.timestamp - updatedAtTimestamp > STALENESS_THRESHOLD;

            return (price, updatedAt, isStale);
        } catch {
            // Fallback to last known price
            if (lastKnownPrices[token] > 0) {
                return (
                    lastKnownPrices[token],
                    lastUpdateTimes[token],
                    true // Mark as stale since we're using fallback
                );
            }
            revert OracleError();
        }
    }

    /**
     * @notice Internal function to get price
     * @param token Token address
     * @return Price in USD with 8 decimals
     */
    function _getPrice(address token) internal view returns (uint256) {
        if (!supportedTokens[token]) revert TokenNotSupported();

        // Special case for DAI (stablecoin = $1.00)
        if (token == 0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1) {
            return 100000000; // $1.00 with 8 decimals
        }

        address feed = priceFeeds[token];
        if (feed == address(0)) revert TokenNotSupported();

        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            // Validate price data
            if (answer <= 0) revert InvalidPrice();

            // Check staleness
            if (block.timestamp - updatedAt > STALENESS_THRESHOLD) {
                emit StalePrice(token, updatedAt);

                // Use last known price if available
                if (lastKnownPrices[token] > 0) {
                    return lastKnownPrices[token];
                }

                revert StalePriceData();
            }

            uint256 price = uint256(answer);

            // Cache the price (non-storage, just for this view call)
            // In a state-changing function, we would update lastKnownPrices

            return price;
        } catch {
            // Fallback to last known price
            if (lastKnownPrices[token] > 0) {
                return lastKnownPrices[token];
            }
            revert OracleError();
        }
    }

    /**
     * @notice Update last known price (called periodically by keeper)
     * @param token Token address
     */
    function updateLastKnownPrice(address token) external {
        if (!supportedTokens[token]) revert TokenNotSupported();

        // DAI is always $1
        if (token == 0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1) {
            lastKnownPrices[token] = 100000000;
            lastUpdateTimes[token] = block.timestamp;
            return;
        }

        address feed = priceFeeds[token];
        if (feed == address(0)) revert TokenNotSupported();

        try AggregatorV3Interface(feed).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            if (answer > 0) {
                lastKnownPrices[token] = uint256(answer);
                lastUpdateTimes[token] = updatedAt;
            }
        } catch {
            revert OracleError();
        }
    }

    /**
     * @notice Add price feed for a token
     * @param token Token address (address(0) for ETH)
     * @param feed Chainlink price feed address
     */
    function addPriceFeed(address token, address feed) external onlyOwner {
        priceFeeds[token] = feed;
        supportedTokens[token] = true;
        emit PriceFeedAdded(token, feed);
    }

    /**
     * @notice Remove price feed for a token
     * @param token Token address
     */
    function removePriceFeed(address token) external onlyOwner {
        delete priceFeeds[token];
        supportedTokens[token] = false;
        emit PriceFeedRemoved(token);
    }

    /**
     * @notice Check if token is supported
     * @param token Token address
     * @return Whether the token has a price feed
     */
    function isTokenSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }

    /**
     * @notice Get price feed address for a token
     * @param token Token address
     * @return Price feed address
     */
    function getPriceFeed(address token) external view returns (address) {
        return priceFeeds[token];
    }
}
