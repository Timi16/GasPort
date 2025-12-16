import type { ChainId } from '@gasport/types';
import type { ChainManager } from '../client/ChainManager';
import type { Logger } from 'pino';
import { encodeFunctionData, getContract, type Hex } from 'viem';

/**
 * Swap quote
 */
export interface SwapQuote {
  /** Input token */
  tokenIn: `0x${string}`;
  /** Output token */
  tokenOut: `0x${string}`;
  /** Amount in */
  amountIn: bigint;
  /** Expected amount out */
  amountOut: bigint;
  /** Minimum amount out (with slippage) */
  minAmountOut: bigint;
  /** Price impact percentage (0-100) */
  priceImpact: number;
  /** Route taken */
  route: `0x${string}`[];
  /** Estimated gas cost */
  gasEstimate: bigint;
  /** Quote expiry timestamp */
  expiresAt: number;
  /** Quote ID */
  quoteId: string;
}

/**
 * Swap result
 */
export interface SwapResult {
  txHash: Hex;
  amountIn: bigint;
  amountOut: bigint;
  gasUsed: bigint;
}

/**
 * DEX type
 */
export type DEXType = 'uniswap-v3' | 'uniswap-v2' | 'camelot' | 'sushiswap';

/**
 * Token swapper with DEX integration
 */
export class TokenSwapper {
  private chainManager: ChainManager;
  private logger: Logger;
  private defaultSlippage: number;
  private quotes: Map<string, SwapQuote>;

  constructor(chainManager: ChainManager, logger: Logger, defaultSlippage = 1.0) {
    this.chainManager = chainManager;
    this.logger = logger;
    this.defaultSlippage = defaultSlippage; // 1% default
    this.quotes = new Map();
  }

  /**
   * Get swap quote from DEX
   */
  async getSwapQuote(
    chainId: ChainId,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint,
    options?: {
      slippage?: number;
      dex?: DEXType;
    }
  ): Promise<SwapQuote> {
    this.logger.info('Getting swap quote', {
      chainId,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
    });

    try {
      const slippage = options?.slippage || this.defaultSlippage;
      const dex = options?.dex || this.selectBestDEX(chainId);

      // Get quote from DEX
      const { amountOut, route, priceImpact } = await this.fetchQuoteFromDEX(
        chainId,
        tokenIn,
        tokenOut,
        amountIn,
        dex
      );

      // Calculate min amount out with slippage
      const minAmountOut = (amountOut * BigInt(Math.floor((100 - slippage) * 100))) / 10000n;

      // Estimate gas
      const gasEstimate = await this.estimateSwapGas(chainId, tokenIn, tokenOut, amountIn, dex);

      // Create quote
      const quoteId = this.generateQuoteId();
      const quote: SwapQuote = {
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        minAmountOut,
        priceImpact,
        route,
        gasEstimate,
        expiresAt: Date.now() + 60000, // 1 minute
        quoteId,
      };

      // Store quote
      this.quotes.set(quoteId, quote);

      this.logger.info('Swap quote generated', {
        quoteId,
        amountOut: amountOut.toString(),
        priceImpact,
      });

      return quote;
    } catch (error) {
      this.logger.error('Failed to get swap quote', { error });
      throw error;
    }
  }

  /**
   * Execute swap using quote
   */
  async executeSwap(
    chainId: ChainId,
    quote: SwapQuote,
    recipient: `0x${string}`
  ): Promise<SwapResult> {
    this.logger.info('Executing swap', { quoteId: quote.quoteId, recipient });

    try {
      // Validate quote not expired
      if (Date.now() > quote.expiresAt) {
        throw new Error(`Quote ${quote.quoteId} expired`);
      }

      // Execute swap on DEX
      const txHash = await this.executeSwapOnDEX(chainId, quote, recipient);

      // Wait for confirmation
      const client = this.chainManager.getClient(chainId);
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });

      // Parse logs to get actual amount out
      const amountOut = await this.parseSwapOutput(receipt);

      const result: SwapResult = {
        txHash,
        amountIn: quote.amountIn,
        amountOut,
        gasUsed: receipt.gasUsed,
      };

      // Remove quote
      this.quotes.delete(quote.quoteId);

      this.logger.info('Swap executed successfully', {
        txHash,
        amountOut: amountOut.toString(),
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to execute swap', { error });
      throw error;
    }
  }

  /**
   * Fetch quote from specific DEX
   */
  private async fetchQuoteFromDEX(
    chainId: ChainId,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint,
    dex: DEXType
  ): Promise<{ amountOut: bigint; route: `0x${string}`[]; priceImpact: number }> {
    switch (dex) {
      case 'uniswap-v3':
        return this.getUniswapV3Quote(chainId, tokenIn, tokenOut, amountIn);
      case 'uniswap-v2':
        return this.getUniswapV2Quote(chainId, tokenIn, tokenOut, amountIn);
      case 'camelot':
        return this.getCamelotQuote(chainId, tokenIn, tokenOut, amountIn);
      case 'sushiswap':
        return this.getSushiswapQuote(chainId, tokenIn, tokenOut, amountIn);
      default:
        throw new Error(`Unsupported DEX: ${dex}`);
    }
  }

  /**
   * Get Uniswap V3 quote
   */
  private async getUniswapV3Quote(
    chainId: ChainId,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint
  ): Promise<{ amountOut: bigint; route: `0x${string}`[]; priceImpact: number }> {
    try {
      const client = this.chainManager.getClient(chainId);

      // Get Uniswap V3 Quoter contract
      const quoterAddress = this.getQuoterAddress(chainId, 'uniswap-v3');

      const quoter = getContract({
        address: quoterAddress,
        abi: UNISWAP_V3_QUOTER_ABI,
        client,
      });

      // Quote exact input single (most common case)
      // In production, you'd want to check multiple fee tiers (500, 3000, 10000)
      const params = {
        tokenIn,
        tokenOut,
        fee: 3000, // 0.3% fee tier
        amountIn,
        sqrtPriceLimitX96: 0n,
      };

      const result = (await quoter.read.quoteExactInputSingle([params])) as [bigint, bigint, bigint, bigint];
      const amountOut = result[0];

      // Calculate price impact (simplified)
      const priceImpact = this.calculatePriceImpact(amountIn, amountOut);

      return {
        amountOut,
        route: [tokenIn, tokenOut],
        priceImpact,
      };
    } catch (error) {
      this.logger.error('Uniswap V3 quote failed', { error });
      throw error;
    }
  }

  /**
   * Get Uniswap V2 quote
   */
  private async getUniswapV2Quote(
    chainId: ChainId,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint
  ): Promise<{ amountOut: bigint; route: `0x${string}`[]; priceImpact: number }> {
    try {
      const client = this.chainManager.getClient(chainId);

      const routerAddress = this.getRouterAddress(chainId, 'uniswap-v2');

      const router = getContract({
        address: routerAddress,
        abi: UNISWAP_V2_ROUTER_ABI,
        client,
      });

      // Get amounts out
      const path = [tokenIn, tokenOut];
      const amounts = (await router.read.getAmountsOut([amountIn, path])) as bigint[];
      const amountOut = amounts[amounts.length - 1];

      const priceImpact = this.calculatePriceImpact(amountIn, amountOut);

      return {
        amountOut,
        route: path,
        priceImpact,
      };
    } catch (error) {
      this.logger.error('Uniswap V2 quote failed', { error });
      throw error;
    }
  }

  /**
   * Get Camelot quote (Arbitrum specific)
   */
  private async getCamelotQuote(
    chainId: ChainId,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint
  ): Promise<{ amountOut: bigint; route: `0x${string}`[]; priceImpact: number }> {
    // Camelot uses similar interface to Uniswap V2
    return this.getUniswapV2Quote(chainId, tokenIn, tokenOut, amountIn);
  }

  /**
   * Get Sushiswap quote
   */
  private async getSushiswapQuote(
    chainId: ChainId,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint
  ): Promise<{ amountOut: bigint; route: `0x${string}`[]; priceImpact: number }> {
    return this.getUniswapV2Quote(chainId, tokenIn, tokenOut, amountIn);
  }

  /**
   * Execute swap on DEX
   */
  private async executeSwapOnDEX(
    chainId: ChainId,
    quote: SwapQuote,
    recipient: `0x${string}`
  ): Promise<Hex> {
    // TODO: Implement actual swap execution
    // This would involve:
    // 1. Get user's wallet client
    // 2. Approve tokens if needed
    // 3. Call swap function on DEX router
    // 4. Return transaction hash

    // Simulate for now
    this.logger.debug('Simulating swap execution', { quoteId: quote.quoteId });
    return `0x${'1'.repeat(64)}` as Hex;
  }

  /**
   * Parse swap output from receipt
   */
  private async parseSwapOutput(receipt: any): Promise<bigint> {
    // TODO: Parse Transfer events from receipt to get actual output amount
    // For now, return simulated value
    return 1000000n;
  }

  /**
   * Estimate gas for swap
   */
  private async estimateSwapGas(
    chainId: ChainId,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint,
    dex: DEXType
  ): Promise<bigint> {
    // Standard estimates
    const gasEstimates: Record<DEXType, bigint> = {
      'uniswap-v3': 150000n,
      'uniswap-v2': 120000n,
      'camelot': 120000n,
      'sushiswap': 120000n,
    };

    return gasEstimates[dex];
  }

  /**
   * Calculate price impact
   */
  private calculatePriceImpact(amountIn: bigint, amountOut: bigint): number {
    // Simplified price impact calculation
    // In production, would compare to spot price
    const ratio = Number(amountOut) / Number(amountIn);
    const impact = ((1 - ratio) * 100);
    return Math.abs(impact);
  }

  /**
   * Select best DEX for a chain
   */
  private selectBestDEX(chainId: ChainId): DEXType {
    // Chain-specific DEX preferences
    switch (chainId) {
      case 42161: // Arbitrum One
      case 42170: // Arbitrum Nova
        return 'camelot'; // Camelot is native to Arbitrum
      default:
        return 'uniswap-v3'; // Default to Uniswap V3
    }
  }

  /**
   * Get quoter address for DEX
   */
  private getQuoterAddress(chainId: ChainId, dex: DEXType): `0x${string}` {
    // TODO: Add real addresses per chain
    const addresses: Record<number, Record<DEXType, `0x${string}`>> = {
      42161: {
        'uniswap-v3': '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' as `0x${string}`,
        'uniswap-v2': '0x0000000000000000000000000000000000000000' as `0x${string}`,
        'camelot': '0x0000000000000000000000000000000000000000' as `0x${string}`,
        'sushiswap': '0x0000000000000000000000000000000000000000' as `0x${string}`,
      },
    };

    return addresses[chainId]?.[dex] || ('0x0000000000000000000000000000000000000000' as `0x${string}`);
  }

  /**
   * Get router address for DEX
   */
  private getRouterAddress(chainId: ChainId, dex: DEXType): `0x${string}` {
    // TODO: Add real addresses per chain
    return '0x0000000000000000000000000000000000000000' as `0x${string}`;
  }

  /**
   * Generate unique quote ID
   */
  private generateQuoteId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear expired quotes
   */
  clearExpiredQuotes(): void {
    const now = Date.now();
    for (const [id, quote] of this.quotes) {
      if (quote.expiresAt < now) {
        this.quotes.delete(id);
      }
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.quotes.clear();
    this.logger.debug('TokenSwapper destroyed');
  }
}

/**
 * Uniswap V3 Quoter ABI (minimal)
 */
const UNISWAP_V3_QUOTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/**
 * Uniswap V2 Router ABI (minimal)
 */
const UNISWAP_V2_ROUTER_ABI = [
  {
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    name: 'getAmountsOut',
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
