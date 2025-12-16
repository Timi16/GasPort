// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title CrossChainRouter
 * @notice Handles cross-chain routing and message passing
 */
contract CrossChainRouter {
    /// @notice Owner address
    address public owner;

    /// @notice Treasury addresses per chain
    mapping(uint256 => address) public treasuries;

    /// @notice Bridge addresses per protocol
    mapping(string => address) public bridges;

    /// @notice Supported chains
    mapping(uint256 => bool) public supportedChains;

    /// Events
    event RouteExecuted(
        uint256 indexed fromChain,
        uint256 indexed toChain,
        address indexed token,
        uint256 amount,
        bytes32 routeId
    );
    event ChainAdded(uint256 indexed chainId, address treasury);
    event ChainRemoved(uint256 indexed chainId);
    event BridgeAdded(string indexed protocol, address bridge);

    /// Errors
    error Unauthorized();
    error ChainNotSupported();
    error InvalidAmount();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    /**
     * @notice Execute cross-chain route
     * @param toChain Target chain ID
     * @param token Token address
     * @param amount Amount to route
     * @param recipient Recipient address on target chain
     * @return routeId Unique route identifier
     */
    function executeRoute(
        uint256 toChain,
        address token,
        uint256 amount,
        address recipient
    ) external returns (bytes32 routeId) {
        if (!supportedChains[toChain]) revert ChainNotSupported();
        if (amount == 0) revert InvalidAmount();

        // Generate route ID
        routeId = keccak256(abi.encodePacked(
            block.chainid,
            toChain,
            token,
            amount,
            recipient,
            block.timestamp
        ));

        // Transfer tokens from sender
        // In production, would handle actual token transfers and bridge calls

        emit RouteExecuted(block.chainid, toChain, token, amount, routeId);

        return routeId;
    }

    /**
     * @notice Add supported chain
     * @param chainId Chain ID
     * @param treasury Treasury address on that chain
     */
    function addChain(uint256 chainId, address treasury) external onlyOwner {
        supportedChains[chainId] = true;
        treasuries[chainId] = treasury;
        emit ChainAdded(chainId, treasury);
    }

    /**
     * @notice Remove supported chain
     * @param chainId Chain ID
     */
    function removeChain(uint256 chainId) external onlyOwner {
        supportedChains[chainId] = false;
        emit ChainRemoved(chainId);
    }

    /**
     * @notice Add bridge protocol
     * @param protocol Protocol name (e.g., "hyperlane", "layerzero")
     * @param bridge Bridge contract address
     */
    function addBridge(string calldata protocol, address bridge) external onlyOwner {
        bridges[protocol] = bridge;
        emit BridgeAdded(protocol, bridge);
    }
}
