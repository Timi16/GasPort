// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IPriceOracle
 * @notice Interface for price oracle
 * @dev Used by GasPortPaymaster to get real-time token prices
 */
interface IPriceOracle {
    /**
     * @notice Get ETH price in USD
     * @return Price in USD with 8 decimals (e.g., 2000.50 = 200050000000)
     */
    function getEthPrice() external view returns (uint256);

    /**
     * @notice Get token price in USD
     * @param token Token address
     * @return Price in USD with 8 decimals
     */
    function getTokenPrice(address token) external view returns (uint256);

    /**
     * @notice Get latest price with metadata
     * @param token Token address (address(0) for ETH)
     * @return price Price in USD with 8 decimals
     * @return updatedAt Timestamp of last update
     * @return isStale Whether the price is stale (>1 hour old)
     */
    function getLatestPrice(address token) external view returns (
        uint256 price,
        uint256 updatedAt,
        bool isStale
    );

    /// Events
    event PriceFeedAdded(address indexed token, address indexed feed);
    event PriceFeedRemoved(address indexed token);
    event StalePrice(address indexed token, uint256 lastUpdate);
}
