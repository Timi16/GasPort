import {
  type ChainId,
  type RoutingPath,
  type RoutingHop,
  type GasPortConfig,
  RoutingError,
  InsufficientLiquidityError,
} from '@gasport/types';
import type { ChainManager } from '../client/ChainManager';
import type { Logger } from 'pino';
import { GasPriceOracle } from './GasPriceOracle';
import { PathOptimizer } from './PathOptimizer';
import { LiquidityChecker } from './LiquidityChecker';

/**
 * Route cache entry
 */
interface CachedRoute {
  route: RoutingPath;
  expiresAt: number;
}

/**
 * Bridge reliability scores (0-1)
 */
const BRIDGE_RELIABILITY = {
  native: 0.95, // Arbitrum native messaging
  hyperlane: 0.90, // Hyperlane
  layerzero: 0.88, // LayerZero
} as const;

/**
 * Cross-chain routing engine
 * Finds optimal paths between chains considering cost, speed, and reliability
 */
export class CrossChainRouter {
  private chainManager: ChainManager;
  private logger: Logger;
  private gasPriceOracle: GasPriceOracle;
  private pathOptimizer: PathOptimizer;
  private liquidityChecker: LiquidityChecker;
  private config: GasPortConfig;
  private routeCache: Map<string, CachedRoute>;

  constructor(chainManager: ChainManager, config: GasPortConfig, logger: Logger) {
    this.chainManager = chainManager;
    this.config = config;
    this.logger = logger;

    // Initialize components
    this.gasPriceOracle = new GasPriceOracle(chainManager, logger, 5000);
    this.pathOptimizer = new PathOptimizer(logger);
    this.liquidityChecker = new LiquidityChecker(chainManager, logger);
    this.routeCache = new Map();

    // Subscribe to gas price updates for all chains
    for (const chain of config.chains) {
      this.gasPriceOracle.subscribeToGasPriceUpdates(chain.chainId);
    }
  }

  /**
   * Find optimal route between two chains
   */
  async findOptimalRoute(
    from: ChainId,
    to: ChainId,
    token: `0x${string}`,
    amount: bigint,
    options?: {
      maxHops?: number;
      preference?: 'cost' | 'speed' | 'reliability';
    }
  ): Promise<RoutingPath> {
    this.logger.info('Finding optimal route', { from, to, token, amount: amount.toString() });

    // Check cache first
    const cacheKey = `${from}-${to}-${token}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this.logger.debug('Route cache hit', { cacheKey });
      return cached.route;
    }

    // Direct route if same chain
    if (from === to) {
      return this.createDirectRoute(from, to);
    }

    // Set optimization preference
    if (options?.preference) {
      this.pathOptimizer.setPreference(options.preference);
    }

    // Find all possible paths
    const allPaths = await this.findAllPaths(from, to, token, amount, options?.maxHops || 3);

    if (allPaths.length === 0) {
      throw new RoutingError(from, to, 'No viable paths found');
    }

    // Filter paths by liquidity
    const viablePaths = await this.filterByLiquidity(allPaths, token, amount);

    if (viablePaths.length === 0) {
      throw new RoutingError(from, to, 'Insufficient liquidity on all paths');
    }

    // Score and rank paths
    const optimalPath = this.pathOptimizer.findOptimalPath(viablePaths);

    if (!optimalPath) {
      throw new RoutingError(from, to, 'Failed to select optimal path');
    }

    // Add fallback routes
    const rankedPaths = this.pathOptimizer.rankPaths(viablePaths);
    optimalPath.fallbacks = rankedPaths.slice(1, 3); // Top 2 fallbacks

    // Cache the route
    this.routeCache.set(cacheKey, {
      route: optimalPath,
      expiresAt: Date.now() + (this.config.routing?.cacheTTL || 300) * 1000,
    });

    this.logger.info('Optimal route found', {
      from,
      to,
      hops: optimalPath.hops.length,
      cost: optimalPath.estimatedCost.toString(),
      time: optimalPath.estimatedTime,
    });

    return optimalPath;
  }

  /**
   * Create direct route (same chain)
   */
  private createDirectRoute(from: ChainId, to: ChainId): RoutingPath {
    return {
      from,
      to,
      hops: [],
      estimatedCost: 0n,
      estimatedTime: 0,
      reliability: 1.0,
    };
  }

  /**
   * Find all possible paths using BFS
   */
  private async findAllPaths(
    from: ChainId,
    to: ChainId,
    token: `0x${string}`,
    amount: bigint,
    maxHops: number
  ): Promise<RoutingPath[]> {
    const paths: RoutingPath[] = [];
    const queue: Array<{ chain: ChainId; path: RoutingHop[]; visited: Set<ChainId> }> = [
      { chain: from, path: [], visited: new Set([from]) },
    ];

    const supportedChains = this.chainManager.getSupportedChainIds();

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Check if reached destination
      if (current.chain === to) {
        const routingPath = await this.createRoutingPath(from, to, current.path, token, amount);
        paths.push(routingPath);
        continue;
      }

      // Check max hops
      if (current.path.length >= maxHops) {
        continue;
      }

      // Explore neighboring chains
      for (const nextChain of supportedChains) {
        if (current.visited.has(nextChain)) {
          continue; // Skip visited chains
        }

        // Determine best bridge for this hop
        const bridge = this.selectBridge(current.chain, nextChain);

        // Create hop
        const hop: RoutingHop = {
          from: current.chain,
          to: nextChain,
          bridge,
          cost: await this.estimateHopCost(current.chain, nextChain, bridge, amount),
          time: this.estimateHopTime(bridge),
        };

        // Add to queue
        const newVisited = new Set(current.visited);
        newVisited.add(nextChain);

        queue.push({
          chain: nextChain,
          path: [...current.path, hop],
          visited: newVisited,
        });
      }
    }

    this.logger.debug('Found paths', { count: paths.length, from, to });
    return paths;
  }

  /**
   * Create routing path from hops
   */
  private async createRoutingPath(
    from: ChainId,
    to: ChainId,
    hops: RoutingHop[],
    token: `0x${string}`,
    amount: bigint
  ): Promise<RoutingPath> {
    // Calculate total cost
    const hopCosts = hops.reduce((sum, hop) => sum + hop.cost, 0n);

    // Add execution cost on target chain
    const executionCost = await this.estimateExecutionCost(to, amount);

    const totalCost = hopCosts + executionCost;

    // Calculate total time
    const totalTime = hops.reduce((sum, hop) => sum + hop.time, 0);

    // Calculate reliability (product of all hop reliabilities)
    const reliability = hops.reduce(
      (product, hop) => product * BRIDGE_RELIABILITY[hop.bridge],
      1.0
    );

    return {
      from,
      to,
      hops,
      estimatedCost: totalCost,
      estimatedTime: totalTime,
      reliability,
    };
  }

  /**
   * Select best bridge for a hop
   */
  private selectBridge(
    from: ChainId,
    to: ChainId
  ): 'native' | 'hyperlane' | 'layerzero' {
    const preferredBridge = this.config.routing?.preferredBridge;

    // If both chains are Arbitrum/Orbit, prefer native
    if (this.isArbitrumChain(from) && this.isArbitrumChain(to)) {
      return preferredBridge === 'native' || !preferredBridge ? 'native' : preferredBridge;
    }

    // Otherwise use preferred bridge or default to hyperlane
    return preferredBridge || 'hyperlane';
  }

  /**
   * Check if chain is Arbitrum/Orbit
   */
  private isArbitrumChain(chainId: ChainId): boolean {
    return [42161, 42170, 421613, 421614, 660279].includes(chainId);
  }

  /**
   * Estimate cost for a single hop
   */
  private async estimateHopCost(
    from: ChainId,
    to: ChainId,
    bridge: 'native' | 'hyperlane' | 'layerzero',
    amount: bigint
  ): Promise<bigint> {
    try {
      // Get gas prices
      const [fromGas, toGas] = await Promise.all([
        this.gasPriceOracle.getCurrentGasPrice(from),
        this.gasPriceOracle.getCurrentGasPrice(to),
      ]);

      // Estimate gas for bridge operations
      const bridgeGas = {
        native: 100000n, // ~100k gas for Arbitrum native
        hyperlane: 150000n, // ~150k gas for Hyperlane
        layerzero: 200000n, // ~200k gas for LayerZero
      };

      const gasUsed = bridgeGas[bridge];
      const gasCost = gasUsed * fromGas.gasPrice;

      // Add bridge fee (0.1% of amount)
      const bridgeFee = amount / 1000n;

      return gasCost + bridgeFee;
    } catch (error) {
      this.logger.error('Failed to estimate hop cost', { from, to, bridge, error });
      // Return conservative estimate
      return 1000000000000000n; // 0.001 ETH
    }
  }

  /**
   * Estimate execution cost on target chain
   */
  private async estimateExecutionCost(chainId: ChainId, amount: bigint): Promise<bigint> {
    try {
      const gasPrice = await this.gasPriceOracle.getCurrentGasPrice(chainId);

      // Estimate 50k gas for execution
      const gasUsed = 50000n;
      const gasCost = gasUsed * gasPrice.gasPrice;

      return gasCost;
    } catch (error) {
      this.logger.error('Failed to estimate execution cost', { chainId, error });
      return 500000000000000n; // 0.0005 ETH
    }
  }

  /**
   * Estimate time for a hop
   */
  private estimateHopTime(bridge: 'native' | 'hyperlane' | 'layerzero'): number {
    // Time in seconds
    const bridgeTimes = {
      native: 300, // 5 minutes for Arbitrum native
      hyperlane: 180, // 3 minutes for Hyperlane
      layerzero: 120, // 2 minutes for LayerZero
    };

    return bridgeTimes[bridge];
  }

  /**
   * Filter paths by liquidity availability
   */
  private async filterByLiquidity(
    paths: RoutingPath[],
    token: `0x${string}`,
    amount: bigint
  ): Promise<RoutingPath[]> {
    const viablePaths: RoutingPath[] = [];

    for (const path of paths) {
      // Check if all intermediate chains have sufficient liquidity
      let hasLiquidity = true;

      for (const hop of path.hops) {
        const hasEnough = await this.liquidityChecker.hasLiquidity(hop.to, token, amount);
        if (!hasEnough) {
          this.logger.debug('Path filtered due to insufficient liquidity', {
            chain: hop.to,
            token,
            amount: amount.toString(),
          });
          hasLiquidity = false;
          break;
        }
      }

      if (hasLiquidity) {
        viablePaths.push(path);
      }
    }

    return viablePaths;
  }

  /**
   * Clear route cache
   */
  clearCache(): void {
    this.routeCache.clear();
    this.gasPriceOracle.clearCache();
    this.liquidityChecker.clearCache();
    this.logger.debug('Router cache cleared');
  }

  /**
   * Update configuration
   */
  updateConfig(config: GasPortConfig): void {
    this.config = config;
    this.logger.info('Router configuration updated');
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.gasPriceOracle.destroy();
    this.liquidityChecker.destroy();
    this.routeCache.clear();
    this.logger.debug('CrossChainRouter destroyed');
  }
}
