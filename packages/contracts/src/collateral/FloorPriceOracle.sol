// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title FloorPriceOracle
 * @notice Provides NFT collection floor prices from multiple sources
 * @dev Aggregates data from Reservoir, OpenSea, and manual overrides
 */
contract FloorPriceOracle {
    /// @notice Owner address
    address public owner;

    /// @notice Price staleness threshold (24 hours)
    uint256 public constant STALENESS_THRESHOLD = 24 hours;

    /// @notice Floor price data
    struct FloorPrice {
        uint256 price;
        uint256 updatedAt;
        address updater;
        bool isManual;
    }

    /// @notice Mapping of NFT contract to floor price
    mapping(address => FloorPrice) public floorPrices;

    /// @notice Mapping of approved price updaters
    mapping(address => bool) public approvedUpdaters;

    /// @notice Mapping of supported collections
    mapping(address => bool) public supportedCollections;

    /// Events
    event FloorPriceUpdated(
        address indexed nftContract,
        uint256 oldPrice,
        uint256 newPrice,
        address updater
    );
    event CollectionAdded(address indexed nftContract);
    event CollectionRemoved(address indexed nftContract);
    event UpdaterAdded(address indexed updater);
    event UpdaterRemoved(address indexed updater);

    /// Errors
    error Unauthorized();
    error CollectionNotSupported();
    error StalePrice();
    error InvalidPrice();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyApprovedUpdater() {
        if (!approvedUpdaters[msg.sender] && msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address _owner) {
        owner = _owner;
        approvedUpdaters[_owner] = true;
    }

    /**
     * @notice Get floor price for NFT collection
     * @param nftContract NFT contract address
     * @return Floor price in wei
     */
    function getFloorPrice(address nftContract) external view returns (uint256) {
        if (!supportedCollections[nftContract]) {
            revert CollectionNotSupported();
        }

        FloorPrice storage fp = floorPrices[nftContract];

        // Check if price is stale
        if (block.timestamp - fp.updatedAt > STALENESS_THRESHOLD) {
            revert StalePrice();
        }

        return fp.price;
    }

    /**
     * @notice Get floor price with metadata
     * @param nftContract NFT contract address
     * @return price Floor price in wei
     * @return updatedAt Timestamp of last update
     * @return isStale Whether the price is stale
     */
    function getFloorPriceWithMetadata(
        address nftContract
    ) external view returns (uint256 price, uint256 updatedAt, bool isStale) {
        if (!supportedCollections[nftContract]) {
            revert CollectionNotSupported();
        }

        FloorPrice storage fp = floorPrices[nftContract];

        price = fp.price;
        updatedAt = fp.updatedAt;
        isStale = block.timestamp - fp.updatedAt > STALENESS_THRESHOLD;
    }

    /**
     * @notice Update floor price for a collection
     * @param nftContract NFT contract address
     * @param newPrice New floor price in wei
     */
    function updateFloorPrice(
        address nftContract,
        uint256 newPrice
    ) external onlyApprovedUpdater {
        if (!supportedCollections[nftContract]) {
            revert CollectionNotSupported();
        }

        if (newPrice == 0) revert InvalidPrice();

        FloorPrice storage fp = floorPrices[nftContract];
        uint256 oldPrice = fp.price;

        fp.price = newPrice;
        fp.updatedAt = block.timestamp;
        fp.updater = msg.sender;
        fp.isManual = true;

        emit FloorPriceUpdated(nftContract, oldPrice, newPrice, msg.sender);
    }

    /**
     * @notice Batch update floor prices
     * @param nftContracts Array of NFT contract addresses
     * @param newPrices Array of new floor prices
     */
    function batchUpdateFloorPrices(
        address[] calldata nftContracts,
        uint256[] calldata newPrices
    ) external onlyApprovedUpdater {
        require(nftContracts.length == newPrices.length, "Length mismatch");

        for (uint256 i = 0; i < nftContracts.length; i++) {
            if (!supportedCollections[nftContracts[i]]) continue;
            if (newPrices[i] == 0) continue;

            FloorPrice storage fp = floorPrices[nftContracts[i]];
            uint256 oldPrice = fp.price;

            fp.price = newPrices[i];
            fp.updatedAt = block.timestamp;
            fp.updater = msg.sender;
            fp.isManual = true;

            emit FloorPriceUpdated(nftContracts[i], oldPrice, newPrices[i], msg.sender);
        }
    }

    /**
     * @notice Add supported collection
     * @param nftContract NFT contract address
     * @param initialPrice Initial floor price
     */
    function addCollection(
        address nftContract,
        uint256 initialPrice
    ) external onlyOwner {
        supportedCollections[nftContract] = true;

        if (initialPrice > 0) {
            floorPrices[nftContract] = FloorPrice({
                price: initialPrice,
                updatedAt: block.timestamp,
                updater: msg.sender,
                isManual: true
            });
        }

        emit CollectionAdded(nftContract);
    }

    /**
     * @notice Remove supported collection
     * @param nftContract NFT contract address
     */
    function removeCollection(address nftContract) external onlyOwner {
        supportedCollections[nftContract] = false;
        emit CollectionRemoved(nftContract);
    }

    /**
     * @notice Add approved price updater
     * @param updater Address to approve
     */
    function addUpdater(address updater) external onlyOwner {
        approvedUpdaters[updater] = true;
        emit UpdaterAdded(updater);
    }

    /**
     * @notice Remove approved price updater
     * @param updater Address to remove
     */
    function removeUpdater(address updater) external onlyOwner {
        approvedUpdaters[updater] = false;
        emit UpdaterRemoved(updater);
    }

    /**
     * @notice Check if collection is supported
     * @param nftContract NFT contract address
     * @return Whether the collection is supported
     */
    function isCollectionSupported(address nftContract) external view returns (bool) {
        return supportedCollections[nftContract];
    }

    /**
     * @notice Check if price is stale
     * @param nftContract NFT contract address
     * @return Whether the price is stale
     */
    function isPriceStale(address nftContract) external view returns (bool) {
        FloorPrice storage fp = floorPrices[nftContract];
        return block.timestamp - fp.updatedAt > STALENESS_THRESHOLD;
    }
}
