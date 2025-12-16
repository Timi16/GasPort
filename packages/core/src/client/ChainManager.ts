import { type GasPortConfig, type ChainInfo, type ChainConfig, ChainId, ChainNotSupportedError } from '@gasport/types';
import { createPublicClient, http, type PublicClient } from 'viem';
import type { Logger } from 'pino';

/**
 * Manages multiple chains and their RPC connections
 */
export class ChainManager {
  private chains: Map<ChainId, ChainConfig>;
  private clients: Map<ChainId, PublicClient>;
  private logger: Logger;

  constructor(config: GasPortConfig, logger: Logger) {
    this.chains = new Map();
    this.clients = new Map();
    this.logger = logger;

    // Initialize chains
    for (const chainConfig of config.chains) {
      this.addChain(chainConfig);
    }
  }

  /**
   * Add a chain
   */
  private addChain(chainConfig: ChainConfig): void {
    this.chains.set(chainConfig.chainId, chainConfig);

    // Create viem client for this chain
    const client = createPublicClient({
      transport: http(chainConfig.rpcUrl, {
        timeout: 30000,
        retryCount: 3,
      }),
    });

    this.clients.set(chainConfig.chainId, client);

    this.logger.debug('Chain added', {
      chainId: chainConfig.chainId,
      name: chainConfig.name,
    });
  }

  /**
   * Get a chain configuration
   */
  getChain(chainId: ChainId): ChainConfig {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new ChainNotSupportedError(chainId);
    }
    return chain;
  }

  /**
   * Get a viem client for a chain
   */
  getClient(chainId: ChainId): PublicClient {
    const client = this.clients.get(chainId);
    if (!client) {
      throw new ChainNotSupportedError(chainId);
    }
    return client;
  }

  /**
   * Get all chains with current info
   */
  async getAllChains(): Promise<ChainInfo[]> {
    const chainInfos: ChainInfo[] = [];

    for (const [chainId, config] of this.chains.entries()) {
      try {
        const client = this.getClient(chainId);

        // Fetch current gas price and block number
        const [gasPrice, blockNumber] = await Promise.all([
          client.getGasPrice().catch(() => undefined),
          client.getBlockNumber().catch(() => undefined),
        ]);

        chainInfos.push({
          config,
          gasPrice,
          blockNumber,
          available: true,
        });
      } catch (error) {
        this.logger.warn('Failed to fetch chain info', { chainId, error });
        chainInfos.push({
          config,
          available: false,
        });
      }
    }

    return chainInfos;
  }

  /**
   * Check if a chain is supported
   */
  isChainSupported(chainId: ChainId): boolean {
    return this.chains.has(chainId);
  }

  /**
   * Get all supported chain IDs
   */
  getSupportedChainIds(): ChainId[] {
    return Array.from(this.chains.keys());
  }

  /**
   * Update configuration
   */
  updateConfig(config: GasPortConfig): void {
    // TODO: Handle dynamic config updates
    // This would require:
    // 1. Comparing old and new configs
    // 2. Removing chains no longer in config
    // 3. Adding new chains
    // 4. Updating existing chains
    this.logger.info('Chain manager config updated');
  }

  /**
   * Destroy and cleanup
   */
  async destroy(): Promise<void> {
    this.chains.clear();
    this.clients.clear();
    this.logger.debug('Chain manager destroyed');
  }
}
