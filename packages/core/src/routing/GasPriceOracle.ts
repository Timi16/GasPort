import { ChainId, ChainNotSupportedError, RPCError } from '@gasport/types';
import type { ChainManager } from '../client/ChainManager';
import type { Logger } from 'pino';
import { EventEmitter } from 'eventemitter3';

/**
 * Gas price data
 */
export interface GasPrice {
  /** Chain ID */
  chainId: ChainId;
  /** Gas price in wei */
  gasPrice: bigint;
  /** Base fee (EIP-1559) */
  baseFee?: bigint;
  /** Priority fee (EIP-1559) */
  priorityFee?: bigint;
  /** Timestamp when fetched */
  timestamp: number;
}

/**
 * Gas price history entry
 */
export interface GasPriceHistory {
  timestamp: number;
  gasPrice: bigint;
  baseFee?: bigint;
  priorityFee?: bigint;
}

/**
 * Real-time gas price oracle with caching and predictions
 */
export class GasPriceOracle extends EventEmitter {
  private chainManager: ChainManager;
  private logger: Logger;
  private cache: Map<ChainId, GasPrice>;
  private history: Map<ChainId, GasPriceHistory[]>;
  private cacheTTL: number;
  private historyLimit: number;
  private updateIntervals: Map<ChainId, NodeJS.Timeout>;

  constructor(chainManager: ChainManager, logger: Logger, cacheTTL = 5000) {
    super();
    this.chainManager = chainManager;
    this.logger = logger;
    this.cache = new Map();
    this.history = new Map();
    this.updateIntervals = new Map();
    this.cacheTTL = cacheTTL; // 5 seconds default
    this.historyLimit = 100; // Keep last 100 data points
  }

  /**
   * Get current gas price for a chain
   * Uses cache if available and fresh
   */
  async getCurrentGasPrice(chainId: ChainId): Promise<GasPrice> {
    // Check cache first
    const cached = this.cache.get(chainId);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      this.logger.debug('Gas price cache hit', { chainId });
      return cached;
    }

    // Fetch fresh data
    this.logger.debug('Fetching fresh gas price', { chainId });
    return this.fetchGasPrice(chainId);
  }

  /**
   * Fetch gas price from RPC
   */
  private async fetchGasPrice(chainId: ChainId): Promise<GasPrice> {
    try {
      const client = this.chainManager.getClient(chainId);

      // Get gas price (works for both legacy and EIP-1559)
      const gasPrice = await client.getGasPrice();

      // Try to get EIP-1559 data if available
      let baseFee: bigint | undefined;
      let priorityFee: bigint | undefined;

      try {
        const block = await client.getBlock({ blockTag: 'latest' });
        baseFee = block.baseFeePerGas;

        // Estimate priority fee (typically 1-2 gwei)
        if (baseFee) {
          priorityFee = gasPrice - baseFee;
        }
      } catch (error) {
        // EIP-1559 not supported, use legacy gas price
        this.logger.debug('EIP-1559 not available for chain', { chainId });
      }

      const gasPriceData: GasPrice = {
        chainId,
        gasPrice,
        baseFee,
        priorityFee,
        timestamp: Date.now(),
      };

      // Update cache
      this.cache.set(chainId, gasPriceData);

      // Update history
      this.addToHistory(chainId, gasPriceData);

      // Emit event
      this.emit('gasPrice:updated', gasPriceData);

      this.logger.debug('Gas price fetched', {
        chainId,
        gasPrice: gasPrice.toString(),
        baseFee: baseFee?.toString(),
      });

      return gasPriceData;
    } catch (error) {
      this.logger.error('Failed to fetch gas price', { chainId, error });
      throw new RPCError(`Failed to fetch gas price: ${(error as Error).message}`, chainId);
    }
  }

  /**
   * Add gas price to history
   */
  private addToHistory(chainId: ChainId, gasPrice: GasPrice): void {
    let history = this.history.get(chainId);
    if (!history) {
      history = [];
      this.history.set(chainId, history);
    }

    history.push({
      timestamp: gasPrice.timestamp,
      gasPrice: gasPrice.gasPrice,
      baseFee: gasPrice.baseFee,
      priorityFee: gasPrice.priorityFee,
    });

    // Keep only last N entries
    if (history.length > this.historyLimit) {
      history.shift();
    }
  }

  /**
   * Get gas price history for a chain
   */
  getGasPriceHistory(chainId: ChainId, period?: number): GasPriceHistory[] {
    const history = this.history.get(chainId) || [];

    if (!period) {
      return history;
    }

    // Filter by time period
    const cutoff = Date.now() - period;
    return history.filter((h) => h.timestamp >= cutoff);
  }

  /**
   * Predict gas price for the next N minutes
   * Uses simple moving average for now (can be enhanced with ML)
   */
  predictGasPrice(chainId: ChainId, minutesAhead: number): GasPrice | null {
    const history = this.history.get(chainId);
    if (!history || history.length < 10) {
      this.logger.warn('Insufficient history for prediction', { chainId });
      return null;
    }

    // Calculate moving average
    const recentHistory = history.slice(-20); // Last 20 data points
    const avgGasPrice =
      recentHistory.reduce((sum, h) => sum + h.gasPrice, 0n) / BigInt(recentHistory.length);

    // Calculate trend (simple linear regression)
    let trend = 0n;
    if (recentHistory.length >= 5) {
      const first5 = recentHistory.slice(0, 5);
      const last5 = recentHistory.slice(-5);

      const firstAvg = first5.reduce((sum, h) => sum + h.gasPrice, 0n) / BigInt(5);
      const lastAvg = last5.reduce((sum, h) => sum + h.gasPrice, 0n) / BigInt(5);

      trend = lastAvg - firstAvg;
    }

    // Project forward (trend * minutes)
    const projectedIncrease = (trend * BigInt(minutesAhead)) / BigInt(5);
    const predictedPrice = avgGasPrice + projectedIncrease;

    return {
      chainId,
      gasPrice: predictedPrice > 0n ? predictedPrice : avgGasPrice,
      timestamp: Date.now() + minutesAhead * 60 * 1000,
    };
  }

  /**
   * Subscribe to gas price updates for a chain
   * Updates are emitted every cacheTTL interval
   */
  subscribeToGasPriceUpdates(chainId: ChainId, intervalMs?: number): void {
    // Check if already subscribed
    if (this.updateIntervals.has(chainId)) {
      this.logger.debug('Already subscribed to gas price updates', { chainId });
      return;
    }

    const interval = intervalMs || this.cacheTTL;

    this.logger.info('Subscribing to gas price updates', { chainId, interval });

    // Fetch immediately
    this.fetchGasPrice(chainId).catch((error) => {
      this.logger.error('Failed to fetch initial gas price', { chainId, error });
    });

    // Set up interval
    const timer = setInterval(() => {
      this.fetchGasPrice(chainId).catch((error) => {
        this.logger.error('Failed to fetch gas price in interval', { chainId, error });
      });
    }, interval);

    this.updateIntervals.set(chainId, timer);
  }

  /**
   * Unsubscribe from gas price updates
   */
  unsubscribeFromGasPriceUpdates(chainId: ChainId): void {
    const timer = this.updateIntervals.get(chainId);
    if (timer) {
      clearInterval(timer);
      this.updateIntervals.delete(chainId);
      this.logger.info('Unsubscribed from gas price updates', { chainId });
    }
  }

  /**
   * Get average gas price over a time period
   */
  getAverageGasPrice(chainId: ChainId, periodMs: number): bigint | null {
    const history = this.getGasPriceHistory(chainId, periodMs);

    if (history.length === 0) {
      return null;
    }

    const sum = history.reduce((acc, h) => acc + h.gasPrice, 0n);
    return sum / BigInt(history.length);
  }

  /**
   * Get minimum gas price over a time period
   */
  getMinGasPrice(chainId: ChainId, periodMs: number): bigint | null {
    const history = this.getGasPriceHistory(chainId, periodMs);

    if (history.length === 0) {
      return null;
    }

    return history.reduce((min, h) => (h.gasPrice < min ? h.gasPrice : min), history[0].gasPrice);
  }

  /**
   * Get maximum gas price over a time period
   */
  getMaxGasPrice(chainId: ChainId, periodMs: number): bigint | null {
    const history = this.getGasPriceHistory(chainId, periodMs);

    if (history.length === 0) {
      return null;
    }

    return history.reduce((max, h) => (h.gasPrice > max ? h.gasPrice : max), history[0].gasPrice);
  }

  /**
   * Clear cache for a chain
   */
  clearCache(chainId?: ChainId): void {
    if (chainId) {
      this.cache.delete(chainId);
      this.logger.debug('Cleared gas price cache', { chainId });
    } else {
      this.cache.clear();
      this.logger.debug('Cleared all gas price cache');
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    // Clear all intervals
    for (const [chainId, timer] of this.updateIntervals) {
      clearInterval(timer);
      this.logger.debug('Cleared update interval', { chainId });
    }

    this.updateIntervals.clear();
    this.cache.clear();
    this.history.clear();
    this.removeAllListeners();

    this.logger.debug('GasPriceOracle destroyed');
  }
}
