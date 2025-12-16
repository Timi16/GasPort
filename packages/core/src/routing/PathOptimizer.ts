import type { RoutingPath, RoutingHop, ChainId } from '@gasport/types';
import type { Logger } from 'pino';

/**
 * Path scoring weights
 */
export interface PathWeights {
  /** Weight for cost (0-1) */
  cost: number;
  /** Weight for time (0-1) */
  time: number;
  /** Weight for reliability (0-1) */
  reliability: number;
}

/**
 * Default weights favoring cost
 */
export const DEFAULT_WEIGHTS: PathWeights = {
  cost: 0.5,
  time: 0.3,
  reliability: 0.2,
};

/**
 * Optimizes routing paths based on cost, speed, and reliability
 */
export class PathOptimizer {
  private logger: Logger;
  private weights: PathWeights;

  constructor(logger: Logger, weights: PathWeights = DEFAULT_WEIGHTS) {
    this.logger = logger;
    this.weights = weights;

    // Validate weights sum to 1
    const sum = weights.cost + weights.time + weights.reliability;
    if (Math.abs(sum - 1.0) > 0.01) {
      this.logger.warn('Path weights do not sum to 1, normalizing', { weights, sum });
      this.weights = {
        cost: weights.cost / sum,
        time: weights.time / sum,
        reliability: weights.reliability / sum,
      };
    }
  }

  /**
   * Calculate score for a routing path
   * Lower score is better
   */
  calculateScore(path: RoutingPath): number {
    // Normalize values to 0-1 range for comparison
    const normalizedCost = this.normalizeCost(path.estimatedCost);
    const normalizedTime = this.normalizeTime(path.estimatedTime);
    const normalizedReliability = 1 - path.reliability; // Invert so lower is better

    // Calculate weighted score
    const score =
      normalizedCost * this.weights.cost +
      normalizedTime * this.weights.time +
      normalizedReliability * this.weights.reliability;

    this.logger.debug('Path score calculated', {
      from: path.from,
      to: path.to,
      score,
      cost: normalizedCost,
      time: normalizedTime,
      reliability: normalizedReliability,
    });

    return score;
  }

  /**
   * Normalize cost to 0-1 range
   * Uses logarithmic scaling to handle large values
   */
  private normalizeCost(cost: bigint): number {
    const costNumber = Number(cost);
    if (costNumber === 0) return 0;

    // Logarithmic scale: log10(cost) / log10(max_expected_cost)
    // Assuming max expected cost is ~1000 USD (1e21 wei for ETH)
    const maxExpected = 1e21;
    const normalized = Math.log10(costNumber) / Math.log10(maxExpected);

    return Math.min(normalized, 1);
  }

  /**
   * Normalize time to 0-1 range
   * Assumes max reasonable time is 1 hour (3600 seconds)
   */
  private normalizeTime(timeSeconds: number): number {
    const maxTime = 3600; // 1 hour
    return Math.min(timeSeconds / maxTime, 1);
  }

  /**
   * Rank paths by score
   */
  rankPaths(paths: RoutingPath[]): RoutingPath[] {
    return paths
      .map((path) => ({
        path,
        score: this.calculateScore(path),
      }))
      .sort((a, b) => a.score - b.score)
      .map((item) => item.path);
  }

  /**
   * Find optimal path from a set of candidates
   */
  findOptimalPath(paths: RoutingPath[]): RoutingPath | null {
    if (paths.length === 0) {
      return null;
    }

    const ranked = this.rankPaths(paths);
    const optimal = ranked[0];

    this.logger.info('Optimal path selected', {
      from: optimal.from,
      to: optimal.to,
      hops: optimal.hops.length,
      cost: optimal.estimatedCost.toString(),
      time: optimal.estimatedTime,
      reliability: optimal.reliability,
    });

    return optimal;
  }

  /**
   * Filter paths by constraints
   */
  filterPaths(
    paths: RoutingPath[],
    constraints: {
      maxCost?: bigint;
      maxTime?: number;
      minReliability?: number;
      maxHops?: number;
    }
  ): RoutingPath[] {
    return paths.filter((path) => {
      if (constraints.maxCost && path.estimatedCost > constraints.maxCost) {
        this.logger.debug('Path filtered by cost', {
          cost: path.estimatedCost.toString(),
          maxCost: constraints.maxCost.toString(),
        });
        return false;
      }

      if (constraints.maxTime && path.estimatedTime > constraints.maxTime) {
        this.logger.debug('Path filtered by time', {
          time: path.estimatedTime,
          maxTime: constraints.maxTime,
        });
        return false;
      }

      if (constraints.minReliability && path.reliability < constraints.minReliability) {
        this.logger.debug('Path filtered by reliability', {
          reliability: path.reliability,
          minReliability: constraints.minReliability,
        });
        return false;
      }

      if (constraints.maxHops && path.hops.length > constraints.maxHops) {
        this.logger.debug('Path filtered by hops', {
          hops: path.hops.length,
          maxHops: constraints.maxHops,
        });
        return false;
      }

      return true;
    });
  }

  /**
   * Update weights for optimization preference
   */
  updateWeights(weights: Partial<PathWeights>): void {
    this.weights = { ...this.weights, ...weights };

    // Normalize
    const sum = this.weights.cost + this.weights.time + this.weights.reliability;
    if (Math.abs(sum - 1.0) > 0.01) {
      this.weights = {
        cost: this.weights.cost / sum,
        time: this.weights.time / sum,
        reliability: this.weights.reliability / sum,
      };
    }

    this.logger.info('Path weights updated', { weights: this.weights });
  }

  /**
   * Set optimization preference
   */
  setPreference(preference: 'cost' | 'speed' | 'reliability' | 'balanced'): void {
    switch (preference) {
      case 'cost':
        this.updateWeights({ cost: 0.7, time: 0.2, reliability: 0.1 });
        break;
      case 'speed':
        this.updateWeights({ cost: 0.2, time: 0.7, reliability: 0.1 });
        break;
      case 'reliability':
        this.updateWeights({ cost: 0.2, time: 0.2, reliability: 0.6 });
        break;
      case 'balanced':
        this.updateWeights({ cost: 0.33, time: 0.33, reliability: 0.34 });
        break;
    }

    this.logger.info('Optimization preference set', { preference });
  }
}
