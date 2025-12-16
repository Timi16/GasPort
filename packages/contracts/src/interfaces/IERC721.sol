// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IERC721
 * @notice Interface for ERC721 Non-Fungible Token Standard
 */
interface IERC721 {
    /**
     * @notice Transfers ownership of an NFT
     * @param from Current owner
     * @param to New owner
     * @param tokenId Token ID to transfer
     */
    function transferFrom(address from, address to, uint256 tokenId) external;

    /**
     * @notice Safely transfers ownership of an NFT
     * @param from Current owner
     * @param to New owner
     * @param tokenId Token ID to transfer
     */
    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    /**
     * @notice Approve address to transfer NFT
     * @param to Address to approve
     * @param tokenId Token ID
     */
    function approve(address to, uint256 tokenId) external;

    /**
     * @notice Set approval for all NFTs
     * @param operator Operator address
     * @param approved Whether to approve or revoke
     */
    function setApprovalForAll(address operator, bool approved) external;

    /**
     * @notice Get owner of NFT
     * @param tokenId Token ID
     * @return Owner address
     */
    function ownerOf(uint256 tokenId) external view returns (address);

    /**
     * @notice Get balance of owner
     * @param owner Owner address
     * @return Number of NFTs owned
     */
    function balanceOf(address owner) external view returns (uint256);

    /**
     * @notice Get approved address for NFT
     * @param tokenId Token ID
     * @return Approved address
     */
    function getApproved(uint256 tokenId) external view returns (address);

    /**
     * @notice Check if operator is approved for all
     * @param owner Owner address
     * @param operator Operator address
     * @return Whether approved
     */
    function isApprovedForAll(address owner, address operator) external view returns (bool);

    /// Events
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
}
