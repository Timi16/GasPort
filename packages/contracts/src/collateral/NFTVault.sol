// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC721} from "../interfaces/IERC721.sol";
import {ReentrancyGuard} from "../libraries/ReentrancyGuard.sol";

/**
 * @title NFTVault
 * @notice Manages NFT collateral for gas abstraction services
 * @dev Users can deposit NFTs to unlock gas credits based on floor price
 */
contract NFTVault is ReentrancyGuard {
    /// @notice Owner address
    address public owner;

    /// @notice Floor price oracle
    address public floorPriceOracle;

    /// @notice Paymaster that can use collateral
    address public paymaster;

    /// @notice Loan-to-Value ratio (basis points, e.g., 5000 = 50%)
    uint256 public ltvRatio = 5000;

    /// @notice Liquidation threshold (basis points, e.g., 7500 = 75%)
    uint256 public liquidationThreshold = 7500;

    /// @notice Collateral position counter
    uint256 public nextPositionId = 1;

    /// @notice Collateral position struct
    struct CollateralPosition {
        address owner;
        address nftContract;
        uint256 tokenId;
        uint256 depositedAt;
        uint256 borrowedAmount;
        bool active;
    }

    /// @notice Mapping of position ID to collateral data
    mapping(uint256 => CollateralPosition) public positions;

    /// @notice Mapping of user to their position IDs
    mapping(address => uint256[]) public userPositions;

    /// @notice Mapping of NFT to position ID (nftContract => tokenId => positionId)
    mapping(address => mapping(uint256 => uint256)) public nftToPosition;

    /// @notice Emergency pause flag
    bool public paused;

    /// Events
    event CollateralDeposited(
        uint256 indexed positionId,
        address indexed owner,
        address indexed nftContract,
        uint256 tokenId
    );
    event CollateralWithdrawn(
        uint256 indexed positionId,
        address indexed owner,
        address indexed nftContract,
        uint256 tokenId
    );
    event BorrowedAgainstCollateral(
        uint256 indexed positionId,
        address indexed borrower,
        uint256 amount
    );
    event CollateralLiquidated(
        uint256 indexed positionId,
        address indexed liquidator,
        uint256 debtAmount
    );
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event LTVRatioUpdated(uint256 oldRatio, uint256 newRatio);

    /// Errors
    error Unauthorized();
    error Paused();
    error InvalidAddress();
    error InvalidRatio();
    error PositionNotFound();
    error PositionNotActive();
    error InsufficientCollateral();
    error ExceedsLTV();
    error NotLiquidatable();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyPaymaster() {
        if (msg.sender != paymaster) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(address _owner, address _floorPriceOracle, address _paymaster) {
        if (_owner == address(0) || _floorPriceOracle == address(0)) {
            revert InvalidAddress();
        }
        owner = _owner;
        floorPriceOracle = _floorPriceOracle;
        paymaster = _paymaster;
    }

    /**
     * @notice Deposit NFT as collateral
     * @param nftContract NFT contract address
     * @param tokenId Token ID to deposit
     * @return positionId The created position ID
     */
    function depositCollateral(
        address nftContract,
        uint256 tokenId
    ) external nonReentrant whenNotPaused returns (uint256 positionId) {
        // Transfer NFT to vault
        IERC721(nftContract).transferFrom(msg.sender, address(this), tokenId);

        // Create position
        positionId = nextPositionId++;
        positions[positionId] = CollateralPosition({
            owner: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            depositedAt: block.timestamp,
            borrowedAmount: 0,
            active: true
        });

        // Track position
        userPositions[msg.sender].push(positionId);
        nftToPosition[nftContract][tokenId] = positionId;

        emit CollateralDeposited(positionId, msg.sender, nftContract, tokenId);
    }

    /**
     * @notice Withdraw NFT collateral
     * @param positionId Position ID to withdraw
     */
    function withdrawCollateral(uint256 positionId) external nonReentrant {
        CollateralPosition storage position = positions[positionId];

        if (position.owner != msg.sender) revert Unauthorized();
        if (!position.active) revert PositionNotActive();
        if (position.borrowedAmount > 0) revert InsufficientCollateral();

        // Mark as inactive
        position.active = false;

        // Transfer NFT back to owner
        IERC721(position.nftContract).transferFrom(
            address(this),
            position.owner,
            position.tokenId
        );

        emit CollateralWithdrawn(
            positionId,
            position.owner,
            position.nftContract,
            position.tokenId
        );
    }

    /**
     * @notice Borrow against collateral (called by paymaster)
     * @param positionId Position ID to borrow against
     * @param amount Amount to borrow
     */
    function borrowAgainstCollateral(
        uint256 positionId,
        uint256 amount
    ) external onlyPaymaster nonReentrant whenNotPaused {
        CollateralPosition storage position = positions[positionId];

        if (!position.active) revert PositionNotActive();

        // Get floor price from oracle
        uint256 floorPrice = IFloorPriceOracle(floorPriceOracle).getFloorPrice(
            position.nftContract
        );

        // Calculate max borrow amount (LTV ratio)
        uint256 maxBorrow = (floorPrice * ltvRatio) / 10000;

        // Check if new total borrowed exceeds max
        if (position.borrowedAmount + amount > maxBorrow) {
            revert ExceedsLTV();
        }

        // Update borrowed amount
        position.borrowedAmount += amount;

        emit BorrowedAgainstCollateral(positionId, position.owner, amount);
    }

    /**
     * @notice Repay borrowed amount
     * @param positionId Position ID to repay
     * @param amount Amount to repay
     */
    function repay(uint256 positionId, uint256 amount) external payable nonReentrant {
        CollateralPosition storage position = positions[positionId];

        if (!position.active) revert PositionNotActive();

        // Reduce borrowed amount
        if (amount > position.borrowedAmount) {
            amount = position.borrowedAmount;
        }
        position.borrowedAmount -= amount;

        // Refund excess ETH
        if (msg.value > amount) {
            (bool success, ) = msg.sender.call{value: msg.value - amount}("");
            require(success, "Refund failed");
        }
    }

    /**
     * @notice Liquidate undercollateralized position
     * @param positionId Position ID to liquidate
     */
    function liquidate(uint256 positionId) external nonReentrant {
        CollateralPosition storage position = positions[positionId];

        if (!position.active) revert PositionNotActive();

        // Get floor price
        uint256 floorPrice = IFloorPriceOracle(floorPriceOracle).getFloorPrice(
            position.nftContract
        );

        // Calculate liquidation threshold
        uint256 liquidationValue = (floorPrice * liquidationThreshold) / 10000;

        // Check if position is liquidatable
        if (position.borrowedAmount <= liquidationValue) {
            revert NotLiquidatable();
        }

        uint256 debtAmount = position.borrowedAmount;

        // Mark as inactive
        position.active = false;
        position.borrowedAmount = 0;

        // Transfer NFT to liquidator
        IERC721(position.nftContract).transferFrom(
            address(this),
            msg.sender,
            position.tokenId
        );

        emit CollateralLiquidated(positionId, msg.sender, debtAmount);
    }

    /**
     * @notice Get available credit for a position
     * @param positionId Position ID
     * @return Available credit in wei
     */
    function getAvailableCredit(uint256 positionId) external view returns (uint256) {
        CollateralPosition storage position = positions[positionId];

        if (!position.active) return 0;

        uint256 floorPrice = IFloorPriceOracle(floorPriceOracle).getFloorPrice(
            position.nftContract
        );

        uint256 maxBorrow = (floorPrice * ltvRatio) / 10000;

        if (position.borrowedAmount >= maxBorrow) return 0;

        return maxBorrow - position.borrowedAmount;
    }

    /**
     * @notice Get user's total available credit across all positions
     * @param user User address
     * @return Total available credit in wei
     */
    function getUserTotalCredit(address user) external view returns (uint256) {
        uint256[] memory positionIds = userPositions[user];
        uint256 totalCredit = 0;

        for (uint256 i = 0; i < positionIds.length; i++) {
            CollateralPosition storage position = positions[positionIds[i]];

            if (!position.active) continue;

            uint256 floorPrice = IFloorPriceOracle(floorPriceOracle).getFloorPrice(
                position.nftContract
            );

            uint256 maxBorrow = (floorPrice * ltvRatio) / 10000;

            if (maxBorrow > position.borrowedAmount) {
                totalCredit += maxBorrow - position.borrowedAmount;
            }
        }

        return totalCredit;
    }

    /**
     * @notice Update floor price oracle
     * @param newOracle New oracle address
     */
    function updateOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert InvalidAddress();
        address oldOracle = floorPriceOracle;
        floorPriceOracle = newOracle;
        emit OracleUpdated(oldOracle, newOracle);
    }

    /**
     * @notice Update LTV ratio
     * @param newRatio New LTV ratio in basis points
     */
    function updateLTVRatio(uint256 newRatio) external onlyOwner {
        if (newRatio == 0 || newRatio > 10000) revert InvalidRatio();
        uint256 oldRatio = ltvRatio;
        ltvRatio = newRatio;
        emit LTVRatioUpdated(oldRatio, newRatio);
    }

    /**
     * @notice Update liquidation threshold
     * @param newThreshold New threshold in basis points
     */
    function updateLiquidationThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > 10000) revert InvalidRatio();
        liquidationThreshold = newThreshold;
    }

    /**
     * @notice Update paymaster address
     * @param newPaymaster New paymaster address
     */
    function updatePaymaster(address newPaymaster) external onlyOwner {
        if (newPaymaster == address(0)) revert InvalidAddress();
        paymaster = newPaymaster;
    }

    /**
     * @notice Pause the vault
     */
    function pause() external onlyOwner {
        paused = true;
    }

    /**
     * @notice Unpause the vault
     */
    function unpause() external onlyOwner {
        paused = false;
    }
}

/**
 * @notice Interface for floor price oracle
 */
interface IFloorPriceOracle {
    function getFloorPrice(address nftContract) external view returns (uint256);
}
