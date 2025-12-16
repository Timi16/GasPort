import type { ChainId } from '@gasport/types';
import type { ChainManager } from '../client/ChainManager';
import type { Logger } from 'pino';
import { getContract } from 'viem';

/**
 * Liquidity information for a token on a chain
 */
export interface LiquidityInfo {
  chainId: ChainId;
  token: `0x${string}`;
  available: bigint;
  reserved: bigint;
  total: bigint;
  utilizationRate: number; // 0-1
  timestamp: number;
}

/**
 * Checks liquidity availability across chains for routing
 */
export class LiquidityChecker {
  private chainManager: ChainManager;
  private logger: Logger;
  private cache: Map<string, LiquidityInfo>;
  private cacheTTL: number;

  constructor(chainManager: ChainManager, logger: Logger, cacheTTL = 10000) {
    this.chainManager = chainManager;
    this.logger = logger;
    this.cache = new Map();
    this.cacheTTL = cacheTTL; // 10 seconds default
  }

  /**
   * Check if sufficient liquidity exists for a token on a chain
   */
  async hasLiquidity(chainId: ChainId, token: `0x${string}`, amount: bigint): Promise<boolean> {
    try {
      const liquidity = await this.getLiquidity(chainId, token);
      const hasEnough = liquidity.available >= amount;

      this.logger.debug('Liquidity check', {
        chainId,
        token,
        amount: amount.toString(),
        available: liquidity.available.toString(),
        hasEnough,
      });

      return hasEnough;
    } catch (error) {
      this.logger.error('Liquidity check failed', { chainId, token, error });
      return false;
    }
  }

  /**
   * Get liquidity information for a token on a chain
   */
  async getLiquidity(chainId: ChainId, token: `0x${string}`): Promise<LiquidityInfo> {
    const cacheKey = `${chainId}-${token}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      this.logger.debug('Liquidity cache hit', { chainId, token });
      return cached;
    }

    // Fetch fresh data
    this.logger.debug('Fetching liquidity', { chainId, token });
    return this.fetchLiquidity(chainId, token);
  }

  /**
   * Fetch liquidity from Treasury contract
   */
  private async fetchLiquidity(chainId: ChainId, token: `0x${string}`): Promise<LiquidityInfo> {
    try {
      const chain = this.chainManager.getChain(chainId);
      const client = this.chainManager.getClient(chainId);

      if (!chain.treasuryAddress) {
        throw new Error(`Treasury address not configured for chain ${chainId}`);
      }

      // Get Treasury contract
      const treasury = getContract({
        address: chain.treasuryAddress,
        abi: TREASURY_ABI,
        client,
      });

      // Read liquidity data from Treasury
      const [totalLiquidity, totalShares] = await Promise.all([
        treasury.read.totalLiquidity([token]) as Promise<bigint>,
        treasury.read.totalShares([token]) as Promise<bigint>,
      ]);

      // For simplicity, assume 80% is available, 20% reserved
      // In production, this would query actual available vs reserved amounts
      const available = (totalLiquidity * 80n) / 100n;
      const reserved = (totalLiquidity * 20n) / 100n;
      const utilizationRate = totalShares > 0n ? Number(reserved) / Number(totalLiquidity) : 0;

      const liquidityInfo: LiquidityInfo = {
        chainId,
        token,
        available,
        reserved,
        total: totalLiquidity,
        utilizationRate,
        timestamp: Date.now(),
      };

      // Update cache
      this.cache.set(`${chainId}-${token}`, liquidityInfo);

      this.logger.debug('Liquidity fetched', {
        chainId,
        token,
        available: available.toString(),
        total: totalLiquidity.toString(),
      });

      return liquidityInfo;
    } catch (error) {
      this.logger.error('Failed to fetch liquidity', { chainId, token, error });

      // Return zero liquidity on error
      return {
        chainId,
        token,
        available: 0n,
        reserved: 0n,
        total: 0n,
        utilizationRate: 1,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Check liquidity across multiple chains
   */
  async checkMultipleChains(
    chains: ChainId[],
    token: `0x${string}`,
    amount: bigint
  ): Promise<Map<ChainId, boolean>> {
    const results = new Map<ChainId, boolean>();

    await Promise.all(
      chains.map(async (chainId) => {
        const hasEnough = await this.hasLiquidity(chainId, token, amount);
        results.set(chainId, hasEnough);
      })
    );

    return results;
  }

  /**
   * Get total liquidity across all chains
   */
  async getTotalLiquidity(chains: ChainId[], token: `0x${string}`): Promise<bigint> {
    const liquidities = await Promise.all(
      chains.map((chainId) => this.getLiquidity(chainId, token))
    );

    return liquidities.reduce((sum, info) => sum + info.available, 0n);
  }

  /**
   * Find chains with sufficient liquidity
   */
  async findChainsWithLiquidity(
    chains: ChainId[],
    token: `0x${string}`,
    minAmount: bigint
  ): Promise<ChainId[]> {
    const checks = await this.checkMultipleChains(chains, token, minAmount);

    return Array.from(checks.entries())
      .filter(([_, hasLiquidity]) => hasLiquidity)
      .map(([chainId]) => chainId);
  }

  /**
   * Clear cache
   */
  clearCache(chainId?: ChainId, token?: `0x${string}`): void {
    if (chainId && token) {
      const key = `${chainId}-${token}`;
      this.cache.delete(key);
      this.logger.debug('Cleared liquidity cache', { chainId, token });
    } else {
      this.cache.clear();
      this.logger.debug('Cleared all liquidity cache');
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.cache.clear();
    this.logger.debug('LiquidityChecker destroyed');
  }
}

/**
 * Treasury ABI (minimal for liquidity checking)
 */
const TREASURY_ABI = [
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'totalLiquidity',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'totalShares',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
