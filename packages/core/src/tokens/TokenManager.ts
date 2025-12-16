import {
  type ChainId,
  type TokenConfig,
  type TokenInfo,
  type TokenBalance,
  TokenNotSupportedError,
  SUPPORTED_TOKENS,
} from '@gasport/types';
import type { ChainManager } from '../client/ChainManager';
import type { Logger } from 'pino';
import { getContract, formatUnits } from 'viem';

/**
 * Manages tokens across multiple chains
 */
export class TokenManager {
  private chainManager: ChainManager;
  private logger: Logger;
  private supportedTokens: Map<string, TokenConfig>;
  private priceCache: Map<string, { price: number; timestamp: number }>;
  private priceCacheTTL: number;

  constructor(chainManager: ChainManager, logger: Logger, tokens?: TokenConfig[]) {
    this.chainManager = chainManager;
    this.logger = logger;
    this.supportedTokens = new Map();
    this.priceCache = new Map();
    this.priceCacheTTL = 60000; // 1 minute

    // Initialize with default tokens
    const tokensToAdd = tokens || Object.values(SUPPORTED_TOKENS);
    for (const token of tokensToAdd) {
      this.supportedTokens.set(token.symbol, token);
    }

    this.logger.debug('TokenManager initialized', {
      tokens: Array.from(this.supportedTokens.keys()),
    });
  }

  /**
   * Get token configuration
   */
  getToken(symbol: string): TokenConfig {
    const token = this.supportedTokens.get(symbol);
    if (!token) {
      throw new TokenNotSupportedError(symbol);
    }
    return token;
  }

  /**
   * Get token address for a specific chain
   */
  getTokenAddress(symbol: string, chainId: ChainId): `0x${string}` {
    const token = this.getToken(symbol);
    const address = token.addresses[chainId];

    if (!address) {
      throw new TokenNotSupportedError(symbol, chainId);
    }

    return address;
  }

  /**
   * Get supported tokens for a chain
   */
  getSupportedTokens(chainId: ChainId): TokenInfo[] {
    const tokens: TokenInfo[] = [];

    for (const [symbol, config] of this.supportedTokens) {
      if (config.addresses[chainId]) {
        tokens.push({
          config,
          priceUSD: this.getCachedPrice(symbol),
        });
      }
    }

    return tokens;
  }

  /**
   * Get token balance for an address
   */
  async getTokenBalance(
    token: string,
    chainId: ChainId,
    userAddress: `0x${string}`
  ): Promise<TokenBalance> {
    const tokenConfig = this.getToken(token);
    const tokenAddress = this.getTokenAddress(token, chainId);

    this.logger.debug('Getting token balance', { token, chainId, userAddress });

    try {
      const client = this.chainManager.getClient(chainId);

      // Special case for native token (ETH)
      let balance: bigint;
      if (tokenAddress === '0x0000000000000000000000000000000000000000') {
        balance = await client.getBalance({ address: userAddress });
      } else {
        // ERC20 token
        const contract = getContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          client,
        });

        balance = (await contract.read.balanceOf([userAddress])) as bigint;
      }

      // Format balance
      const balanceFormatted = formatUnits(balance, tokenConfig.decimals);

      // Get price
      const priceUSD = await this.getTokenPrice(token);

      // Calculate value
      const valueUSD = priceUSD ? parseFloat(balanceFormatted) * priceUSD : undefined;

      return {
        token,
        address: tokenAddress,
        chainId,
        balance,
        balanceFormatted,
        priceUSD,
        valueUSD,
      };
    } catch (error) {
      this.logger.error('Failed to get token balance', { token, chainId, error });
      throw error;
    }
  }

  /**
   * Get balances for all supported tokens
   */
  async getAllBalances(chainId: ChainId, userAddress: `0x${string}`): Promise<TokenBalance[]> {
    const supportedTokens = this.getSupportedTokens(chainId);
    const balances: TokenBalance[] = [];

    await Promise.all(
      supportedTokens.map(async (tokenInfo) => {
        try {
          const balance = await this.getTokenBalance(
            tokenInfo.config.symbol,
            chainId,
            userAddress
          );
          balances.push(balance);
        } catch (error) {
          this.logger.warn('Failed to get balance for token', {
            token: tokenInfo.config.symbol,
            error,
          });
        }
      })
    );

    return balances;
  }

  /**
   * Get token price in USD
   */
  async getTokenPrice(symbol: string): Promise<number> {
    // Check cache first
    const cached = this.getCachedPrice(symbol);
    if (cached !== undefined) {
      return cached;
    }

    // Fetch fresh price
    return this.fetchTokenPrice(symbol);
  }

  /**
   * Get cached price
   */
  private getCachedPrice(symbol: string): number | undefined {
    const cached = this.priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.priceCacheTTL) {
      return cached.price;
    }
    return undefined;
  }

  /**
   * Fetch token price from oracle
   */
  private async fetchTokenPrice(symbol: string): Promise<number> {
    try {
      // TODO: Implement actual price oracle integration
      // Options:
      // 1. Chainlink price feeds
      // 2. Pyth network
      // 3. CoinGecko API
      // 4. Uniswap TWAP

      // For now, return mock prices
      const mockPrices: Record<string, number> = {
        ETH: 2000,
        USDC: 1,
        USDT: 1,
        DAI: 1,
        ARB: 1.5,
      };

      const price = mockPrices[symbol] || 0;

      // Cache the price
      this.priceCache.set(symbol, {
        price,
        timestamp: Date.now(),
      });

      this.logger.debug('Token price fetched', { symbol, price });

      return price;
    } catch (error) {
      this.logger.error('Failed to fetch token price', { symbol, error });
      return 0;
    }
  }

  /**
   * Approve token spending
   */
  async approveToken(
    token: string,
    chainId: ChainId,
    spender: `0x${string}`,
    amount: bigint
  ): Promise<`0x${string}`> {
    const tokenAddress = this.getTokenAddress(token, chainId);

    this.logger.info('Approving token', {
      token,
      chainId,
      spender,
      amount: amount.toString(),
    });

    try {
      const client = this.chainManager.getClient(chainId);

      // TODO: Implement actual approval transaction
      // This would involve:
      // 1. Get user's wallet client
      // 2. Call approve on token contract
      // 3. Wait for transaction confirmation
      // 4. Return transaction hash

      // Simulate for now
      const txHash = `0x${'a'.repeat(64)}` as `0x${string}`;

      this.logger.info('Token approved', { token, txHash });

      return txHash;
    } catch (error) {
      this.logger.error('Token approval failed', { token, error });
      throw error;
    }
  }

  /**
   * Check token allowance
   */
  async getTokenAllowance(
    token: string,
    chainId: ChainId,
    owner: `0x${string}`,
    spender: `0x${string}`
  ): Promise<bigint> {
    const tokenAddress = this.getTokenAddress(token, chainId);

    try {
      const client = this.chainManager.getClient(chainId);

      const contract = getContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        client,
      });

      const allowance = (await contract.read.allowance([owner, spender])) as bigint;

      this.logger.debug('Token allowance checked', {
        token,
        allowance: allowance.toString(),
      });

      return allowance;
    } catch (error) {
      this.logger.error('Failed to check allowance', { token, error });
      return 0n;
    }
  }

  /**
   * Add a new supported token
   */
  addToken(token: TokenConfig): void {
    this.supportedTokens.set(token.symbol, token);
    this.logger.info('Token added', { symbol: token.symbol });
  }

  /**
   * Remove a supported token
   */
  removeToken(symbol: string): void {
    this.supportedTokens.delete(symbol);
    this.priceCache.delete(symbol);
    this.logger.info('Token removed', { symbol });
  }

  /**
   * Clear price cache
   */
  clearPriceCache(): void {
    this.priceCache.clear();
    this.logger.debug('Price cache cleared');
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.supportedTokens.clear();
    this.priceCache.clear();
    this.logger.debug('TokenManager destroyed');
  }
}

/**
 * ERC20 ABI (minimal)
 */
const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
