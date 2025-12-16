import type { ChainId } from '@gasport/types';
import type { ChainManager } from '../client/ChainManager';
import type { Logger } from 'pino';
import { getContract } from 'viem';

/**
 * Price feed data
 */
export interface PriceFeed {
  /** Price in USD (8 decimals) */
  price: bigint;
  /** Decimals */
  decimals: number;
  /** Timestamp */
  timestamp: number;
  /** Round ID */
  roundId: bigint;
}

/**
 * Price oracle type
 */
export type OracleType = 'chainlink' | 'pyth' | 'uniswap-twap';

/**
 * Price oracle with multiple data sources
 */
export class PriceOracle {
  private chainManager: ChainManager;
  private logger: Logger;
  private priceCache: Map<string, { feed: PriceFeed; expiresAt: number }>;
  private cacheTTL: number;

  constructor(chainManager: ChainManager, logger: Logger, cacheTTL = 60000) {
    this.chainManager = chainManager;
    this.logger = logger;
    this.priceCache = new Map();
    this.cacheTTL = cacheTTL; // 1 minute default
  }

  /**
   * Get token price in USD
   */
  async getTokenPrice(
    token: `0x${string}`,
    chainId: ChainId,
    oracle: OracleType = 'chainlink'
  ): Promise<number> {
    const cacheKey = `${chainId}-${token}`;

    // Check cache
    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this.logger.debug('Price cache hit', { token, chainId });
      return this.formatPrice(cached.feed);
    }

    // Fetch fresh price
    this.logger.debug('Fetching token price', { token, chainId, oracle });

    const feed = await this.fetchPrice(token, chainId, oracle);

    // Cache the result
    this.priceCache.set(cacheKey, {
      feed,
      expiresAt: Date.now() + this.cacheTTL,
    });

    return this.formatPrice(feed);
  }

  /**
   * Get multiple token prices
   */
  async getTokenPrices(
    tokens: `0x${string}`[],
    chainId: ChainId
  ): Promise<Map<`0x${string}`, number>> {
    const prices = new Map<`0x${string}`, number>();

    await Promise.all(
      tokens.map(async (token) => {
        try {
          const price = await this.getTokenPrice(token, chainId);
          prices.set(token, price);
        } catch (error) {
          this.logger.warn('Failed to get price for token', { token, error });
        }
      })
    );

    return prices;
  }

  /**
   * Fetch price from oracle
   */
  private async fetchPrice(
    token: `0x${string}`,
    chainId: ChainId,
    oracle: OracleType
  ): Promise<PriceFeed> {
    switch (oracle) {
      case 'chainlink':
        return this.getChainlinkPrice(token, chainId);
      case 'pyth':
        return this.getPythPrice(token, chainId);
      case 'uniswap-twap':
        return this.getUniswapTWAP(token, chainId);
      default:
        throw new Error(`Unsupported oracle: ${oracle}`);
    }
  }

  /**
   * Get price from Chainlink
   */
  private async getChainlinkPrice(
    token: `0x${string}`,
    chainId: ChainId
  ): Promise<PriceFeed> {
    try {
      const client = this.chainManager.getClient(chainId);

      // Get Chainlink price feed address for token
      const feedAddress = this.getChainlinkFeed(token, chainId);

      if (!feedAddress) {
        throw new Error(`No Chainlink feed for token ${token} on chain ${chainId}`);
      }

      const priceFeed = getContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        client,
      });

      // Get latest round data
      const result = (await priceFeed.read.latestRoundData()) as [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint
      ];

      const [roundId, price, , timestamp] = result;

      // Get decimals
      const decimals = (await priceFeed.read.decimals()) as number;

      this.logger.debug('Chainlink price fetched', {
        token,
        price: price.toString(),
        decimals,
        timestamp: Number(timestamp),
      });

      return {
        price,
        decimals,
        timestamp: Number(timestamp),
        roundId,
      };
    } catch (error) {
      this.logger.error('Failed to fetch Chainlink price', { token, chainId, error });
      throw error;
    }
  }

  /**
   * Get price from Pyth Network
   */
  private async getPythPrice(
    token: `0x${string}`,
    chainId: ChainId
  ): Promise<PriceFeed> {
    try {
      const client = this.chainManager.getClient(chainId);

      // Get Pyth contract address
      const pythAddress = this.getPythAddress(chainId);

      if (!pythAddress) {
        throw new Error(`Pyth not available on chain ${chainId}`);
      }

      // Get price ID for token
      const priceId = this.getPythPriceId(token, chainId);

      if (!priceId) {
        throw new Error(`No Pyth price ID for token ${token}`);
      }

      const pyth = getContract({
        address: pythAddress,
        abi: PYTH_ABI,
        client,
      });

      // Get current price
      const priceData = (await pyth.read.getPriceUnsafe([priceId])) as {
        price: bigint;
        conf: bigint;
        expo: number;
        publishTime: bigint;
      };

      // Pyth uses expo (negative exponent) instead of decimals
      const decimals = Math.abs(priceData.expo);

      return {
        price: priceData.price,
        decimals,
        timestamp: Number(priceData.publishTime),
        roundId: 0n,
      };
    } catch (error) {
      this.logger.error('Failed to fetch Pyth price', { token, chainId, error });
      throw error;
    }
  }

  /**
   * Get price from Uniswap TWAP
   */
  private async getUniswapTWAP(
    token: `0x${string}`,
    chainId: ChainId
  ): Promise<PriceFeed> {
    try {
      // TODO: Implement Uniswap V3 TWAP oracle
      // This requires:
      // 1. Finding the appropriate pool
      // 2. Reading TWAP observations
      // 3. Calculating time-weighted average price

      this.logger.warn('Uniswap TWAP not implemented, using mock price');

      return {
        price: 2000n * 10n ** 8n, // Mock $2000
        decimals: 8,
        timestamp: Math.floor(Date.now() / 1000),
        roundId: 0n,
      };
    } catch (error) {
      this.logger.error('Failed to fetch Uniswap TWAP', { token, chainId, error });
      throw error;
    }
  }

  /**
   * Format price feed to USD number
   */
  private formatPrice(feed: PriceFeed): number {
    const price = Number(feed.price) / 10 ** feed.decimals;
    return price;
  }

  /**
   * Get Chainlink feed address for token
   */
  private getChainlinkFeed(token: `0x${string}`, chainId: ChainId): `0x${string}` | null {
    // Chainlink feed addresses per chain and token
    const feeds: Record<number, Record<string, `0x${string}`>> = {
      // Arbitrum One
      42161: {
        // ETH/USD
        '0x0000000000000000000000000000000000000000': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
        // ARB/USD
        '0x912CE59144191C1204E64559FE8253a0e49E6548': '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6',
        // USDC/USD
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
      },
    };

    const tokenLower = token.toLowerCase() as `0x${string}`;
    return feeds[chainId]?.[tokenLower] || null;
  }

  /**
   * Get Pyth contract address for chain
   */
  private getPythAddress(chainId: ChainId): `0x${string}` | null {
    const addresses: Record<number, `0x${string}`> = {
      42161: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C', // Arbitrum One
      42170: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C', // Arbitrum Nova
    };

    return addresses[chainId] || null;
  }

  /**
   * Get Pyth price ID for token
   */
  private getPythPriceId(token: `0x${string}`, chainId: ChainId): `0x${string}` | null {
    // Pyth price IDs are 32-byte hex strings
    // These are examples - real IDs need to be looked up from Pyth docs
    const priceIds: Record<string, `0x${string}`> = {
      // ETH/USD
      '0x0000000000000000000000000000000000000000':
        '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
      // ARB/USD
      '0x912CE59144191C1204E64559FE8253a0e49E6548':
        '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5',
    };

    const tokenLower = token.toLowerCase() as `0x${string}`;
    return priceIds[tokenLower] || null;
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
    this.logger.debug('Price cache cleared');
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.priceCache.clear();
    this.logger.debug('PriceOracle destroyed');
  }
}

/**
 * Chainlink Aggregator ABI
 */
const CHAINLINK_AGGREGATOR_ABI = [
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Pyth Network ABI (minimal)
 */
const PYTH_ABI = [
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'getPriceUnsafe',
    outputs: [
      {
        components: [
          { name: 'price', type: 'int64' },
          { name: 'conf', type: 'uint64' },
          { name: 'expo', type: 'int32' },
          { name: 'publishTime', type: 'uint256' },
        ],
        name: 'price',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
