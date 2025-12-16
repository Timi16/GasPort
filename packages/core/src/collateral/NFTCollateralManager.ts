import { Address, Hex, parseAbi, formatEther, parseEther } from 'viem';
import { ChainManager } from '../client/ChainManager';
import { Logger } from '../utils/logger';
import { ChainId } from '@gasport/types';

/**
 * NFT Collateral Position
 */
export interface CollateralPosition {
  positionId: bigint;
  owner: Address;
  nftContract: Address;
  tokenId: bigint;
  depositedAt: bigint;
  borrowedAmount: bigint;
  active: boolean;
}

/**
 * NFT Collateral Manager Configuration
 */
export interface NFTCollateralConfig {
  vaultAddress: Address;
  oracleAddress: Address;
}

/**
 * Floor Price Data
 */
export interface FloorPriceData {
  price: bigint;
  updatedAt: bigint;
  isStale: boolean;
}

/**
 * Manages NFT collateral for gas abstraction
 * Allows users to deposit NFTs to unlock gas credits
 */
export class NFTCollateralManager {
  private chainManager: ChainManager;
  private logger: Logger;
  private config: Map<ChainId, NFTCollateralConfig>;

  // Contract ABIs
  private readonly VAULT_ABI = parseAbi([
    'function depositCollateral(address nftContract, uint256 tokenId) external returns (uint256 positionId)',
    'function withdrawCollateral(uint256 positionId) external',
    'function borrowAgainstCollateral(uint256 positionId, uint256 amount) external',
    'function repay(uint256 positionId, uint256 amount) external payable',
    'function liquidate(uint256 positionId) external',
    'function getAvailableCredit(uint256 positionId) external view returns (uint256)',
    'function getUserTotalCredit(address user) external view returns (uint256)',
    'function positions(uint256 positionId) external view returns (address owner, address nftContract, uint256 tokenId, uint256 depositedAt, uint256 borrowedAmount, bool active)',
    'function userPositions(address user, uint256 index) external view returns (uint256)',
    'function ltvRatio() external view returns (uint256)',
    'function liquidationThreshold() external view returns (uint256)',
    'event CollateralDeposited(uint256 indexed positionId, address indexed owner, address indexed nftContract, uint256 tokenId)',
    'event CollateralWithdrawn(uint256 indexed positionId, address indexed owner, address indexed nftContract, uint256 tokenId)',
    'event BorrowedAgainstCollateral(uint256 indexed positionId, address indexed borrower, uint256 amount)',
  ]);

  private readonly ORACLE_ABI = parseAbi([
    'function getFloorPrice(address nftContract) external view returns (uint256)',
    'function getFloorPriceWithMetadata(address nftContract) external view returns (uint256 price, uint256 updatedAt, bool isStale)',
    'function updateFloorPrice(address nftContract, uint256 newPrice) external',
    'function isCollectionSupported(address nftContract) external view returns (bool)',
    'function isPriceStale(address nftContract) external view returns (bool)',
  ]);

  constructor(
    chainManager: ChainManager,
    logger: Logger,
    config?: Map<ChainId, NFTCollateralConfig>
  ) {
    this.chainManager = chainManager;
    this.logger = logger;
    this.config = config || new Map();
  }

  /**
   * Set collateral config for a chain
   */
  setConfig(chainId: ChainId, config: NFTCollateralConfig): void {
    this.config.set(chainId, config);
    this.logger.info(`NFT collateral config set for chain ${chainId}`);
  }

  /**
   * Deposit NFT as collateral
   */
  async depositNFT(
    chainId: ChainId,
    nftContract: Address,
    tokenId: bigint,
    userAddress: Address
  ): Promise<{ positionId: bigint; txHash: Hex }> {
    this.logger.info(`Depositing NFT ${nftContract}:${tokenId} as collateral on chain ${chainId}`);

    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    // First, check if collection is supported
    const isSupported = await client.readContract({
      address: config.oracleAddress,
      abi: this.ORACLE_ABI,
      functionName: 'isCollectionSupported',
      args: [nftContract],
    });

    if (!isSupported) {
      throw new Error(`NFT collection ${nftContract} is not supported`);
    }

    // User needs to approve NFT to vault first (done separately via wallet)
    // Deposit NFT
    const hash = await client.writeContract({
      address: config.vaultAddress,
      abi: this.VAULT_ABI,
      functionName: 'depositCollateral',
      args: [nftContract, tokenId],
      account: userAddress,
    });

    this.logger.info(`NFT deposit transaction sent: ${hash}`);

    // Wait for transaction
    const receipt = await client.waitForTransactionReceipt({ hash });

    // Extract position ID from event
    let positionId = 0n;
    for (const log of receipt.logs) {
      try {
        const decoded = client.decodeEventLog({
          abi: this.VAULT_ABI,
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName === 'CollateralDeposited') {
          positionId = (decoded.args as any).positionId;
          break;
        }
      } catch {
        // Skip logs that don't match our ABI
      }
    }

    this.logger.info(
      `NFT deposited successfully. Position ID: ${positionId}, Tx: ${hash}`
    );

    return {
      positionId,
      txHash: hash,
    };
  }

  /**
   * Withdraw NFT collateral
   */
  async withdrawNFT(
    chainId: ChainId,
    positionId: bigint,
    userAddress: Address
  ): Promise<Hex> {
    this.logger.info(`Withdrawing NFT from position ${positionId} on chain ${chainId}`);

    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    // Check if position has no debt
    const position = await this.getPosition(chainId, positionId);
    if (position.borrowedAmount > 0n) {
      throw new Error(
        `Cannot withdraw NFT with outstanding debt: ${formatEther(position.borrowedAmount)} ETH`
      );
    }

    const hash = await client.writeContract({
      address: config.vaultAddress,
      abi: this.VAULT_ABI,
      functionName: 'withdrawCollateral',
      args: [positionId],
      account: userAddress,
    });

    this.logger.info(`NFT withdrawal transaction sent: ${hash}`);

    await client.waitForTransactionReceipt({ hash });

    this.logger.info(`NFT withdrawn successfully. Tx: ${hash}`);

    return hash;
  }

  /**
   * Repay borrowed amount against collateral
   */
  async repay(
    chainId: ChainId,
    positionId: bigint,
    amount: bigint,
    userAddress: Address
  ): Promise<Hex> {
    this.logger.info(
      `Repaying ${formatEther(amount)} ETH for position ${positionId} on chain ${chainId}`
    );

    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    const hash = await client.writeContract({
      address: config.vaultAddress,
      abi: this.VAULT_ABI,
      functionName: 'repay',
      args: [positionId, amount],
      account: userAddress,
      value: amount,
    });

    this.logger.info(`Repayment transaction sent: ${hash}`);

    await client.waitForTransactionReceipt({ hash });

    this.logger.info(`Repaid successfully. Tx: ${hash}`);

    return hash;
  }

  /**
   * Get available credit for a position
   */
  async getAvailableCredit(chainId: ChainId, positionId: bigint): Promise<bigint> {
    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    const credit = await client.readContract({
      address: config.vaultAddress,
      abi: this.VAULT_ABI,
      functionName: 'getAvailableCredit',
      args: [positionId],
    });

    return credit;
  }

  /**
   * Get total available credit for a user across all positions
   */
  async getUserTotalCredit(chainId: ChainId, userAddress: Address): Promise<bigint> {
    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    const credit = await client.readContract({
      address: config.vaultAddress,
      abi: this.VAULT_ABI,
      functionName: 'getUserTotalCredit',
      args: [userAddress],
    });

    return credit;
  }

  /**
   * Get collateral position details
   */
  async getPosition(chainId: ChainId, positionId: bigint): Promise<CollateralPosition> {
    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    const result = await client.readContract({
      address: config.vaultAddress,
      abi: this.VAULT_ABI,
      functionName: 'positions',
      args: [positionId],
    });

    const [owner, nftContract, tokenId, depositedAt, borrowedAmount, active] = result as [
      Address,
      Address,
      bigint,
      bigint,
      bigint,
      boolean
    ];

    return {
      positionId,
      owner,
      nftContract,
      tokenId,
      depositedAt,
      borrowedAmount,
      active,
    };
  }

  /**
   * Get NFT floor price
   */
  async getFloorPrice(chainId: ChainId, nftContract: Address): Promise<bigint> {
    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    const price = await client.readContract({
      address: config.oracleAddress,
      abi: this.ORACLE_ABI,
      functionName: 'getFloorPrice',
      args: [nftContract],
    });

    return price;
  }

  /**
   * Get NFT floor price with metadata
   */
  async getFloorPriceWithMetadata(
    chainId: ChainId,
    nftContract: Address
  ): Promise<FloorPriceData> {
    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    const result = await client.readContract({
      address: config.oracleAddress,
      abi: this.ORACLE_ABI,
      functionName: 'getFloorPriceWithMetadata',
      args: [nftContract],
    });

    const [price, updatedAt, isStale] = result as [bigint, bigint, boolean];

    return {
      price,
      updatedAt,
      isStale,
    };
  }

  /**
   * Check if NFT collection is supported
   */
  async isCollectionSupported(chainId: ChainId, nftContract: Address): Promise<boolean> {
    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    const supported = await client.readContract({
      address: config.oracleAddress,
      abi: this.ORACLE_ABI,
      functionName: 'isCollectionSupported',
      args: [nftContract],
    });

    return supported;
  }

  /**
   * Get vault LTV ratio
   */
  async getLTVRatio(chainId: ChainId): Promise<number> {
    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    const ratio = await client.readContract({
      address: config.vaultAddress,
      abi: this.VAULT_ABI,
      functionName: 'ltvRatio',
    });

    // Convert basis points to percentage (5000 => 50%)
    return Number(ratio) / 100;
  }

  /**
   * Get liquidation threshold
   */
  async getLiquidationThreshold(chainId: ChainId): Promise<number> {
    const config = this.config.get(chainId);
    if (!config) {
      throw new Error(`No collateral config for chain ${chainId}`);
    }

    const client = this.chainManager.getClient(chainId);

    const threshold = await client.readContract({
      address: config.vaultAddress,
      abi: this.VAULT_ABI,
      functionName: 'liquidationThreshold',
    });

    // Convert basis points to percentage (7500 => 75%)
    return Number(threshold) / 100;
  }

  /**
   * Calculate max borrowable amount for an NFT
   */
  async calculateMaxBorrow(chainId: ChainId, nftContract: Address): Promise<bigint> {
    const floorPrice = await this.getFloorPrice(chainId, nftContract);
    const ltvRatio = await this.getLTVRatio(chainId);

    // maxBorrow = floorPrice * (ltvRatio / 100)
    const maxBorrow = (floorPrice * BigInt(ltvRatio)) / 100n;

    return maxBorrow;
  }

  /**
   * Check if a position is at risk of liquidation
   */
  async isAtRiskOfLiquidation(
    chainId: ChainId,
    positionId: bigint
  ): Promise<{ atRisk: boolean; healthFactor: number }> {
    const position = await this.getPosition(chainId, positionId);

    if (!position.active || position.borrowedAmount === 0n) {
      return { atRisk: false, healthFactor: Infinity };
    }

    const floorPrice = await this.getFloorPrice(chainId, position.nftContract);
    const liquidationThreshold = await this.getLiquidationThreshold(chainId);

    // Calculate liquidation value
    const liquidationValue = (floorPrice * BigInt(liquidationThreshold)) / 100n;

    // Health factor = liquidationValue / borrowedAmount
    // If < 1, position is liquidatable
    const healthFactor = Number(liquidationValue) / Number(position.borrowedAmount);

    return {
      atRisk: healthFactor < 1.2, // 20% buffer
      healthFactor,
    };
  }
}
